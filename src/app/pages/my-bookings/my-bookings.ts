import { Component, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { BookingService } from '../../services/booking.service';

@Component({
  selector: 'app-my-bookings',
  imports: [DatePipe, RouterLink],
  templateUrl: './my-bookings.html',
  styleUrl: './my-bookings.css'
})
export class MyBookings implements OnInit {
  bookings = signal<any[]>([]);
  loading = signal(true);
  cancellingId = signal<number | null>(null);
  successMsg = signal('');

  constructor(private bookingService: BookingService, private router: Router) {}

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
    return raw.map(b => ({
      ...b,
      id:            b.id            ?? b.bookingId    ?? b.Id,
      spaceName:     b.spaceName     ?? b.workspaceName ?? b.space?.name ?? `Space #${b.spaceId}`,
      bookingStatus: b.bookingStatus ?? b.status        ?? b.Status ?? 'Pending',
      totalAmount:   b.totalAmount   ?? b.amount        ?? 0,
      startDateTime: b.startDateTime ?? b.startDate,
      endDateTime:   b.endDateTime   ?? b.endDate,
      createdAt:     b.createdAt     ?? b.createdDate   ?? b.bookingDate,
    }));
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

  payNow(id: number) {
    this.router.navigate(['/checkout', id]);
  }

  getStatusClass(status: string): string {
    return 'status-' + (status || '').toLowerCase();
  }
}
