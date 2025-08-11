import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

export interface AiDetailsResponse {
  success: boolean;
  data: Record<string, string>;
}

// Aggiunta: tipo per questionari premium
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

  // Cache-buster per evitare cache senza header custom
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
    // POST JSON: assicurati che config.php gestisca OPTIONS
    return this.http.post<ApiResponse>(
      `${this.apiBaseUrl}/profile_update.php`,
      data
    );
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
  // Elenco questionari PREMIUM (aggiunta)
  // =======================
  getElencoQuestionariPremium(): Observable<ApiResponse<PremiumQuestionarioListItem[]>> {
    return this.http.get<ApiResponse<PremiumQuestionarioListItem[]>>(
      `${this.apiBaseUrl}/get_questionari_premium.php?${this.ts()}`
    );
  }

  // =======================
  // Domande del questionario (standard)
  // =======================
  getDomandeQuestionario(questionarioId: number): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(
      `${this.apiBaseUrl}/get_domande.php?questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  // =======================
  // Domande del questionario PREMIUM (aggiunta)
  // =======================
  getDomandeQuestionarioPremium(questionarioId: number): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(
      `${this.apiBaseUrl}/get_domande_premium.php?questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  // =======================
  // Dati questionario utente (standard)
  // =======================
  getQuestionario(userId: number, questionarioId: number): Observable<ApiResponse<Record<string, any>>> {
    return this.http.get<ApiResponse<Record<string, any>>>(
      `${this.apiBaseUrl}/questionario.php?user_id=${userId}&questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  postQuestionario(data: { user_id: number; questionario_id: number; questionario: Record<string, any> }): Observable<ApiResponse> {
    // POST JSON: assicurati che config.php gestisca OPTIONS
    return this.http.post<ApiResponse>(
      `${this.apiBaseUrl}/questionario.php`,
      data
    );
  }

  // =======================
  // Dati questionario utente PREMIUM (aggiunte)
  // =======================
  getQuestionarioPremium(userId: number, questionarioId: number): Observable<ApiResponse<Record<string, any>>> {
    return this.http.get<ApiResponse<Record<string, any>>>(
      `${this.apiBaseUrl}/questionario_premium.php?user_id=${userId}&questionario_id=${questionarioId}&${this.ts()}`
    );
  }

  postQuestionarioPremium(data: { user_id: number; questionario_id: number; questionario: Record<string, any> }): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(
      `${this.apiBaseUrl}/questionario_premium.php`,
      data
    );
  }

  // =======================
  // Servizi AI (per-questionario)
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
}
