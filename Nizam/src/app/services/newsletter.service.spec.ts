import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NewsletterService } from './newsletter.service';

describe('NewsletterService', () => {
  let service: NewsletterService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(NewsletterService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts a normalized unsubscribe request', () => {
    service.unsubscribe(' shopper@example.com ').subscribe();
    const request = http.expectOne('/api/newsletter/unsubscribe');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'shopper@example.com' });
    request.flush({ success: true, message: 'Unsubscribed' });
  });

  it('posts a normalized subscription request', () => {
    service.subscribe(' shopper@example.com ').subscribe();
    const request = http.expectOne('/api/newsletter/subscribe');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'shopper@example.com', interests: [] });
    request.flush({ success: true, alreadySubscribed: false, message: 'Thanks' });
  });
});
