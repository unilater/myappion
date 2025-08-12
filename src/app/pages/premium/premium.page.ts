import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { Storage } from '@ionic/storage-angular';
import { DataService, AiStatus } from 'src/app/services/data/data.service';
import { forkJoin, of, interval, Subscription } from 'rxjs';
import { catchError, finalize, map, take } from 'rxjs/operators';

type PremiumQuestionarioItem = {
  id: number;
  titolo: string;
  descrizione?: string | null;
  num_domande?: number | null;
  num_prompts?: number | null;
};

type PremiumItemView = PremiumQuestionarioItem & {
  completed?: boolean;
  checking?: boolean;
  initialized?: boolean;
};

type InitStats = { enqueued?: number; duplicates?: number; total?: number };
type Status = AiStatus & { total?: number };

@Component({
  selector: 'app-premium',
  templateUrl: './premium.page.html',
  styleUrls: ['./premium.page.scss'],
})
export class PremiumPage implements OnInit, OnDestroy {
  items: PremiumItemView[] = [];
  loading = false;
  userId: number | null = null;

  initLoading: Record<number, boolean> = {};

  statusMap = new Map<number, Status>();
  detailsMap = new Map<number, Record<string, string>>();

  openedIds: number[] = [];
  private pollingSubs = new Map<number, Subscription>();

  constructor(
    private data: DataService,
    private router: Router,
    private storage: Storage,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController
  ) {}

  async ngOnInit() {
    await this.storage.create();
    this.userId = await this.storage.get('user_id');
    await this.load();
  }

  ngOnDestroy(): void { this.stopAllPolling(); }

  trackById(_: number, q: PremiumItemView) { return q.id; }

  async load(event?: any) {
    if (!event) this.loading = true;
    const overlay = await this.loadingCtrl.create({ message: 'Caricamento questionari premium...', spinner: 'crescent' });
    if (!event) await overlay.present();

    this.data.getElencoQuestionariPremium().pipe(
      finalize(() => { this.loading = false; if (!event) overlay.dismiss(); else event.target.complete(); })
    ).subscribe({
      next: async (res) => {
        if (res?.success && Array.isArray(res.data)) {
          this.items = res.data.map((q: any) => ({
            id: Number(q.id),
            titolo: q.titolo ?? `Questionario ${q.id}`,
            descrizione: q.descrizione ?? '',
            num_domande: q.num_domande ?? 0,
            checking: true,
            completed: false,
            initialized: false
          }));

          await this.checkAllCompletions();

          this.items.forEach(it => { this.refreshStatus(it.id); this.refreshDetails(it.id); });
          this.reconcileMapsWithList();
        } else {
          this.items = [];
          await this.presentToast('Nessun questionario premium disponibile', 'warning');
        }
      },
      error: async () => {
        this.items = [];
        await this.presentToast('Errore di rete nel caricamento (premium)', 'danger');
      }
    });
  }

  private reconcileMapsWithList() {
    const ids = new Set(this.items.map(i => i.id));
    Array.from(this.pollingSubs.keys()).forEach(id => { if (!ids.has(id)) this.stopPolling(id); });
    Array.from(this.statusMap.keys()).forEach(id => { if (!ids.has(id)) this.statusMap.delete(id); });
    Array.from(this.detailsMap.keys()).forEach(id => { if (!ids.has(id)) this.detailsMap.delete(id); });
    this.openedIds = this.openedIds.filter(id => ids.has(id));
  }

  private isUpload(q: any): boolean {
    const t = (q?.tipo || '').toString().trim().toLowerCase();
    const looksLikeUploadOptions =
      Array.isArray(q?.opzioni) &&
      q.opzioni.length > 0 &&
      q.opzioni.every((o: any) => o && typeof o === 'object' && 'nome' in o);
    return t === 'upload' || (!t && looksLikeUploadOptions);
  }

  private filled(val: any): boolean {
    if (val === null || val === undefined) return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
    const s = String(val).trim();
    return s.length > 0 || s === '0';
  }

  private async checkAllCompletions() {
    if (!this.userId || !this.items.length) return;

    const checks$ = this.items.map(item =>
      forkJoin([
        this.data.getDomandeQuestionarioPremium(item.id),
        this.data.getQuestionarioPremium(this.userId!, item.id)
      ]).pipe(
        map(([domandeRes, ansRes]) => {
          const domande = (domandeRes?.success ? domandeRes.data : []) || [];
          const answers: Record<string, any> = (ansRes?.success ? ansRes.data : {}) || {};
          for (const q of domande) {
            if (!q?.obbligatoria) continue;
            const key = String(q.id);
            const val = answers[key];
            if (this.isUpload(q)) {
              const opts = Array.isArray(q.opzioni) ? q.opzioni : [];
              if (!opts.length) {
                if (!val || typeof val !== 'object' || !this.filled(val)) return false;
              } else {
                if (!val || typeof val !== 'object') return false;
                const allHave = opts.every((o: any) => this.filled(val[o.id] ?? val[String(o.id)]));
                if (!allHave) return false;
              }
            } else {
              if (!this.filled(val)) return false;
            }
          }
          return true;
        }),
        catchError(() => of(false))
      )
    );

    await new Promise<void>((resolve) => {
      forkJoin(checks$).subscribe(results => {
        this.items = this.items.map((it, idx) => ({ ...it, completed: !!results[idx], checking: false }));
        resolve();
      });
    });
  }

