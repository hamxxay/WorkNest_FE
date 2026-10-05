import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../../../services/admin.service';
import { Chart } from '../../access/access-shared';

type AttentionTab = 'overdue' | 'ending' | 'pending';

interface Kpi {
  key: string;
  label: string;
  value: string;
  sub: string;
  link: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  trend?: { text: string; dir: 'up' | 'down' | 'flat'; good: boolean } | null;
  full?: string;
}

/**
 * Admin dashboard top section: headline numbers (with last-month comparison), a "Needs attention"
 * panel and a 6-month invoiced / paid / occupancy chart. One request (GET api/dashboard/overview);
 * shows placeholder blocks while loading, independent of the rest of the dashboard.
 */
@Component({
  selector: 'app-dashboard-overview',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './dashboard-overview.html',
  styleUrl: './dashboard-overview.css'
})
export class DashboardOverview {
  private admin = inject(AdminService);

  /** 'ALL' or a location id (as the dashboard's location filter holds it). */
  locationId = input<string>('ALL');
  /** Bumped by the dashboard to reload. */
  refreshTick = input<number>(0);

  loading = signal(true);
  failed = signal(false);
  data = signal<any | null>(null);
  tab = signal<AttentionTab>('overdue');

  // Chart canvases (always in the DOM; a placeholder covers them while loading)
  private revenueCanvas = viewChild<ElementRef<HTMLCanvasElement>>('revenueCanvas');
  private agingCanvas = viewChild<ElementRef<HTMLCanvasElement>>('agingCanvas');
  private occCanvas = viewChild<ElementRef<HTMLCanvasElement>>('occCanvas');
  private typeCanvas = viewChild<ElementRef<HTMLCanvasElement>>('typeCanvas');
  private custCanvas = viewChild<ElementRef<HTMLCanvasElement>>('custCanvas');
  private expCanvas = viewChild<ElementRef<HTMLCanvasElement>>('expCanvas');
  private charts: Chart[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroyCharts());
    effect(() => {
      const loc = this.locationId();
      this.refreshTick();
      untracked(() => this.load(loc));
    });
  }

  load(loc: string) {
    if (!this.data()) this.loading.set(true);
    const id = loc && loc !== 'ALL' ? Number(loc) : null;
    this.admin.getDashboardOverview(id).subscribe({
      next: (res) => {
        this.data.set(res); this.failed.set(false); this.loading.set(false);
        setTimeout(() => this.renderCharts(res));
      },
      error: () => { this.failed.set(true); this.loading.set(false); }
    });
  }

  // ---------- formatting ----------
  static money(v: number | null | undefined): string {
    const n = Number(v || 0);
    const a = Math.abs(n);
    if (a >= 1_000_000) return `Rs ${(n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}M`;
    if (a >= 1_000) return `Rs ${(n / 1_000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return `Rs ${Math.round(n).toLocaleString()}`;
  }
  money = DashboardOverview.money;
  fullMoney(v: number | null | undefined): string {
    return 'Rs ' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  private trend(now: number, prev: number, unit: '%' | 'pts' | 'n', higherIsGood = true): Kpi['trend'] {
    if (!prev && !now) return null;
    let diff: number; let text: string;
    if (unit === '%') {
      if (!prev) return { text: 'new', dir: 'up', good: higherIsGood };
      diff = ((now - prev) / prev) * 100;
      text = `${Math.abs(diff).toFixed(0)}%`;
    } else if (unit === 'pts') {
      diff = now - prev;
      text = `${Math.abs(diff).toFixed(1)} pts`;
    } else {
      diff = now - prev;
      text = `${Math.abs(diff)}`;
    }
    if (Math.abs(diff) < 0.05) return { text: 'no change', dir: 'flat', good: true };
    const up = diff > 0;
    return { text, dir: up ? 'up' : 'down', good: up === higherIsGood };
  }

  kpis = computed<Kpi[]>(() => {
    const d = this.data();
    if (!d) return [];
    return [
      {
        key: 'occupancy', label: 'Occupancy', value: `${d.occupancyPct}%`,
        sub: `${d.occupiedSpaces} of ${d.totalSpaces} spaces in use`, link: '/admin/spaces',
        tone: d.occupancyPct >= 70 ? 'ok' : d.occupancyPct >= 40 ? 'neutral' : 'warn',
        trend: this.trend(d.occupancyPct, d.occupancyPctLastMonth, 'pts')
      },
      {
        key: 'active', label: 'Active bookings', value: `${d.activeBookings}`,
        sub: 'Running today', link: '/admin/bookings', tone: 'neutral',
        trend: this.trend(d.activeBookings, d.activeBookingsLastMonth, 'n')
      },
      {
        key: 'pending', label: 'Awaiting confirmation', value: `${d.pendingConfirmations}`,
        sub: d.pendingConfirmations ? 'Bookings not yet confirmed' : 'Nothing waiting', link: '/admin/bookings',
        tone: d.pendingConfirmations ? 'warn' : 'ok'
      },
      {
        key: 'outstanding', label: 'Outstanding', value: this.money(d.outstanding), full: this.fullMoney(d.outstanding),
        sub: `${d.outstandingCount} unpaid invoice${d.outstandingCount === 1 ? '' : 's'}`, link: '/admin/invoices',
        tone: d.outstanding > 0 ? 'neutral' : 'ok'
      },
      {
        key: 'overdue', label: 'Overdue', value: this.money(d.overdueAmount), full: this.fullMoney(d.overdueAmount),
        sub: d.overdueCount ? `${d.overdueCount} past due date` : 'Nothing overdue', link: '/admin/invoices',
        tone: d.overdueCount ? 'danger' : 'ok'
      },
      {
        key: 'invoiced', label: 'Invoiced this month', value: this.money(d.invoicedThisMonth), full: this.fullMoney(d.invoicedThisMonth),
        sub: `Last month ${this.money(d.invoicedLastMonth)}`, link: '/admin/invoices', tone: 'neutral',
        trend: this.trend(d.invoicedThisMonth, d.invoicedLastMonth, '%')
      }
    ];
  });

  attentionItems = computed<any[]>(() => {
    const d = this.data();
    if (!d) return [];
    return this.tab() === 'overdue' ? d.overdueInvoices : this.tab() === 'ending' ? d.endingLeases : d.pendingBookings;
  });

  attentionTotal = computed(() => {
    const d = this.data();
    return d ? (d.overdueCount || 0) + (d.leasesEndingSoon || 0) + (d.pendingConfirmations || 0) : 0;
  });

  daysFrom(date: string | null | undefined): number | null {
    if (!date) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = new Date(date + 'T00:00:00');
    return Math.round((d.getTime() - t.getTime()) / 86400000);
  }

  overdueDays(date: string | null | undefined): number {
    return Math.max(0, -(this.daysFrom(date) ?? 0));
  }

  // ---------- 12-month totals shown above the revenue chart ----------
  yearTotals = computed(() => {
    const months: any[] = this.data()?.months ?? [];
    const invoiced = months.reduce((a, m) => a + (m.invoiced || 0), 0);
    const paid = months.reduce((a, m) => a + (m.paid || 0), 0);
    return { invoiced, paid, rate: invoiced > 0 ? Math.round((paid / invoiced) * 100) : 0 };
  });

  agingTotal = computed(() => (this.data()?.aging ?? []).reduce((a: number, b: any) => a + (b.amount || 0), 0));
  readonly agingColors = ['#10b981', '#fbbf24', '#f97316', '#ef4444', '#991b1b'];

  // ---------- Chart.js ----------
  private destroyCharts() {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
  }

  private monthLabel(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' }) + (m === 1 ? ` ${String(y).slice(2)}` : '');
  }

  private renderCharts(d: any) {
    this.destroyCharts();
    if (!d) return;
    Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
    Chart.defaults.color = '#64748b';

    const tooltip = {
      backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#e2e8f0', padding: 10, cornerRadius: 8,
      titleFont: { weight: 600 as const }, boxPadding: 4, usePointStyle: true
    };
    const grid = { color: '#eef2f6', drawTicks: false };
    const axisMoney = { callback: (v: any) => this.money(Number(v)).replace('Rs ', ''), padding: 8 };
    const legend = { position: 'bottom' as const, labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16 } };
    const months: any[] = d.months ?? [];
    const labels = months.map(m => this.monthLabel(m.month));
    const add = (el: ElementRef<HTMLCanvasElement> | undefined, cfg: any) => { if (el) this.charts.push(new Chart(el.nativeElement, cfg)); };

    // 1. Revenue & collections — invoiced vs paid bars, collection-rate line
    add(this.revenueCanvas(), {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Invoiced', data: months.map(m => m.invoiced), backgroundColor: '#99f6e4', borderRadius: 6, maxBarThickness: 26, order: 2 },
          { type: 'bar', label: 'Paid', data: months.map(m => m.paid), backgroundColor: '#0d9488', borderRadius: 6, maxBarThickness: 26, order: 2 },
          { type: 'line', label: 'Collection rate', data: months.map(m => m.invoiced > 0 ? Math.round((m.paid / m.invoiced) * 100) : null),
            yAxisID: 'pct', borderColor: '#6366f1', backgroundColor: '#6366f1', borderWidth: 2.5, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, spanGaps: true, order: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend,
          tooltip: { ...tooltip, callbacks: { label: (c: any) => c.dataset.yAxisID === 'pct' ? ` ${c.dataset.label}: ${c.parsed.y ?? 0}%` : ` ${c.dataset.label}: ${this.fullMoney(c.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grid, border: { display: false }, ticks: axisMoney },
          pct: { position: 'right', beginAtZero: true, max: 100, grid: { display: false }, border: { display: false }, ticks: { callback: (v: any) => v + '%', stepSize: 25 } }
        }
      }
    });

    // 2. Receivables aging — doughnut
    const aging: any[] = d.aging ?? [];
    add(this.agingCanvas(), {
      type: 'doughnut',
      data: {
        labels: aging.map(a => a.label),
        datasets: [{ data: aging.map(a => a.amount), backgroundColor: this.agingColors, borderColor: '#fff', borderWidth: 3, hoverOffset: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltip, callbacks: { label: (c: any) => ` ${c.label}: ${this.fullMoney(c.parsed)} (${aging[c.dataIndex]?.count ?? 0} invoices)` } }
        }
      }
    });

    // 3. Occupancy & new bookings — bars + line
    add(this.occCanvas(), {
      data: {
        labels,
        datasets: [
          { type: 'line', label: 'Occupancy', data: months.map(m => m.occupancyPct), yAxisID: 'pct', borderColor: '#0d9488', borderWidth: 2.5, tension: 0.35,
            fill: true, backgroundColor: (ctx: any) => {
              const { chart } = ctx; const area = chart.chartArea;
              if (!area) return 'rgba(13,148,136,0.12)';
              const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              g.addColorStop(0, 'rgba(13,148,136,0.28)'); g.addColorStop(1, 'rgba(13,148,136,0.02)');
              return g;
            }, pointRadius: 3, pointBackgroundColor: '#fff', pointBorderColor: '#0d9488', pointBorderWidth: 2, order: 1 },
          { type: 'bar', label: 'New bookings', data: months.map(m => m.newBookings), yAxisID: 'n', backgroundColor: '#c7d2fe', borderRadius: 6, maxBarThickness: 22, order: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend,
          tooltip: { ...tooltip, callbacks: { label: (c: any) => c.dataset.yAxisID === 'pct' ? ` Occupancy: ${c.parsed.y}%` : ` New bookings: ${c.parsed.y}` } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          pct: { position: 'left', beginAtZero: true, max: 100, grid, border: { display: false }, ticks: { callback: (v: any) => v + '%', stepSize: 25, padding: 8 } },
          n: { position: 'right', beginAtZero: true, grid: { display: false }, border: { display: false }, ticks: { precision: 0 } }
        }
      }
    });

    // 4. Occupancy by space type — stacked horizontal bars
    const types: any[] = d.spaceTypes ?? [];
    add(this.typeCanvas(), {
      type: 'bar',
      data: {
        labels: types.map(t => t.spaceType),
        datasets: [
          { label: 'Booked', data: types.map(t => t.occupied), backgroundColor: '#0d9488', borderRadius: 4, maxBarThickness: 18 },
          { label: 'Vacant', data: types.map(t => Math.max(0, t.total - t.occupied)), backgroundColor: '#e2e8f0', borderRadius: 4, maxBarThickness: 18 }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend,
          tooltip: { ...tooltip, callbacks: { footer: (items: any[]) => { const t = types[items[0]?.dataIndex]; return t ? `${t.total ? Math.round(t.occupied * 100 / t.total) : 0}% occupied` : ''; } } }
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid, border: { display: false }, ticks: { precision: 0 } },
          y: { stacked: true, grid: { display: false }, border: { display: false } }
        }
      }
    });

    // 5. Top customers — horizontal bars
    const cust: any[] = d.topCustomers ?? [];
    add(this.custCanvas(), {
      type: 'bar',
      data: {
        labels: cust.map(c => c.label.length > 22 ? c.label.slice(0, 21) + '…' : c.label),
        datasets: [{ label: 'Invoiced (12 months)', data: cust.map(c => c.amount), backgroundColor: ['#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4'], borderRadius: 6, maxBarThickness: 20 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltip, callbacks: { title: (i: any[]) => cust[i[0]?.dataIndex]?.label ?? '', label: (c: any) => ` ${this.fullMoney(c.parsed.x)} · ${cust[c.dataIndex]?.count ?? 0} invoices` } }
        },
        scales: {
          x: { beginAtZero: true, grid, border: { display: false }, ticks: axisMoney },
          y: { grid: { display: false }, border: { display: false } }
        }
      }
    });

    // 6. Lease expiries — next 6 months
    const exp: any[] = d.leaseExpiries ?? [];
    add(this.expCanvas(), {
      type: 'bar',
      data: {
        labels: exp.map(e => this.monthLabel(e.label)),
        datasets: [{ label: 'Leases ending', data: exp.map(e => e.count),
          backgroundColor: exp.map((_, i) => i === 0 ? '#f59e0b' : i === 1 ? '#fbbf24' : '#fde68a'), borderRadius: 6, maxBarThickness: 30 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltip, callbacks: { label: (c: any) => ` ${c.parsed.y} lease${c.parsed.y === 1 ? '' : 's'} · ${this.fullMoney(exp[c.dataIndex]?.amount)}` } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grid, border: { display: false }, ticks: { precision: 0 } }
        }
      }
    });
  }
}
