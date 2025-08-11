import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { DataService } from 'src/app/services/data/data.service';

type PremiumQuestionarioItem = {
  id: number;
  titolo: string;
  descrizione?: string | null;
  num_domande?: number | null;
  num_prompts?: number | null; // opzionale, se il backend lo fornisce
};

@Component({
  selector: 'app-premium',
  templateUrl: './premium.page.html',
  styleUrls: ['./premium.page.scss'],
})
export class PremiumPage implements OnInit {
  items: PremiumQuestionarioItem[] = [];
  loading = false;

  constructor(
    private data: DataService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController
  ) {}

  async ngOnInit() {
    await this.load();
  }

  trackById(_: number, q: PremiumQuestionarioItem) { return q.id; }

  async load(event?: any) {
    if (!event) this.loading = true;
    const loadingOverlay = await this.loadingCtrl.create({
      message: 'Caricamento questionari premium...',
      spinner: 'crescent'
    });
    if (!event) await loadingOverlay.present();

    this.data.getElencoQuestionariPremium().subscribe({
      next: async (res) => {
        if (res?.success && Array.isArray(res.data)) {
          this.items = res.data.map((q: any) => ({
            id: Number(q.id),
            titolo: q.titolo ?? `Questionario ${q.id}`,
            descrizione: q.descrizione ?? '',
            num_domande: q.num_domande ?? 0,
            num_prompts: q.num_prompts ?? null
          }));
        } else {
          this.items = [];
          await this.presentToast('Nessun questionario premium disponibile', 'warning');
        }
        this.loading = false;
        if (!event) loadingOverlay.dismiss(); else event.target.complete();
      },
      error: async () => {
        this.items = [];
        this.loading = false;
        if (!event) loadingOverlay.dismiss(); else event.target.complete();
        await this.presentToast('Errore di rete nel caricamento (premium)', 'danger');
      }
    });
  }

  apri(id: number) {
    // Punta alla pagina di dettaglio premium appena creata: /premium-detail/:id
    this.router.navigate(['/premium-detail', id]);
  }

  private async presentToast(message: string, color: 'success' | 'danger' | 'warning') {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'top' });
    await toast.present();
  }
}
