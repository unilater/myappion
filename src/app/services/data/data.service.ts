import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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

@Injectable({ providedIn: 'root' })
export class DataService {
  private apiBaseUrl = 'https://pannellogaleazzi.appnativeitalia.com/api';

  constructor(private http: HttpClient) {}

  // Cache-buster
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
  // Elenco questionari (standard)
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

  /** Fallback per recuperare l'ultimo result_id del summary */
  getLatestPremiumResultId(
    userId: number,
    questionarioId: number,
    scope: 'summary' = 'summary'
  ): Observable<ApiResponse<{ result_id: number }>> {
    return this.http.get<ApiResponse<{ result_id: number }>>(
      `${this.apiBaseUrl}/openai/get_latest_result_premium.php?user_id=${userId}&questionario_id=${questionarioId}&scope=${encodeURIComponent(scope)}&${this.ts()}`
    );
  }

  // =======================
  // Chat via backend proxy (AnythingLLM nascosto lato server)
  // =======================
  sendChatMessageViaBackend(args: {
    user_id: number;
    questionario_id: number;
    message: string;
    result_id?: number;
    thread_slug?: string | null;
  }): Observable<{ reply: string; thread_slug?: string | null; result_id?: number | null }> {
    const form = new FormData();
    form.append('user_id', String(args.user_id));
    form.append('questionario_id', String(args.questionario_id));
    form.append('message', args.message);
    if (args.result_id != null) form.append('result_id', String(args.result_id));
    if (args.thread_slug) form.append('thread_slug', args.thread_slug);

    return this.http.post<ApiResponse<{ reply: string; thread_slug?: string; result_id?: number }>>(
      `${this.apiBaseUrl}/anyllm/chat_send.php?${this.ts()}`,
      form
    ).pipe(
      map(res => {
        if (!res?.success) throw new Error(res?.message || 'Errore chat');
        return {
          reply: res.data?.reply || '',
          thread_slug: res.data?.thread_slug || null,
          result_id: res.data?.result_id ?? null
        };
      })
    );
  }
}
