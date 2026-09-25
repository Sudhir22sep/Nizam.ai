import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild
} from '@angular/core';

/** Premium, controlled glassmorphic dialog with animated gradient edging. */
@Component({
  selector: 'app-glass-popup',
  standalone: true,
  templateUrl: './glass-popup.component.html',
  styleUrl: './glass-popup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GlassPopupComponent implements AfterViewInit {
  private isOpenState = false;

  @Input()
  set isOpen(value: boolean) {
    this.isOpenState = value;
    this.syncFocusState();
  }

  get isOpen(): boolean {
    return this.isOpenState;
  }

  @Input() eyebrow = 'Private preview';
  @Input() title = 'A luminous experience';
  @Input() description = '';
  @Input() closeLabel = 'Close popup';
  @Input() dismissible = true;

  @Output() readonly closed = new EventEmitter<void>();

  @ViewChild('dialog') private dialog?: ElementRef<HTMLElement>;

  private viewReady = false;
  private wasOpen = false;
  private previouslyFocused: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.syncFocusState();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen && this.dismissible) this.requestClose();
  }

  @HostListener('document:keydown.tab', ['$event'])
  onTab(event: KeyboardEvent): void {
    if (!this.isOpen || !this.dialog) return;

    const focusable = this.getFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      this.dialog.nativeElement.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !this.dialog.nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.dialog.nativeElement.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.requestClose();
  }

  requestClose(): void {
    if (this.dismissible) this.closed.emit();
  }

  private syncFocusState(): void {
    if (!this.viewReady) return;

    if (this.isOpen && !this.wasOpen) {
      const active = document.activeElement;
      this.previouslyFocused = active instanceof HTMLElement ? active : null;
      queueMicrotask(() => {
        if (!this.isOpen || !this.dialog) return;
        const first = this.getFocusableElements()[0];
        (first ?? this.dialog.nativeElement).focus();
      });
    } else if (!this.isOpen && this.wasOpen) {
      const target = this.previouslyFocused;
      this.previouslyFocused = null;
      setTimeout(() => target?.focus());
    }

    this.wasOpen = this.isOpen;
  }

  private getFocusableElements(): HTMLElement[] {
    if (!this.dialog) return [];
    return Array.from(this.dialog.nativeElement.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
  }
}
