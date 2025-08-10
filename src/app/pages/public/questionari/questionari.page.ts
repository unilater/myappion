import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { DataService } from 'src/app/services/data/data.service';

type QuestionarioItem = {
  id: number;
  titolo: string;
  descrizione?: string | null;
  num_domande?: number | null;
};

@Component({
  selector: 'app-questionari',
  templateUrl: './questionari.page.html',
  styleUrls: ['./questionari.page.scss'],
})
export class QuestionariPage implements OnInit {
  items: QuestionarioItem[] = [];
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

  trackById(_: number, q: QuestionarioItem) { return q.id; }

  async load(event?: any) {
    if (!event) this.loading = true;
    const loadingOverlay = await this.loadingCtrl.create({
      message: 'Caricamento questionari...',
      spinner: 'crescent'
    });
    if (!event) await loadingOverlay.present();

    this.data.getElencoQuestionari().subscribe({
      next: async (res) => {
        if (res?.success && Array.isArray(res.data)) {
          this.items = res.data.map((q: any) => ({
            id: Number(q.id),
            titolo: q.titolo ?? `Questionario ${q.id}`,
            descrizione: q.descrizione ?? '',
            num_domande: q.num_domande ?? 0
          }));
        } else {
          this.items = [];
          await this.presentToast('Nessun questionario disponibile', 'warning');
        }
        this.loading = false;
        if (!event) loadingOverlay.dismiss(); else event.target.complete();
      },
      error: async () => {
        this.items = [];
        this.loading = false;
        if (!event) loadingOverlay.dismiss(); else event.target.complete();
        await this.presentToast('Errore di rete nel caricamento', 'danger');
      }
    });
  }

  apri(id: number) {
    this.router.navigate(['/questionario', id]);
  }

  private async presentToast(message: string, color: 'success' | 'danger' | 'warning') {
    const toast = await this.toastCtrl.create({ message, duration: 2500, color, position: 'top' });
    await toast.present();
  }
}
