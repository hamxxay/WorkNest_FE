import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../../../services/admin.service';
import { Chart } from '../../access/access-shared';

type AttentionTab = 'overdue' | 'ending' | 'pending';
export type DashPeriod = 'month' | 'quarter' | 'year';

interface Kpi {
  key: string;
  label: string;
  value: string;
  sub: string;
  link: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  trend?: { text: string; dir: 'up' | 'down' | 'flat'; good: boolean } | null;
  vs?: string;
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
  /** This month / quarter / year — every number and chart follows it. */
  period = input<DashPeriod>('month');

  periodWord = computed(() => this.period());
  seriesLabel = computed(() => `Last ${this.period() === 'year' ? 24 : this.period() === 'quarter' ? 12 : 6} months`);
  aheadLabel = computed(() => `Next ${this.period() === 'year' ? 12 : this.period() === 'quarter' ? 6 : 3} months`);

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
      this.period();
      untracked(() => this.load(loc));
    });
  }

  load(loc: string) {
    if (!this.data()) this.loading.set(true);
    const id = loc && loc !== 'ALL' ? Number(loc) : null;
    this.admin.getDashboardOverview(id, this.period()).subscribe({
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
    if (a >= 1_000_000) return `PKR ${(n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}M`;
    if (a >= 1_000) return `PKR ${(n / 1_000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return `PKR ${Math.round(n).toLocaleString()}`;
  }
  money = DashboardOverview.money;
  fullMoney(v: number | null | undefined): string {
    return 'PKR ' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
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
        trend: this.trend(d.occupancyPct, d.occupancyPctLastMonth, 'pts'), vs: `vs a ${this.periodWord()} ago`
      },
      {
        key: 'active', label: 'Active bookings', value: `${d.activeBookings}`,
        sub: 'Running today', link: '/admin/bookings', tone: 'neutral',
        trend: this.trend(d.activeBookings, d.activeBookingsLastMonth, 'n'), vs: `vs a ${this.periodWord()} ago`
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
        key: 'invoiced', label: `Invoiced this ${this.periodWord()}`, value: this.money(d.invoicedThisPeriod), full: this.fullMoney(d.invoicedThisPeriod),
        sub: `${this.money(d.paidThisPeriod)} of it paid`, link: '/admin/invoices', tone: 'neutral',
        trend: this.trend(d.invoicedThisPeriod, d.invoicedPrevPeriod, '%'), vs: `vs last ${this.periodWord()} to date`
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

  // "No data yet" overlays instead of bare axes
  empty = computed(() => {
    const d = this.data();
    const months: any[] = d?.months ?? [];
    return {
      revenue: !months.some(m => m.invoiced > 0 || m.paid > 0),
      aging: !(d?.aging ?? []).some((a: any) => a.amount > 0),
      occupancy: !months.some(m => m.occupancyPct > 0 || m.newBookings > 0),
      types: !(d?.spaceTypes ?? []).some((t: any) => t.total > 0),
      customers: !(d?.topCustomers ?? []).length,
      expiries: !(d?.leaseExpiries ?? []).some((e: any) => e.count > 0)
    };
  });

  agingTotal = computed(() => (this.data()?.aging ?? []).reduce((a: number, b: any) => a + (b.amount || 0), 0));
  readonly agingColors = ['#10b981', '#fbbf24', '#f97316', '#ef4444', '#991b1b'];

  // ---------- One-page PDF report (A4 landscape) ----------
  exporting = signal(false);

  async downloadReport(meta: { location: string; preparedBy: string }) {
    const d = this.data();
    if (!d || this.exporting()) return;
    this.exporting.set(true);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const W = 297, M = 12;
      const periodTitle = { month: 'This month', quarter: 'This quarter', year: 'This year' }[this.period()];
      const now = new Date();

      // Header band
      pdf.setFillColor(15, 23, 42); pdf.rect(0, 0, W, 24, 'F');
      pdf.setFillColor(13, 148, 136); pdf.rect(0, 24, W, 1.2, 'F');
      pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
      pdf.text('WorkNest  ·  Executive Summary', M, 11);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(203, 213, 225);
      pdf.text(`${periodTitle}  ·  ${meta.location}  ·  ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, M, 18);
      pdf.text(`Prepared by ${meta.preparedBy}`, W - M, 18, { align: 'right' });

      // Headline numbers
      const kpis = this.kpis();
      const gap = 4, boxW = (W - 2 * M - gap * (kpis.length - 1)) / kpis.length, boxH = 22, y0 = 31;
      const toneRgb: Record<string, [number, number, number]> = { ok: [16, 185, 129], warn: [245, 158, 11], danger: [239, 68, 68], neutral: [13, 148, 136] };
      kpis.forEach((k, i) => {
        const x = M + i * (boxW + gap);
        pdf.setDrawColor(226, 232, 240); pdf.setFillColor(255, 255, 255); pdf.roundedRect(x, y0, boxW, boxH, 2, 2, 'FD');
        const c = toneRgb[k.tone] ?? toneRgb['neutral']; pdf.setFillColor(c[0], c[1], c[2]); pdf.rect(x, y0 + 2, 1.1, boxH - 4, 'F');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(100, 116, 139);
        pdf.text(k.label.toUpperCase(), x + 4, y0 + 6);
        pdf.setFontSize(13); pdf.setTextColor(15, 23, 42);
        pdf.text(k.value, x + 4, y0 + 13.5);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(100, 116, 139);
        const foot = k.trend ? `${k.trend.dir === 'up' ? '+' : k.trend.dir === 'down' ? '-' : ''}${k.trend.text} ${k.vs ?? ''}` : k.sub;
        pdf.text(pdf.splitTextToSize(foot, boxW - 6)[0] ?? '', x + 4, y0 + 18.5);
      });

      // Charts: 3 x 2 grid
      const e = this.empty();
      const charts: { title: string; canvas?: ElementRef<HTMLCanvasElement>; empty: boolean; note?: string }[] = [
        { title: `Revenue & collections (${this.seriesLabel().toLowerCase()})`, canvas: this.revenueCanvas(), empty: e.revenue },
        { title: 'Receivables aging (as of today)', canvas: this.agingCanvas(), empty: e.aging, note: `Outstanding ${this.fullMoney(this.agingTotal())}` },
        { title: `Occupancy & new bookings (${this.seriesLabel().toLowerCase()})`, canvas: this.occCanvas(), empty: e.occupancy },
        { title: 'Occupancy by space type (today)', canvas: this.typeCanvas(), empty: e.types },
        { title: `Top customers (this ${this.periodWord()})`, canvas: this.custCanvas(), empty: e.customers },
        { title: `Leases expiring (${this.aheadLabel().toLowerCase()})`, canvas: this.expCanvas(), empty: e.expiries }
      ];
      const cols = 3, cg = 5, rg = 5, top = y0 + boxH + 6;
      const cw = (W - 2 * M - cg * (cols - 1)) / cols, ch = (210 - top - 12 - rg) / 2;
      charts.forEach((c, i) => {
        const x = M + (i % cols) * (cw + cg), y = top + Math.floor(i / cols) * (ch + rg);
        pdf.setDrawColor(226, 232, 240); pdf.setFillColor(255, 255, 255); pdf.roundedRect(x, y, cw, ch, 2, 2, 'FD');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(15, 23, 42); pdf.text(c.title, x + 4, y + 6);
        if (c.note) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(100, 116, 139); pdf.text(c.note, x + cw - 4, y + 6, { align: 'right' }); }
        const ax = x + 3, ay = y + 9, aw = cw - 6, ah = ch - 12;
        if (c.empty || !c.canvas) {
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(148, 163, 184);
          pdf.text('No data yet', x + cw / 2, y + ch / 2, { align: 'center' });
          return;
        }
        const el = c.canvas.nativeElement;
        const ratio = el.width / el.height || 2;
        let w = aw, h = aw / ratio;
        if (h > ah) { h = ah; w = ah * ratio; }
        pdf.addImage(el.toDataURL('image/png', 1), 'PNG', ax + (aw - w) / 2, ay + (ah - h) / 2, w, h);
      });

      // Footer
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(148, 163, 184);
      pdf.text(`Generated ${now.toLocaleString('en-GB')}  ·  Figures in PKR  ·  Occupancy = spaces with a live booking`, M, 205);
      pdf.text('WorkNest', W - M, 205, { align: 'right' });

      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      pdf.save(`WorkNest-Executive-Summary-${this.period()}-${stamp}.pdf`);
    } finally {
      this.exporting.set(false);
    }
  }

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
    const axisMoney = { callback: (v: any) => this.money(Number(v)).replace('PKR ', ''), padding: 8 };
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
