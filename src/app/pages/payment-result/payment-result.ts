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

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    const p = this.route.snapshot.queryParamMap;
    this.status.set(p.get('status') === 'success' ? 'success' : 'failed');
    this.bookingId.set(p.get('bookingId') ?? '');
    this.amount.set(p.get('amount') ?? '');
    this.ref.set(p.get('ref') ?? '');
    this.message.set(p.get('message') ?? '');
  }
}
