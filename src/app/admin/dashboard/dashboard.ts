import { Component, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../services/admin.service';
import { forkJoin, of, catchError } from 'rxjs';

@Component({
  selector: 'app-admin-dashboard',
  imports: [DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class AdminDashboard implements OnInit {
  loading = signal(true);
  stats = signal({
    users: 0, spaces: 0, bookings: 0, contacts: 0,
    locations: 0, plans: 0, gallery: 0, memberships: 0
  });
  recentBookings = signal<any[]>([]);
  recentContacts = signal<any[]>([]);

  constructor(private admin: AdminService) {}

  ngOnInit() {
    // first fetch the lightweight summary counts wrapped in ApiResponse
    this.admin.getDashboardStats()
      .pipe(
        catchError(() => of({ isSuccessful: false })),
      )
      .subscribe((res: any) => {
        if (res.isSuccessful && res.data) {
          this.stats.set(res.data);
        } else {
          // fallback structure matches initial value shape
          this.stats.set({
            users: 0, spaces: 0, bookings: 0, contacts: 0,
            locations: 0, plans: 0, gallery: 0, memberships: 0
          });
        }
        this.loading.set(false);
      });

    // fetch recent items separately with explicit server-side limits
    forkJoin({
      recentBookings: this.admin.getRecentBookings(5).pipe(catchError(() => of({ data: [] }))),
      recentContacts: this.admin.getRecentContacts(5).pipe(catchError(() => of({ data: [] })))
    }).subscribe(({ recentBookings, recentContacts }: any) => {
      this.recentBookings.set(recentBookings.data || []);
      this.recentContacts.set(recentContacts.data || []);
    });
  }
}
