import { Component } from '@angular/core';
import { ActionSheetController, LoadingController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { DataService } from 'src/app/services/data/data.service';
import type { ActionSheetButton } from '@ionic/core';

type QuestionarioItem = {
  id: number;
  titolo: string;
  descrizione?: string | null;
  num_domande?: number | null;
};

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss']
})
export class TabsPage {
  questionari: QuestionarioItem[] = [];
  loading = false;

  constructor(
    private actionSheetController: ActionSheetController,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
    private data: DataService,
    private router: Router
  ) {}

  // FAB → apre action sheet con l’elenco
  async selectAction() {
    // ricarica la lista se è vuota (senza overlay)
    if (!this.questionari.length && !this.loading) {
      await this.loadQuestionari(true);
    }

    // costruisci pulsanti dinamici con classi per colorare le icone
    const qButtons: ActionSheetButton[] = this.questionari.slice(0, 10).map<ActionSheetButton>(q => ({
      text: q.titolo || `Questionario ${q.id}`,
      icon: 'document-text-outline',
      cssClass: 'btn-questionario',
      handler: () => this.openQuestionario(q.id)
    }));

    const extra: ActionSheetButton[] = [
      ...(this.questionari.length > 10
        ? [{
            text: 'Vedi tutti i questionari',
            icon: 'list-outline',
            cssClass: 'btn-lista',
            handler: () => this.router.navigate(['/questionari'])
          } as ActionSheetButton]
        : []),
      {
        text: 'Aggiorna elenco',
        icon: 'refresh-outline',
        cssClass: 'btn-refresh',
        handler: async () => {
          await this.loadQuestionari(true);
          this.presentToast('Elenco aggiornato', 'success');
        }
      },
      {
        text: 'Chiudi',
        icon: 'close',
        cssClass: 'btn-cancel',
        role: 'cancel'
      }
    ];

    const actionSheet = await this.actionSheetController.create({
      header: this.loading ? 'Caricamento…' : 'Apri questionario',
      cssClass: 'custom-action-sheet',
      buttons: [...qButtons, ...extra]
    });

    await actionSheet.present();
  }

  // Carica elenco questionari dal service
  private async loadQuestionari(silent = false) {
    this.loading = true;
    const overlay = silent ? null : await this.loadingCtrl.create({
      message: 'Caricamento questionari...',
      spinner: 'crescent'
    });
    if (overlay) await overlay.present();

    return new Promise<void>((resolve) => {
      this.data.getElencoQuestionari().subscribe({
        next: async (res) => {
          if (res?.success && Array.isArray(res.data)) {
            this.questionari = res.data.map((q: any) => ({
              id: Number(q.id),
              titolo: q.titolo ?? `Questionario ${q.id}`,
              descrizione: q.descrizione ?? null,
              num_domande: q.num_domande ?? null
            }));
          } else {
            this.questionari = [];
            await this.presentToast('Nessun questionario disponibile', 'warning');
          }
          this.loading = false;
          if (overlay) await overlay.dismiss();
          resolve();
        },
        error: async () => {
          this.questionari = [];
          this.loading = false;
          if (overlay) await overlay.dismiss();
          await this.presentToast('Errore nel caricamento dei questionari', 'danger');
          resolve();
        }
      });
    });
  }

  private openQuestionario(id: number) {
    this.router.navigate(['/questionario', id]);
  }

  private async presentToast(message: string, color: 'success' | 'danger' | 'warning') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2200,
      color,
      position: 'top'
    });
    await toast.present();
  }
}
