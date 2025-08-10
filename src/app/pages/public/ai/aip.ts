import { Component, OnDestroy, OnInit } from '@angular/core';
import { LoadingController, ToastController } from '@ionic/angular';
import { Storage } from '@ionic/storage-angular';
import { DataService, AiStatus } from 'src/app/services/data/data.service';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { finalize, take, filter } from 'rxjs/operators';

type QItem = { id: number; titolo: string; descrizione?: string | null; num_domande?: number | null };
type Status = AiStatus & { total?: number };

@Component({
  selector: 'app-ai',
  templateUrl: './ai.page.html',
  styleUrls: ['./ai.page.scss'],
})
export class AiPage implements OnInit, OnDestroy {
  userId: number | null = null;

  // elenco questionari
  questionari: QItem[] = [];
  loadingList = false;

  // stato e dettagli per questionario
  statusMap = new Map<number, Status>();
  detailsMap = new Map<number, Record<string, string>>();

  // tracking init e polling per questionario
  private pollingSubs = new Map<number, Subscription>();
  private initBusy: Record<number, boolean> = {};

  // router
  private routerSub?: Subscription;

  // supporto multi-espansione nell'accordion
  public openedIds: number[] = [];

  constructor(
    private dataService: DataService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private storage: Storage,
    private router: Router
  ) {}

  // ===== Lifecycle =====
  async ngOnInit() {
    await this.ensureUser();
    if (!this.userId) return;

    await this.reloadAll(); // primo load

    // ricarico quando si torna a /ai via routing (back, link interni, etc.)
    this.routerSub = this.router.events
      .pipe(filter(ev => ev instanceof NavigationEnd))
      .subscribe(async () => {
        if (this.router.url.includes('/ai')) {
          await this.reloadAll();
        }
      });
  }

  // chiamata da Ionic ogni volta che la pagina rientra in vista (anche da back stack)
  async ionViewWillEnter() {
    if (!this.userId) {
      await this.ensureUser();
    }
    if (this.userId) {
      await this.reloadAll();
    }
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.stopAllPolling();
  }

  // ===== Boot / reload =====
  private async ensureUser() {
    await this.storage.create();
    this.userId = await this.storage.get('user_id');
    if (!this.userId) {
      await this.toast('Errore: utente non autenticato', 'danger');
      this.router.navigate(['/signin']);
    }
  }

  /** ricarica elenco + stato + dettagli, ripulisce ciò che è stato rimosso lato server */
  private async reloadAll() {
    await this.loadQuestionari();
    // Prefetch stato/dettagli dei questionari visibili
    this.questionari.forEach(q => {
      this.refreshStatus(q.id);
      this.refreshDetails(q.id);
    });
    // Riconcilia mappe/polling per rimuovere residui di questionari cancellati
    this.reconcileMapsWithList();
  }

  // ===== Lista questionari =====
  private async loadQuestionari() {
    this.loadingList = true;
    this.dataService.getElencoQuestionari()
      .pipe(take(1), finalize(() => (this.loadingList = false)))
      .subscribe({
        next: (res) => {
          if (res?.success && Array.isArray(res.data)) {
            const list: QItem[] = res.data.map((q: any) => ({
              id: Number(q.id),
              titolo: q.titolo ?? `Questionario ${q.id}`,
              descrizione: q.descrizione ?? null,
              num_domande: q.num_domande ?? null
            }));
            this.questionari = list;
          } else {
            this.questionari = [];
            this.toast('Nessun questionario disponibile', 'warning');
          }
        },
        error: () => {
          this.questionari = [];
          this.toast('Errore nel caricamento dei questionari', 'danger');
        }
      });
  }

  /** elimina da statusMap/detailsMap/polling gli id non più presenti nella lista */
  private reconcileMapsWithList() {
    const ids = new Set(this.questionari.map(q => q.id));
    // stop polling orfani
    Array.from(this.pollingSubs.keys()).forEach(id => {
      if (!ids.has(id)) this.stopPolling(id);
    });
    // pulizia mappe
    Array.from(this.statusMap.keys()).forEach(id => {
      if (!ids.has(id)) this.statusMap.delete(id);
    });
    Array.from(this.detailsMap.keys()).forEach(id => {
      if (!ids.has(id)) this.detailsMap.delete(id);
    });
    // chiudi eventuali accordion per id scomparsi
    this.openedIds = this.openedIds.filter(id => ids.has(id));
  }

