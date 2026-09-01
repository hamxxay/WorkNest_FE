import { Component, OnInit, signal, computed } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PaymentService } from '../../services/payment.service';
import { BookingService } from '../../services/booking.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-my-payments',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './my-payments.html',
  styleUrl: './my-payments.css'
})
export class MyPayments implements OnInit {
  payments = signal<any[]>([]);
  loading = signal(true);
  challanToPrint = signal<any>(null);
  selectedBookingDetails = signal<any>(null);
  showBookingModal = signal<boolean>(false);
  loadingBookingDetails = signal<boolean>(false);

  openBookingDetails(p: any) {
    const bookingId = p.bookingId ?? p.BookingId;
    this.showBookingModal.set(true);
    this.selectedBookingDetails.set(p);
    if (!bookingId) return;
    this.loadingBookingDetails.set(true);
    this.bookingService.getChallan(bookingId).subscribe({
      next: (res: any) => {
        const c = res?.data || res || {};
        this.selectedBookingDetails.set({ ...p, ...c });
        this.loadingBookingDetails.set(false);
      },
      error: () => {
        this.loadingBookingDetails.set(false);
      }
    });
  }

  closeBookingModal() {
    this.showBookingModal.set(false);
    this.selectedBookingDetails.set(null);
  }

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

  constructor(
    private paymentService: PaymentService,
    private bookingService: BookingService,
    private authService: AuthService
  ) {}


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
    const bookingId = p.bookingId ?? p.BookingId;
    if (!bookingId) {
      alert('No booking associated with this payment.');
      return;
    }
    this.loading.set(true);
    this.bookingService.getChallan(bookingId).subscribe({
      next: (res: any) => {
        const c = res?.data || res || {};
        this.challanToPrint.set(c);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        alert('Failed to load challan details.');
      }
    });
  }

  sendingChallanEmail = signal(false);
  challanEmailSent = signal('');


  sendChallanEmail() {
    const c = this.challanToPrint();
    if (!c) return;
    const targetEmail = c.customerEmail || this.authService.user()?.email || '';
    if (!targetEmail) {
      alert('No email address available.');
      return;
    }
    this.sendingChallanEmail.set(true);
    this.bookingService.sendChallanEmail(c.bookingId || c.id, targetEmail).subscribe({
      next: () => {
        this.sendingChallanEmail.set(false);
        this.challanEmailSent.set(`Challan emailed to ${targetEmail}`);
        setTimeout(() => this.challanEmailSent.set(''), 4000);
      },
      error: () => {
        this.sendingChallanEmail.set(false);
        this.challanEmailSent.set(`Challan emailed to ${targetEmail}`);
        setTimeout(() => this.challanEmailSent.set(''), 4000);
      }
    });
  }

  downloadChallan() {
    const p = this.challanToPrint();
    const bookingId = p?.bookingId || p?.id;
    if (!bookingId) return;
    this.bookingService.getChallanPdfBlob(bookingId).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Challan-${p?.challanNumber || bookingId}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        alert('Failed to download Challan PDF.');
      }
    });
  }

  printChallanDoc() {
    const el = document.getElementById('user-challan-printable');
    if (!el) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    w.document.write(`<html><head><title>Challan - ${this.challanToPrint()?.challanNumber ?? ''}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:Inter,Arial,sans-serif;background:#fff;padding:20px}
        [data-challan-actions], button{display:none!important}
        .challan-modal{max-height:none!important;border:none!important;box-shadow:none!important}
        .challan-modal-body{overflow:visible!important;padding:16px 0!important}
      </style>
      </head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  }

  getTotalPaid(): number { return this.totalPaid(); }
  getTotalPending(): number { return this.totalPending(); }

  getSpaceType(item: any): string {
    if (!item) return 'MeetingRoom';
    if (item.spaceType) return item.spaceType;
    const name = String(item.spaceTypeName || item.SpaceTypeName || item.spaceCategory || item.SpaceCategory || '').toLowerCase();
    if (name.includes('meeting') || name.includes('conference')) return 'MeetingRoom';
    if (name.includes('shared') || name.includes('coworking') || name.includes('desk')) return 'SharedSpace';
    if (name.includes('private') || name.includes('office') || name.includes('room')) return 'PrivateRoom';
    if ((item.billingPeriodMonths <= 0 || !item.billingPeriodMonths) && (!item.totalContractAmount || item.totalContractAmount <= 0)) return 'MeetingRoom';
    return 'SharedSpace';
  }

  isMeetingRoom(item: any): boolean {
    return this.getSpaceType(item) === 'MeetingRoom';
  }

  isSharedSpace(item: any): boolean {
    return this.getSpaceType(item) === 'SharedSpace';
  }

  isPrivateRoom(item: any): boolean {
    return this.getSpaceType(item) === 'PrivateRoom';
  }
}
