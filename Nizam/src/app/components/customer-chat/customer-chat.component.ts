import { ChangeDetectionStrategy, Component, ElementRef, HostListener, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { SiteEventsService } from '../../services/site-events.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Component({
  selector: 'app-customer-chat',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './customer-chat.component.html',
  styleUrl: './customer-chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CustomerChatComponent {
  @ViewChild('messageInput') private messageInput?: ElementRef<HTMLInputElement>;

  protected readonly isOpen = signal(false);
  private readonly siteEvents = inject(SiteEventsService);
  protected readonly isSending = signal(false);
  protected readonly error = signal('');
  protected readonly messages = signal<ChatMessage[]>([{
    role: 'assistant',
    content: 'Hi, I’m Amma. Ask me about styling, sizing, shipping, returns, or finding your next look.'
  }]);
  protected draft = '';

  protected open(): void {
    this.isOpen.set(true);
    this.siteEvents.track('chat_opened');
    queueMicrotask(() => this.messageInput?.nativeElement.focus());
  }

  protected close(): void {
    if (!this.isSending()) this.isOpen.set(false);
  }

  protected async send(): Promise<void> {
    const content = this.draft.trim().slice(0, 600);
    if (!content || this.isSending()) return;

    const history = [...this.messages(), { role: 'user' as const, content }].slice(-10);
    this.messages.set(history);
    this.draft = '';
    this.error.set('');
    this.isSending.set(true);

    try {
      const response = await fetch(`${environment.apiUrl}/api/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });
      const payload = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !payload.success || !payload.message) {
        throw new Error('The assistant is unavailable right now.');
      }
      this.messages.update(messages => [...messages, { role: 'assistant', content: payload.message! }]);
    } catch {
      this.error.set('I could not connect just now. Please try again in a moment.');
    } finally {
      this.isSending.set(false);
      queueMicrotask(() => this.messageInput?.nativeElement.focus());
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }
}
