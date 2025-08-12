import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormGroup, Validators, FormControl } from '@angular/forms';
import { ToastController, LoadingController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Storage } from '@ionic/storage-angular';
import { Subject, firstValueFrom, of } from 'rxjs';
import { finalize, takeUntil, debounceTime, distinctUntilChanged, switchMap, catchError, map } from 'rxjs/operators';
import { DataService } from 'src/app/services/data/data.service';

type UploadOpt = { id: number; nome: string };
type Question = { id:number; testo_domanda:string; tipo?: string|null; opzioni?: UploadOpt[]|null; obbligatoria?: boolean; };

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
  // Stato base
  questionarioForm: FormGroup = new FormGroup({});
  userId: number | null = null;
  questionarioId: number | null = null;

  isSubmitted = false;
  isComplete = false;

  // Dati
  questions: Question[] = [];
  qTitle: string | null = null;
  qDesc: string | null = null;

  // Upload UI state
  uploadsQueue:   Record<string, Record<string, { nome: string; file: File }>> = {};
  uploadsVisuals: Record<string, Record<string, { user_file_id?: number; filename?: string; url?: string }>> = {};

  // File utente
  fileIndex: Record<number, UserFileSummary> = {};    // by user_file_id
  chosenByType: Record<string, UserFileSummary> = {}; // più recente per tipologia_id

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

  // ===== Wizard helpers =====
  get totalSteps() { return Math.max(1, Math.ceil((this.questions?.length || 0) / this.pageSize)); }
  get stepLabel(): string { return `Step ${this.currentStep + 1} di ${this.totalSteps}`; }
  get stepEmoji(): string { return this.currentStep === 0 ? '🚀' : (this.currentStep === this.totalSteps - 1 ? '🏁' : '➡️'); }
  stepsArray(): number[] { return Array.from({ length: this.totalSteps }, (_, i) => i); }
  nextStep(){ if (this.currentStep < this.totalSteps - 1) this.currentStep++; }
  prevStep(){ if (this.currentStep > 0) this.currentStep--; }
  goToStep(i:number){ if (i <= this.currentStep) this.currentStep = i; }

  isStepValid(): boolean {
    const start = this.currentStep * this.pageSize;
    const end   = start + this.pageSize;
    const subset = (this.questions || []).slice(start, end);
    return subset.every(q => {
      if (this.isUploadQuestion(q)) return true; // upload non obbligatorio nel form
      const ctrl = this.questionarioForm.controls[String(q.id)];
      return ctrl ? ctrl.valid : true;
    });
  }

  // ===== Lifecycle =====
  async ngOnInit() {
    await this.storage.create();
    this.userId = await this.storage.get('user_id');
    if (!this.userId) {
      this.presentToast('Errore: user_id non trovato', 'danger');
      this.router.navigate(['/signin']);
      return;
    }

    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(async p => {
      const idParam = p.get('id');
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
      this.uploadsQueue = {};
      this.uploadsVisuals = {};
      this.fileIndex = {};
      this.chosenByType = {};
      this.questionarioForm = new FormGroup({});
      this.currentStep = 0;
      this.qTitle = null; this.qDesc = null;

      // flow deterministico
      await this.loadDomande(this.questionarioId);
      await this.loadExistingUploads(this.userId!); // fileIndex + chosenByType
      this.prefillUploadsFromExisting();            // collega automatico per tipologia (se già presente)
      await this.loadUserData(this.userId!, this.questionarioId); // risposte salvate vincono
    });
  }

  ngOnDestroy(){ this.destroy$.next(); this.destroy$.complete(); }

  // ===== Utils =====
  isUploadQuestion(q: Question): boolean {
    return ((q?.tipo || '').toLowerCase() === 'upload');
  }

  private savedUserFileId(qId:number, optId:number): number | null {
    const val = this.questionarioForm.get(String(qId))?.value;
    const raw = val && (val[optId] ?? val[String(optId)]);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private setUserFileIdInForm(qId:number, optId:number, userFileId:number|null, emit=false){
    const key = String(qId);
    const ctrl = this.questionarioForm.get(key);
    if (!ctrl) return;
    const prev = ctrl.value || {};
    if (userFileId === null) {
      const clone:any = { ...prev };
      delete clone[String(optId)];
      ctrl.setValue(Object.keys(clone).length ? clone : null, { emitEvent: emit });
    } else {
      ctrl.setValue({ ...prev, [String(optId)]: userFileId }, { emitEvent: emit });
    }
  }

  displayFilename(qId:number, optId:number): string | null {
    return this.uploadsVisuals[String(qId)]?.[String(optId)]?.filename || null;
  }

  private setupAutosave(){
    this.questionarioForm.valueChanges.pipe(
      debounceTime(800),
      distinctUntilChanged((a,b)=>JSON.stringify(a)===JSON.stringify(b)),
      switchMap(val => this.dataService.postQuestionarioPremium({
        user_id:this.userId!, questionario_id:this.questionarioId!, questionario: val
      }).pipe(catchError(()=>of(null)))),
      takeUntil(this.destroy$)
    ).subscribe();
  }

  // ===== Data load =====
  private async loadDomande(questionarioId:number){
    const loading = await this.loadingCtrl.create({ message:'Carico le domande…', spinner:'crescent' });
    await loading.present();
    try{
      const res:any = await firstValueFrom(
        this.dataService.getDomandeQuestionarioPremium(questionarioId).pipe(finalize(()=>loading.dismiss()))
      );

      if (res?.meta){ this.qTitle = res.meta.titolo || null; this.qDesc = res.meta.descrizione || null; }

      if (res?.success && res?.data){
        this.questions = (res.data as Question[]).sort((a:any,b:any)=>a.id-b.id);

        const group:{[k:string]:FormControl} = {};
        for (const q of this.questions){
          const key = String(q.id);
          if (this.isUploadQuestion(q)) {
            group[key] = new FormControl({ value:null, disabled:this.isComplete });
          } else {
            const validators = q.obbligatoria ? [Validators.required] : [];
            if ((q.tipo||'').toLowerCase()==='number') validators.push(Validators.min(0));
            group[key] = new FormControl({ value:'', disabled:this.isComplete }, validators);
          }
        }
        this.questionarioForm = new FormGroup(group);
        this.currentStep = 0;
        this.setupAutosave();

        if (!this.qTitle || this.qDesc === null) this.fetchMetaFromList(questionarioId);
      } else {
        this.presentToast('Errore nel caricamento delle domande', 'danger');
      }
    } catch {
      this.presentToast('Errore di rete durante il caricamento', 'danger');
    }
  }

  private async fetchMetaFromList(questionarioId:number){
    try{
      const list:any = await firstValueFrom(
        this.dataService.getElencoQuestionariPremium().pipe(
          map(r => (r?.success && Array.isArray(r.data)) ? r.data : []),
          catchError(()=>of([]))
        )
      );
      const item = list.find((x:any)=>Number(x.id)===Number(questionarioId));
      if (item){ this.qTitle = this.qTitle ?? (item.titolo||null); this.qDesc = this.qDesc ?? (item.descrizione ?? ''); }
    }catch{ /* ignore */ }
  }

  /** Carica tutti i file dell'utente e prepara:
   *  - fileIndex[user_file_id] = summary
   *  - chosenByType[tipologia_id] = file più recente
   */
  private async loadExistingUploads(userId:number){
    try{
      const res:any = await firstValueFrom(
        this.dataService.getUserFilesByTipologia(userId).pipe(catchError(()=>of({success:false,data:[]})))
      );
      const list:UserFileSummary[] = (res?.success && Array.isArray(res.data)) ? res.data : [];
      this.fileIndex = {};
      this.chosenByType = {};

      for (const it of list){
        this.fileIndex[it.user_file_id] = it;
        const key = String(it.tipologia_id ?? 0);
        const prev = this.chosenByType[key];
        if (!prev || it.user_file_id > prev.user_file_id) {
          this.chosenByType[key] = it; // tieni il più recente
        }
      }
    }catch{/* ignore */}
  }

  /** Per ogni domanda upload e per ogni opzione, se esiste già un file di quella tipologia lo collego in automatico */
  private prefillUploadsFromExisting(){
    if (!this.questions?.length) return;

    for (const q of this.questions) {
      if (!this.isUploadQuestion(q)) continue;
      const qKey = String(q.id);
      const opts = Array.isArray(q.opzioni) ? q.opzioni : [];

      for (const opt of opts) {
        const tipKey = String(opt.id);
        const chosen = this.chosenByType[tipKey];
        if (!chosen) continue;

        // se già presente (da salvataggi precedenti), non toccare
        if (this.savedUserFileId(q.id, opt.id)) continue;

        if (!this.uploadsVisuals[qKey]) this.uploadsVisuals[qKey] = {};
        this.uploadsVisuals[qKey][String(opt.id)] = {
          user_file_id: chosen.user_file_id,
          filename: chosen.filename,
          url: chosen.url
        };
        this.setUserFileIdInForm(q.id, opt.id, chosen.user_file_id, false);
      }
    }

    // autosave silenzioso
    this.dataService.postQuestionarioPremium({
      user_id: this.userId!,
      questionario_id: this.questionarioId!,
      questionario: this.questionarioForm.value
    }).pipe(catchError(()=>of(null))).subscribe();
  }

  private async loadUserData(userId:number, questionarioId:number){
    const loading = await this.loadingCtrl.create({ message:'Recupero le tue risposte…', spinner:'crescent' });
    await loading.present();
    try{
      const res:any = await firstValueFrom(
        this.dataService.getQuestionarioPremium(userId, questionarioId).pipe(finalize(()=>loading.dismiss()))
      );
      if (res?.success && res?.data){
        Object.keys(res.data).forEach(key=>{
          const ctrl = this.questionarioForm.get(key);
          if (ctrl) ctrl.patchValue(res.data[key], { emitEvent:false });

          // ricostruisci i visuals dagli id salvati
          const value = res.data[key];
          if (value && typeof value === 'object'){
            for (const optId of Object.keys(value)){
              const uId = Number(value[optId]);
              const sum = this.fileIndex[uId];
              if (sum){
                if (!this.uploadsVisuals[key]) this.uploadsVisuals[key]={};
                this.uploadsVisuals[key][optId] = { user_file_id:uId, filename:sum.filename, url:sum.url };
              }
            }
          }
        });
        this.setCompleteState(false);
      }
    }catch{
      this.presentToast('Errore nel caricamento dei dati', 'danger');
    }
  }

  // ===== Upload handlers =====
  onPickClick(input:HTMLInputElement){ if (!this.isComplete) input.click(); }

  onFileChosen(evt:Event, qId:number, opt:UploadOpt){
    const input = evt.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;

    const tipologiaId = Number(opt.id);
    if (!Number.isFinite(tipologiaId) || tipologiaId <= 0){
      this.presentToast('Tipologia non valida', 'danger');
      return;
    }

    const qKey = String(qId), oKey = String(opt.id);
    if (!this.uploadsQueue[qKey]) this.uploadsQueue[qKey] = {};
    this.uploadsQueue[qKey][oKey] = { nome: opt.nome, file };

    this.dataService.uploadFilePremium(this.userId!, this.questionarioId!, tipologiaId, file, opt.nome)
      .subscribe({
        next: async (res:any)=>{
          const data = res?.data || {};
          const userFileId = Number(data.user_file_id ?? data.id ?? 0);
          if (res?.success && userFileId > 0){
            const filename = file.name;
            const url = data.download_url || data.presigned_url || data.url || null;

            if (!this.uploadsVisuals[qKey]) this.uploadsVisuals[qKey] = {};
            this.uploadsVisuals[qKey][oKey] = { user_file_id:userFileId, filename, url: url || undefined };

            this.setUserFileIdInForm(qId, tipologiaId, userFileId, false);

            // aggiorna indici locali
            const summary:UserFileSummary = { user_file_id:userFileId, tipologia_id:tipologiaId, filename, url: url || undefined };
            this.fileIndex[userFileId] = summary;
            const keyType = String(tipologiaId);
            const prev = this.chosenByType[keyType];
            if (!prev || userFileId > prev.user_file_id) this.chosenByType[keyType] = summary;

            // pulizia coda
            delete this.uploadsQueue[qKey][oKey];
            if (Object.keys(this.uploadsQueue[qKey]).length===0) delete this.uploadsQueue[qKey];

            // autosave silenzioso
            this.dataService.postQuestionarioPremium({
              user_id:this.userId!, questionario_id:this.questionarioId!, questionario:this.questionarioForm.value
            }).pipe(catchError(()=>of(null))).subscribe();

            await this.presentToast(`Caricato: ${filename}`, 'success');
          } else {
            await this.presentToast('Upload fallito', 'danger');
          }
        },
        error: async ()=>{ await this.presentToast('Errore upload', 'danger'); }
      });
  }

  // ===== Delete / Detach =====
  async clearChosen(qId:number, opt:UploadOpt){
    if (this.isComplete) return;

    const savedId = this.savedUserFileId(qId, opt.id); // per eventuale pulizia indici
    const overlay = await this.loadingCtrl.create({ message:'Rimuovo il file…', spinner:'crescent' });
    await overlay.present();

    try {
      const res:any = await firstValueFrom(
        this.dataService.deleteUploadPremium(this.userId!, this.questionarioId!, opt.id, String(qId))
          .pipe(finalize(()=>overlay.dismiss()))
      );

      if (!res?.success) {
        await this.presentToast(res?.message || 'Impossibile rimuovere il file', 'danger');
        return;
      }

      // Pulizia UI locale
      const qKey = String(qId), oKey = String(opt.id);
      if (this.uploadsQueue[qKey]?.[oKey]) {
        delete this.uploadsQueue[qKey][oKey];
        if (Object.keys(this.uploadsQueue[qKey]).length===0) delete this.uploadsQueue[qKey];
      }
      if (this.uploadsVisuals[qKey]?.[oKey]) delete this.uploadsVisuals[qKey][oKey];
      this.setUserFileIdInForm(qId, opt.id, null, false);

      // Se il backend ha eliminato il file (orfano), puliamo gli indici
      const deletedFiles = Number(res?.data?.user_files_deleted ?? 0);
      if (deletedFiles > 0 && savedId) {
        delete this.fileIndex[savedId];
        const tipKey = String(opt.id);
        const chosen = this.chosenByType[tipKey];
        if (chosen && chosen.user_file_id === savedId) {
          delete this.chosenByType[tipKey];
        }
      }

      // autosave silenzioso
      this.dataService.postQuestionarioPremium({
        user_id:this.userId!, questionario_id:this.questionarioId!, questionario:this.questionarioForm.value
      }).pipe(catchError(()=>of(null))).subscribe();

      // Messaggio coerente con esito
      const links = Number(res?.data?.links_deleted ?? 0);
      if (deletedFiles > 0)      await this.presentToast('File eliminato.', 'success');
      else if (links > 0)        await this.presentToast('Collegamento rimosso.', 'success');
      else                       await this.presentToast('Nessuna modifica effettuata.', 'warning');

    } catch {
      await this.presentToast('Errore di rete durante la rimozione', 'danger');
    }
  }

  // ===== Submit =====
  async submit(){
    if (this.isSubmitted || this.isComplete) return;
    if (!this.questionarioId){ this.presentToast('Questionario non valido','danger'); return; }

    if (this.currentStep < this.totalSteps - 1) {
      if (!this.isStepValid()) { this.presentToast('Completa i campi dello step corrente','warning'); return; }
      this.nextStep(); return;
    }

    if (this.questionarioForm.invalid) { this.presentToast('Compila tutti i campi obbligatori correttamente','danger'); return; }

    this.isSubmitted = true;
    const loading = await this.loadingCtrl.create({ message:'Salvataggio finale…', spinner:'crescent' });
    await loading.present();

    this.dataService.postQuestionarioPremium({
      user_id:this.userId!, questionario_id:this.questionarioId!, questionario:this.questionarioForm.value
    }).pipe(finalize(()=>{ loading.dismiss(); this.isSubmitted=false; }))
      .subscribe({
        next: async (res:any)=>{ 
          if (res?.success) await this.presentToast('Tutto salvato! 🎉','success');
          else await this.presentToast('Errore nel salvataggio finale','danger');
        },
        error: async ()=>{ await this.presentToast('Errore di rete, riprova più tardi','danger'); }
      });
  }

  // ===== Helpers =====
  private setCompleteState(done:boolean){
    this.isComplete = done;
    if (done) this.questionarioForm.disable({emitEvent:false});
    else this.questionarioForm.enable({emitEvent:false});
  }

  private async presentToast(message:string, color:'success'|'danger'|'warning'){
    const toast = await this.toastCtrl.create({ message, duration:3000, color, position:'top' });
    await toast.present();
  }
}
