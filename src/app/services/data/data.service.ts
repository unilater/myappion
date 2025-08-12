import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface AiStatus {
  queued: number;
  running: number;
  done: number;
  error: number;
  total?: number;
  percent?: number;
}

/** Esteso: opzionale result_id anche dentro meta */
export interface AiDetailsResponse {
  success: boolean;
  data: Record<string, string>;
  result_id?: number;
  meta?: { result_id?: number };
}

export interface PremiumQuestionarioListItem {
  id: number;
  titolo: string;
  descrizione?: string;
  num_domande?: number;
  num_prompts?: number;
}

/* ======== Tipi per la CHAT AnythingLLM ======== */
export interface ChatServerData {
  reply: string;
  thread_slug: string | null;
  first: 0 | 1;
  sent_kind: 'first' | 'followup';
  sent_message: string;        // primo giro: prompt+contesto+domanda; follow-up: solo messaggio
  sent_len: number;
  used_prompt: string | null;
  used_context_len: number;
  session_id: string;
  msg_index: number;
  input_echo?: {
    message: string;
    result_id: number;
    thread_slug: string | null;
    reset: 0 | 1;
  };
}

export interface ChatSendArgs {
  message: string;
  result_id?: number;           // richiesto al primo invio della sessione
  thread_slug?: string | null;  // per follow-up (in genere lo gestiamo internamente)
  prompt?: string;              // opzionale: extra soft prompt
  reset?: boolean;              // opzionale: forza nuovo thread (serve anche result_id)
}

@Injectable({ providedIn: 'root' })
export class DataService {
  /** Base URL del backend PHP */
  private apiBaseUrl = 'https://pannellogaleazzi.appnativeitalia.com/api';

  constructor(private http: HttpClient) {}

  /** Cache-buster semplice per GET */
  private ts() { return `_=${Date.now()}`; }

  // =======================
  // Profilo utente
  // =======================
  getProfile(userId: number): Observable<ApiResponse<{ name_first: string; name_last: string; email: string }>> {
    return this.http.get<ApiResponse<{ name_first: string; name_last: string; email: string }>>(
      `${this.apiBaseUrl}/profile.php?user_id=${userId}&${this.ts()}`
    );
  }

