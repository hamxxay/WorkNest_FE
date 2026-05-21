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
    const safe = (obs: any) => obs.pipe(catchError(() => of({ data: { items: [], totalCount: 0 } })));
    const countOf = (resp: any) => Number(resp?.data?.totalCount ?? resp?.data?.length ?? 0);
    const itemsOf = (resp: any) => (resp?.data?.items ?? resp?.data ?? []) as any[];
    const revenueFromReports = (resp: any) => {
      const rows = Array.isArray(resp?.data?.paymentByStatus) ? resp.data.paymentByStatus : [];
      return rows
        .filter((x: any) => ['paid', 'completed'].includes(String(x?.status ?? '').toLowerCase()))
        .reduce((sum: number, x: any) => sum + Number(x?.total ?? 0), 0);
    };
    const spacesAvailableFromReports = (resp: any) => {
      const rows = Array.isArray(resp?.data?.spaceByStatus) ? resp.data.spaceByStatus : [];
      return rows
        .filter((x: any) => {
          const s = String(x?.status ?? '').trim().toLowerCase();
          return s === '' || s === 'available';
        })
        .reduce((sum: number, x: any) => sum + Number(x?.count ?? 0), 0);
    };
    const membershipsFromReports = (resp: any) => {
      const rows = Array.isArray(resp?.data?.membershipByStatus) ? resp.data.membershipByStatus : [];
      return rows.reduce((sum: number, x: any) => sum + Number(x?.count ?? 0), 0);
    };

    forkJoin({
      adminStats: safe(this.admin.getStats()),
      reports: safe(this.admin.getReports()),
      users: safe(this.admin.getUsers()),
      spaces: safe(this.admin.getSpaces()),
      bookings: safe(this.admin.getBookings()),
      contacts: safe(this.admin.getContacts()),
      locations: safe(this.admin.getLocations()),
      plans: safe(this.admin.getPricingPlans()),
      gallery: safe(this.admin.getGalleryAll()),
      memberships: safe(this.admin.getMemberships())
    }).subscribe({
      next: (res: any) => {
        const statsRevenue = Number(res.adminStats?.data?.revenue ?? 0);
        const fallbackRevenue = revenueFromReports(res.reports);
        const statsSpacesAvailable = Number(res.adminStats?.data?.spacesAvailable ?? 0);
        const fallbackSpacesAvailable = spacesAvailableFromReports(res.reports);
        const apiMemberships = countOf(res.memberships);
        const fallbackMemberships = membershipsFromReports(res.reports);
        this.stats.set({
          users: countOf(res.users),
          spaces: countOf(res.spaces),
          spacesAvailable: statsSpacesAvailable > 0 ? statsSpacesAvailable : fallbackSpacesAvailable,
          bookings: countOf(res.bookings),
          contacts: countOf(res.contacts),
          revenue: statsRevenue > 0 ? statsRevenue : fallbackRevenue,
          locations: countOf(res.locations),
          plans: countOf(res.plans),
          gallery: countOf(res.gallery),
          memberships: apiMemberships > 0 ? apiMemberships : fallbackMemberships
        });
        this.recentBookings.set(itemsOf(res.bookings).slice(0, 5));
        this.recentContacts.set(itemsOf(res.contacts).slice(0, 5));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }
}
