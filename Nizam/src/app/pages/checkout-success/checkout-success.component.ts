import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-checkout-success',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './checkout-success.component.html',
  styleUrl: './checkout-success.component.css'
})
export class CheckoutSuccessComponent implements OnInit {
  sessionId = '';
  orderReference = '';
  statusMessage = 'Confirming your payment...';

  ngOnInit() {
    const params = new URLSearchParams(window.location.search);
    this.sessionId = params.get('session_id') || '';

    if (this.sessionId) {
      this.confirmPayment(this.sessionId);
    } else {
      this.statusMessage = 'No session to confirm.';
    }
  }

  async confirmPayment(sessionId: string) {
    try {
      const res = await fetch(`${environment.apiUrl}/api/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.orderReference = data.orderReference;
        this.statusMessage = `Payment confirmed — ${this.orderReference}`;
      } else {
        this.statusMessage = data.message || 'Payment could not be confirmed.';
      }
    } catch (e) {
      console.error(e);
      this.statusMessage = 'Unable to confirm payment at this time.';
    }
  }
}
