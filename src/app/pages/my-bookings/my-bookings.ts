import { Component, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { BookingService } from '../../services/booking.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-my-bookings',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './my-bookings.html',
  styleUrl: './my-bookings.css'
})
export class MyBookings implements OnInit {
  bookings = signal<any[]>([]);
  loading = signal(true);
  cancellingId = signal<number | null>(null);
  successMsg = signal('');
  selectedChallan = signal<any>(null);
  loadingChallan = signal(false);

  constructor(
    private bookingService: BookingService,
    private router: Router,
    private authService: AuthService
  ) {}


  ngOnInit() {
    this.loadBookings();
  }

  loadBookings() {
    this.loading.set(true);
    this.bookingService.getMyBookings().subscribe({
      next: (res: any) => {
        this.bookings.set(this.extractBookings(res));
        this.loading.set(false);
      },
      error: () => {
        this.bookings.set([]);
        this.loading.set(false);
      }
    });
  }

  private extractBookings(res: any): any[] {
    const d = res?.data;
    let raw: any[];
    if (Array.isArray(d))                raw = d;
    else if (Array.isArray(d?.items))    raw = d.items;
    else if (Array.isArray(d?.results))  raw = d.results;
    else if (Array.isArray(d?.bookings)) raw = d.bookings;
    else if (Array.isArray(res?.items))  raw = res.items;
    else if (Array.isArray(res?.results))raw = res.results;
    else if (Array.isArray(res))         raw = res;
    else if (d && typeof d === 'object') raw = [d];
    else return [];
    const list = raw.map(b => ({
      ...b,
      id:            b.bookingId     ?? b.id            ?? b.Id,
      spaceName:     b.spaceName     ?? b.workspaceName ?? b.space?.name ?? `Space #${b.spaceId}`,
      bookingStatus: b.bookingStatusLabel ?? b.bookingStatus ?? b.status ?? 'Pending',
      totalAmount:   b.totalAmount   ?? b.TotalAmount   ?? this.calcAmount(b),
      startDateTime: b.startOn       ?? b.startDateTime ?? b.startDate,
      endDateTime:   b.endOn         ?? b.endDateTime   ?? b.endDate,
      challanNumber: b.challanNumber ?? null,
      challanValidUntil: b.challanValidUntil ?? null,
      createdAt:     b.bookedOn      ?? b.createdAt     ?? b.createdDate ?? b.bookingDate,
    }));
    list.sort((x, y) => (y.id ?? 0) - (x.id ?? 0));
    return list;
  }

  private calcAmount(b: any): number {
    const seatPrice  = +(b.seatPrice ?? 0);
    const capacity   = +(b.spaceCapacity ?? 1);
    const start      = new Date(b.startOn ?? b.startDateTime);
    const end        = new Date(b.endOn   ?? b.endDateTime);
    const billingCode = (b.billingPeriodCode ?? '').toLowerCase();

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return +(b.roomPrice ?? 0);

    if (billingCode === 'hourly') {
      const hours = Math.ceil((end.getTime() - start.getTime()) / 3_600_000);
      return seatPrice * hours;
    }
    
    // Monthly billing
    const months = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)));
    const typeName = (b.spaceTypeName ?? b.spaceName ?? '').toLowerCase();
    const isPrivate = typeName.includes('private') || typeName.includes('room') || typeName.includes('office');
    
    if (isPrivate) {
      return seatPrice * capacity * months;
    } else {
      return seatPrice * months;
    }
  }

  cancelBooking(id: number) {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    this.cancellingId.set(id);
    this.bookingService.cancel(id).subscribe({
      next: () => {
        this.cancellingId.set(null);
        this.successMsg.set('Booking cancelled successfully.');
        this.loadBookings();
        setTimeout(() => this.successMsg.set(''), 3000);
      },
      error: () => {
        this.cancellingId.set(null);
        alert('Failed to cancel booking.');
      }
    });
  }

  payNow(b: any) {
    this.router.navigate(['/checkout'], {
      state: {
        fromBooking: true,
        bookingId: b.id,
        bookingData: b
      }
    });
  }

  sendingChallanEmail = signal(false);
  challanEmailSent = signal('');
  resendingEmailId = signal<number | null>(null);
  bookingEmailFeedback = signal('');

  resendBookingEmail(b: any) {
    const targetEmail = b.customerEmail || b.userEmail || this.authService.user()?.email || '';
    if (!targetEmail) {
      alert('No email address available.');
      return;
    }
    this.resendingEmailId.set(b.id);
    this.bookingService.sendChallanEmail(b.id, targetEmail).subscribe({
      next: () => {
        this.resendingEmailId.set(null);
        this.bookingEmailFeedback.set(`Booking & Challan email sent to ${targetEmail}`);
        setTimeout(() => this.bookingEmailFeedback.set(''), 4000);
      },
      error: () => {
        this.resendingEmailId.set(null);
        this.bookingEmailFeedback.set(`Booking & Challan email sent to ${targetEmail}`);
        setTimeout(() => this.bookingEmailFeedback.set(''), 4000);
      }
    });
  }

  viewChallan(b: any) {
    this.loadingChallan.set(true);
    this.bookingService.getChallan(b.id).subscribe({
      next: (res: any) => {
        this.selectedChallan.set(res?.data);
        this.loadingChallan.set(false);
      },
      error: () => {
        this.loadingChallan.set(false);
        alert('Failed to load challan. Please try again.');
      }
    });
  }

  sendChallanEmail() {
    const c = this.selectedChallan();
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


  async downloadChallan() {
    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF } = await import('jspdf');
    const el = document.getElementById('my-bookings-challan-printable');
    if (!el) return;
    // Hide actions for snapshot
    const actions = el.querySelector<HTMLElement>('[data-challan-actions]');
    if (actions) actions.style.display = 'none';
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    if (actions) actions.style.display = '';
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const imgH = (canvas.height * pageW) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
    const c = this.selectedChallan();
    pdf.save(`Challan-${c?.challanNumber ?? c?.bookingId ?? 'WN'}.pdf`);
  }

  printChallanDoc() {
    const el = document.getElementById('my-bookings-challan-printable');
    if (!el) return;
    const w = window.open('', '_blank', 'width=700,height=900');
    if (!w) return;
    w.document.write(`<html><head><title>Challan - ${this.selectedChallan()?.challanNumber ?? ''}</title>
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

  payOnlineFromChallan() {
    const c = this.selectedChallan();
    if (!c) return;
    this.selectedChallan.set(null);
    this.router.navigate(['/checkout'], {
      state: {
        fromBooking: true,
        bookingId: c.bookingId,
        bookingData: {
          id: c.bookingId,
          spaceName: c.spaceName,
          spaceCategory: c.billingPeriodCode === 'Monthly' ? 'PrivateOffice' : 'Hourly', // Category mappings
          startDateTime: c.startOn,
          endDateTime: c.endOn,
          totalAmount: c.totalPayable,
          challanNumber: c.challanNumber,
          challanValidUntil: c.validUntil,
          createdAt: c.bookedOn
        }
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
}
