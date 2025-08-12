import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, LoadingController, ToastController } from '@ionic/angular';
import { Storage } from '@ionic/storage-angular';
import { DataService } from 'src/app/services/data/data.service';
import { Subscription, firstValueFrom } from 'rxjs';

type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string };

function toNum(v: any): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.page.html',
  styleUrls: ['./chat.page.scss'],
})
export class ChatPage implements OnInit, OnDestroy {
  @ViewChild(IonContent) content?: IonContent;

  userId: number | null = null;
  questionarioId: number | null = null;
  resultId: number | null = null;

  input = '';
  sending = false;
  ready = false;

  threadSlug: string | null = null;

  messages: ChatMsg[] = [
    { role: 'system', content: 'Chat dedicata al risultato premium (summary).' }
  ];

  private routeSub?: Subscription;
  private bootstrapped = false; // evitiamo doppio open

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private storage: Storage,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private data: DataService
  ) {}

  async ngOnInit() {
    await this.storage.create();

    // user_id sempre da storage
    this.userId = toNum(await this.storage.get('user_id'));

    // idratazione iniziale e subscribe ai cambi rotta
    this.hydrateFromRoute();
    await this.ensureContext();

    this.routeSub = this.route.paramMap.subscribe(async () => {
      this.hydrateFromRoute();
      await this.ensureContext();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  // ===== UI helpers =====
  trackByIdx(i: number): number { return i; }

  private async scrollToBottom(delay = 50) {
    setTimeout(() => this.content?.scrollToBottom(200), delay);
  }

  onEnter(ev: KeyboardEvent) {
    if (ev.shiftKey) return; // consenti a capo
    ev.preventDefault();
    if (this.canSend()) this.send();
  }

  canSend(): boolean {
    return !!this.ready
      && !!this.userId
      && !!this.questionarioId
      && !!this.resultId
      && !this.sending
      && (this.input || '').trim().length > 0;
  }

  async toast(message: string, color: 'success' | 'danger' | 'warning') {
    const t = await this.toastCtrl.create({ message, duration: 2200, color, position: 'top' });
    await t.present();
  }

  // ===== Context =====
  private hydrateFromRoute() {
    const p  = this.route.snapshot.paramMap;
    const qp = this.route.snapshot.queryParamMap;
    const st = history.state || {};

    // rotta principale: /public/chat/:resultId?questionario_id=123
    const rid =
      toNum(p.get('resultId')) ??
      toNum(p.get('result_id')) ??
      toNum(qp.get('result_id')) ??
      toNum(qp.get('rid')) ??
      toNum(st.result_id) ??
      null;

    const qid =
      toNum(qp.get('questionario_id')) ??
      toNum(qp.get('qid')) ??
      toNum(st.questionario_id) ??
      null;

    if (rid) this.resultId = rid;
    if (qid) this.questionarioId = qid;
  }

  private async ensureContext() {
    // fallback dallo storage se manca qualcosa
    if (!this.questionarioId || !this.resultId) {
      const saved = await this.storage.get('last_premium_chat');
      if (saved) {
        if (!this.questionarioId) this.questionarioId = toNum(saved.questionario_id);
        if (!this.resultId)      this.resultId      = toNum(saved.result_id);
      }
    }

    if (!this.userId) {
      this.ready = false;
      await this.toast('Sessione non valida: manca user_id.', 'danger');
      return;
    }

    // se manca resultId prova a recuperarlo dal summary
    if (this.userId && this.questionarioId && !this.resultId) {
      const overlay = await this.loadingCtrl.create({ message: 'Recupero contesto…', spinner: 'crescent' });
      await overlay.present();
      try {
        try {
          const det = await firstValueFrom(this.data.getAiDetailsPremium(this.userId, this.questionarioId, 'summary'));
          const metaId = det?.result_id ?? det?.meta?.result_id;
          if (toNum(metaId)) this.resultId = Number(metaId);
        } catch { /* ignore */ }

        if (!this.resultId) {
          const latest = await firstValueFrom(this.data.getLatestPremiumResultId(this.userId, this.questionarioId, 'summary'));
          const rid = toNum(latest?.data?.result_id);
          if (rid) this.resultId = rid;
        }
      } finally {
        await overlay.dismiss();
      }
    }

    // salva per aperture future
    await this.storage.set('last_premium_chat', {
      user_id: this.userId,
      questionario_id: this.questionarioId,
      result_id: this.resultId
    });

    this.ready = !!this.userId && !!this.questionarioId && !!this.resultId && this.resultId > 0;

    // === NEW: bootstrap thread una volta, così il prompt di sistema viene fissato lato server ===
    if (this.ready && !this.bootstrapped) {
      try {
        const opened = await firstValueFrom(
          this.data.openChatSessionViaBackend({
            user_id: this.userId!,
            questionario_id: this.questionarioId!,
            result_id: this.resultId! // lega la chat al summary
          })
        );
        this.threadSlug = opened?.thread_slug || this.threadSlug;
        this.bootstrapped = true;
      } catch (e) {
        // Se fallisce l'open non blocchiamo la pagina: il send può comunque andare (il server può risolvere il thread)
        console.warn('openChatSessionViaBackend failed:', e);
      }
    }

    if (this.ready) this.scrollToBottom();
  }

  async refreshContext() {
    await this.ensureContext();
    if (!this.ready) {
      await this.toast('Contesto non pronto.', 'warning');
    } else {
      await this.toast('Contesto aggiornato.', 'success');
    }
  }

  doRefresh(ev: CustomEvent) {
    this.refreshContext().finally(() => (ev.target as any)?.complete?.());
  }

  // ===== Send =====
  async send() {
    const text = (this.input || '').trim();
    if (!text) {
      await this.toast('Scrivi un messaggio', 'warning');
      return;
    }
    if (!this.ready || !this.userId || !this.questionarioId || !this.resultId) {
      await this.toast('Sessione non valida: contesto incompleto.', 'danger');
      return;
    }

    this.sending = true;
    this.messages.push({ role: 'user', content: text });
    this.input = '';
    this.scrollToBottom();

    try {
      const res = await firstValueFrom(
        this.data.sendChatMessageViaBackend({
          user_id: this.userId!,
          questionario_id: this.questionarioId!,
          result_id: this.resultId!,
          thread_slug: this.threadSlug || undefined, // opzionale: il server sa risolvere anche senza
          message: text
        })
      );

      if (res?.thread_slug) this.threadSlug = res.thread_slug;

      const reply = (res?.reply || '').toString();
      this.messages.push({
        role: 'assistant',
        content: reply || '(nessuna risposta dal modello)'
      });
      this.scrollToBottom();
    } catch (e: any) {
      const msg = e?.message || 'Errore nell’invio del messaggio';
      this.messages.push({ role: 'assistant', content: `⚠️ ${msg}` });
      await this.toast(msg, 'danger');
    } finally {
      this.sending = false;
    }
  }
}
