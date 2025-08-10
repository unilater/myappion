import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

// ===== Tipi di risposta comuni =====
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface AiDetailsResponse {
  success: boolean;
  data: Record<string, string>;
}

// ===== DataService =====
@Injectable({ providedIn: 'root' })
export class DataService {
  // BASE URL API
  private apiBaseUrl = 'https://pannellogaleazzi.appnativeitalia.com/api';

  // Header per evitare cache (utile con dati dinamici)
  private noCacheHeaders = new HttpHeaders({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });

  constructor(private http: HttpClient) {}

  // =======================
  // Profilo utente
  // =======================
  getProfile(userId: number): Observable<ApiResponse> {
    return this.http.get<ApiResponse>(
      `${this.apiBaseUrl}/profile.php?user_id=${userId}`,
      { headers: this.noCacheHeaders }
    );
    }

  updateProfile(data: { user_id: number; name_first: string; name_last: string }): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(
      `${this.apiBaseUrl}/profile_update.php`,
      data
    );
  }

  // =======================
  // Elenco questionari
  // =======================
  getElencoQuestionari(): Observable<ApiResponse<Array<{ id: number; titolo: string; descrizione?: string; num_domande?: number }>>> {
    return this.http.get<ApiResponse<Array<{ id: number; titolo: string; descrizione?: string; num_domande?: number }>>>(
      `${this.apiBaseUrl}/get_questionari.php`,
      { headers: this.noCacheHeaders }
    );
  }

  // =======================
  // Domande del questionario (ID obbligatorio)
  // =======================
  getDomandeQuestionario(questionarioId: number): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(
      `${this.apiBaseUrl}/get_domande.php?questionario_id=${questionarioId}`,
      { headers: this.noCacheHeaders }
    );
  }

  // =======================
  // Dati questionario utente (ID obbligatorio)
  // =======================
  getQuestionario(userId: number, questionarioId: number): Observable<ApiResponse<Record<string, any>>> {
    return this.http.get<ApiResponse<Record<string, any>>>(
      `${this.apiBaseUrl}/questionario.php?user_id=${userId}&questionario_id=${questionarioId}`,
      { headers: this.noCacheHeaders }
    );
  }

  postQuestionario(data: { user_id: number; questionario_id: number; questionario: Record<string, any> }): Observable<ApiResponse> {
    return this.http.post<ApiResponse>(
      `${this.apiBaseUrl}/questionario.php`,
      data
    );
  }

  // =======================
  // Servizi AI (accettano opzionalmente questionario_id)
  // =======================
  inizializzaAI(userId: number, questionarioId?: number): Observable<ApiResponse> {
    const q = questionarioId ? `&questionario_id=${questionarioId}` : '';
    return this.http.get<ApiResponse>(
      `${this.apiBaseUrl}/openai/inizializza.php?user_id=${userId}${q}`,
      { headers: this.noCacheHeaders }
    );
  }

  attivaTutele(userId: number, questionarioId?: number): Observable<ApiResponse> {
    const q = questionarioId ? `&questionario_id=${questionarioId}` : '';
    return this.http.get<ApiResponse>(
      `${this.apiBaseUrl}/openai/tutele.php?user_id=${userId}${q}`,
      { headers: this.noCacheHeaders }
    );
  }

  getAiDetails(userId: number, questionarioId?: number): Observable<AiDetailsResponse> {
    const q = questionarioId ? `&questionario_id=${questionarioId}` : '';
    return this.http.get<AiDetailsResponse>(
      `${this.apiBaseUrl}/openai/get_tutele.php?user_id=${userId}${q}`,
      { headers: this.noCacheHeaders }
    );
  }
}
