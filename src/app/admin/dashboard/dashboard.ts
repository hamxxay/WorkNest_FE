import { Component, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../services/admin.service';
import { forkJoin, of, catchError } from 'rxjs';

@Component({
  selector: 'app-admin-dashboard',
  imports: [DatePipe, DecimalPipe, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class AdminDashboard implements OnInit {
  loading = signal(true);
  stats = signal({
    users: 0, spaces: 0, spacesAvailable: 0, bookings: 0, contacts: 0,
    revenue: 0,
    locations: 0, plans: 0, gallery: 0, memberships: 0
  });
  recentBookings = signal<any[]>([]);
  recentContacts = signal<any[]>([]);

  constructor(private admin: AdminService) {}

  ngOnInit() {
    const safe = (obs: any) => obs.pipe(catchError(() => of(null)));

    const toItems = (res: any): any[] => {
      if (Array.isArray(res)) return res;
      if (Array.isArray(res?.data?.items)) return res.data.items;
      if (Array.isArray(res?.data)) return res.data;
      return [];
    };

    forkJoin({
      users:       safe(this.admin.getUsers()),
      spaces:      safe(this.admin.getSpaces()),
      bookings:    safe(this.admin.getBookings()),
      contacts:    safe(this.admin.getContacts()),
      locations:   safe(this.admin.getLocations()),
      plans:       safe(this.admin.getPricingPlans()),
      gallery:     safe(this.admin.getGalleryAll()),
      memberships: safe(this.admin.getMemberships()),
      payments:    safe(this.admin.getPayments())
    }).subscribe({
      next: (res: any) => {
        const payments  = toItems(res.payments);
        const spaces    = toItems(res.spaces);

        const revenue = payments
          .filter((p: any) => ['paid', 'completed'].includes(String(p?.paymentStatus ?? '').toLowerCase()))
          .reduce((sum: number, p: any) => sum + Number(p?.amount ?? 0), 0);

        const spacesAvailable = spaces
          .filter((s: any) => String(s?.status ?? '').toLowerCase() === 'available').length;

        this.stats.set({
          users:           toItems(res.users).length,
          spaces:          spaces.length,
          spacesAvailable,
          bookings:        toItems(res.bookings).length,
          contacts:        toItems(res.contacts).length,
          revenue,
          locations:       toItems(res.locations).length,
          plans:           toItems(res.plans).length,
          gallery:         toItems(res.gallery).length,
          memberships:     toItems(res.memberships).length
        });

        this.recentBookings.set(toItems(res.bookings).slice(0, 5));
        this.recentContacts.set(toItems(res.contacts).slice(0, 5));
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); }
    });
  }
}
