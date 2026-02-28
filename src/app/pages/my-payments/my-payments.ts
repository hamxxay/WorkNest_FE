import { Component, OnInit, signal, computed } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PaymentService } from '../../services/payment.service';

@Component({
  selector: 'app-my-payments',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './my-payments.html',
  styleUrl: './my-payments.css'
})
export class MyPayments implements OnInit {
  payments = signal<any[]>([]);
  loading = signal(true);

  // memoized summaries
  totalPaid = computed(() =>
    this.payments()
      .filter(p => p.paymentStatus === 'Paid')
      .reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
  );
  totalPending = computed(() =>
    this.payments()
      .filter(p => p.paymentStatus === 'Pending')
      .reduce((sum: number, p: any) => sum + (p.amount || 0), 0)
  );

  constructor(private paymentService: PaymentService) {}

  ngOnInit() {
    this.paymentService.getMyPayments().subscribe({
      next: (res: any) => {
        this.payments.set(res.data || []);
        this.loading.set(false);
      },
      error: () => {
        this.payments.set([]);
        this.loading.set(false);
      }
    });
  }

  getStatusClass(status: string): string {
    return 'status-' + (status || '').toLowerCase();
  }

  // old getters replaced by computed signals above; kept for reference
  getTotalPaid(): number {
    return this.totalPaid();
  }

  getTotalPending(): number {
    return this.totalPending();
  }
}
