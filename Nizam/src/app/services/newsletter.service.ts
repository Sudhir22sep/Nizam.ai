import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface NewsletterResponse {
  success: boolean;
  alreadySubscribed: boolean;
  welcomeEmailSent?: boolean;
  message: string;
}

export interface NewsletterUnsubscribeResponse {
  success: boolean;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class NewsletterService {
  private readonly http = inject(HttpClient);

  subscribe(email: string, interests: string[] = []): Observable<NewsletterResponse> {
    return this.http.post<NewsletterResponse>('/api/newsletter/subscribe', {
      email: email.trim().toLowerCase(),
      interests: interests.map(interest => interest.trim()).filter(Boolean).slice(0, 12)
    });
  }

  unsubscribe(email: string): Observable<NewsletterUnsubscribeResponse> {
    return this.http.post<NewsletterUnsubscribeResponse>('/api/newsletter/unsubscribe', { email: email.trim().toLowerCase() });
  }
}
