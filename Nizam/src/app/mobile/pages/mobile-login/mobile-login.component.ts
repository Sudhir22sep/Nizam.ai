import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { eyeOutline, eyeOffOutline, lockClosedOutline, mailOutline } from 'ionicons/icons';

import { AuthService } from '../../../services/auth.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../services/toast.service';
import { NativeShellService } from '../../services/native-shell.service';

/**
 * MobileLoginComponent — sign-in screen.
 *
 * Calls the same AuthService as the website, so a shopper who signs in on the
 * phone is signed in on every screen: the JWT is stored by the service and
 * attached by AuthInterceptor.
 *
 * Two mobile-specific behaviours:
 *  - the password field toggles visibility, which matters far more on a shared
 *    or public device than on a desktop keyboard;
 *  - `enterkeyhint="go"` and a submit-on-Enter handler, because on a phone the
 *    software keyboard's action key is the natural way to submit.
 */
@Component({
  selector: 'app-mobile-login',
  imports: [FormsModule, RouterLink, IonIcon, IonSpinner],
  templateUrl: './mobile-login.component.html',
  styleUrls: ['./mobile-login.component.scss'],
})
export class MobileLoginComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly shell = inject(NativeShellService);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);

  ngOnInit(): void {
    this.analytics.init();
    this.analytics.trackPageView('/login');
  }

  protected togglePasswordVisibility(): void {
    this.showPassword.update((visible) => !visible);
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    const email = this.email().trim();
    const password = this.password();

    if (!email || !password) {
      this.toast.warning('Enter your email and password.');
      return;
    }

    this.submitting.set(true);
    try {
      await new Promise<void>((resolve, reject) => {
        this.authService.login(email, password).subscribe({
          next: (response) => {
            if (response?.success) {
              resolve();
            } else {
              reject(new Error(response?.message ?? 'Sign in failed'));
            }
          },
          error: reject,
        });
      });

      this.analytics.trackLogin('email');
      this.toast.success('Welcome back!');

      // The guard stores the URL the shopper was denied, so they resume exactly
      // where they left off (e.g. checkout) rather than at the home screen.
      const redirectUrl = this.authService.redirectUrl || '/';
      this.authService.redirectUrl = null;
      await this.shell.dismissKeyboard();
      await this.router.navigateByUrl(redirectUrl);
    } catch (error) {
      this.toast.error(this.messageFor(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Turns an HttpErrorResponse into wording a shopper can act on. */
  private messageFor(error: unknown): string {
    const candidate = error as { status?: number; error?: { message?: string } };
    if (candidate?.status === 401) {
      return 'That email and password combination is not recognised.';
    }
    if (candidate?.status === 0) {
      return 'Cannot reach the server. Check your connection.';
    }
    return candidate?.error?.message ?? 'Sign in failed. Try again.';
  }
}
