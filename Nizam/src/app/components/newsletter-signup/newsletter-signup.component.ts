import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NewsletterService, NewsletterResponse } from '../../services/newsletter.service';

@Component({
  selector: 'app-newsletter-signup',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form class="newsletter-form" (ngSubmit)="subscribe()" novalidate>
      <label for="newsletter-email">Join the Amma Wears newsletter</label>
      <div class="newsletter-controls">
        <input id="newsletter-email" name="email" type="email" autocomplete="email" required
          [(ngModel)]="email" (input)="clearMessage()" [attr.aria-invalid]="message() ? 'true' : null"
          [disabled]="loading()" placeholder="Your email address" aria-describedby="newsletter-message">
        <button type="submit" [disabled]="loading() || !email.trim()">{{ loading() ? 'Joining…' : 'Subscribe' }}</button>
      </div>
        <div class="newsletter-interests" role="group" aria-label="Choose your shopping interests">
          <span class="newsletter-interests__label">I'm interested in</span>
          @for (interest of interests; track interest) {
            <label class="newsletter-interest">
              <input type="checkbox" [checked]="selectedInterests().includes(interest)" (change)="toggleInterest(interest)">
              <span>{{ interest }}</span>
            </label>
          }
        </div>
        <p class="newsletter-consent">By subscribing, you agree to receive Amma Wears marketing emails about new arrivals, products, and offers. You can unsubscribe anytime.</p>
      <p id="newsletter-message" class="newsletter-message" [class.newsletter-message--error]="isError()" aria-live="polite">{{ message() }}</p>
    </form>
  `,
  styles: [`
    .newsletter-form { display: grid; gap: .55rem; max-width: 420px; }
    label { color: #fff; font-weight: 700; }
    .newsletter-controls { display: flex; gap: .5rem; flex-wrap: wrap; }
    input { min-width: 0; flex: 1 1 220px; padding: .75rem .85rem; border: 1px solid #64748b; border-radius: 8px; background: #fff; color: #14263D; }
    button { padding: .75rem 1rem; border: 0; border-radius: 8px; background: #E9B949; color: #14263D; font-weight: 800; cursor: pointer; }
    button:disabled { cursor: not-allowed; opacity: .65; }
    .newsletter-interests { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem .7rem; color: rgba(255,255,255,.78); font-size: .76rem; }
    .newsletter-interests__label { font-weight: 700; }
    .newsletter-interest { display: inline-flex; align-items: center; gap: .3rem; font-weight: 500; cursor: pointer; }
    .newsletter-interest input { width: 15px; height: 15px; flex: 0 0 auto; accent-color: #E9B949; }
    .newsletter-consent { margin: 0; color: rgba(255, 255, 255, .58); font-size: .72rem; line-height: 1.45; }
    .newsletter-message { min-height: 1.25rem; color: #d9f99d; font-size: .85rem; }
    .newsletter-message--error { color: #fecaca; }
  `]
})
export class NewsletterSignupComponent {
  private readonly newsletter = inject(NewsletterService);
  email = '';
  readonly loading = signal(false);
  readonly message = signal('');
  readonly isError = signal(false);
  readonly interests = ['Women', 'Men', 'Footwear', 'Accessories', 'Beauty'];
  readonly selectedInterests = signal<string[]>([]);

  toggleInterest(interest: string): void {
    this.selectedInterests.update(selected => selected.includes(interest)
      ? selected.filter(item => item !== interest)
      : [...selected, interest]);
  }

  subscribe(): void {
    const email = this.email.trim();
    if (!email || this.loading()) return;
    this.loading.set(true);
    this.message.set('');
    this.isError.set(false);
    this.newsletter.subscribe(email, this.selectedInterests()).subscribe({
      next: (result: NewsletterResponse) => {
        this.email = '';
        this.message.set(result.message);
        this.isError.set(!result.success);
        this.loading.set(false);
      },
      error: (error: { error?: { message?: string } }) => {
        this.message.set(error?.error?.message || 'Unable to subscribe right now. Please try again later.');
        this.isError.set(true);
        this.loading.set(false);
      },
    });
  }

  clearMessage(): void {
    if (this.message()) {
      this.message.set('');
      this.isError.set(false);
    }
  }
}
