import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { DataService } from 'src/app/services/data/data.service';
import { ToastService } from 'src/app/services/toast/toast.service';
import { Storage } from '@ionic/storage-angular';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage implements OnInit, OnDestroy {
  content_loaded = false;
  userId: number | null = null;

  userProfile = { name_first: '', name_last: '', email: '' };

  private routerSubscription?: Subscription;

  constructor(
    private dataService: DataService,
    private router: Router,
    private toastService: ToastService,
    private storage: Storage
  ) {}

  async ngOnInit() {
    await this.storage.create();
    this.userId = await this.storage.get('user_id');
    if (!this.userId) {
      this.toastService.presentToast('Errore', 'Utente non autenticato', 'top', 'danger', 3000);
      this.router.navigate(['/signin']);
      return;
    }

    await this.loadUserProfile();

    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(async () => {
        if (this.router.url === '/home') {
          await this.loadUserProfile();
        }
      });
  }

  // ricarica quando si rientra sulla pagina dallo stack (indietro)
  async ionViewWillEnter() {
    if (!this.userId) {
      await this.storage.create();
      this.userId = await this.storage.get('user_id');
      if (!this.userId) {
        this.toastService.presentToast('Errore', 'Utente non autenticato', 'top', 'danger', 3000);
        this.router.navigate(['/signin']);
        return;
      }
    }
    await this.loadUserProfile();
  }

  ngOnDestroy() {
    this.routerSubscription?.unsubscribe();
  }

  private async loadUserProfile() {
    this.content_loaded = false;

    this.dataService.getProfile(this.userId!).subscribe({
      next: (res: any) => {
        if (res?.success && res?.data) {
          this.userProfile = {
            name_first: res.data.name_first || '',
            name_last:  res.data.name_last  || '',
            email:      res.data.email      || ''
          };
        }
        this.content_loaded = true;
      },
      error: () => {
        this.content_loaded = true;
        this.toastService.presentToast('Errore', 'Impossibile caricare profilo', 'top', 'danger', 3000);
      }
    });
  }

  get needsProfileCompletion(): boolean {
    return (
      this.userProfile.name_first.trim() === '' ||
      this.userProfile.name_last.trim() === ''
    );
  }

  goToProfile() {
    this.router.navigate(['/settings/profile/edit']);
  }

  goToQuestionari() {
    this.router.navigate(['/questionari']);
  }
}
