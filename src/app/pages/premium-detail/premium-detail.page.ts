import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormGroup, Validators, FormControl } from '@angular/forms';
import { ToastController, LoadingController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Storage } from '@ionic/storage-angular';
import { Subject, firstValueFrom } from 'rxjs';
import { finalize, takeUntil } from 'rxjs/operators';
import { DataService } from 'src/app/services/data/data.service';

@Component({
  selector: 'app-premium-detail',
  templateUrl: './premium-detail.page.html',
  styleUrls: ['./premium-detail.page.scss'],
})
export class PremiumDetailPage implements OnInit, OnDestroy {
  questionarioForm: FormGroup = new FormGroup({});
  userId: number | null = null;
  isSubmitted = false;
  isComplete = false; // <- gestiamo disabled via TS, non nel template
  questions: any[] = [];
  questionarioId: number | null = null;

  private destroy$ = new Subject<void>();

  // Wizard
  pageSize = 5;
  currentStep = 0;

  get totalSteps() {
    return Math.max(1, Math.ceil((this.questions?.length || 0) / this.pageSize));
  }
  get stepLabel(): string { return `Step ${this.currentStep + 1} di ${this.totalSteps}`; }
  get stepEmoji(): string {
    if (this.currentStep === 0) return '🚀';
    if (this.currentStep === this.totalSteps - 1) return '🏁';
    return '➡️';
  }
  stepsArray(): number[] { return Array.from({ length: this.totalSteps }, (_, i) => i); }
  nextStep() { if (this.currentStep < this.totalSteps - 1) this.currentStep++; }
  prevStep() { if (this.currentStep > 0) this.currentStep--; }
  goToStep(i: number) { if (i <= this.currentStep) this.currentStep = i; }

  isStepValid(): boolean {
    if (!this.questionarioForm) return true;
    const start = this.currentStep * this.pageSize;
    const end = start + this.pageSize;
    const subset = (this.questions || []).slice(start, end);
    return subset.every(q => {
      const key = String(q.id);
      const ctrl = this.questionarioForm.controls[key];
      return ctrl ? ctrl.valid : true;
    });
  }

  constructor(
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController,
    private router: Router,
    private route: ActivatedRoute,
    private storage: Storage,
    private dataService: DataService
  ) {}

  async ngOnInit() {
    await this.storage.create();
    this.userId = await this.storage.get('user_id');
    if (!this.userId) {
      this.presentToast('Errore: user_id non trovato', 'danger');
      this.router.navigate(['/signin']);
      return;
    }

    this.route.paramMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(async (params) => {
        const idParam = params.get('id');
        this.questionarioId = idParam ? Number(idParam) : null;

        if (!this.questionarioId || Number.isNaN(this.questionarioId)) {
          this.presentToast('ID questionario non valido', 'danger');
          this.router.navigate(['/premium']);
          return;
        }

        // reset
        this.setCompleteState(false);
        this.isSubmitted = false;
        this.questions = [];
        this.questionarioForm = new FormGroup({});
        this.currentStep = 0;

        await this.loadDomande(this.questionarioId);
        await this.loadUserData(this.userId!, this.questionarioId);
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadDomande(questionarioId: number) {
    const loading = await this.loadingCtrl.create({
      message: 'Carico le domande…',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const res: any = await firstValueFrom(
        this.dataService.getDomandeQuestionarioPremium(questionarioId).pipe(
          finalize(() => loading.dismiss())
        )
      );

      if (res?.success && res?.data) {
        this.questions = res.data.sort((a: any, b: any) => a.id - b.id);

        const group: { [key: string]: FormControl } = {};
        this.questions.forEach(q => {
          const validators = q.obbligatoria ? [Validators.required] : [];
          if (q.tipo === 'number') validators.push(Validators.min(0));

          // stato disabled iniziale deciso in TS
          group[q.id.toString()] = new FormControl(
            { value: '', disabled: this.isComplete },
            validators
          );
        });
        this.questionarioForm = new FormGroup(group);
        this.currentStep = 0;
      } else {
        this.presentToast('Errore nel caricamento delle domande', 'danger');
      }
    } catch {
      this.presentToast('Errore di rete durante il caricamento', 'danger');
    }
  }

  private async loadUserData(userId: number, questionarioId: number) {
    const loading = await this.loadingCtrl.create({
      message: 'Recupero le tue risposte…',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      const res: any = await firstValueFrom(
        this.dataService.getQuestionarioPremium(userId, questionarioId).pipe(
          finalize(() => loading.dismiss())
        )
      );

      if (res?.success && res?.data) {
        Object.keys(res.data).forEach(key => {
          const ctrl = (this.questionarioForm.controls as any)[key];
          if (ctrl) ctrl.patchValue(res.data[key], { emitEvent: false });
        });

        // Se hai un criterio per marcare "completo", impostalo qui.
        // Esempio: this.setCompleteState(!!res.data.__completed);
        this.setCompleteState(false); // per ora resta editabile
      }
    } catch {
      this.presentToast('Errore nel caricamento dei dati', 'danger');
    }
  }

  async submit() {
    if (this.isSubmitted || this.isComplete) return;
    if (!this.questionarioId) {
      this.presentToast('Questionario non valido', 'danger');
      return;
    }

    if (this.currentStep < this.totalSteps - 1) {
      if (!this.isStepValid()) {
        this.presentToast('Completa i campi dello step corrente', 'warning');
        return;
      }
      this.nextStep();
      return;
    }

    if (this.questionarioForm.invalid) {
      this.presentToast('Compila tutti i campi obbligatori correttamente', 'danger');
      return;
    }

    this.isSubmitted = true;
    const loading = await this.loadingCtrl.create({
      message: 'Invio in corso…',
      spinner: 'crescent'
    });
    await loading.present();

    const payload = {
      user_id: this.userId!,
      questionario_id: this.questionarioId,
      questionario: this.questionarioForm.value
    };

    this.dataService.postQuestionarioPremium(payload).pipe(
      finalize(() => {
        loading.dismiss();
        this.isSubmitted = false;
      })
    ).subscribe({
      next: async (res: any) => {
        if (res?.success) {
          await this.presentToast('Dati inviati con successo! 🎉', 'success');
          // se vuoi bloccare l’editing dopo l’invio:
          // this.setCompleteState(true);
        } else {
          await this.presentToast('Errore nell’invio dei dati', 'danger');
        }
      },
      error: async () => {
        await this.presentToast('Errore di rete, riprova più tardi', 'danger');
      }
    });
  }

  private setCompleteState(completed: boolean) {
    this.isComplete = completed;
    if (completed) this.questionarioForm.disable({ emitEvent: false });
    else this.questionarioForm.enable({ emitEvent: false });
  }

  private async presentToast(message: string, color: 'success' | 'danger' | 'warning') {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    await toast.present();
  }
}
