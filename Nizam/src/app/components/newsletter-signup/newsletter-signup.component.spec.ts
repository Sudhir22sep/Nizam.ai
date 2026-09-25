import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NewsletterSignupComponent } from './newsletter-signup.component';

describe('NewsletterSignupComponent', () => {
  let fixture: ComponentFixture<NewsletterSignupComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NewsletterSignupComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(NewsletterSignupComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('submits an email and announces success accessibly', () => {
    fixture.componentInstance.email = 'shopper@example.com';
    fixture.componentInstance.subscribe();
    const request = http.expectOne('/api/newsletter/subscribe');
    expect(request.request.body.email).toBe('shopper@example.com');
    request.flush({ success: true, alreadySubscribed: false, message: 'Thanks for subscribing.' });
    fixture.detectChanges();
    expect(fixture.componentInstance.message()).toContain('Thanks');
    expect(fixture.nativeElement.querySelector('[aria-live="polite"]').textContent).toContain('Thanks');
  });
});