  // ===== Inizializzazione per-id =====
  async inizializzaAI(questionarioId: number) {
    if (!this.userId || this.initBusy[questionarioId]) return;

    // fail-safe: blocca se c’è una queue attiva (globale)
    if (this.hasAnyActiveQueue()) {
      this.toast('Elaborazioni in corso. Attendi il completamento.', 'warning');
      return;
    }

    this.initBusy[questionarioId] = true;
    const loading = await this.loadingCtrl.create({
      message: `Inizializzazione Q${questionarioId}...`,
      spinner: 'crescent'
    });
    await loading.present();

    this.dataService.inizializzaAI(this.userId, questionarioId)
      .pipe(take(1), finalize(async () => {
        this.initBusy[questionarioId] = false;
        await loading.dismiss();
      }))
      .subscribe({
        next: (res: any) => {
          if (res?.success) {
            this.toast(`Q${questionarioId}: inizializzato (${res.data?.jobs ?? 0} job)`, 'success');
            this.startPolling(questionarioId);
            // ricarico stato/dettagli subito
            this.refreshStatus(questionarioId);
            this.refreshDetails(questionarioId);
          } else {
            this.toast(`Q${questionarioId}: errore inizializzazione`, 'danger');
          }
        },
        error: () => {
          this.toast(`Q${questionarioId}: errore di rete`, 'danger');
        }
      });
  }

  isInitBusy(id: number): boolean {
    return !!this.initBusy[id];
  }

  // ===== Polling per-id =====
  private startPolling(questionarioId: number) {
    this.stopPolling(questionarioId);          // evita doppio polling
    this.refreshStatus(questionarioId);        // subito
    this.refreshDetails(questionarioId);       // subito
    const sub = interval(4000).subscribe(() => {
      this.refreshStatus(questionarioId);
      this.refreshDetails(questionarioId);
    });
    this.pollingSubs.set(questionarioId, sub);
  }

  private stopPolling(questionarioId: number) {
    const sub = this.pollingSubs.get(questionarioId);
    if (sub) {
      sub.unsubscribe();
      this.pollingSubs.delete(questionarioId);
    }
  }

  private stopAllPolling() {
    this.pollingSubs.forEach(s => s.unsubscribe());
    this.pollingSubs.clear();
  }

  // ===== Stato & Dettagli per-id =====
  refreshStatus(questionarioId: number) {
    if (!this.userId) return;
    this.dataService.getAiStatus(this.userId, questionarioId)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            const s = res.data as AiStatus;
            const total = typeof (s as any).total === 'number'
              ? (s as any).total
              : (s.queued + s.running + s.done + s.error);
            this.statusMap.set(questionarioId, { ...s, total });

            // se tutto fatto, ferma il polling solo per questo questionario
            if (total > 0 && s.done === total) this.stopPolling(questionarioId);
          }
        },
        error: () => {}
      });
  }

  refreshDetails(questionarioId: number) {
    if (!this.userId) return;
    this.dataService.getAiDetails(this.userId, questionarioId)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            this.detailsMap.set(questionarioId, res.data); // { chiave: '<html>' }
          }
        },
        error: () => {}
      });
  }

  // ===== Regole bottone Inizializza =====
  /** true se QUALSIASI questionario ha queue attive (queued + running > 0) */
  public hasAnyActiveQueue(): boolean {
    for (const st of this.statusMap.values()) {
      const queued = st?.queued ?? 0;
      const running = st?.running ?? 0;
      if (queued + running > 0) return true;
    }
    return false;
  }

  /** true se la CARD specifica ha queue attive */
  public hasActiveQueueFor(id: number): boolean {
    const st = this.statusMap.get(id);
    return !!st && ((st.queued ?? 0) + (st.running ?? 0) > 0);
  }

  // ===== UI helpers =====
  public trackById = (_: number, q: QItem) => q.id;

  public getStatus(id: number): Status | null {
    return this.statusMap?.get(id) ?? null;
  }

  public getProgress(st: Status): number {
    if (!st || !st.total) return 0;
    const v = st.done / st.total;
    return Math.max(0, Math.min(1, v));
  }

  public getPercent(st: Status): number {
    return Math.round(this.getProgress(st) * 100);
  }

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

  public objectKeys(obj: Record<string, any> | null | undefined) {
    return obj ? Object.keys(obj) : [];
  }

  // ===== Toast =====
  private async toast(msg: string, color: 'success' | 'danger' | 'warning' | 'primary' | 'medium' = 'medium') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2500, color, position: 'top' });
    await t.present();
  }
}