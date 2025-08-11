import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormGroup, Validators, FormControl } from '@angular/forms';
import { ToastController, LoadingController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Storage } from '@ionic/storage-angular';
import { Subject, firstValueFrom, of } from 'rxjs';
import { finalize, takeUntil, debounceTime, distinctUntilChanged, switchMap, catchError, map } from 'rxjs/operators';
import { DataService } from 'src/app/services/data/data.service';

type UploadOpt = { id: number; nome: string };
type Question = {
  id: number;
  testo_domanda: string;
  tipo?: string | null;
  opzioni?: any;
  obbligatoria?: boolean;
};

@Component({
  selector: 'app-premium-detail',
  templateUrl: './premium-detail.page.html',
  styleUrls: ['./premium-detail.page.scss'],
})
export class PremiumDetailPage implements OnInit, OnDestroy {
  // Form & stato
  questionarioForm: FormGroup = new FormGroup({});
  userId: number | null = null;
  questionarioId: number | null = null;

  isSubmitted = false;
  isComplete = false;

  // Dati
  questions: Question[] = [];
  /** Stato locale upload: { [qId]: { [optId]: { nome, file? } } } */
  uploads: Record<string, Record<string, { nome: string; file?: File }>> = {};

  // Meta (titolo/descrizione) per header e intro
  qTitle: string | null = null;
  qDesc: string | null = null;

  // Wizard
  pageSize = 5;
  currentStep = 0;

  private destroy$ = new Subject<void>();

  constructor(
    private toastCtrl: ToastController,
    private loadingCtrl: LoadingController,
    private router: Router,
    private route: ActivatedRoute,
    private storage: Storage,
    private dataService: DataService
  ) {}

