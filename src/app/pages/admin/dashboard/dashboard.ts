import { Component, signal, OnInit, computed, AfterViewInit, ViewChild, ElementRef, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AdminService } from '../../services/admin.service';
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

  // Demo fallback bookings (used only when API returns no bookings locally)
  private DEMO_BOOKINGS = [
    { "id": 49, "startDateTime": "2026-06-10T09:00:00" },
    { "id": 48, "startDateTime": "2026-06-08T09:00:00" },
    { "id": 47, "startDateTime": "2026-06-08T09:00:00" },
    { "id": 46, "startDateTime": "2026-06-08T09:00:00" },
    { "id": 45, "startDateTime": "2026-06-08T09:00:00" },
    { "id": 44, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 43, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 42, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 41, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 40, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 39, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 38, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 37, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 36, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 35, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 34, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 33, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 32, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 31, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 30, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 29, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 28, "startDateTime": "2026-06-23T09:00:00" },
    { "id": 27, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 26, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 25, "startDateTime": "2026-06-05T09:00:00" },
    { "id": 24, "startDateTime": "2026-06-11T18:30:00" },
    { "id": 23, "startDateTime": "2026-06-01T09:00:00" },
    { "id": 22, "startDateTime": "2026-11-01T09:00:00" },
    { "id": 20, "startDateTime": "2026-06-01T09:00:00" },
    { "id": 17, "startDateTime": "2026-06-16T18:00:00" },
    { "id": 15, "startDateTime": "2026-06-09T18:00:00" }
  ];

  periodRevenue = computed(() => this.filterByPeriod(this.allPayments(), 'paidAt')
    .filter(p => p.paymentStatus === 'Paid')
    .reduce((s: number, p: any) => s + (p.amount ?? 0), 0));

  periodBookings = computed(() => this.filterByPeriod(this.allBookings(), 'startDateTime').length);

  chartData = computed(() => {
    const bookings = this.filterByPeriod(this.allBookings(), 'startDateTime');
    const p = this.period();

    const now = new Date();
    const labels: string[] = [];
    // build chronological keys (ISO dates for days, YYYY-MM for months)
    if (p === '1W') {
      const from = new Date(now);
      from.setDate(now.getDate() - 6); // 7 days including today
      for (let d = new Date(from); d <= now; d.setDate(d.getDate() + 1)) {
        labels.push(d.toISOString().slice(0, 10));
      }
    } else if (p === '1M') {
      const from = new Date(now);
      from.setDate(now.getDate() - 29); // 30 days
      for (let d = new Date(from); d <= now; d.setDate(d.getDate() + 1)) {
        labels.push(d.toISOString().slice(0, 10));
      }
    } else {
      // 1Y - months
      const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      for (let i = 0; i < 12; i++) {
        const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
        labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    }

    // initialize counts
    const counts: Record<string, number> = Object.fromEntries(labels.map(l => [l, 0]));

    bookings.forEach(b => {
      const d = new Date(b.startDateTime);
      if (isNaN(d.getTime())) return;
      let key: string;
      if (p === '1Y') key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      else key = d.toISOString().slice(0, 10);
      if (counts[key] !== undefined) counts[key] = (counts[key] ?? 0) + 1;
    });

    // display labels (friendly)
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

  constructor(private admin: AdminService) {
    effect(() => {
      const { labels, data } = this.chartData();
      console.debug('[Dashboard] chartData effect', { labels, data });
      if (this.chart) { this.chart.data.labels = labels; this.chart.data.datasets[0].data = data; this.chart.update(); }
    });
  }

  ngOnInit() {
    Promise.all([
      this.admin.getUsers(1, 1).toPromise(),
      this.admin.getSpaces(1, 1).toPromise(),
      this.admin.getPayments(1, 500).toPromise(),
      this.admin.getBookings(1, 500).toPromise(),
      this.admin.getContacts(1, 5).toPromise(),
      this.admin.getLocations(1, 1).toPromise(),
      this.admin.getPricingPlans(1, 1).toPromise(),
      this.admin.getGalleryAll(1, 1).toPromise(),
    ]).then(([users, spaces, payments, bookings, contacts, locations, plans, gallery]) => {
      this.baseStats.set({
        users: (users as any)?.total ?? 0,
        spacesAvailable: (spaces as any)?.total ?? 0,
        contacts: (contacts as any)?.total ?? 0,
        locations: (locations as any)?.total ?? 0,
        plans: (plans as any)?.total ?? 0,
        gallery: (gallery as any)?.total ?? 0,
      });
      this.allPayments.set((payments as any)?.data ?? []);
      const fetched = (bookings as any)?.data ?? [];
      this.allBookings.set(fetched.length ? fetched : this.DEMO_BOOKINGS);
      this.recentBookings.set(((bookings as any)?.data ?? []).slice(0, 5));
      this.recentContacts.set((contacts as any)?.data ?? []);
      this.loading.set(false);
    }).catch(() => this.loading.set(false));
  }

  setPeriod(p: Period) { this.period.set(p); }

  ngAfterViewInit() { setTimeout(() => this.initChart()); }

  private initChart() {
    if (!this.lineChartRef) return;
    const { labels, data } = this.chartData();
    console.debug('[Dashboard] initChart', { labels, data, canvas: this.lineChartRef?.nativeElement });
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
    console.debug('[Dashboard] chart created', this.chart);
    try { this.chart.options.animation = false as any; this.chart.update(); } catch (e) { console.error('[Dashboard] chart update error', e); }
  }

  private filterByPeriod(items: any[], dateKey: string): any[] {
    const now = new Date();
    const from = new Date(now);
    if (this.period() === '1W') from.setDate(now.getDate() - 7);
    else if (this.period() === '1M') from.setMonth(now.getMonth() - 1);
    else from.setFullYear(now.getFullYear() - 1);
    return items.filter(i => { const d = new Date(i[dateKey]); return !isNaN(d.getTime()) && d >= from; });
  }
}
