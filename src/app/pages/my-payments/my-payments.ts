import { Component, OnInit, signal, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PaymentService } from '../../services/payment.service';

@Component({
  selector: 'app-my-payments',
  imports: [DecimalPipe, RouterLink],
  templateUrl: './my-payments.html',
  styleUrl: './my-payments.css'
})
export class MyPayments implements OnInit {
  payments = signal<any[]>([]);
  loading = signal(true);
  challanToPrint = signal<any>(null);

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

  private parseDate(val: string | null): string | null {
    if (!val) return null;
    // Handle DD/MM/YYYY HH:MM:SS am/pm
    const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}${m[4]}`;
    return val;
  }

  private normalizePayment(p: any): any {
    return {
      ...p,
      paidAt:        this.parseDate(p.paidAt),
      startDateTime: this.parseDate(p.startDateTime),
      endDateTime:   this.parseDate(p.endDateTime),
    };
  }

  ngOnInit() {
    this.paymentService.getMyPayments().subscribe({
      next: (res: any) => {
        const raw = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
        this.payments.set(raw.map((p: any) => this.normalizePayment(p)));
        this.loading.set(false);
      },
      error: () => {
        this.payments.set([]);
        this.loading.set(false);
      }
    });
  }

  tryDate(val: string | null): string {
    if (!val) return '—';
    const d = new Date(val);
    return isNaN(d.getTime()) ? val : d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  }

  getStatusClass(status: string): string {
    return 'status-' + (status || '').toLowerCase();
  }

  getDisplayStatus(p: any): string {
    if ((p.paymentMethod || '').toLowerCase().includes('cash') && p.paymentStatus !== 'Paid') {
      return 'Pending';
    }
    return p.paymentStatus || '—';
  }

  printChallan(p: any) {
    this.challanToPrint.set(p);
  }

  printChallanDoc() {
    const el = document.getElementById('user-challan-printable');
    if (!el) return;
    const w = window.open('', '_blank', 'width=680,height=600');
    if (!w) return;
    w.document.write(`<html><head><title>Challan</title>
      <style>body{font-family:sans-serif;padding:24px}*{box-sizing:border-box}</style>
      </head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
    w.close();
  }

  getTotalPaid(): number { return this.totalPaid(); }
  getTotalPending(): number { return this.totalPending(); }
}