  // ======= Wizard helpers =======
  get totalSteps() {
    return Math.max(1, Math.ceil((this.questions?.length || 0) / this.pageSize));
  }
  get stepLabel(): string { return `Step ${this.currentStep + 1} di ${this.totalSteps}`; }
  get stepEmoji(): string { return this.currentStep === 0 ? '🚀' : (this.currentStep === this.totalSteps - 1 ? '🏁' : '➡️'); }
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
      // upload non obbligatorio nel form principale
      if (this.isUploadQuestion(q)) return true;
      const key = String(q.id);
      const ctrl = this.questionarioForm.controls[key];
      return ctrl ? ctrl.valid : true;
    });
  }

  // ======= Lifecycle =======
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

        // reset stato
        this.setCompleteState(false);
        this.isSubmitted = false;
        this.questions = [];
        this.uploads = {};
        this.questionarioForm = new FormGroup({});
        this.currentStep = 0;
        this.qTitle = null;
        this.qDesc = null;

        await this.loadDomande(this.questionarioId);
        await this.loadUserData(this.userId!, this.questionarioId);
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ======= Utils =======
  /** True se domanda upload: tipo === 'upload' o tipo vuoto + opzioni {nome}[] */
  private isUploadQuestion(q: Question): boolean {
    const t = (q?.tipo || '').toString().trim().toLowerCase();
    const looksLikeUploadOptions =
      Array.isArray(q?.opzioni) &&
      q.opzioni.length > 0 &&
      q.opzioni.every((o: any) => o && typeof o === 'object' && 'nome' in o);
    return t === 'upload' || (!t && looksLikeUploadOptions);
  }

  /** Ritorna il nome file salvato nel FormControl (server-side) */
  savedUploadName(qId: number, optId: number): string | null {
    const val = this.questionarioForm.get(String(qId))?.value;
    return val && typeof val === 'object' && val[optId] ? String(val[optId]) : null;
  }

  /** Autosave con debounce su tutte le modifiche del form */
  private setupAutosave() {
    this.questionarioForm.valueChanges
      .pipe(
        debounceTime(800),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap(val =>
          this.dataService.postQuestionarioPremium({
            user_id: this.userId!,
            questionario_id: this.questionarioId!,
            questionario: val
          }).pipe(catchError(() => of(null)))
        ),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  // ======= Data load =======
  private async loadDomande(questionarioId: number) {
    const loading = await this.loadingCtrl.create({ message: 'Carico le domande…', spinner: 'crescent' });
    await loading.present();

    try {
      const res: any = await firstValueFrom(
        this.dataService.getDomandeQuestionarioPremium(questionarioId).pipe(finalize(() => loading.dismiss()))
      );

      // meta (titolo/descrizione) se il backend li fornisce
      if (res?.meta) {
        this.qTitle = res.meta.titolo || null;
        this.qDesc  = res.meta.descrizione || null;
      }

      if (res?.success && res?.data) {
        this.questions = (res.data as Question[]).sort((a: any, b: any) => a.id - b.id);

        const group: { [key: string]: FormControl } = {};
        this.questions.forEach(q => {
          const key = q.id.toString();

          if (this.isUploadQuestion(q)) {
            this.uploads[key] = {};
            // placeholder non required
            group[key] = new FormControl({ value: null, disabled: this.isComplete });
          } else {
            const validators = q.obbligatoria ? [Validators.required] : [];
            if ((q.tipo || '').toLowerCase() === 'number') validators.push(Validators.min(0));
            group[key] = new FormControl({ value: '', disabled: this.isComplete }, validators);
          }
        });

        this.questionarioForm = new FormGroup(group);
        this.currentStep = 0;

        // Attiva autosave
        this.setupAutosave();

        // Se meta mancanti, fallback dall’elenco
        if (!this.qTitle || this.qDesc === null) {
          this.fetchMetaFromList(questionarioId);
        }
      } else {
        this.presentToast('Errore nel caricamento delle domande', 'danger');
      }
    } catch {
      this.presentToast('Errore di rete durante il caricamento', 'danger');
    }
  }

  /** Fallback: recupera titolo/descrizione dall’elenco premium */
  private async fetchMetaFromList(questionarioId: number) {
    try {
      const listRes: any = await firstValueFrom(
        this.dataService.getElencoQuestionariPremium().pipe(
          map(r => (r?.success && Array.isArray(r.data)) ? r.data : []),
          catchError(() => of([]))
        )
      );
      const item = listRes.find((x: any) => Number(x.id) === Number(questionarioId));
      if (item) {
        this.qTitle = this.qTitle ?? (item.titolo || null);
        this.qDesc  = this.qDesc  ?? (item.descrizione ?? '');
      }
    } catch {
      // ignora
    }
  }

  private async loadUserData(userId: number, questionarioId: number) {
    const loading = await this.loadingCtrl.create({ message: 'Recupero le tue risposte…', spinner: 'crescent' });
    await loading.present();

    try {
      const res: any = await firstValueFrom(
        this.dataService.getQuestionarioPremium(userId, questionarioId).pipe(finalize(() => loading.dismiss()))
      );

      if (res?.success && res?.data) {
        Object.keys(res.data).forEach(key => {
          const ctrl = (this.questionarioForm.controls as any)[key];
          if (ctrl) ctrl.patchValue(res.data[key], { emitEvent: false });
        });
        this.setCompleteState(false);
      }
    } catch {
      this.presentToast('Errore nel caricamento dei dati', 'danger');
    }
  }

  // ======= Upload handlers =======
  onPickClick(input: HTMLInputElement) {
    if (this.isComplete) return;
    input.click();
  }

  /** Upload immediato + aggiorno il form col nome restituito dal server */
  onFileChosen(evt: Event, qId: number, opt: UploadOpt) {
    const input = evt.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;

    const qKey = String(qId);
    const oKey = String(opt.id);

    // Optimistic: metto il nome nel form (senza valueChanges)
    const ctrl = this.questionarioForm.controls[qKey];
    if (ctrl) ctrl.setValue({ ...(ctrl.value || {}), [oKey]: file.name }, { emitEvent: false });

    // Stato locale (per UI/retry)
    if (!this.uploads[qKey]) this.uploads[qKey] = {};
    this.uploads[qKey][oKey] = { nome: opt.nome, file };

    // Upload al volo
    this.dataService.uploadFilePremium(
      this.userId!,
      this.questionarioId!,
      opt.id,     // tipologia_id
      file,
      opt.nome    // etichetta
    ).subscribe({
      next: async (res: any) => {
        if (res?.success) {
          await this.presentToast(`Caricato: ${file.name}`, 'success');

          // Nome definitivo salvato dal server (es. percorso in B2)
          const serverName =
            (res.data && (res.data.b2_file_name || res.data.file_name)) || file.name;

          if (ctrl) ctrl.setValue({ ...(ctrl.value || {}), [oKey]: serverName }, { emitEvent: false });

          // Pulizia coda
          delete this.uploads[qKey][oKey];
          if (Object.keys(this.uploads[qKey]).length === 0) delete this.uploads[qKey];

          // Autosave silenzioso
          this.dataService.postQuestionarioPremium({
            user_id: this.userId!,
            questionario_id: this.questionarioId!,
            questionario: this.questionarioForm.value
          }).pipe(catchError(() => of(null))).subscribe();
        } else {
          await this.presentToast('Upload fallito', 'danger');
        }
      },
      error: async () => {
        await this.presentToast('Errore upload', 'danger');
      }
    });
  }

  /** Rimuove selezione/salvataggio del file da UI + form + autosave */
  clearChosen(qId: number, opt: UploadOpt) {
    const qKey = String(qId);
    const oKey = String(opt.id);

    if (this.uploads[qKey] && this.uploads[qKey][oKey]) {
      delete this.uploads[qKey][oKey];
      if (Object.keys(this.uploads[qKey]).length === 0) delete this.uploads[qKey];
    }

    const ctrl = this.questionarioForm.controls[qKey];
    if (ctrl) {
      const v = { ...(ctrl.value || {}) };
      delete v[oKey];
      ctrl.setValue(Object.keys(v).length ? v : null, { emitEvent: false });

      // autosave leggero
      this.dataService.postQuestionarioPremium({
        user_id: this.userId!,
        questionario_id: this.questionarioId!,
        questionario: this.questionarioForm.value
      }).pipe(catchError(() => of(null))).subscribe();
    }
  }

  // ======= Submit =======
  async submit() {
    if (this.isSubmitted || this.isComplete) return;
    if (!this.questionarioId) {
      this.presentToast('Questionario non valido', 'danger');
      return;
    }

    // Non ultimo step → avanza
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

    // Salvataggio finale (i file sono già stati caricati al volo)
    this.isSubmitted = true;
    const loading = await this.loadingCtrl.create({ message: 'Salvataggio finale…', spinner: 'crescent' });
    await loading.present();

    const payload = {
      user_id: this.userId!,
      questionario_id: this.questionarioId!,
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
          await this.presentToast('Tutto salvato! 🎉', 'success');
          // opzionale: this.setCompleteState(true);
        } else {
          await this.presentToast('Errore nel salvataggio finale', 'danger');
        }
      },
      error: async () => {
        await this.presentToast('Errore di rete, riprova più tardi', 'danger');
      }
    });
  }

  // ======= Helpers =======
  private setCompleteState(completed: boolean) {
    this.isComplete = completed;
    if (completed) this.questionarioForm.disable({ emitEvent: false });
    else this.questionarioForm.enable({ emitEvent: false });
  }

  private async presentToast(message: string, color: 'success' | 'danger' | 'warning') {
    const toast = await this.toastCtrl.create({ message, duration: 3000, color, position: 'top' });
    await toast.present();
  }
}
