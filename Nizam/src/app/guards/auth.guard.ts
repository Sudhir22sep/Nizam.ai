import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(): boolean {
    if (this.authService.isLoggedIn()) {
      return true;
    } else {
      // Store the attempted URL for redirecting after login
      this.authService.redirectUrl = this.router.url;
      // Redirect to login page
      this.router.navigate(['/login']);
      return false;
    }
  }
}