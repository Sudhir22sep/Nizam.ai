import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.css'
})
export class ContactComponent {
  name = '';
  email = '';
  message = '';
  status = '';
  isSubmitting = false;

  async submitContact() {
    if (!this.name || !this.email || !this.message) {
      this.status = 'Please fill in every field before submitting.';
      return;
    }

    this.isSubmitting = true;
    this.status = '';

    try {
      const response = await fetch(`${environment.apiUrl}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.name, email: this.email, message: this.message }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        this.name = '';
        this.email = '';
        this.message = '';
        this.status = 'Thank you! Your message has been sent.';
      } else {
        this.status = result.message || 'Unable to send your message. Please try again later.';
      }
    } catch (error) {
      console.error(error);
      this.status = 'Unable to send your message at this time.';
    } finally {
      this.isSubmitting = false;
    }
  }
}
