
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CustomerChatComponent } from './customer-chat.component';

describe('CustomerChatComponent', () => {
  let fixture: ComponentFixture<CustomerChatComponent>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CustomerChatComponent] }).compileComponents();
    fixture = TestBed.createComponent(CustomerChatComponent);
    element = fixture.nativeElement as HTMLElement;
  });

  it('opens accessibly and closes with Escape', async () => {
    fixture.detectChanges();
    const launcher = element.querySelector('.customer-chat__launcher') as HTMLButtonElement;
    expect(launcher.getAttribute('aria-label')).toBe('Chat with Amma');

    launcher.click();
    fixture.detectChanges();
    expect(element.querySelector('[role="dialog"]')).not.toBeNull();
    expect(element.querySelector('input')?.getAttribute('placeholder')).toContain('Ask about');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(element.querySelector('[role="dialog"]')).toBeNull();
  });

  it('sends a trimmed question and renders the assistant reply', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      message: 'Choose your usual size for a relaxed fit.',
      source: 'local'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    fixture.detectChanges();
    (element.querySelector('.customer-chat__launcher') as HTMLButtonElement).click();

    const component = fixture.componentInstance as any;
    component.draft = '  What size should I choose?  ';
    fixture.detectChanges();
    (element.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    const request = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(request.messages.at(-1)).toEqual({ role: 'user', content: 'What size should I choose?' });
    expect(element.textContent).toContain('Choose your usual size');
    expect(element.querySelectorAll('.customer-chat__message')).toHaveLength(3);
    fetchSpy.mockRestore();
  });
});