  apri(id: number) { this.router.navigate(['/premium-detail', id]); }

  async inizializza(item: PremiumItemView) {
    if (!this.userId) return void this.presentToast('Devi effettuare l’accesso', 'warning');
    if (!item.completed) return void this.presentToast('Completa prima tutte le domande obbligatorie', 'warning');
    if (this.hasAnyActiveQueue()) return void this.presentToast('Elaborazioni in corso. Attendi il completamento.', 'warning');

    this.initLoading[item.id] = true;
    const overlay = await this.loadingCtrl.create({ message: 'Inizializzazione in corso…', spinner: 'crescent' });
    await overlay.present();

    this.data.inizializzaPremium(this.userId, item.id).pipe(
      finalize(() => { this.initLoading[item.id] = false; overlay.dismiss(); })
    ).subscribe({
      next: async (res) => {
        if (res?.success) {
          const stats: InitStats = (res.data ?? {});
          const en = stats.enqueued ?? 0, du = stats.duplicates ?? 0, tot = stats.total ?? (en + du);
          await this.presentToast(`Processo avviato. Job in coda: ${en} (duplicati: ${du} / totale: ${tot})`, 'success');
          this.startPolling(item.id);
          this.refreshStatus(item.id);
          this.refreshDetails(item.id);
        } else {
          await this.presentToast(res?.message || 'Errore nell’inizializzazione', 'danger');
        }
      },
      error: async () => { await this.presentToast('Errore di rete durante l’inizializzazione', 'danger'); }
    });
  }

  // ======= Stato & Dettagli (premium) =======
  private startPolling(questionarioId: number) {
    this.stopPolling(questionarioId);
    this.refreshStatus(questionarioId);
    this.refreshDetails(questionarioId);
    const sub = interval(4000).subscribe(() => { this.refreshStatus(questionarioId); this.refreshDetails(questionarioId); });
    this.pollingSubs.set(questionarioId, sub);
  }

  private stopPolling(questionarioId: number) {
    const sub = this.pollingSubs.get(questionarioId);
    if (sub) { sub.unsubscribe(); this.pollingSubs.delete(questionarioId); }
  }

  private stopAllPolling() { this.pollingSubs.forEach(s => s.unsubscribe()); this.pollingSubs.clear(); }

  private refreshStatus(questionarioId: number) {
    if (!this.userId) return;
    this.data.getAiStatusPremium(this.userId, questionarioId).pipe(take(1)).subscribe({
      next: (res) => {
        if (res?.success && res.data) {
          const s = res.data as AiStatus;
          const total = typeof (s as any).total === 'number' ? (s as any).total : (s.queued + s.running + s.done + s.error);
          this.statusMap.set(questionarioId, { ...s, total });
          if (total > 0 && s.done === total) this.stopPolling(questionarioId);
        }
      }
    });
  }

  // decode entities and normalize accidental <pre> wrappers from API
  private decodeHtml(v: string): string {
    const ta = document.createElement('textarea');
    ta.innerHTML = v ?? '';
    return ta.value;
  }
  private normalizeApiHtml(html: string): string {
    const decoded = this.decodeHtml(html);
    // se l'API ha incapsulato in <pre>, sostituisci con un div wrappabile
    return decoded
      .replace(/<pre\b[^>]*>/gi, '<div class="pre-wrap">')
      .replace(/<\/pre>/gi, '</div>');
  }

  private refreshDetails(questionarioId: number) {
    if (!this.userId) return;
    this.data.getAiDetailsPremium(this.userId, questionarioId, 'summary').pipe(take(1)).subscribe({
      next: (res) => {
        if (res?.success && res.data) {
          const normalized: Record<string, string> = {};
          Object.keys(res.data).forEach(k => normalized[k] = this.normalizeApiHtml(res.data[k]));
          this.detailsMap.set(questionarioId, normalized);
        }
      }
    });
  }

  // ======= Helpers UI =======
  public hasAnyActiveQueue(): boolean {
    for (const st of this.statusMap.values()) {
      const queued = st?.queued ?? 0, running = st?.running ?? 0;
      if (queued + running > 0) return true;
    }
    return false;
  }

  public getStatus(id: number): Status | null { return this.statusMap?.get(id) ?? null; }

  public getOverallLabel(st: Status): string {
    if (!st) return '—';
    if (st.error > 0) return 'Attenzione';
    if (st.running > 0) return 'In esecuzione';
    if (st.done > 0 && st.done === st.total) return 'Completato';
    if (st.done > 0) return 'Parzialmente completato';
    return 'In coda';
  }
  public getOverallColor(st: Status): 'danger' | 'warning' | 'success' | 'medium' | 'tertiary' {
    if (!st) return 'medium';
    if (st.error > 0) return 'danger';
    if (st.running > 0) return 'warning';
    if (st.done > 0 && st.done === st.total) return 'success';
    if (st.done > 0) return 'tertiary';
    return 'medium';
  }

  public objectKeys(obj: Record<string, any> | null | undefined) { return obj ? Object.keys(obj) : []; }

  // TRUE se esiste già un sommario non vuoto → nascondi azioni
  public hasSummary(id: number): boolean {
    const det = this.detailsMap.get(id);
    if (!det) return false;
    return Object.values(det).some(v => (v ?? '').toString().trim().length > 0);
  }

  private async presentToast(message: string, color: 'success' | 'danger' | 'warning') {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'top' });
    await toast.present();
  }
}
