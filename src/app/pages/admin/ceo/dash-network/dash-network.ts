import {
  Component, DestroyRef, ElementRef, afterRenderEffect, computed, effect, inject, input, signal, untracked, viewChild
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import type { DashError } from '../../../../services/dashboard-api';
import {
  NetDashboard, NetHistoryPoint, NetWan, NetworkDashboardService, NetworkSource
} from '../../../../services/network-dashboard.service';
import {
  Chart, ChartKeyNav, DashKpi, GRID, LEGEND, TEAL, TEAL_DARK, TOOLTIP, applyChartDefaults, count, pct
} from '../ceo-shared';

type ChartKey = 'clients' | 'types' | 'latency';
type HistoryRange = 'day' | 'week';

/** Same series colours as the Network pages: Wi-Fi teal, wired indigo, guest light teal. */
const WIFI = '#0d9488';
const WIRED = '#6366f1';
const GUEST = '#5eead4';
const PEAK = '#334155';
const OFFLINE = '#ef4444';

/** Client kinds (as the Clients page labels them), each with its own colour; unknown stays grey. */
const KIND_COLORS: Record<string, string> = {
  phone: '#0d9488', computer: '#6366f1', tablet: '#0ea5e9', printer: '#f59e0b', tv: '#ec4899', camera: '#8b5cf6',
  access: '#f97316', network: '#64748b', iot: '#84cc16', other: '#cbd5e1'
};
const KIND_FALLBACK = ['#0d9488', '#6366f1', '#0ea5e9', '#f59e0b', '#ec4899', '#8b5cf6', '#f97316', '#84cc16'];
/** One latency line per site (a second location gets its own colour). */
const SITE_COLORS = ['#0d9488', '#6366f1', '#f59e0b', '#ec4899'];

/** "14:00" (24 h) or "Mon 14:00" (7 days), in the viewer's time. */
function stepLabel(t: string, range: HistoryRange): string {
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return range === 'week' ? `${d.toLocaleDateString([], { weekday: 'short' })} ${hm}` : hm;
}

/** "Mon 19 Oct, 14:00" (tooltips, screen readers). */
function stepTitle(t: string): string {
  const d = new Date(t);
  if (isNaN(d.getTime())) return t;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** "12 ms" / "12.5 ms". */
function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return `${Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v) : v.toFixed(1)} ms`;
}

/**
 * Network section of the CEO and Sales Manager dashboards: the Wi-Fi / network (UniFi) picture of the dashboard's
 * location. Clients online now (Wi-Fi / wired / guest) and over time (24 hours or 7 days, from the stored history),
 * devices online against offline by type, clients by type, internet lines and latency, and the issues that need
 * attention. Read-only; loads on its own (GET api/ceo/network or api/sales-manager/network), so a network that is
 * not set up or not reachable shows one plain message here and the rest of the dashboard keeps working. Follows the
 * dashboard's location picker; the API limits a Sales Manager to the sites of their locations.
 */
@Component({
  selector: 'app-dash-network',
  standalone: true,
  imports: [NgTemplateOutlet],
  templateUrl: './dash-network.html',
  styleUrls: ['../ceo-dashboard.css', './dash-network.css']
})
export class DashNetworkSection {
  private net = inject(NetworkDashboardService);
  private host = inject(ElementRef<HTMLElement>);

  /** Which dashboard: the CEO's (api/ceo/network) or the Sales Manager's (api/sales-manager/network). */
  source = input.required<NetworkSource>();
  locationId = input<number | null>(null);
  /** The dashboard's locations (names for the sites' locations). */
  locations = input<{ locationId: number; name: string }[]>([]);
  /** What no location means on this dashboard ("All locations", "All my locations"). */
  allLabel = input('All locations');
  /** Bumped by the dashboard's refresh button. */
  reload = input(0);
  /** Bumped by the dashboard's auto refresh: reload without dimming the section. */
  quietReload = input(0);

  readonly count = count;
  readonly pct = pct;
  readonly ms = ms;
  readonly wifiColor = WIFI;
  readonly wiredColor = WIRED;
  readonly guestColor = GUEST;
  readonly offlineColor = OFFLINE;

  data = signal<NetDashboard | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  error = signal<DashError | null>(null);
  range = signal<HistoryRange>('day');
  chartAnnounce = signal('');

  private sub: Subscription | null = null;
  private dataKey = '';
  private charts = new Map<ChartKey, Chart>();
  private clock?: ReturnType<typeof setInterval>;
  private nowTick = signal(Date.now());

  private clientsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('clientsCanvas');
  private typesCanvas = viewChild<ElementRef<HTMLCanvasElement>>('typesCanvas');
  private latencyCanvas = viewChild<ElementRef<HTMLCanvasElement>>('latencyCanvas');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.sub?.unsubscribe();
      this.destroyCharts();
      if (this.clock) clearInterval(this.clock);
    });
    this.clock = setInterval(() => this.nowTick.set(Date.now()), 30_000);
    effect(() => {
      this.source();
      this.locationId();
      this.reload();
      untracked(() => this.load());
    });
    effect(() => {
      if (this.quietReload()) untracked(() => this.load(true));
    });
    afterRenderEffect(() => this.renderCharts());
  }

  // ---------- loading ----------

  /** quiet: the auto refresh (the figures on screen stay until the new ones arrive). */
  load(quiet = false) {
    this.sub?.unsubscribe();
    if (!quiet) { if (this.data()) this.refreshing.set(true); else this.loading.set(true); }
    const key = `${this.source()}|${this.locationId() ?? ''}`;
    this.sub = this.net.get(this.source(), this.locationId()).subscribe({
      next: d => {
        this.data.set(d);
        this.dataKey = key;
        this.error.set(null);
        this.loading.set(false);
        this.refreshing.set(false);
        this.nowTick.set(Date.now());
      },
      error: (err: DashError) => {
        this.error.set(NetworkDashboardService.describeError(err));
        // Another location's network would be misleading: keep the figures only for a plain refresh.
        if (this.dataKey !== key) { this.data.set(null); this.dataKey = ''; this.destroyCharts(); }
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }

  // ---------- figures ----------

  /** Figures to show: the network answered and at least one site serves the location. */
  shown = computed(() => {
    const d = this.data();
    return !!d && d.available && d.sites.length > 0 && !!d.clients;
  });

  /** "UniFi site WorkNest I-8" / "2 UniFi sites" for the section line. */
  scopeText = computed(() => {
    const sites = this.data()?.sites ?? [];
    if (!sites.length) return '';
    return sites.length === 1 ? `UniFi site ${sites[0].name}` : `${sites.length} UniFi sites`;
  });

  /** The line under the section title: what it shows, the site(s) and when the network was read. */
  titleLine = computed(() =>
    ['Wi-Fi and wired clients, network devices and internet', this.scopeText(), this.updatedText()].filter(Boolean).join(' · '));

  /** Each site with the WorkNest locations it serves ("WorkNest I-8: I-8"). */
  siteLines = computed(() => {
    const names = new Map(this.locations().map(l => [l.locationId, l.name]));
    return (this.data()?.sites ?? []).map(s => ({
      id: s.id,
      name: s.name,
      serves: s.everyLocation ? 'every location' : s.locationIds.map(id => names.get(id) ?? `location ${id}`).join(', ')
    }));
  });

  updatedText = computed(() => {
    this.nowTick();
    const at = this.data()?.updatedAt;
    if (!at) return '';
    const t = new Date(at).getTime();
    if (isNaN(t)) return '';
    const mins = Math.floor((Date.now() - t) / 60000);
    return mins < 1 ? 'updated just now' : mins === 1 ? 'updated 1 min ago' : mins < 60 ? `updated ${mins} min ago`
      : `updated ${new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  });

  kpis = computed<DashKpi[]>(() => {
    const d = this.data();
    if (!d || !this.shown()) return [];
    const c = d.clients!;
    const dv = d.devices;
    const i = d.internet;
    const peakAt = c.peak24hAt ? new Date(c.peak24hAt) : null;
    const peakTime = peakAt && !isNaN(peakAt.getTime()) ? peakAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const latency = i?.latencyMs ?? null;
    const loss = i?.lossMaxPct ?? null;
    return [
      {
        key: 'clients', label: 'Clients online now', value: count(c.total),
        sub: `${count(c.wifi)} Wi-Fi · ${count(c.wired)} wired · ${count(c.guest)} guest`, tone: 'neutral',
        action: () => this.focusEl('net-panel-clients'), actionLabel: 'Show clients over time'
      },
      {
        key: 'peak', label: 'Busiest in 24 hours', value: c.peak24h === null ? '-' : count(c.peak24h),
        sub: c.peak24h === null ? 'History is still filling in'
          : [peakTime ? `at ${peakTime}` : '', c.avg24h !== null ? `average ${count(c.avg24h)}` : ''].filter(Boolean).join(' · '),
        tone: 'neutral'
      },
      {
        key: 'devices', label: 'Network devices online',
        value: dv && dv.total ? `${count(dv.online)} of ${count(dv.total)}` : '-',
        sub: !dv || !dv.total ? 'No devices reported' : dv.offline ? `${count(dv.offline)} offline` : 'All online',
        tone: !dv || !dv.total ? 'neutral' : dv.offline ? 'danger' : 'ok',
        action: () => this.focusEl('net-panel-devices'), actionLabel: 'Show devices by type'
      },
      {
        key: 'lines', label: 'Internet lines up',
        value: i && i.linesTotal ? `${count(i.linesUp)} of ${count(i.linesTotal)}` : '-',
        sub: !i || !i.linesTotal ? 'No line reported' : i.uptimePct !== null ? `WAN uptime ${pct(i.uptimePct)}` : i.linesUp < i.linesTotal ? 'A line is down' : 'All up',
        tone: !i || !i.linesTotal ? 'neutral' : i.linesUp < i.linesTotal ? 'danger' : 'ok',
        action: () => this.focusEl('net-panel-internet'), actionLabel: 'Show the internet lines'
      },
      {
        key: 'latency', label: 'Internet latency', value: ms(latency),
        sub: latency === null ? 'Not reported yet'
          : [i?.latencyAvgMs !== null && i?.latencyAvgMs !== undefined ? `average ${ms(i.latencyAvgMs)}` : '', loss !== null ? `loss up to ${pct(loss)}` : ''].filter(Boolean).join(' · ') + ' (24 h)',
        tone: latency === null ? 'neutral' : latency >= 100 || (loss ?? 0) >= 1 ? 'warn' : 'ok'
      }
    ];
  });

  // ---------- clients over time ----------

  history = computed<NetHistoryPoint[]>(() => {
    const h = this.data()?.history;
    return (this.range() === 'week' ? h?.week : h?.day) ?? [];
  });
  historyEmpty = computed(() => !this.history().some(p => p.peak !== null));
  historyStats = computed(() => {
    const pts = this.history().filter(p => p.peak !== null);
    if (!pts.length) return null;
    const totals = pts.map(p => (p.wifi ?? 0) + (p.wired ?? 0) + (p.guest ?? 0));
    const peak = pts.reduce((a, p) => ((p.peak ?? 0) > (a.peak ?? 0) ? p : a), pts[0]);
    return { avg: Math.round(totals.reduce((a, b) => a + b, 0) / totals.length), peak: peak.peak ?? 0, peakAt: stepTitle(peak.t) };
  });
  historyAria = computed(() => {
    const s = this.historyStats();
    const span = this.range() === 'week' ? 'the last 7 days' : 'the last 24 hours';
    return s ? `Clients online over ${span}: average ${s.avg}, most at once ${s.peak} on ${s.peakAt}. Use the arrow keys to read each step.`
      : `Clients online over ${span}: no samples yet.`;
  });

  setRange(r: HistoryRange) { this.range.set(r); }

  readonly clientsNav = new ChartKeyNav({
    charts: () => [this.charts.get('clients')],
    count: () => this.history().length,
    describe: i => {
      const p = this.history()[i];
      if (!p) return '';
      if (p.peak === null) return `${stepTitle(p.t)}: no sample.`;
      return `${stepTitle(p.t)}: ${p.wifi ?? 0} Wi-Fi, ${p.wired ?? 0} wired, ${p.guest ?? 0} guest on average, ${p.peak} at most.`;
    },
    pick: () => { /* a step has nothing to open */ },
    announce: t => this.chartAnnounce.set(t)
  });

  // ---------- clients by type ----------

  types = computed(() => {
    const ct = this.data()?.clientTypes;
    if (!ct?.available) return [];
    return ct.items.filter(x => x.count > 0).map((x, i) => ({ ...x, color: KIND_COLORS[x.kind] ?? KIND_FALLBACK[i % KIND_FALLBACK.length] }));
  });
  typesTotal = computed(() => this.types().reduce((a, x) => a + x.count, 0));
  typesAria = computed(() => this.types().map(t => `${t.label}: ${t.count}`).join(', '));
  typeShare(n: number): string { const t = this.typesTotal(); return t ? pct((n / t) * 100) : '0%'; }

  // ---------- devices ----------

  deviceRows = computed(() => (this.data()?.devices?.byType ?? []).map(t => {
    const total = t.online + t.offline;
    return { ...t, total, onW: total ? (t.online / total) * 100 : 0, offW: total ? (t.offline / total) * 100 : 0 };
  }));

  // ---------- internet ----------

  lines = computed(() => this.data()?.internet?.lines ?? []);
  /** "Primary · uptime 100% · 1 issue" (and the site when there are several). */
  lineMeta(w: NetWan): string {
    return [
      w.role || 'Line',
      this.multiSite() ? w.site : '',
      w.uptimePct !== null ? `uptime ${pct(w.uptimePct)}` : '',
      w.issues ? `${w.issues} issue${w.issues === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' · ');
  }
  multiSite = computed(() => (this.data()?.sites.length ?? 0) > 1);
  latencyEmpty = computed(() => !(this.data()?.internet?.latency ?? []).some(s => s.points.some(p => p.avg !== null)));

  alerts = computed(() => this.data()?.alerts ?? []);

  // ---------- helpers ----------

  focusEl(id: string) {
    const el = (this.host.nativeElement as HTMLElement).querySelector(`#${id}`) as HTMLElement | null;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  private destroyCharts() {
    this.charts.forEach(c => c.destroy());
    this.charts.clear();
  }

  /** Creates a chart, or updates it in place (no flash) when it already sits on the same canvas. */
  private upsert(key: ChartKey, ref: ElementRef<HTMLCanvasElement> | undefined, config: any) {
    const existing = this.charts.get(key);
    if (!ref) { existing?.destroy(); this.charts.delete(key); return; }
    if (existing && existing.canvas === ref.nativeElement) {
      existing.data = config.data;
      existing.options = config.options;
      existing.update();
      return;
    }
    existing?.destroy();
    this.charts.set(key, new Chart(ref.nativeElement, config));
  }

  private renderCharts() {
    const d = this.data();
    const clientsCanvas = this.clientsCanvas();
    const typesCanvas = this.typesCanvas();
    const latencyCanvas = this.latencyCanvas();
    const pts = this.history();
    const range = this.range();
    const types = this.types();
    if (!d || !this.shown()) { this.destroyCharts(); return; }
    applyChartDefaults();

    // 1. Clients over time: Wi-Fi / wired / guest stacked (average in each step), and the most at once as a dashed line.
    const area = (label: string, field: 'wifi' | 'wired' | 'guest', color: string, fill: string | boolean) => ({
      label, data: pts.map(p => p[field]), stack: 'clients', borderColor: color, backgroundColor: color + 'cc', fill,
      borderWidth: 1.5, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 8, spanGaps: false
    });
    this.upsert('clients', this.historyEmpty() ? undefined : clientsCanvas, {
      type: 'line',
      data: {
        labels: pts.map(p => stepLabel(p.t, range)),
        datasets: [
          area('Wi-Fi', 'wifi', WIFI, 'origin'),
          area('Wired', 'wired', WIRED, '-1'),
          area('Guest', 'guest', GUEST, '-1'),
          {
            label: 'Most at once', data: pts.map(p => p.peak), stack: 'peak', borderColor: PEAK, backgroundColor: PEAK, fill: false,
            borderWidth: 1.5, borderDash: [4, 3], tension: 0.3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 8, spanGaps: false
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => stepTitle(pts[items[0]?.dataIndex]?.t ?? ''),
              label: (c: any) => c.parsed.y === null ? '' : ` ${c.dataset.label}: ${count(c.parsed.y)}`,
              footer: (items: any[]) => {
                const p = pts[items[0]?.dataIndex];
                return p && p.peak !== null ? `Average over ${range === 'week' ? 'the hour' : '15 minutes'}` : 'No sample';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 14 } },
          y: { stacked: true, beginAtZero: true, grid: GRID, border: { display: false }, ticks: { precision: 0, padding: 8 } }
        }
      }
    });

    // 2. Clients by type: part of the whole.
    this.upsert('types', types.length ? typesCanvas : undefined, {
      type: 'doughnut',
      data: {
        labels: types.map(t => t.label),
        datasets: [{
          data: types.map(t => t.count), backgroundColor: types.map(t => t.color),
          borderColor: '#fff', borderWidth: 2, hoverOffset: 6, hoverBorderColor: '#fff'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%', layout: { padding: 8 },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              label: (c: any) => ` ${c.label}: ${count(c.parsed)} (${this.typeShare(c.parsed)})`,
              footer: (items: any[]) => {
                const t = types[items[0]?.dataIndex];
                return t ? `${count(t.wifi)} Wi-Fi · ${count(t.wired)} wired` : '';
              }
            }
          }
        }
      }
    });

    // 3. Internet latency over 24 hours: average per site (the peak dashed when there is one site).
    const series = d.internet?.latency ?? [];
    const labels = series[0]?.points.map(p => stepLabel(p.t, 'day')) ?? [];
    const multi = series.length > 1;
    const datasets: any[] = series.map((s, i) => ({
      label: multi ? s.name : 'Average', data: s.points.map(p => p.avg), borderColor: SITE_COLORS[i % SITE_COLORS.length],
      backgroundColor: SITE_COLORS[i % SITE_COLORS.length] + '22', fill: !multi ? 'origin' : false, borderWidth: 2, tension: 0.3,
      pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 8
    }));
    if (!multi && series[0]) {
      datasets.push({
        label: 'Peak', data: series[0].points.map(p => p.peak), borderColor: WIRED, backgroundColor: WIRED, fill: false,
        borderWidth: 1.5, borderDash: [4, 3], tension: 0.3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 8
      });
    }
    this.upsert('latency', this.latencyEmpty() ? undefined : latencyCanvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => stepTitle(series[0]?.points[items[0]?.dataIndex]?.t ?? ''),
              label: (c: any) => c.parsed.y === null ? '' : ` ${c.dataset.label}: ${ms(c.parsed.y)}`,
              footer: (items: any[]) => {
                const losses = series.map(s => s.points[items[0]?.dataIndex]?.loss).filter((v): v is number => v !== null && v !== undefined);
                const worst = losses.length ? Math.max(...losses) : null;
                return worst !== null && worst > 0 ? `Packet loss up to ${pct(worst)}` : '';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 14 } },
          y: { beginAtZero: true, grid: GRID, border: { display: false }, ticks: { padding: 8, callback: (v: any) => `${v} ms` } }
        }
      }
    });
  }

  /** Colours for the template (teal accents match the rest of the dashboard). */
  readonly teal = TEAL;
  readonly tealDark = TEAL_DARK;
}
