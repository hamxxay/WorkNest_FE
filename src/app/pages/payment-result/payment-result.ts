import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-payment-result',
  imports: [RouterLink],
  templateUrl: './payment-result.html',
  styleUrl: './payment-result.css'
})
export class PaymentResult implements OnInit {
  status = signal<'success' | 'failed'>('success');
  bookingId = signal<string>('');
  amount = signal<string>('');
  ref = signal<string>('');
  message = signal<string>('');
  method = signal<string>('');
  assignedSpace = signal<any>(null);

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    const p = this.route.snapshot.queryParamMap;
    this.status.set(p.get('status') === 'success' ? 'success' : 'failed');
    this.bookingId.set(p.get('bookingId') ?? '');
    this.amount.set(p.get('amount') ?? '');
    this.ref.set(p.get('ref') ?? p.get('order_id') ?? '');
    this.message.set(p.get('message') ?? p.get('payment_status') ?? '');
    this.method.set(p.get('method') ?? '');
    
    // Parse assigned space info if available
    const assignedSpaceParam = p.get('assignedSpace');
    if (assignedSpaceParam) {
      try {
        this.assignedSpace.set(JSON.parse(assignedSpaceParam));
      } catch (e) {
        // Ignore parsing errors
      }
    }
    
    // Check session storage for PayFast assigned space info
    const bookingId = this.bookingId();
    if (bookingId && !this.assignedSpace()) {
      const sessionKey = `assignedSpace_${bookingId}`;
      const sessionData = sessionStorage.getItem(sessionKey);
      if (sessionData) {
        try {
          this.assignedSpace.set(JSON.parse(sessionData));
          sessionStorage.removeItem(sessionKey); // Clean up
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
  }
}