  updateProfile(data: { user_id: number; name_first: string; name_last: string }): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.apiBaseUrl}/profile_update.php`, data);
  }

  // =======================
  // Elenco questionari
  // =======================
  getElencoQuestionari(): Observable<ApiResponse<Array<{ id: number; titolo: string; descrizione?: string; num_domande?: number }>>> {
    return this.http.get<ApiResponse<Array<{ id: number; titolo: string; descrizione?: string; num_domande?: number }>>>(
      `${this.apiBaseUrl}/get_questionari.php?${this.ts()}`
    );
  }

  // =======================
  // Elenco questionari PREMIUM
  // =======================
  getElencoQuestionariPremium(): Observable<ApiResponse<PremiumQuestionarioListItem[]>> {
    return this.http.get<ApiResponse<PremiumQuestionarioListItem[]>>(
      `${this.apiBaseUrl}/get_questionari_premium.php?${this.ts()}`
    );
  }

  /** Dettaglio “soft” dal listing premium */
  getQuestionarioPremiumInfo(questionarioId: number): Observable<PremiumQuestionarioListItem | null> {
    return this.getElencoQuestionariPremium().pipe(
      map(res => {
        if (!res?.success || !Array.isArray(res.data)) return null;
        const found = res.data.find(q => Number(q.id) === Number(questionarioId));
        return found ? {
          id: Number(found.id),
          titolo: found.titolo ?? `Questionario ${found.id}`,
          descrizione: found.descrizione ?? '',
          num_domande: found.num_domande ?? 0,
          num_prompts: found.num_prompts ?? undefined
        } : null;
      })
    );
  }

  // =======================
  // Domande questionario
  // =======================
  getDomandeQuestionario(questionarioId: number): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(
      `${this.apiBaseUrl}/get_domande.php?questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  getDomandeQuestionarioPremium(questionarioId: number): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(
      `${this.apiBaseUrl}/get_domande_premium.php?questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  // =======================
  // Dati questionario utente
  // =======================
  getQuestionario(userId: number, questionarioId: number): Observable<ApiResponse<Record<string, any>>> {
    return this.http.get<ApiResponse<Record<string, any>>>(
      `${this.apiBaseUrl}/questionario.php?user_id=${userId}&questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  postQuestionario(data: { user_id: number; questionario_id: number; questionario: Record<string, any> }): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.apiBaseUrl}/questionario.php`, data);
  }

  getQuestionarioPremium(userId: number, questionarioId: number): Observable<ApiResponse<Record<string, any>>> {
    return this.http.get<ApiResponse<Record<string, any>>>(
      `${this.apiBaseUrl}/questionario_premium.php?user_id=${userId}&questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  postQuestionarioPremium(data: { user_id: number; questionario_id: number; questionario: Record<string, any> }): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(`${this.apiBaseUrl}/questionario_premium.php`, data);
  }

  // =======================
  // Upload premium
  // =======================
  uploadFilePremium(
    userId: number,
    questionarioId: number,
    tipologiaId: number,
    file: File,
    nome?: string
  ): Observable<ApiResponse<{ file_name?: string; url?: string; path?: string; b2_file_name?: string; user_file_id?: number }>> {
    const form = new FormData();
    form.append('user_id', String(userId));
    form.append('questionario_id', String(questionarioId));
    form.append('tipologia_id', String(tipologiaId));
    if (nome) form.append('nome', nome);
    form.append('file', file, file.name);

    return this.http.post<ApiResponse<{ file_name?: string; url?: string; path?: string; b2_file_name?: string; user_file_id?: number }>>(
      `${this.apiBaseUrl}/upload_premium_b2.php?${this.ts()}`,
      form
    );
  }

  getUserFilesByTipologia(userId: number) {
    return this.http.get<ApiResponse<Array<{ user_file_id: number; tipologia_id: number | null; filename: string; url?: string }>>>(
      `${this.apiBaseUrl}/user_files_by_tipologia.php?user_id=${userId}&${this.ts()}`
    );
  }

  attachUserFileToQuestionario(
    userId: number,
    questionarioId: number,
    userFileId: number,
    tipologiaId: number
  ) {
    return this.http.post<ApiResponse>(
      `${this.apiBaseUrl}/attach_user_file_to_questionario.php?${this.ts()}`,
      { user_id: userId, questionario_id: questionarioId, user_file_id: userFileId, tipologia_id: tipologiaId }
    );
  }

  deleteUploadPremium(
    userId: number,
    questionarioId: number,
    tipologiaId: number,
    questionId?: string
  ) {
    const qid = questionId ? `&question_id=${encodeURIComponent(questionId)}` : '';
    return this.http.get<ApiResponse>(
      `${this.apiBaseUrl}/delete_premium_file.php?user_id=${userId}&questionario_id=${questionarioId}&tipologia_id=${tipologiaId}${qid}&${this.ts()}`
    );
  }

  // =======================
  // Servizi AI (standard)
  // =======================
  inizializzaAI(userId: number, questionarioId: number): Observable<ApiResponse<{ textResponse: string; jobs: number }>> {
    return this.http.get<ApiResponse<{ textResponse: string; jobs: number }>>(
      `${this.apiBaseUrl}/openai/inizializza.php?user_id=${userId}&questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  getAiDetails(userId: number, questionarioId: number): Observable<AiDetailsResponse> {
    return this.http.get<AiDetailsResponse>(
      `${this.apiBaseUrl}/openai/get_tutele.php?user_id=${userId}&questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  getAiStatus(userId: number, questionarioId: number): Observable<ApiResponse<AiStatus>> {
    return this.http.get<ApiResponse<AiStatus>>(
      `${this.apiBaseUrl}/openai/status.php?user_id=${userId}&questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  // =======================
  // Servizi AI PREMIUM
  // =======================
  inizializzaPremium(
    userId: number,
    questionarioId: number
  ): Observable<ApiResponse<{ enqueued: number; duplicates: number; total: number }>> {
    return this.http.get<ApiResponse<{ enqueued: number; duplicates: number; total: number }>>(
      `${this.apiBaseUrl}/openai/inizializza_premium.php?user_id=${userId}&questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  getAiStatusPremium(userId: number, questionarioId: number): Observable<ApiResponse<AiStatus>> {
    return this.http.get<ApiResponse<AiStatus>>(
      `${this.apiBaseUrl}/openai/status_premium.php?user_id=${userId}&questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  /** Supporta scope (es. 'summary') e restituisce opzionalmente result_id */
  getAiDetailsPremium(
    userId: number,
    questionarioId: number,
    scope?: 'summary' | 'file' | 'qa' | 'other'
  ): Observable<AiDetailsResponse> {
    const sc = scope ? `&scope=${encodeURIComponent(scope)}` : '';
    return this.http.get<AiDetailsResponse>(
      `${this.apiBaseUrl}/openai/get_tutele_premium.php?user_id=${userId}&questionario_id=${questionarioId}${sc}&${this.ts()}`
    );
  }

  /** Fallback per recuperare l'ultimo result_id del summary (serve per avviare la chat) */
  getLatestPremiumResultId(
    userId: number,
    questionarioId: number,
    scope: 'summary' = 'summary'
  ): Observable<ApiResponse<{ result_id: number }>> {
    return this.http.get<ApiResponse<{ result_id: number }>>(
      `${this.apiBaseUrl}/openai/get_latest_result_premium.php?user_id=${userId}&questionario_id=${questionarioId}&scope=${encodeURIComponent(scope)}&${this.ts()}`
    );
  }

  // ======================================================================
  // ANYTHINGLLM — CHAT (endpoint unico che prende il contesto da response_text di result_id)
  // ======================================================================

  /** Identificativo di sessione chat (rigenerato a ogni apertura schermata) */
  private chatSessionId: string | null = null;
  /** Thread corrente (impostato dopo il primo giro) */
  private chatThreadSlug: string | null = null;

  /** Genera un UUID v4 semplice per la sessione di UI */
  private newUuidv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 0xf) >> 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /** Da chiamare quando si apre/ricarica la schermata chat */
  startChatSession(): void {
    this.chatSessionId = this.newUuidv4();
    this.chatThreadSlug = null;
  }

  /** Reset esplicito senza ricaricare la schermata (richiede result_id al prossimo invio) */
  resetChatSession(): void {
    if (!this.chatSessionId) this.chatSessionId = this.newUuidv4();
    this.chatThreadSlug = null;
  }

  /**
   * Invia un messaggio alla chat.
   * - Primo invio della sessione: NON passare thread_slug. Passa { message, result_id }.
   *   Il backend userà users_ai_results_premium.response_text (ripulito HTML) come contesto e costruirà
   *   il messaggio completo (prompt + contesto + domanda).
   * - Invii successivi: passa solo { message } e il service manderà thread_slug salvato.
   * - Se vuoi forzare un nuovo thread durante la stessa sessione, passa { reset: true, result_id }.
   */
  sendChatMessage(args: ChatSendArgs): Observable<ChatServerData> {
    // Autostart session se mancante
    if (!this.chatSessionId) this.startChatSession();

    const isFirst = !this.chatThreadSlug || !!args.reset;

    // Validazioni minime lato client (per UX)
    if (isFirst && (!args.result_id || args.result_id <= 0)) {
      return throwError(() => new Error('result_id è obbligatorio al primo messaggio (o quando reset=true)'));
    }

    const payload: any = {
      session_id: this.chatSessionId,
      message: args.message
    };
    if (args.prompt) payload.prompt = args.prompt;
    if (args.reset)  payload.reset  = true;

    if (isFirst) {
      // Primo giro: NON mandare thread_slug, serve result_id
      payload.result_id = args.result_id;
    } else {
      // Follow-up: usa thread corrente (o quello passato esplicitamente)
      payload.thread_slug = args.thread_slug ?? this.chatThreadSlug;
    }

    return this.http
      .post<ApiResponse<ChatServerData>>(
        `${this.apiBaseUrl}/anyllm/chat.php?${this.ts()}`,
        payload
      )
      .pipe(
        map((res) => {
          if (!res?.success) {
            throw new Error(res?.message || 'Errore chat');
          }
          const data = res.data as ChatServerData;

          // Memorizza il thread la prima volta (o quando il backend lo restituisce)
          if (data?.thread_slug) {
            this.chatThreadSlug = data.thread_slug;
          }

          // Ritorna tutto (così puoi vedere sent_message per verificare prompt+contesto)
          return data;
        })
      );
  }
}

