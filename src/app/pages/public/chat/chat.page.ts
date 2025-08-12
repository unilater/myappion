import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonContent, ToastController } from '@ionic/angular';
import { DataService } from 'src/app/services/data/data.service';
import { firstValueFrom } from 'rxjs';

type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string };

function toNum(v: any): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }

@Component({
  selector: 'app-chat',
  templateUrl: './chat.page.html',
  styleUrls: ['./chat.page.scss'],
})
export class ChatPage implements OnInit, OnDestroy {
  @ViewChild(IonContent) content?: IonContent;

  // Solo per il primo invio
  resultId: number | null = null;

  input = '';
  sending = false;
  ready = false;

  // Solo per mostrare a UI; la gestione reale è nel DataService
  threadSlug: string | null = null;

  messages: ChatMsg[] = [
    { role: 'system', content: 'Chat basata sul summary (response_text) del result_id passato nella rotta.' }
  ];

  constructor(
    private route: ActivatedRoute,
    private toastCtrl: ToastController,
    private data: DataService
  ) {}

  async ngOnInit() {
    // Legge resultId da /chat/:resultId o query/state
    const p  = this.route.snapshot.paramMap;
    const qp = this.route.snapshot.queryParamMap;
    const st = history.state || {};
    this.resultId =
      toNum(p.get('resultId')) ??
      toNum(qp.get('result_id')) ??
      toNum(st.result_id) ??
      this.resultId;

    // Ogni apertura/refresh = nuova sessione (richiederà result_id al primo invio)
    this.data.startChatSession();
    this.threadSlug = null;

    this.ready = true;
    this.scrollToBottom();
  }

  ngOnDestroy(): void {}

  trackByIdx(i: number) { return i; }

  private scrollToBottom(delay = 50) { setTimeout(() => this.content?.scrollToBottom(200), delay); }

  onEnter(ev: KeyboardEvent) {
    if (ev.shiftKey) return;      // Shift+Invio = a capo
    ev.preventDefault();
    if (this.canSend()) this.send();
  }

  canSend(): boolean {
    const hasText = (this.input || '').trim().length > 0;
    // Al primo giro (senza thread) è necessario avere resultId
    const firstOk = !this.threadSlug ? !!this.resultId : true;
    return this.ready && !this.sending && hasText && firstOk;
  }

  private async toast(message: string, color: 'success' | 'danger' | 'warning') {
    const t = await this.toastCtrl.create({ message, duration: 2000, color, position: 'top' });
    await t.present();
  }

  async send() {
    const text = (this.input || '').trim();
    if (!text) { await this.toast('Scrivi un messaggio', 'warning'); return; }

    if (!this.threadSlug && !this.resultId) {
      await this.toast('Manca result_id per il primo invio.', 'danger');
      return;
    }

    this.sending = true;
    this.messages.push({ role: 'user', content: text });
    this.input = '';
    this.scrollToBottom();

    try {
      // Costruisci payload per il backend (il DataService aggiunge session_id e gestisce thread)
      const payload: any = { message: text };
      if (this.threadSlug) {
        payload.thread_slug = this.threadSlug;  // follow-up
      } else {
        payload.result_id = this.resultId!;     // primo giro
        // opzionale: prompt extra “soft”
        payload.prompt = `Rispondi in italiano, chiaro e sintetico.
Usa il contesto del summary (preface). Se manca qualcosa, dai una risposta generale e indica quali dati servono per personalizzare.
Struttura: - Risposta breve - Cosa manca - Prossimi passi.`;
      }

      const res = await firstValueFrom(this.data.sendChatMessage(payload));

      // Mostra slug (gestito comunque in memoria dal service)
      if (res?.thread_slug) {
        this.threadSlug = res.thread_slug;
      }

      const reply = (res?.reply || '').toString();
      this.messages.push({ role: 'assistant', content: reply || '(nessuna risposta dal modello)' });
      this.scrollToBottom();
    } catch (e: any) {
      const msg = e?.message || 'Errore nell’invio del messaggio';
      this.messages.push({ role: 'assistant', content: `⚠️ ${msg}` });
      await this.toast(msg, 'danger');
    } finally {
      this.sending = false;
    }
  }

  // Avvia una nuova conversazione durante la stessa schermata
  async newSession() {
    this.data.resetChatSession(); // azzera sessione e thread nel service
    this.threadSlug = null;
    await this.toast('Nuova sessione: al prossimo invio verrà ricreato il contesto dal result_id.', 'success');
  }
}
