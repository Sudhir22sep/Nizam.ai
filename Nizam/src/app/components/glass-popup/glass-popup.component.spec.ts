import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GlassPopupComponent } from './glass-popup.component';

describe('GlassPopupComponent', () => {
  let fixture: ComponentFixture<GlassPopupComponent>;
  let component: GlassPopupComponent;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [GlassPopupComponent] }).compileComponents();

    fixture = TestBed.createComponent(GlassPopupComponent);
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
  });

  it('starts closed and exposes accessible dialog state', () => {
    fixture.detectChanges();

    const overlay = element.querySelector('.glass-popup') as HTMLElement;
    const dialog = element.querySelector('[role="dialog"]') as HTMLElement;

    expect(overlay.classList.contains('glass-popup--open')).toBe(false);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.hasAttribute('inert')).toBe(true);
  });

  it('opens from the input and renders projected content', () => {
    component.isOpen = true;
    component.title = 'Members preview';
    fixture.detectChanges();

    const overlay = element.querySelector('.glass-popup') as HTMLElement;
    const dialog = element.querySelector('[role="dialog"]') as HTMLElement;

    expect(overlay.classList.contains('glass-popup--open')).toBe(true);
    expect(overlay.getAttribute('aria-hidden')).toBe('false');
    expect(dialog.hasAttribute('inert')).toBe(false);
    expect(dialog.getAttribute('aria-label')).toBe('Members preview');
  });

  it('emits closed from the vector close button', () => {
    const closed = vi.fn();
    component.isOpen = true;
    component.closed.subscribe(closed);
    fixture.detectChanges();

    (element.querySelector('.glass-popup__close') as HTMLButtonElement).click();

    expect(closed).toHaveBeenCalledOnce();
  });

  it('emits closed only when the backdrop itself is clicked', () => {
    const closed = vi.fn();
    component.isOpen = true;
    component.closed.subscribe(closed);
    fixture.detectChanges();

    const overlay = element.querySelector('.glass-popup') as HTMLElement;
    (element.querySelector('.glass-popup__dialog') as HTMLElement).click();
    expect(closed).not.toHaveBeenCalled();

    overlay.click();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('moves focus into the dialog, traps Tab, and restores focus on close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    component.isOpen = true;
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();

    const close = element.querySelector('.glass-popup__close') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);

    close.focus();
    component.onTab(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement).toBe(close);

    close.blur();
    component.onTab(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement).toBe(close);

    component.isOpen = false;
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('contains focus even when the popup is non-dismissible', async () => {
    component.isOpen = true;
    component.dismissible = false;
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();

    const dialog = element.querySelector('[role="dialog"]') as HTMLElement;
    const close = element.querySelector('.glass-popup__close');
    expect(close).toBeNull();
    expect(document.activeElement).toBe(dialog);
  });

  it('closes on Escape only when open and dismissible', () => {
    const closed = vi.fn();
    component.closed.subscribe(closed);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).not.toHaveBeenCalled();

    component.isOpen = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalledOnce();

    component.dismissible = false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalledOnce();
  });
});
