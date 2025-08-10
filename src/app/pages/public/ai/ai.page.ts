import { Component, OnDestroy, OnInit } from '@angular/core';
import { LoadingController, ToastController } from '@ionic/angular';
import { Storage } from '@ionic/storage-angular';
import { DataService, AiStatus } from 'src/app/services/data/data.service';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, interval, firstValueFrom } from 'rxjs';
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

  questionari: QItem[] = [];
  loadingList = false;

  statusMap = new Map<number, Status>();
  detailsMap = new Map<number, Record<string, string>>();

  private pollingSubs = new Map<number, Subscription>();
  private initBusy: Record<number, boolean> = {};
  private routerSub?: Subscription;

  // per accordion multiplo
  public openedIds: number[] = [];

  // evita ricarichi concorrenti
  private isReloading = false;

  constructor(
    private dataService: DataService,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private storage: Storage,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.ensureUser();
    if (!this.userId) return;

    await this.reloadAll();

    // ricarica quando si ritorna su /ai
    this.routerSub = this.router.events
      .pipe(filter((ev): ev is NavigationEnd => ev instanceof NavigationEnd))
      .subscribe(async () => {
        if (this.router.url.includes('/ai')) await this.reloadAll();
      });
  }

  async ionViewWillEnter() {
    if (!this.userId) await this.ensureUser();
    if (this.userId) await this.reloadAll();
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
    this.stopAllPolling();
  }

  // ===== Boot/reload =====
  private async ensureUser() {
    await this.storage.create();
    this.userId = await this.storage.get('user_id');
    if (!this.userId) {
      await this.toast('Errore: utente non autenticato', 'danger');
      this.router.navigate(['/signin']);
    }
  }

  private async reloadAll() {
    if (this.isReloading) return;
    this.isReloading = true;

    try {
      await this.loadQuestionari(); // <-- ora aspetta davvero

      // solo dopo che la lista è pronta
      this.questionari.forEach(q => {
        this.refreshStatus(q.id);
        this.refreshDetails(q.id);
      });

      this.reconcileMapsWithList();
    } finally {
      this.isReloading = false;
    }
  }

  private async loadQuestionari(): Promise<void> {
    this.loadingList = true;
    try {
      const res: any = await firstValueFrom(
        this.dataService.getElencoQuestionari().pipe(take(1))
      );

      if (res?.success && Array.isArray(res.data)) {
        this.questionari = res.data.map((q: any) => ({
          id: Number(q.id),
          titolo: q.titolo ?? `Questionario ${q.id}`,
          descrizione: q.descrizione ?? null,
          num_domande: q.num_domande ?? null
        }));
      } else {
        this.questionari = [];
        this.toast('Nessun questionario disponibile', 'warning');
      }
    } catch {
      this.questionari = [];
      this.toast('Errore nel caricamento dei questionari', 'danger');
    } finally {
      this.loadingList = false;
    }
  }

  private reconcileMapsWithList() {
    const ids = new Set(this.questionari.map(q => q.id));
    Array.from(this.pollingSubs.keys()).forEach(id => { if (!ids.has(id)) this.stopPolling(id); });
    Array.from(this.statusMap.keys()).forEach(id => { if (!ids.has(id)) this.statusMap.delete(id); });
    Array.from(this.detailsMap.keys()).forEach(id => { if (!ids.has(id)) this.detailsMap.delete(id); });
    this.openedIds = this.openedIds.filter(id => ids.has(id));
  }

  // ===== Init AI =====
  async inizializzaAI(questionarioId: number) {
    if (!this.userId || this.initBusy[questionarioId]) return;

    if (this.hasAnyActiveQueue()) {
      this.toast('Elaborazioni in corso. Attendi il completamento.', 'warning');
      return;
    }
    if (this.isCompleted(questionarioId)) {
      this.toast('Questionario già completato.', 'primary');
      return;
    }

    this.initBusy[questionarioId] = true;
    const loading = await this.loadingCtrl.create({ message: `Inizializzazione Q${questionarioId}...`, spinner: 'crescent' });
    await loading.present();

    this.dataService.inizializzaAI(this.userId, questionarioId)
      .pipe(take(1), finalize(async () => { this.initBusy[questionarioId] = false; await loading.dismiss(); }))
      .subscribe({
        next: (res: any) => {
          if (res?.success) {
            this.toast(`Q${questionarioId}: inizializzato (${res.data?.jobs ?? 0} job)`, 'success');
            this.startPolling(questionarioId);
            this.refreshStatus(questionarioId);
            this.refreshDetails(questionarioId);
          } else {
            this.toast(`Q${questionarioId}: errore inizializzazione`, 'danger');
          }
        },
        error: () => this.toast(`Q${questionarioId}: errore di rete`, 'danger')
      });
  }

  isInitBusy(id: number): boolean { return !!this.initBusy[id]; }

  // ===== Polling =====
  private startPolling(questionarioId: number) {
    this.stopPolling(questionarioId);
    this.refreshStatus(questionarioId);
    this.refreshDetails(questionarioId);
    const sub = interval(4000).subscribe(() => {
      this.refreshStatus(questionarioId);
      this.refreshDetails(questionarioId);
    });
    this.pollingSubs.set(questionarioId, sub);
  }

  private stopPolling(questionarioId: number) {
    const sub = this.pollingSubs.get(questionarioId);
    if (sub) { sub.unsubscribe(); this.pollingSubs.delete(questionarioId); }
  }

  private stopAllPolling() {
    this.pollingSubs.forEach(s => s.unsubscribe());
    this.pollingSubs.clear();
  }

  // ===== Stato & Dettagli =====
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
        next: (res) => { if (res?.success && res.data) this.detailsMap.set(questionarioId, res.data); },
        error: () => {}
      });
  }

  // ===== Regole visibilità bottone =====
  public hasAnyActiveQueue(): boolean {
    for (const st of this.statusMap.values()) {
      const queued = st?.queued ?? 0;
      const running = st?.running ?? 0;
      if (queued + running > 0) return true;
    }
    return false;
  }

  public isCompleted(id: number): boolean {
    const st = this.statusMap.get(id);
    const total = st?.total ?? 0;
    return !!st && total > 0 && st.done === total;
  }

  // ===== UI helpers =====
  public trackById = (_: number, q: QItem) => q.id;
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

  // ===== Azioni UI =====
  public async refresh() { await this.reloadAll(); }
  public doRefresh(ev: CustomEvent) { this.refresh().finally(() => (ev.target as HTMLIonRefresherElement)?.complete()); }
  public openSettings() { console.log('openSettings'); }

  // ===== Toast =====
  private async toast(msg: string, color: 'success' | 'danger' | 'warning' | 'primary' | 'medium' = 'medium') {
    const t = await this.toastCtrl.create({ message: msg, duration: 2500, color, position: 'top' });
    await t.present();
  }
}
