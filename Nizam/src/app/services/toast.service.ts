import { Injectable, signal, NgZone } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  visible: boolean;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private counter = signal(0);
  readonly toasts = signal<Toast[]>([]);

  constructor(private ngZone: NgZone) {}

  private nextId(): number {
    const id = this.counter();
    this.counter.set(id + 1);
    return id;
  }

  show(message: string, type: ToastType = 'info', duration = 4000): void {
    const id = this.nextId();
    const toast: Toast = { id, message, type, visible: true };
    this.ngZone.run(() => { this.toasts.update(list => [...list, toast]); });
    setTimeout(() => this.dismiss(id), duration);
  }

  success(message: string, duration = 4000): void { this.show(message, 'success', duration); }
  error(message: string, duration = 5000): void { this.show(message, 'error', duration); }
  info(message: string, duration = 4000): void { this.show(message, 'info', duration); }
  warning(message: string, duration = 4000): void { this.show(message, 'warning', duration); }

  confirm(message: string): Promise<boolean> {
    return new Promise(resolve => {
      const id = this.nextId();
      this.ngZone.run(() => {
        this.toasts.update(list => [
          ...list,
          { id, message, type: 'warning', visible: true }
        ]);
      });
      (window as any).__toastConfirm = (choice: boolean) => {
        this.dismiss(id);
        resolve(choice);
      };
    });
  }

  dismiss(id: number): void {
    this.ngZone.run(() => {
      this.toasts.update(list => list.map(t =>
        t.id === id ? { ...t, visible: false } : t
      ));
      setTimeout(() => {
        this.ngZone.run(() => {
          this.toasts.update(list => list.filter(t => t.id !== id || t.visible));
        });
      }, 220);
    });
  }
}

