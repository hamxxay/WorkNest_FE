import { Component, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
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

  constructor(private bookingService: BookingService) {}

  ngOnInit() {
    this.loadBookings();
  }

  loadBookings() {
    this.loading.set(true);
    this.bookingService.getMyBookings().subscribe({
      next: (res: any) => {
        this.bookings.set(res.data || []);
        this.loading.set(false);
      },
      error: () => {
        this.bookings.set([]);
        this.loading.set(false);
      }
    });
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

  getStatusClass(status: string): string {
    return 'status-' + (status || '').toLowerCase();
  }
}
