import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormGroup, Validators, FormControl } from '@angular/forms';
import { ToastController, LoadingController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Storage } from '@ionic/storage-angular';
import { Subject, firstValueFrom, of } from 'rxjs';
import { finalize, takeUntil, debounceTime, distinctUntilChanged, switchMap, catchError, map } from 'rxjs/operators';
import { DataService } from 'src/app/services/data/data.service';

type UploadOpt = { id: number; nome: string }; // id = tipologia_id
type Question = {
  id: number;
  testo_domanda: string;
  tipo?: string | null;
  opzioni?: any;
  obbligatoria?: boolean;
};

type UserFileSummary = {
  user_file_id: number;
  tipologia_id: number | null;
  filename: string;
  url?: string;
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

  /**
   * Stato locale uploads:
   * - uploadsQueue: file scelti ma non ancora caricati (per retry/indicatore)
   * - uploadsVisuals: metadati visuali (filename/url) per gli user_file_id salvati nel form
   */
  uploadsQueue:   Record<string, Record<string, { nome: string; file: File }>> = {};
  uploadsVisuals: Record<string, Record<string, { user_file_id?: number; filename?: string; url?: string }>> = {};

  // Files esistenti per tipologia (user-centric)
  existingByType: Record<string, UserFileSummary[]> = {}; // { [tipologia_id]: UserFileSummary[] }
  fileIndex: Record<number, UserFileSummary> = {};        // { user_file_id: summary }

  // Meta (titolo/descrizione)
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
        this.uploadsQueue = {};
        this.uploadsVisuals = {};
        this.existingByType = {};
        this.fileIndex = {};
        this.questionarioForm = new FormGroup({});
        this.currentStep = 0;
        this.qTitle = null;
        this.qDesc = null;

        await this.loadDomande(this.questionarioId);
        await this.loadExistingUploadsByType(this.userId!);        // 1) catalogo file user
        await this.loadUserData(this.userId!, this.questionarioId); // 2) risposte salvate
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ======= Utils =======
  /** True se domanda upload: tipo === 'upload' OPPURE opzioni array non vuoto */
  private isUploadQuestion(q: Question): boolean {
    const t = (q?.tipo || '').toString().trim().toLowerCase();
    const hasOptions = Array.isArray(q?.opzioni) && q.opzioni.length > 0;
    return t === 'upload' || (!t && hasOptions);
  }

  /** Normalizza opzioni in { id:number, nome:string } */
  private normalizeUploadOptions(raw: any): Array<{ id: number; nome: string }> {
    if (!Array.isArray(raw)) return [];
    return raw.map((o: any, idx: number) => {
      if (o && typeof o === 'object' && ('id' in o || 'tipologia_id' in o || 'nome' in o)) {
        const id = Number(o.id ?? o.tipologia_id ?? idx + 1);
        const nome = String(o.nome ?? o.label ?? o.titolo ?? o.name ?? o.text ?? `Documento ${id}`).trim();
        return { id, nome: nome || `Documento ${id}` };
      }
      if (typeof o === 'string') {
        const nome = o.trim();
        return { id: idx + 1, nome: nome || `Documento ${idx + 1}` };
      }
      return { id: idx + 1, nome: `Documento ${idx + 1}` };
    });
  }

  /** leggi/scrivi user_file_id nel form */
  private savedUserFileId(qId: number, optId: number): number | null {
    const val = this.questionarioForm.get(String(qId))?.value;
    const raw = val && (val[optId] ?? val[String(optId)]);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  private setUserFileIdInForm(qId: number, optId: number, userFileId: number | null, emit = false) {
    const key = String(qId);
    const ctrl = this.questionarioForm.get(key);
    if (!ctrl) return;
    const prev = ctrl.value || {};
    if (userFileId === null) {
      const clone = { ...prev };
      delete clone[String(optId)];
      ctrl.setValue(Object.keys(clone).length ? clone : null, { emitEvent: emit });
    } else {
      ctrl.setValue({ ...prev, [String(optId)]: userFileId }, { emitEvent: emit });
    }
  }

  /** Nome file da mostrare (visual), se disponibile */
  displayFilename(qId: number, optId: number): string | null {
    return this.uploadsVisuals[String(qId)]?.[String(optId)]?.filename || null;
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
            questionario: val   // contiene user_file_id per le opzioni upload
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
        this.questions = (res.data as Question[])
          .map(q => {
            if (this.isUploadQuestion(q)) {
              q.opzioni = this.normalizeUploadOptions(q.opzioni);
            }
            return q;
          })
          .sort((a: any, b: any) => a.id - b.id);

        const group: { [key: string]: FormControl } = {};
        this.questions.forEach(q => {
          const key = q.id.toString();

          if (this.isUploadQuestion(q)) {
            // map { [optId]: user_file_id:number }
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

  /** Carica file già caricati dall’utente e indicizza per tipologia + per id */
  private async loadExistingUploadsByType(userId: number) {
    try {
      const res: any = await firstValueFrom(
        this.dataService.getUserFilesByTipologia(userId).pipe(catchError(() => of({ success:false, data:[] })))
      );
      const list: UserFileSummary[] = (res?.success && Array.isArray(res.data)) ? res.data : [];
      this.existingByType = {};
      this.fileIndex = {};
      for (const item of list) {
        const key = String(item.tipologia_id ?? 0);
        if (!this.existingByType[key]) this.existingByType[key] = [];
        this.existingByType[key].push(item);
        this.fileIndex[item.user_file_id] = item;
      }
    } catch { /* ignore */ }
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
          const ctrl = this.questionarioForm.get(key);
          if (ctrl) ctrl.patchValue(res.data[key], { emitEvent: false });

          // Popola i visuals se troviamo user_file_id salvati
          const value = res.data[key];
          if (value && typeof value === 'object') {
            for (const optId of Object.keys(value)) {
              const uId = Number(value[optId]);
              const sum = this.fileIndex[uId];
              if (sum) {
                if (!this.uploadsVisuals[key]) this.uploadsVisuals[key] = {};
                this.uploadsVisuals[key][optId] = {
                  user_file_id: uId,
                  filename: sum.filename,
                  url: sum.url
                };
              }
            }
          }
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

  /** Upload immediato (user-centric): backend deduplica, ritorna user_file_id e linka al questionario */
  onFileChosen(evt: Event, qId: number, opt: UploadOpt) {
    const input = evt.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;

    // Verifica tipologia valida
    const tipologiaId = Number(opt.id);
    if (!Number.isFinite(tipologiaId) || tipologiaId <= 0) {
      this.presentToast('Tipologia non valida: manca l’ID del documento', 'danger');
      return;
    }

    const qKey = String(qId);
    const oKey = String(opt.id);

    // Coda locale per UI
    if (!this.uploadsQueue[qKey]) this.uploadsQueue[qKey] = {};
    this.uploadsQueue[qKey][oKey] = { nome: opt.nome, file };

    this.dataService.uploadFilePremium(
      this.userId!, this.questionarioId!, tipologiaId, file, opt.nome
    ).subscribe({
      next: async (res: any) => {
        const data = res?.data || {};
        const userFileId = Number(data.user_file_id ?? data.id ?? 0);
        if (res?.success && userFileId > 0) {
          const filename   = file.name;
          const url        = data.download_url || data.presigned_url || data.url || null;

          // visuals
          if (!this.uploadsVisuals[qKey]) this.uploadsVisuals[qKey] = {};
          this.uploadsVisuals[qKey][oKey] = { user_file_id: userFileId, filename, url: url || undefined };

          // scrivi nel form l'ID (non il nome)
          this.setUserFileIdInForm(qId, tipologiaId, userFileId, false);

          // aggiorna indici locali di riuso per tipologia
          const tipKey = String(tipologiaId);
          const summary: UserFileSummary = { user_file_id: userFileId, tipologia_id: tipologiaId, filename, url: url || undefined };
          if (!this.existingByType[tipKey]) this.existingByType[tipKey] = [];
          if (!this.existingByType[tipKey].some(x => x.user_file_id === userFileId)) {
            this.existingByType[tipKey].push(summary);
          }
          this.fileIndex[userFileId] = summary;

          // pulizia coda
          delete this.uploadsQueue[qKey][oKey];
          if (Object.keys(this.uploadsQueue[qKey]).length === 0) delete this.uploadsQueue[qKey];

          // autosave silenzioso
          this.dataService.postQuestionarioPremium({
            user_id: this.userId!,
            questionario_id: this.questionarioId!,
            questionario: this.questionarioForm.value
          }).pipe(catchError(() => of(null))).subscribe();

          await this.presentToast(`Caricato: ${filename}`, 'success');
        } else {
          await this.presentToast('Upload fallito', 'danger');
        }
      },
      error: async () => {
        await this.presentToast('Errore upload', 'danger');
      }
    });
  }

  /** Usa un file già caricato dall’utente per quella tipologia (nessun re-upload) */
  async useExisting(qId: number, opt: UploadOpt, file: UserFileSummary) {
    if (this.isComplete) return;

    const overlay = await this.loadingCtrl.create({ message: 'Collego il file…', spinner: 'crescent' });
    await overlay.present();

    try {
      const res: any = await firstValueFrom(
        this.dataService.attachUserFileToQuestionario(
          this.userId!, this.questionarioId!, file.user_file_id, opt.id
        ).pipe(finalize(() => overlay.dismiss()))
      );

      if (res?.success) {
        const qKey = String(qId);
        const oKey = String(opt.id);

        // visuals
        if (!this.uploadsVisuals[qKey]) this.uploadsVisuals[qKey] = {};
        this.uploadsVisuals[qKey][oKey] = {
          user_file_id: file.user_file_id,
          filename: file.filename,
          url: file.url
        };

        // scrivi nel form l'ID
        this.setUserFileIdInForm(qId, opt.id, file.user_file_id, false);

        // autosave
        this.dataService.postQuestionarioPremium({
          user_id: this.userId!,
          questionario_id: this.questionarioId!,
          questionario: this.questionarioForm.value
        }).pipe(catchError(() => of(null))).subscribe();

        await this.presentToast('File collegato.', 'success');
      } else {
        await this.presentToast(res?.message || 'Impossibile collegare il file', 'danger');
      }
    } catch {
      await this.presentToast('Errore di rete durante il collegamento', 'danger');
    }
  }

  /** Rimuove il valore dal form (il delete fisico/DB lo decidiamo dopo) */
  async clearChosen(qId: number, opt: UploadOpt) {
    if (this.isComplete) return;

    const qKey = String(qId);
    const oKey = String(opt.id);

    // Se è in coda locale e non caricato ancora → pulizia locale
    if (this.uploadsQueue[qKey]?.[oKey]) {
      delete this.uploadsQueue[qKey][oKey];
      if (Object.keys(this.uploadsQueue[qKey]).length === 0) delete this.uploadsQueue[qKey];
    }

    // TODO (in futuro): detach lato server senza delete fisico
    // this.dataService.detachUploadPremium(this.userId!, this.questionarioId!, this.savedUserFileId(qId, opt.id)!, opt.id)

    // pulizia visuals + form
    if (this.uploadsVisuals[qKey]?.[oKey]) delete this.uploadsVisuals[qKey][oKey];
    this.setUserFileIdInForm(qId, opt.id, null, false);

    // autosave
    this.dataService.postQuestionarioPremium({
      user_id: this.userId!,
      questionario_id: this.questionarioId!,
      questionario: this.questionarioForm.value
    }).pipe(catchError(() => of(null))).subscribe();

    await this.presentToast('File rimosso dal questionario.', 'success');
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

    // Salvataggio finale (i file sono già gestiti al volo)
    this.isSubmitted = true;
    const loading = await this.loadingCtrl.create({ message: 'Salvataggio finale…', spinner: 'crescent' });
    await loading.present();

    const payload = {
      user_id: this.userId!,
      questionario_id: this.questionarioId!,
      questionario: this.questionarioForm.value  // contiene user_file_id per le opzioni upload
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
