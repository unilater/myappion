import { Component, OnInit, OnDestroy } from '@angular/core';
import { DataService } from 'src/app/services/data/data.service';
import { Router, NavigationEnd } from '@angular/router';
import { ToastService } from 'src/app/services/toast/toast.service';
import { Storage } from '@ionic/storage-angular';
import { filter } from 'rxjs/operators';

interface Section {
  title: string;
  content: string;
  expanded?: boolean;
  key: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
})
export class HomePage implements OnInit, OnDestroy {
  content_loaded = false;
  showContent    = false;
  userId: number | null = null;

  userProfile = { name_first: '', name_last: '', email: '' };
  questionarioCompletato = false;
  sections: Section[] = [];

  private routerSubscription: any;

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
      this.toastService.presentToast(
        'Errore',
        'Utente non autenticato',
        'top',
        'danger',
        3000
      );
      this.router.navigate(['/signin']);
      return;
    }

    await this.loadUserProfile();

    this.routerSubscription = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(async () => {
      if (this.router.url === '/home') {
        await this.loadUserProfile();
      }
    });
  }

  ngOnDestroy() {
    this.routerSubscription?.unsubscribe();
  }

  private loadSectionsData(qdata: Record<string, any>) {
    const titles: Record<string, string> = {
      salute:          'Salute e Assistenza Sanitaria',
      famiglia:        'Famiglia e Relazioni',
      lavoro:          'Lavoro e Reddito',
      casa:            'Casa e Alloggio',
      istruzione:      'Istruzione e Formazione',
      diritti_legali:  'Diritti Legali e Previdenza',
      servizi_sociali:'Supporti e Servizi Sociali'
    };

    this.sections = Object.keys(titles).map(key => {
      const html = qdata[key]?.toString().trim();
      return {
        key,
        title: titles[key],
        content: (html && html !== '{}')
          ? html
          : '<p><em>Non disponibile</em></p>',
        expanded: false
      };
    });
  }

  async loadUserProfile() {
    this.content_loaded = false;
    this.showContent    = false;
    this.sections       = [];

    // 1) Carica tutele AI prima di tutto
    let aiData: Record<string, string> = {};
    this.dataService.getAiDetails(this.userId!).subscribe({
      next: aiRes => {
        if (aiRes.success) {
          aiData = aiRes.data;
        }
        // 2) Dopo AI, carica profilo
        this.dataService.getProfile(this.userId!).subscribe({
          next: (res: any) => {
            if (res.success && res.user) {
              // Popola profilo
              this.userProfile = {
                name_first: res.user.name_first || '',
                name_last:  res.user.name_last  || '',
                email:      res.user.email      || ''
              };
              // Questionario
              let qdata: Record<string, any> = {};
              try {
                qdata = typeof res.user.questionario_data === 'string'
                  ? JSON.parse(res.user.questionario_data)
                  : res.user.questionario_data || {};
              } catch {
                qdata = {};
              }
              this.questionarioCompletato = Object.keys(qdata).length > 0;

              // Popola sezioni di default da questionario_data
              this.loadSectionsData(qdata);
              // Override con AI se disponibile
              this.sections = this.sections.map(sec => ({
                ...sec,
                content: aiData[sec.key] ?? sec.content
              }));
            }
            this.content_loaded = true;
            this.showContent    = this.questionarioCompletato;
          },
          error: () => {
            this.content_loaded = true;
            this.showContent    = false;
            this.toastService.presentToast(
              'Errore',
              'Impossibile caricare profilo',
              'top',
              'danger',
              3000
            );
          }
        });
      },
      error: () => {
        // Se AI fallisce, procedi comunque con il profilo
        this.dataService.getProfile(this.userId!).subscribe();
      }
    });
  }

  toggleSection(idx: number) {
    this.sections[idx].expanded = !this.sections[idx].expanded;
  }

  get needsProfileCompletion(): boolean {
    return (
      this.userProfile.name_first.trim() === '' ||
      this.userProfile.name_last.trim() === ''
    );
  }

  get needsQuestionarioCompletion(): boolean {
    return !this.needsProfileCompletion && !this.questionarioCompletato;
  }

  goToProfile() {
    this.router.navigate(['/settings/profile/edit']);
  }

  goToQuestionario() {
    this.router.navigate(['/questionario']);
  }
}
