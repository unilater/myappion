import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadingController } from '@ionic/angular';
import { AuthService } from 'src/app/services/auth/auth.service';
import { DataService } from 'src/app/services/data/data.service';
import { ToastService } from 'src/app/services/toast/toast.service';
import { Storage } from '@ionic/storage-angular';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
})
export class SettingsPage implements OnInit {

  userEmail = '';
  userName  = '';
  userId: number | null = null;

  constructor(
    private authService: AuthService,
    private dataService: DataService,
    private toastService: ToastService,
    private storage: Storage,
    private router: Router,
    private loadingCtrl: LoadingController
  ) {}

  async ngOnInit() {
    await this.ensureUser();
    if (!this.userId) return;
    await this.loadProfile();
  }

  // ricarica quando torni su Settings dallo stack
  async ionViewWillEnter() {
    if (!this.userId) await this.ensureUser();
    if (this.userId) await this.loadProfile(true); // silent: evita doppio spinner
  }

  private async ensureUser() {
    await this.storage.create();
    const raw = await this.storage.get('user_id');
    const parsed = Number(raw);
    this.userId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

    if (!this.userId) {
      this.toastService.presentToast('Errore', 'Utente non autenticato', 'top', 'danger', 3000);
      await this.router.navigateByUrl('/signin');
    }
  }

  async loadProfile(silent = false) {
    if (!this.userId) return;

    const loader = silent ? null : await this.loadingCtrl.create({
      message: 'Caricamento profilo…',
      spinner: 'crescent'
    });
    if (loader) await loader.present();

    this.dataService.getProfile(this.userId).subscribe({
      next: async (res: any) => {
        // accetta { success, data } o { success, profile }
        const ok = (res?.success === true || res?.success === 'true');
        const payload = res?.data ?? res?.profile ?? null;

        if (ok && payload) {
          const nameFirst = (payload.name_first ?? payload.first_name ?? '').toString();
          const nameLast  = (payload.name_last  ?? payload.last_name  ?? '').toString();
          const email     = (payload.email      ?? '').toString();

          this.userName  = `${nameFirst} ${nameLast}`.trim();
          this.userEmail = email;

          if (!this.userName && !this.userEmail) {
            // profilo scarno: informativo ma non blocca
            this.toastService.presentToast('Info', 'Profilo senza dati', 'top', 'warning', 2500);
          }
        } else {
          const msg = res?.message || 'Impossibile caricare il profilo';
          this.toastService.presentToast('Errore', msg, 'top', 'danger', 3000);
        }

        if (loader) await loader.dismiss();
      },
      error: async (err) => {
        console.error('[Settings] getProfile error:', err);
        if (loader) await loader.dismiss();
        this.toastService.presentToast('Errore', 'Errore di rete', 'top', 'danger', 3000);
      }
    });
  }

  async refresh(ev?: CustomEvent) {
    await this.loadProfile(true);
    (ev?.target as HTMLIonRefresherElement | undefined)?.complete?.();
  }

  signOut() {
    this.authService.signOut();
  }
}
