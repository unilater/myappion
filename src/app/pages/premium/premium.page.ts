import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { Storage } from '@ionic/storage-angular';
import { DataService } from 'src/app/services/data/data.service';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';

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
  initialized?: boolean; // futuro: se inizializza già premuto
};

type InitStats = { enqueued?: number; duplicates?: number; total?: number };

@Component({
  selector: 'app-premium',
  templateUrl: './premium.page.html',
  styleUrls: ['./premium.page.scss'],
})
export class PremiumPage implements OnInit {
  items: PremiumItemView[] = [];
  loading = false;
  userId: number | null = null;

  // stato spinner del singolo bottone "Inizializza"
  initLoading: Record<number, boolean> = {};

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

  trackById(_: number, q: PremiumItemView) { return q.id; }

  async load(event?: any) {
    if (!event) this.loading = true;
    const overlay = await this.loadingCtrl.create({
      message: 'Caricamento questionari premium...',
      spinner: 'crescent'
    });
    if (!event) await overlay.present();

    this.data.getElencoQuestionariPremium().pipe(
      finalize(() => {
        this.loading = false;
        if (!event) overlay.dismiss(); else event.target.complete();
      })
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

  /**
   * Completato = tutte le domande OBBLIGATORIE soddisfatte
   * - Non upload: qualunque valore non-vuoto
   * - Upload: se esistono opzioni, ciascuna deve avere un nome file salvato;
   *           se non ci sono opzioni, basta un oggetto non vuoto.
   */
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
                // nessuna opzione definita → basta un oggetto non vuoto
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
        this.items = this.items.map((it, idx) => ({
          ...it,
          completed: !!results[idx],
          checking: false
        }));
        resolve();
      });
    });
  }

  apri(id: number) { this.router.navigate(['/premium-detail', id]); }

  async inizializza(item: PremiumItemView) {
    if (!this.userId) {
      await this.presentToast('Devi effettuare l’accesso', 'warning');
      return;
    }
    if (!item.completed) {
      await this.presentToast('Completa prima tutte le domande obbligatorie', 'warning');
      return;
    }

    this.initLoading[item.id] = true;
    const overlay = await this.loadingCtrl.create({
      message: 'Inizializzazione in corso…',
      spinner: 'crescent'
    });
    await overlay.present();

    this.data.inizializzaPremium(this.userId, item.id).pipe(
      finalize(() => {
        this.initLoading[item.id] = false;
        overlay.dismiss();
      })
    ).subscribe({
      next: async (res) => {
        if (res?.success) {
          const stats: InitStats = (res.data ?? {});
          const en = stats.enqueued ?? 0;
          const du = stats.duplicates ?? 0;
          const tot = stats.total ?? (en + du);

          await this.presentToast(
            `Processo avviato. Job in coda: ${en} (duplicati: ${du} / totale: ${tot})`,
            'success'
          );
          // Se vuoi bloccare il pulsante "Completa questionario" dopo l’avvio:
          // item.initialized = true;
        } else {
          await this.presentToast(res?.message || 'Errore nell’inizializzazione', 'danger');
        }
      },
      error: async () => {
        await this.presentToast('Errore di rete durante l’inizializzazione', 'danger');
      }
    });
  }

  private async presentToast(message: string, color: 'success' | 'danger' | 'warning') {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'top' });
    await toast.present();
  }
}
