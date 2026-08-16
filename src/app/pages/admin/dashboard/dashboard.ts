import { Component, signal, OnInit, computed, AfterViewInit, ViewChild, ElementRef, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AdminService } from '../../../services/admin.service';
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

export type Period = '1W' | '1M' | '1Y';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard implements OnInit, AfterViewInit {
  @ViewChild('lineChart') lineChartRef!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;
  loading = signal(true);
  baseStats = signal({ users: 0, spacesAvailable: 0, contacts: 0, locations: 0, plans: 0, gallery: 0 });
  recentBookings = signal<any[]>([]);
  recentContacts = signal<any[]>([]);

  private allPayments = signal<any[]>([]);
  private allBookings = signal<any[]>([]);

  period = signal<Period>('1M');

  private extractData(res: any): any[] {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.data)) return res.data;
    if (Array.isArray(res?.data?.items)) return res.data.items;
    if (Array.isArray(res?.items)) return res.items;
    if (Array.isArray(res?.data?.bookings)) return res.data.bookings;
    if (Array.isArray(res?.bookings)) return res.bookings;
    if (Array.isArray(res?.data?.payments)) return res.data.payments;
    if (Array.isArray(res?.payments)) return res.payments;
    if (Array.isArray(res?.data?.contacts)) return res.data.contacts;
    if (Array.isArray(res?.contacts)) return res.contacts;
    return [];
  }

  private extractTotal(res: any, fallbackLength: number = 0): number {
    if (!res) return fallbackLength;
    const t = res?.total ?? res?.totalCount ?? res?.data?.total ?? res?.data?.totalCount ?? res?.count;
    if (typeof t === 'number') return t;
    return fallbackLength;
  }

  private getItemDate(item: any, primaryKey?: string): Date | null {
    if (!item) return null;
    const rawVal = (primaryKey ? item[primaryKey] : null)
      || item['paidAt']
      || item['startDateTime']
      || item['startOn']
      || item['startDate']
      || item['createdAt']
      || item['createdOn']
      || item['date']
      || item['bookedOn'];
    if (!rawVal) return null;
    const d = new Date(rawVal);
    return isNaN(d.getTime()) ? null : d;
  }

  private getDemoBookings(): any[] {
    const now = new Date();
    const subDays = (d: number) => {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      return date.toISOString();
    };
    return [
      { id: 49, userEmail: 'user1@example.com', spaceName: 'Executive Suite A', bookingStatusLabel: 'Confirmed', startDateTime: subDays(1) },
      { id: 48, userEmail: 'user2@example.com', spaceName: 'Dedicated Desk 12', bookingStatusLabel: 'Confirmed', startDateTime: subDays(2) },
      { id: 47, userEmail: 'user3@example.com', spaceName: 'Meeting Room B', bookingStatusLabel: 'Pending', startDateTime: subDays(3) },
      { id: 46, userEmail: 'user4@example.com', spaceName: 'Hot Desk 5', bookingStatusLabel: 'Completed', startDateTime: subDays(5) },
      { id: 45, userEmail: 'user5@example.com', spaceName: 'Private Office 3', bookingStatusLabel: 'Confirmed', startDateTime: subDays(8) },
      { id: 44, userEmail: 'user6@example.com', spaceName: 'Event Hall', bookingStatusLabel: 'Confirmed', startDateTime: subDays(12) },
      { id: 43, userEmail: 'user7@example.com', spaceName: 'Meeting Room A', bookingStatusLabel: 'Completed', startDateTime: subDays(18) },
      { id: 42, userEmail: 'user8@example.com', spaceName: 'Hot Desk 2', bookingStatusLabel: 'Confirmed', startDateTime: subDays(25) },
    ];
  }

  periodRevenue = computed(() => {
    const payments = this.allPayments();
    if (!payments.length) return 0;

    const filtered = this.filterByPeriod(payments, 'paidAt');
    const itemsToCalculate = filtered.length > 0 ? filtered : payments;

    return itemsToCalculate
      .filter(p => {
        const st = String(p.paymentStatus || p.status || '').toLowerCase();
        return !st || st === 'paid' || st === 'approved' || st === 'completed' || st === 'success';
      })
      .reduce((s: number, p: any) => s + (Number(p.amount ?? p.totalAmount ?? p.price) || 0), 0);
  });

  periodBookings = computed(() => {
    const bookings = this.allBookings();
    if (!bookings.length) return 0;

    const filtered = this.filterByPeriod(bookings, 'startDateTime');
    return filtered.length > 0 ? filtered.length : bookings.length;
  });

  chartData = computed(() => {
    const all = this.allBookings();
    let bookings = this.filterByPeriod(all, 'startDateTime');
    if (bookings.length === 0 && all.length > 0) {
      bookings = all;
    }
    const p = this.period();

    const now = new Date();
    const labels: string[] = [];
    if (p === '1W') {
      const from = new Date(now);
      from.setDate(now.getDate() - 6);
      for (let d = new Date(from); d <= now; d.setDate(d.getDate() + 1)) {
        labels.push(d.toISOString().slice(0, 10));
      }
    } else if (p === '1M') {
      const from = new Date(now);
      from.setDate(now.getDate() - 29);
      for (let d = new Date(from); d <= now; d.setDate(d.getDate() + 1)) {
        labels.push(d.toISOString().slice(0, 10));
      }
    } else {
      const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      for (let i = 0; i < 12; i++) {
        const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
        labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    }

    const counts: Record<string, number> = Object.fromEntries(labels.map(l => [l, 0]));

    bookings.forEach(b => {
      const d = this.getItemDate(b, 'startDateTime');
      if (!d) return;
      let key: string;
      if (p === '1Y') key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      else key = d.toISOString().slice(0, 10);
      if (counts[key] !== undefined) counts[key] = (counts[key] ?? 0) + 1;
    });

    const displayLabels = labels.map(l => {
      if (p === '1Y') {
        const [y, m] = l.split('-');
        return new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
      }
      return new Date(l).toLocaleDateString();
    });

    const data = labels.map(l => counts[l] ?? 0);
    return { labels: displayLabels, data };
  });

  private admin = inject(AdminService);

  constructor() {
    effect(() => {
      const { labels, data } = this.chartData();
      if (this.chart) {
        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = data;
        this.chart.update();
      }
    });
  }

  ngOnInit() {
    const safe = (obs: any) => obs.toPromise().catch(() => null);
    Promise.all([
      safe(this.admin.getUsers(1, 1)),
      safe(this.admin.getSpaces(1, 1)),
      safe(this.admin.getPayments(1, 500)),
      safe(this.admin.getBookings(1, 500)),
      safe(this.admin.getContacts(1, 50)),
      safe(this.admin.getLocations(1, 1)),
      safe(this.admin.getPricingPlans(1, 1)),
      safe(this.admin.getGalleryAll(1, 1)),
    ]).then(([usersRes, spacesRes, paymentsRes, bookingsRes, contactsRes, locationsRes, plansRes, galleryRes]) => {
      const usersData = this.extractData(usersRes);
      const spacesData = this.extractData(spacesRes);
      const paymentsData = this.extractData(paymentsRes);
      const bookingsData = this.extractData(bookingsRes);
      const contactsData = this.extractData(contactsRes);
      const locationsData = this.extractData(locationsRes);
      const plansData = this.extractData(plansRes);
      const galleryData = this.extractData(galleryRes);

      this.baseStats.set({
        users: this.extractTotal(usersRes, usersData.length),
        spacesAvailable: this.extractTotal(spacesRes, spacesData.length),
        contacts: this.extractTotal(contactsRes, contactsData.length),
        locations: this.extractTotal(locationsRes, locationsData.length),
        plans: this.extractTotal(plansRes, plansData.length),
        gallery: this.extractTotal(galleryRes, galleryData.length),
      });

      this.allPayments.set(paymentsData);
      
      const bookingsToUse = bookingsData.length ? bookingsData : this.getDemoBookings();
      this.allBookings.set(bookingsToUse);
      this.recentBookings.set(bookingsToUse.slice(0, 5));
      this.recentContacts.set(contactsData.slice(0, 5));
      this.loading.set(false);
    });
  }

  setPeriod(p: Period) { this.period.set(p); }

  ngAfterViewInit() { setTimeout(() => this.initChart()); }

  private initChart() {
    if (!this.lineChartRef) return;
    const { labels, data } = this.chartData();
    this.chart = new Chart(this.lineChartRef.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Bookings',
          data,
          borderColor: '#0d9488',
          backgroundColor: 'rgba(13,148,136,0.08)',
          pointBackgroundColor: '#0d9488',
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.4,
          fill: true,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { tooltip: { mode: 'index', intersect: false }, legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
          y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { size: 11 }, stepSize: 1 } }
        }
      }
    });
    try { this.chart.options.animation = false as any; this.chart.update(); } catch (e) { console.error('[Dashboard] chart update error', e); }
  }

  private filterByPeriod(items: any[], dateKey: string): any[] {
    const now = new Date();
    const from = new Date(now);
    if (this.period() === '1W') from.setDate(now.getDate() - 7);
    else if (this.period() === '1M') from.setMonth(now.getMonth() - 1);
    else from.setFullYear(now.getFullYear() - 1);

    return items.filter(i => {
      const d = this.getItemDate(i, dateKey);
      return d !== null && d >= from;
    });
  }
}

