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
    // Handle all common API response shapes:
    // { data: [...] }  |  { data: { items: [...] } }  |  { data: { results: [...] } }  |  [...]
    const d = res?.data;
    if (Array.isArray(d))              return d;
    if (Array.isArray(d?.items))       return d.items;
    if (Array.isArray(d?.results))     return d.results;
    if (Array.isArray(d?.bookings))    return d.bookings;
    if (Array.isArray(res?.items))     return res.items;
    if (Array.isArray(res?.results))   return res.results;
    if (Array.isArray(res))            return res;
    return [];
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
