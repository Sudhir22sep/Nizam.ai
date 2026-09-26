import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  isLoading = false;
  errorMessage: string | null = null;
  /** Providers the server has credentials for; empty hides the buttons. */
  socialProviders: string[] = [];
  /** Set while the provider redirect is being exchanged for a session. */
  completingSocialLogin = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      rememberMe: [false]
    });
  }

  ngOnInit(): void {
    // The provider redirects back here with ?socialCallback=1 (or
    // ?socialError=…). Finish the handshake before the "already signed in"
    // check below would redirect away from the page.
    this.finishSocialLoginFromRedirect();

    // If user is already logged in, redirect to home
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/']);
    }

    this.authService.getSocialProviders().subscribe(providers => {
      this.socialProviders = providers;
    });
  }

  /** Reads the redirect query params and completes or reports the social flow. */
  private finishSocialLoginFromRedirect(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const failure = params.get('socialError');
    if (failure) {
      this.errorMessage = this.socialErrorMessage(failure);
      return;
    }

    if (params.get('socialCallback') !== '1') {
      return;
    }

    this.completingSocialLogin = true;
    this.authService.completeSocialLogin().subscribe({
      next: () => {
        this.completingSocialLogin = false;
        const redirectUrl = this.authService.redirectUrl || '/';
        this.router.navigateByUrl(redirectUrl);
      },
      error: () => {
        this.completingSocialLogin = false;
        this.errorMessage = 'We could not complete that sign-in. Please try again.';
      },
    });
  }

  private socialErrorMessage(code: string): string {
    switch (code) {
      case 'denied':
        return 'Sign-in was cancelled. No worries — you can use email and password instead.';
      case 'account_disabled':
        return 'This account has been deactivated.';
      case 'email_required':
        return 'That provider did not share an email address. Please use email and password.';
      case 'state_mismatch':
      case 'invalid_response':
        return 'That sign-in link expired or could not be verified. Please try again.';
      default:
        return 'Social sign-in is unavailable right now. Please use email and password.';
    }
  }

  /** Hands the browser to the provider's consent screen. */
  loginWith(provider: string): void {
    this.errorMessage = null;
    this.authService.startSocialLogin(provider);
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    const { email, password } = this.loginForm.value;

    this.authService.login(email, password).subscribe({
      next: () => {
        this.isLoading = false;
        // Redirect to intended URL or home
        const redirectUrl = this.authService.redirectUrl || '/';
        this.router.navigateByUrl(redirectUrl);
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.message || 'Login failed';
      }
    });
  }
}