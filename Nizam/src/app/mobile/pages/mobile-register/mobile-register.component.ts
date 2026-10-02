import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { eyeOutline, eyeOffOutline, lockClosedOutline, mailOutline, personOutline } from 'ionicons/icons';

import { AuthService } from '../../../services/auth.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../services/toast.service';
import { NativeShellService } from '../../services/native-shell.service';

/** Minimal length the password field enforces, mirroring the website form. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * MobileRegisterComponent — account creation.
 *
 * Submits to the same AuthService.register endpoint as the website, so an
 * account created in the app is usable on the site and vice versa.
 *
 * Validation is deliberately duplicated on the client rather than relying on the
 * server: a round trip per mistyped field on a phone connection is a poor
 * experience, and the server still validates everything (client checks are UX,
 * never a security boundary).
 */
@Component({
  selector: 'app-mobile-register',
  imports: [FormsModule, RouterLink, IonIcon, IonSpinner],
  templateUrl: './mobile-register.component.html',
  styleUrls: ['./mobile-register.component.scss'],
})
export class MobileRegisterComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly shell = inject(NativeShellService);

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);

  /** Only set once a field has been touched and failed, to avoid shouting. */
  protected readonly touched = signal(false);

  ngOnInit(): void {
    this.analytics.init();
    this.analytics.trackPageView('/register');
  }

  protected togglePasswordVisibility(): void {
    this.showPassword.update((visible) => !visible);
  }

  protected markTouched(): void {
    this.touched.set(true);
  }

  protected get passwordTooShort(): boolean {
    return this.password().length > 0 && this.password().length < MIN_PASSWORD_LENGTH;
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.touched.set(true);

    const firstName = this.firstName().trim();
    const lastName = this.lastName().trim();
    const email = this.email().trim();
    const phone = this.phone().trim();
    const password = this.password();

    if (!firstName || !lastName) {
      this.toast.warning('Enter your first and last name.');
      return;
    }
    if (!email) {
      this.toast.warning('Enter your email address.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      this.toast.warning(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
      return;
    }

    this.submitting.set(true);
    try {
      await new Promise<void>((resolve, reject) => {
        this.authService.register(firstName, lastName, email, phone, password).subscribe({
          next: (response) => {
            if (response?.success) {
              resolve();
            } else {
              reject(new Error(response?.message ?? 'Registration failed'));
            }
          },
          error: reject,
        });
      });

      this.analytics.trackSignUp('email');
      this.toast.success('Welcome to Amma Wears!');
      await this.shell.dismissKeyboard();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.toast.error(this.messageFor(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private messageFor(error: unknown): string {
    const candidate = error as { status?: number; error?: { message?: string } };
    if (candidate?.status === 409) {
      return 'An account with that email already exists.';
    }
    if (candidate?.status === 0) {
      return 'Cannot reach the server. Check your connection.';
    }
    return candidate?.error?.message ?? 'Could not create your account. Try again.';
  }
}
