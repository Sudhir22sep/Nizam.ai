import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="false">
      <div
        *ngFor="let toast of toastService.toasts()"
        class="toast toast-{{ toast.type }}"
        [class.toast-exit]="!toast.visible"
        role="alert"
      >
        <span class="toast-icon" aria-hidden="true">
          <svg *ngIf="toast.type === 'success'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <svg *ngIf="toast.type === 'error'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          <svg *ngIf="toast.type === 'warning'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <svg *ngIf="toast.type === 'info'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </span>
        <span class="toast-message">{{ toast.message }}</span>
        <button class="toast-close" (click)="toastService.dismiss(toast.id)" aria-label="Dismiss notification">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
    .toast-stack {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 420px;
      pointer-events: none;
    }
    .toast {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(255,255,255,0.96);
      border: 1px solid;
      box-shadow: 0 12px 32px rgba(18,15,44,0.18);
      font-size: 0.9rem;
      line-height: 1.45;
      pointer-events: auto;
      animation: toast-in 0.25s ease both;
      will-change: transform, opacity;
    }
    .toast-toast-exit,
    .toast-exit {
      animation: toast-out 0.18s ease both;
    }
    .toast-success {
      border-color: rgba(58, 120, 90, 0.35);
      background: #f4f9f5;
    }
    .toast-error {
      border-color: rgba(200, 70, 70, 0.4);
      background: #fdf2f2;
    }
    .toast-warning {
      border-color: rgba(176, 141, 87, 0.4);
      background: #faf6ef;
    }
    .toast-info {
      border-color: rgba(74, 107, 87, 0.35);
      background: #f4f8f6;
    }
    .toast-icon {
      flex-shrink: 0;
      margin-top: 1px;
      color: var(--brand-dark, #1E2A38);
    }
    .toast-message {
      flex: 1;
      color: var(--text-color, #3C4C5E);
    }
    .toast-close {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: inherit;
      opacity: 0.55;
      cursor: pointer;
      border-radius: 4px;
      transition: opacity 0.15s ease;
    }
    .toast-close:hover {
      opacity: 1;
    }
    @keyframes toast-in {
      from { transform: translateX(24px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes toast-out {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(24px); opacity: 0; }
    }
    @media (max-width: 480px) {
      .toast-stack {
        left: 12px;
        right: 12px;
        bottom: 12px;
        max-width: none;
      }
    }
  `]
})
export class ToastContainerComponent {
  readonly toastService = inject(ToastService);
}
