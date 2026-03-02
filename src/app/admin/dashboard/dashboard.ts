import { Component, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../services/admin.service';
import { forkJoin, of, catchError } from 'rxjs';
import { ApiResponse } from '../../models/admin.model';

type DashboardStats = {
  users: number;
  spaces: number;
  bookings: number;
  contacts: number;
  locations: number;
  plans: number;
  gallery: number;
  memberships: number;
};

const DEFAULT_STATS: DashboardStats = {
  users: 0,
  spaces: 0,
  bookings: 0,
  contacts: 0,
  locations: 0,
  plans: 0,
  gallery: 0,
  memberships: 0
};

@Component({
  selector: 'app-admin-dashboard',
  imports: [DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class AdminDashboard implements OnInit {
  loading = signal(true);
  stats = signal<DashboardStats>(DEFAULT_STATS);
  recentBookings = signal<any[]>([]);
  recentContacts = signal<any[]>([]);

  constructor(private admin: AdminService) {}

  ngOnInit() {
    // Try summary endpoint first.
    this.admin.getDashboardStats()
      .pipe(
        catchError(() => of(null)),
      )
      .subscribe((res: any) => {
        const summary = this.normalizeSummary(res);
        if (summary) {
          this.stats.set(summary);
          this.loading.set(false);
        } else {
          // Fallback: compute counts from existing list endpoints.
          this.loadStatsFallback();
        }
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

  private loadStatsFallback(): void {
    forkJoin({
      users: this.admin.getUsers(1, 1).pipe(catchError(() => of(null))),
      spaces: this.admin.getSpaces(1, 1).pipe(catchError(() => of(null))),
      bookings: this.admin.getBookings(1, 1).pipe(catchError(() => of(null))),
      contacts: this.admin.getContacts(1, 1).pipe(catchError(() => of(null))),
      locations: this.admin.getLocations(1, 1).pipe(catchError(() => of(null))),
      plans: this.admin.getPricingPlans(1, 1).pipe(catchError(() => of(null))),
      gallery: this.admin.getGalleryAll(1, 1).pipe(catchError(() => of(null))),
      memberships: this.admin.getMemberships(1, 1).pipe(catchError(() => of(null))),
    }).subscribe((res: any) => {
      this.stats.set({
        users: this.getCount(res.users),
        spaces: this.getCount(res.spaces),
        bookings: this.getCount(res.bookings),
        contacts: this.getCount(res.contacts),
        locations: this.getCount(res.locations),
        plans: this.getCount(res.plans),
        gallery: this.getCount(res.gallery),
        memberships: this.getCount(res.memberships),
      });
      this.loading.set(false);
    });
  }

  private getCount(response: ApiResponse<any> | null): number {
    if (!response) return 0;
    if (typeof response.total === 'number') return response.total;

    const data = response.data as any;
    if (Array.isArray(data)) return data.length;
    if (Array.isArray(data?.items)) return data.items.length;
    if (typeof data?.total === 'number') return data.total;
    return 0;
  }

  private normalizeSummary(response: ApiResponse<any> | null): DashboardStats | null {
    if (!response?.isSuccessful || !response.data) return null;
    const d = response.data as Record<string, any>;
    return {
      users: Number(d['users'] ?? d['userCount'] ?? d['totalUsers'] ?? 0),
      spaces: Number(d['spaces'] ?? d['spaceCount'] ?? d['totalSpaces'] ?? 0),
      bookings: Number(d['bookings'] ?? d['bookingCount'] ?? d['totalBookings'] ?? 0),
      contacts: Number(d['contacts'] ?? d['contactCount'] ?? d['totalContacts'] ?? 0),
      locations: Number(d['locations'] ?? d['locationCount'] ?? d['totalLocations'] ?? 0),
      plans: Number(d['plans'] ?? d['pricingPlans'] ?? d['planCount'] ?? 0),
      gallery: Number(d['gallery'] ?? d['galleryImages'] ?? d['galleryCount'] ?? 0),
      memberships: Number(d['memberships'] ?? d['membershipCount'] ?? 0),
    };
  }
}
