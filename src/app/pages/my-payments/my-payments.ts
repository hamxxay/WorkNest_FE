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
      validity:      this.parseDate(p.validity),
      validityDate:  this.parseDate(p.validityDate),
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

  async downloadChallan() {
    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF } = await import('jspdf');
    const el = document.getElementById('user-challan-printable');
    if (!el) return;
    // Temporarily hide action buttons
    const actions = el.querySelector<HTMLElement>('[data-challan-actions]');
    if (actions) actions.style.display = 'none';
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    if (actions) actions.style.display = '';
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const imgH = (canvas.height * pageW) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
    const p = this.challanToPrint();
    pdf.save(`Challan-${p?.challanNumber ?? p?.id ?? 'WN'}.pdf`);
  }

  printChallanDoc() {
    const el = document.getElementById('user-challan-printable');
    if (!el) return;
    const w = window.open('', '_blank', 'width=700,height=900');
    if (!w) return;
    w.document.write(`<html><head><title>Challan - ${this.challanToPrint()?.challanNumber ?? ''}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:Arial,sans-serif;background:#fff}
        button{display:none!important}
      </style>
      </head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  }

  getTotalPaid(): number { return this.totalPaid(); }
  getTotalPending(): number { return this.totalPending(); }
}
