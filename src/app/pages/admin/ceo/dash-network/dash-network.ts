import {
  Component, DestroyRef, ElementRef, HostListener, afterRenderEffect, computed, effect, inject, input, signal, untracked, viewChild
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import type { DashError, DashRange } from '../../../../services/dashboard-api';
import {
  NetDashboard, NetGwnSection, NetHistoryPoint, NetSpeedtest, NetSpeedtestError, NetTopClient, NetTrafficPoint, NetWan, NetworkDashboardService,
  NetworkSource
} from '../../../../services/network-dashboard.service';
import { bytesText, linkText, mbpsText, pairText, stampText, whenText } from './net-format';
import {
  Chart, ChartKeyNav, DashKpi, GRID, LEGEND, TEAL, TEAL_DARK, TOOLTIP, applyChartDefaults, count, pct
} from '../ceo-shared';
import { AuthService } from '../../../../services/auth.service';

type ChartKey = 'clients' | 'types' | 'latency' | 'gwnClients' | 'gwnBandwidth';
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
 * A line's 24-hour traffic as two sparkline paths (download, upload) on a 100 x 24 box, and the download's area (a soft
 * fill under it); a step without figures breaks the line. Null when there is nothing to draw.
 */
function sparkOf(points: NetTrafficPoint[]): { down: string; up: string; area: string; peak: string } | null {
  const n = points.length;
  if (n < 2) return null;
  const peakDown = Math.max(0, ...points.map(p => p.down ?? 0));
  const peakUp = Math.max(0, ...points.map(p => p.up ?? 0));
  const max = Math.max(peakDown, peakUp);
  if (!(max > 0)) return null;
  const x = (i: number) => ((i / (n - 1)) * 100).toFixed(2);
  const y = (v: number) => (23 - (v / max) * 21).toFixed(2);
  const path = (field: 'down' | 'up') => {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      const v = p[field];
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i)},${y(v)} `;
      pen = true;
    });
    return d.trim();
  };
  // The area: each unbroken run of download figures closed down to the baseline.
  let area = '';
  let run: number[] = [];
  const close = () => {
    if (run.length > 1) area += `M${x(run[0])},24 ${run.map(i => `L${x(i)},${y(points[i].down!)}`).join(' ')} L${x(run[run.length - 1])},24 Z `;
    run = [];
  };
  points.forEach((p, i) => { if (p.down === null) close(); else run.push(i); });
  close();
  return { down: path('down'), up: path('up'), area: area.trim(), peak: `${mbpsText(peakDown)} down, ${mbpsText(peakUp)} up` };
}

/** Bits per second -> Mbps (null stays null). */
function bpsToMbps(v: number | null | undefined): number | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : v / 1e6;
}

/** A GWN device this warm or warmer is flagged (degrees C). */
const GWN_HOT_C = 70;

/** While the API is still reading the network (line speeds, client types, top data users): reload after this long (ms). */
const PENDING_RETRY_MS = 60_000;
/** At most this many reloads in a row for that (the server keeps the reads warm, so one is normally enough). */
const PENDING_RETRIES = 5;

/** Some figures were still being read when the API stopped waiting (they come within a minute). */
function stillLoading(d: NetDashboard): boolean {
  const loading = (m: string | null | undefined) => !!m && /loading/i.test(m);
  return d.available && (!!d.internet?.speedsPending || loading(d.clientTypes?.message) || loading(d.topClientsMessage));
}

/** How long a UniFi speed test takes (seconds), for the "about N s" countdown. */
const TEST_SECONDS = 30;
/** How often a running speed test is polled (ms), as on the Network pages. */
const TEST_POLL_MS = 3000;

/** "14:05" in the viewer's time; "" when unknown. */
function timeOf(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Network section of the CEO and Sales Manager dashboards: the Wi-Fi / network (UniFi) picture of the dashboard's
 * location. Clients online now (Wi-Fi / wired / guest) and over time (24 hours or 7 days, from the stored history),
 * devices online against offline by type, clients by type, the top 5 data users (each opens its details), internet
 * lines and latency, and the issues that need attention. Read-only, except that the CEO can run a speed test on a line
 * ("Test speed", api/ceo/network/speedtest: one at a time, as UniFi allows). Loads on its own (GET api/ceo/network or api/sales-manager/network), so a network that is
 * not set up or not reachable shows one plain message here and the rest of the dashboard keeps working. Follows the
 * dashboard's location picker; the API limits a Sales Manager to the sites of their locations.
 */
@Component({
  selector: 'app-dash-network',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './dash-network.html',
  styleUrls: ['../ceo-dashboard.css', './dash-network.css']
})
export class DashNetworkSection {
  private net = inject(NetworkDashboardService);
  private host = inject(ElementRef<HTMLElement>);
  private auth = inject(AuthService);

  /** Which dashboard: the CEO's (api/ceo/network) or the Sales Manager's (api/sales-manager/network). */
  source = input.required<NetworkSource>();
  locationId = input<number | null>(null);
  /** The dashboard's locations (names for the sites' locations). */
  locations = input<{ locationId: number; name: string }[]>([]);
  /** What no location means on this dashboard ("All locations", "All my locations"). */
  allLabel = input('All locations');
  /** The dashboard's period (month / quarter / year / custom + range): the top data users follow it. */
  period = input<string | null>(null);
  range = input<DashRange | null>(null);
  /** Bumped by the dashboard's refresh button. */
  reload = input(0);
  /** Bumped by the dashboard's auto refresh: reload without dimming the section. */
  quietReload = input(0);

  readonly count = count;
  readonly pct = pct;
  readonly ms = ms;
  readonly bytes = bytesText;
  readonly wifiColor = WIFI;
  readonly wiredColor = WIRED;
  readonly guestColor = GUEST;
  readonly offlineColor = OFFLINE;

  data = signal<NetDashboard | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  error = signal<DashError | null>(null);
  historyRange = signal<HistoryRange>('day');
  chartAnnounce = signal('');

  private sub: Subscription | null = null;
  private dataKey = '';
  private pendingTimer?: ReturnType<typeof setTimeout>;
  private pendingRetries = 0;
  private charts = new Map<ChartKey, Chart>();
  private clock?: ReturnType<typeof setInterval>;
  private nowTick = signal(Date.now());

  private clientsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('clientsCanvas');
  private typesCanvas = viewChild<ElementRef<HTMLCanvasElement>>('typesCanvas');
  private latencyCanvas = viewChild<ElementRef<HTMLCanvasElement>>('latencyCanvas');
  private gwnClientsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('gwnClientsCanvas');
  private gwnBandwidthCanvas = viewChild<ElementRef<HTMLCanvasElement>>('gwnBandwidthCanvas');
  private topPanel = viewChild<ElementRef<HTMLElement>>('topPanel');
  private topHeading = viewChild<ElementRef<HTMLElement>>('topHeading');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      if (this.pendingTimer) clearTimeout(this.pendingTimer);
      this.stopTestPolling();
      this.sub?.unsubscribe();
      this.destroyCharts();
      if (this.clock) clearInterval(this.clock);
    });
    this.clock = setInterval(() => this.nowTick.set(Date.now()), 30_000);
    effect(() => {
      this.source();
      this.locationId();
      this.period();
      this.range();
      this.reload();
      untracked(() => { this.closeTop(false); this.load(); });
    });
    effect(() => {
      if (this.quietReload()) untracked(() => this.load(true));
    });
    // A test started elsewhere (the Network pages, another tab) keeps the buttons disabled until it ends.
    effect(() => {
      if (this.canTest()) untracked(() => this.followRunningTest());
    });
    afterRenderEffect(() => this.renderCharts());
  }

  // ---------- loading ----------

  /**
   * quiet: the auto refresh (the figures on screen stay until the new ones arrive). pendingRetry: the reload that picks
   * up figures that were still loading (any other load starts the count again).
   */
  load(quiet = false, pendingRetry = false) {
    this.sub?.unsubscribe();
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = undefined; }
    if (!pendingRetry) this.pendingRetries = 0;
    if (!quiet) { if (this.data()) this.refreshing.set(true); else this.loading.set(true); }
    const key = `${this.source()}|${this.locationId() ?? ''}`;
    this.sub = this.net.get(this.source(), this.locationId(), this.period(), this.range()).subscribe({
      next: d => {
        this.data.set(d);
        this.dataKey = key;
        this.error.set(null);
        this.loading.set(false);
        this.refreshing.set(false);
        this.nowTick.set(Date.now());
        // Figures still on their way from the network: one quiet reload in a minute (no dimming, no skeleton).
        if (stillLoading(d) && !this.destroyed && this.pendingRetries < PENDING_RETRIES) {
          this.pendingRetries++;
          this.pendingTimer = setTimeout(() => this.load(true, true), PENDING_RETRY_MS);
        }
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
    ['Wi-Fi and wired clients, network devices and internet', this.scopeText(), this.gwn() ? `Grandstream ${this.gwnPlace()}` : '', this.updatedText()]
      .filter(Boolean).join(' · '));

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
    const latency = i?.latencyMs ?? null;
    const loss = i?.lossMaxPct ?? null;
    return [
      {
        key: 'clients', label: 'Clients online now', value: count(c.total),
        sub: `${count(c.wifi)} Wi-Fi · ${count(c.wired)} wired · ${count(c.guest)} guest`, tone: 'neutral',
        action: () => this.focusEl('net-panel-clients'), actionLabel: 'Show clients over time'
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
    return (this.historyRange() === 'week' ? h?.week : h?.day) ?? [];
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
    const span = this.historyRange() === 'week' ? 'the last 7 days' : 'the last 24 hours';
    return s ? `Clients online over ${span}: average ${s.avg}, most at once ${s.peak} on ${s.peakAt}. Use the arrow keys to read each step.`
      : `Clients online over ${span}: no samples yet.`;
  });

  setRange(r: HistoryRange) { this.historyRange.set(r); }

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
  /** Each line with its figures written out: speed now, link, last speed test, data in 24 h, sparkline. */
  lineRows = computed(() => {
    this.nowTick();
    const tested = this.testResults();
    return this.lines().map((w, i) => {
      const st = this.latestTest(w.speedtest, w.live ? tested[w.label] : undefined);
      const fresh = !!st && st === tested[w.label];
      return {
        w,
        key: `${w.site}|${w.label}|${i}`,
        /** The CEO can test this line: the main gateway reports it (its figures are live). */
        testable: this.canTest() && w.live,
        meta: this.lineMeta(w),
        downNow: mbpsText(w.downMbps),
        upNow: mbpsText(w.upMbps),
        link: linkText(w.linkMbps),
        test: st ? pairText(st.downMbps, st.upMbps) : '-',
        testWhen: fresh ? [whenText(st?.at), timeOf(st?.at)].filter(Boolean).join(', ') : whenText(st?.at),
        testTitle: st ? ['Download / upload', st.pingMs !== null ? `ping ${ms(st.pingMs)}` : '', stampText(st.at)].filter(Boolean).join(' · ') : '',
        data24: w.down24hBytes === null && w.up24hBytes === null ? '-' : `${bytesText(w.down24hBytes)} / ${bytesText(w.up24hBytes)}`,
        dataTitle: 'Downloaded / uploaded in the last 24 hours',
        spark: sparkOf(w.traffic)
      };
    });
  });
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

  // ---------- speed test (CEO only) ----------

  /** Only the CEO dashboard (the CEO and super admins) runs speed tests; the Sales Manager's stays read-only. */
  canTest = computed(() => this.source() === 'ceo');
  /** The test running now (here or elsewhere): its line and seconds since it started. */
  testRun = signal<{ wan: string; elapsed: number } | null>(null);
  /** The line whose test is being started (the request is on its way). */
  testStarting = signal<string | null>(null);
  /** Per line (WAN1...): why its test failed or what UniFi did instead, in plain words. */
  testNotes = signal<Record<string, string>>({});
  /** Per line: results of tests run while the page is open (newer than the figures the dashboard last read). */
  testResults = signal<Record<string, NetSpeedtest>>({});
  testAnnounce = signal('');
  /** A test is starting or running: every "Test speed" button waits (UniFi runs one at a time). */
  testBusy = computed(() => !!this.testRun() || !!this.testStarting());

  private testTimer?: ReturnType<typeof setTimeout>;
  private testSub: Subscription | null = null;
  private testIfname = '';
  private destroyed = false;

  /** The newer of the dashboard's last test and one run here. */
  private latestTest(server: NetSpeedtest | null, local: NetSpeedtest | undefined): NetSpeedtest | null {
    if (!local) return server;
    const t = (x: NetSpeedtest | null) => (x?.at ? new Date(x.at).getTime() : NaN);
    return !server || !(t(server) > t(local)) ? local : server;
  }

  /** "Testing… about 24 s" from the seconds since the test started. */
  testLabel(): string {
    if (this.testStarting()) return 'Starting…';
    const left = TEST_SECONDS - (this.testRun()?.elapsed ?? 0);
    return left > 3 ? `Testing… about ${Math.round(left)} s` : 'Testing… almost done';
  }

  /** The button's tooltip: what the test does, or why it cannot run now. */
  testTip(w: NetWan): string {
    const run = this.testRun();
    const starting = this.testStarting();
    if (run?.wan === w.label || starting === w.label) return `Testing ${w.label}. It takes about ${TEST_SECONDS} seconds.`;
    if (run || starting) return `A speed test is running on ${run?.wan || starting}. UniFi runs one test at a time.`;
    if (!w.up) return `${w.label} is down, so it cannot be tested.`;
    return `Run a speed test on ${w.label} now. It uses the line's full bandwidth for about ${TEST_SECONDS} seconds.`;
  }

  runSpeedtest(w: NetWan) {
    if (!this.canTest() || !w.live || !w.up || this.testBusy()) return;
    const key = w.label;
    const ok = confirm(`Run a speed test on ${key}?\n\nIt uses the full bandwidth of this line for about 20-30 seconds, so people using it may notice a short slowdown.`);
    if (!ok) return;
    this.setTestNote(key, null);
    this.testStarting.set(key);
    this.testSub?.unsubscribe();
    this.testSub = this.net.startSpeedtest(key).subscribe({
      next: run => {
        this.testStarting.set(null);
        this.testIfname = run.ifname;
        this.testRun.set({ wan: run.wan || key, elapsed: 0 });
        this.testAnnounce.set(`Speed test started on ${run.wan || key}. It takes about ${TEST_SECONDS} seconds.`);
        this.scheduleTestPoll();
      },
      error: (err: NetSpeedtestError) => {
        this.testStarting.set(null);
        this.setTestNote(key, `Could not start the test: ${err.message}`);
        this.testAnnounce.set(`Could not start the speed test on ${key}.`);
        // Another test is running (the Network pages, another tab): follow it so the buttons wait for it.
        if (err.status === 409) this.followRunningTest();
      }
    });
  }

  /** Asks once whether a test is running; if so, polls it until it ends. */
  private followRunningTest() {
    if (this.testRun() || this.testStarting()) return;
    this.testSub?.unsubscribe();
    this.testSub = this.net.speedtestStatus().subscribe({
      next: st => {
        if (!st.running || !st.wan || this.testRun() || this.testStarting()) return;
        this.testIfname = '';
        this.testRun.set({ wan: st.wan, elapsed: st.elapsed });
        this.scheduleTestPoll();
      },
      error: () => { /* nothing to follow: the buttons stay available */ }
    });
  }

  private scheduleTestPoll() {
    if (this.testTimer) clearTimeout(this.testTimer);
    if (this.destroyed) return;
    this.testTimer = setTimeout(() => this.pollTest(), TEST_POLL_MS);
  }

  private pollTest() {
    const run = this.testRun();
    if (!run || this.destroyed) return;
    this.testSub?.unsubscribe();
    this.testSub = this.net.speedtestStatus().subscribe({
      next: st => {
        if (st.running) {
          this.testRun.set({ wan: st.wan || run.wan, elapsed: st.elapsed });
          this.scheduleTestPoll();
          return;
        }
        this.testRun.set(null);
        const wan = st.wan || run.wan;
        if (st.timedOut) {
          this.setTestNote(wan, 'The test took too long and was stopped. Try again in a minute.');
          this.testAnnounce.set(`The speed test on ${wan} took too long and was stopped.`);
        } else if (st.result && (st.result.down !== null || st.result.up !== null)) {
          const r = st.result;
          if (this.testIfname && r.interface && r.interface !== this.testIfname) {
            // Some UniFi versions only test the primary line: the result is not this line's.
            this.setTestNote(wan, `UniFi ran the test on the primary line instead (${r.interface}). This UniFi version may only test the primary line.`);
          } else {
            this.testResults.set({ ...this.testResults(), [wan]: { downMbps: r.down, upMbps: r.up, pingMs: r.ping, at: new Date().toISOString() } });
            this.setTestNote(wan, null);
            this.testAnnounce.set(`Speed test on ${wan} finished: ${pairText(r.down, r.up)} down / up.`);
          }
        }
        this.testIfname = '';
        // The rest of the line's figures (and the stored last test) from the server, without dimming the section.
        this.load(true);
      },
      error: (err: NetSpeedtestError) => {
        this.testRun.set(null);
        this.testIfname = '';
        this.setTestNote(run.wan, `Lost track of the test: ${err.message}`);
        this.testAnnounce.set(`Lost track of the speed test on ${run.wan}.`);
      }
    });
  }

  private setTestNote(wan: string, text: string | null) {
    const n = { ...this.testNotes() };
    if (text) n[wan] = text; else delete n[wan];
    this.testNotes.set(n);
  }

  private stopTestPolling() {
    if (this.testTimer) clearTimeout(this.testTimer);
    this.testTimer = undefined;
    this.testSub?.unsubscribe();
    this.testSub = null;
  }
  latencyEmpty = computed(() => !(this.data()?.internet?.latency ?? []).some(s => s.points.some(p => p.avg !== null)));

  // ---------- top data users ----------

  /** The range under the title: "Today" -> "today", "Last 7 days" -> "last 7 days". */
  topRange = computed(() => {
    const d = this.data();
    const label = d?.topClientsRangeLabel;
    // "Today" -> "today"; the dashboard's period ("October 2026", "Q4 2026", "1 Oct - 15 Oct 2026") -> "in October 2026".
    if (label) return label.toLowerCase() === 'today' ? 'today' : label.toLowerCase().startsWith('last ') ? label.charAt(0).toLowerCase() + label.slice(1) : `in ${label}`;
    const days = d?.topClientsRangeDays;
    return days && days > 1 ? `last ${days} days` : 'today';
  });
  /** Each row with its bar (share of the biggest) and figures written out. */
  topRows = computed(() => {
    const list = this.data()?.topClients ?? [];
    const max = Math.max(0, ...list.map(c => c.totalBytes)) || 1;
    return list.map((c, i) => ({
      c,
      key: `${c.mac}|${i}`,
      share: Math.max(2, (c.totalBytes / max) * 100),
      color: KIND_COLORS[c.kind] ?? KIND_FALLBACK[i % KIND_FALLBACK.length],
      total: bytesText(c.totalBytes),
      down: bytesText(c.downloadBytes),
      up: bytesText(c.uploadBytes)
    }));
  });
  readonly kindColor = (kind: string) => KIND_COLORS[kind] ?? KIND_COLORS['other'];

  /** The client whose details are open (a snapshot: a refresh behind it does not change it). */
  topOpen = signal<NetTopClient | null>(null);
  private topReturn: HTMLElement | null = null;

  openTop(c: NetTopClient, ev?: Event) {
    this.topReturn = (ev?.currentTarget as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
    this.topOpen.set(c);
    setTimeout(() => (this.topHeading()?.nativeElement ?? this.topPanel()?.nativeElement)?.focus({ preventScroll: true }));
  }

  closeTop(restoreFocus = true) {
    if (!this.topOpen()) return;
    this.topOpen.set(null);
    const target = this.topReturn;
    this.topReturn = null;
    if (restoreFocus && target && document.contains(target)) setTimeout(() => target.focus({ preventScroll: true }));
  }

  /** The details, one row each ("-" when not reported). */
  topDetails = computed(() => {
    const c = this.topOpen();
    if (!c) return [];
    this.nowTick();
    const seen = c.online ? 'Now' : c.lastSeen ? `${stampText(c.lastSeen)} (${whenText(c.lastSeen)})` : '-';
    return [
      { label: 'Name', value: c.name },
      { label: 'Type', value: c.kindLabel },
      { label: 'Status', value: c.online ? 'Online now' : 'Offline' },
      { label: 'Last seen', value: seen },
      { label: 'MAC address', value: c.mac || '-' },
      { label: 'IP address', value: c.ip || '-' },
      { label: 'Connection', value: c.connection || (c.wired ? 'Wired' : 'Wi-Fi') },
      { label: c.wired ? 'Switch' : 'Access point', value: c.uplink || '-' },
      ...(c.wired ? [{ label: 'Switch port', value: c.port || '-' }] : [{ label: 'Wi-Fi name', value: c.ssid || '-' }]),
      { label: 'Network', value: c.network || '-' },
      { label: 'Guest', value: c.guest ? 'Yes' : 'No' },
      { label: 'Hostname', value: c.hostname || '-' },
      { label: 'Maker', value: c.vendor || '-' }
    ];
  });

  /** Escape closes the details; Tab stays inside them. */
  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent) {
    if (!this.topOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); this.closeTop(); return; }
    if (e.key !== 'Tab') return;
    const panel = this.topPanel()?.nativeElement;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(el => el.offsetParent !== null);
    if (!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !panel.contains(active))) { e.preventDefault(); first.focus(); }
  }

  alerts = computed(() => this.data()?.alerts ?? []);
  /** A critical issue among them (the panel's icon turns red). */
  hasCritical = computed(() => this.alerts().some(a => a.level === 'critical'));

  // ---------- Grandstream GWN (F-7) ----------

  /** The Grandstream part of the answer: null when no GWN network serves the location (I-8) or the API has none yet. */
  gwn = computed<NetGwnSection | null>(() => this.data()?.gwn ?? null);
  /** Grandstream figures to show (the network answered). */
  gwnShown = computed(() => !!this.gwn()?.available);
  /** Both networks are on screen (All locations): each block gets its own title. */
  bothShown = computed(() => this.shown() && !!this.gwn());
  /** "I-8" (the locations the UniFi sites serve), else the site names: the UniFi block's title when both show. */
  unifiPlace = computed(() => {
    const names = new Map(this.locations().map(l => [l.locationId, l.name]));
    const sites = this.data()?.sites ?? [];
    const places = [...new Set(sites.filter(x => !x.everyLocation).flatMap(x => x.locationIds).map(id => names.get(id)).filter((x): x is string => !!x))];
    return places.length ? places.join(', ') : sites.map(x => x.name).join(', ');
  });
  /** The UniFi empty states give way when the Grandstream block is on screen (F-7 has no UniFi site). */
  unifiQuiet = computed(() => !!this.gwn() && !this.shown());

  /** "F-7" (the locations of the GWN networks), else the network names. */
  gwnPlace = computed(() => {
    const g = this.gwn();
    if (!g) return '';
    const names = new Map(this.locations().map(l => [l.locationId, l.name]));
    const places = [...new Set(g.networks.flatMap(n => n.locationIds).map(id => names.get(id)).filter((x): x is string => !!x))];
    if (places.length) return places.join(', ');
    const nets = g.networks.map(n => n.name).filter(Boolean);
    return nets.length ? nets.join(', ') : 'F-7';
  });
  gwnTitle = computed(() => `Grandstream · ${this.gwnPlace()}`);
  /** "GWN network WorkNest F-7 Third Floor · updated 2 min ago" under the block title. */
  gwnSub = computed(() => {
    const g = this.gwn();
    if (!g) return '';
    this.nowTick();
    const nets = g.networks.map(n => n.name).filter(Boolean);
    return [
      nets.length === 1 ? `GWN network ${nets[0]}` : nets.length ? `${nets.length} GWN networks` : 'GWN Cloud',
      this.agoText(g.updatedAt)
    ].filter(Boolean).join(' · ');
  });

  /** The Grandstream pages (/admin/network/gwn): only for those who may open the Network pages (not CEO- or Sales-Manager-only). */
  canOpenGwn = computed(() => !this.auth.isCeoOnly() && !this.auth.isSalesManagerOnly());

  gwnKpis = computed<DashKpi[]>(() => {
    const g = this.gwn();
    if (!g || !g.available) return [];
    const c = g.clients;
    const dv = g.devices;
    const u = g.usageToday;
    const t = g.trafficNow;
    const temps = (dv?.list ?? []).map(d => d.temperature).filter((v): v is number => v !== null);
    const warmest = temps.length ? Math.max(...temps) : null;
    const down = bpsToMbps(t?.downloadBps), up = bpsToMbps(t?.uploadBps);
    return [
      {
        key: 'gwn-clients', label: 'Clients now', value: c ? count(c.total) : '-',
        sub: !c ? 'Not reported' : [
          `${count(c.band24)} on 2.4 GHz · ${count(c.band5)} on 5 GHz · ${count(c.wired)} wired`,
          c.weak ? `${count(c.weak)} weak signal` : ''
        ].filter(Boolean).join(' · '),
        tone: c && c.weak ? 'warn' : 'neutral',
        action: () => this.focusEl('gwn-panel-clients'), actionLabel: 'Show Grandstream clients over 24 hours'
      },
      {
        key: 'gwn-devices', label: 'Devices online',
        value: dv && dv.total ? `${count(dv.online)} of ${count(dv.total)}` : '-',
        sub: [
          !dv || !dv.total ? 'No devices reported' : dv.offline ? `${count(dv.offline)} offline` : 'All online',
          warmest !== null ? `warmest ${Math.round(warmest)} °C` : ''
        ].filter(Boolean).join(' · '),
        tone: !dv || !dv.total ? 'neutral' : dv.offline ? 'danger' : warmest !== null && warmest >= GWN_HOT_C ? 'warn' : 'ok',
        action: () => this.focusEl('gwn-panel-devices'), actionLabel: 'Show the Grandstream devices'
      },
      {
        key: 'gwn-usage', label: 'Data used today', value: u ? bytesText(u.total) : '-',
        sub: u ? `${bytesText(u.download)} down · ${bytesText(u.upload)} up` : 'Not reported', tone: 'neutral'
      },
      {
        key: 'gwn-traffic', label: 'Traffic now', value: mbpsText(down),
        sub: down === null && up === null ? 'Not reported' : `download · ${mbpsText(up)} upload`, tone: 'neutral',
        action: () => this.focusEl('gwn-panel-bandwidth'), actionLabel: 'Show Grandstream bandwidth over 24 hours'
      }
    ];
  });

  gwnClientsEmpty = computed(() => !(this.gwn()?.clientHistory.counts ?? []).some(v => v !== null));
  gwnClientStats = computed(() => {
    const h = this.gwn()?.clientHistory;
    if (!h) return null;
    const pts = h.counts.map((v, i) => ({ v, t: h.times[i] })).filter((p): p is { v: number; t: string } => p.v !== null);
    if (!pts.length) return null;
    const peak = pts.reduce((a, p) => (p.v > a.v ? p : a), pts[0]);
    return { avg: Math.round(pts.reduce((a, p) => a + p.v, 0) / pts.length), peak: peak.v, peakAt: stepTitle(peak.t) };
  });
  gwnClientsAria = computed(() => {
    const s = this.gwnClientStats();
    return s ? `Grandstream clients over the last 24 hours: average ${s.avg}, most ${s.peak} on ${s.peakAt}. Use the arrow keys to read each step.`
      : 'Grandstream clients over the last 24 hours: no samples yet.';
  });
  readonly gwnClientsNav = new ChartKeyNav({
    charts: () => [this.charts.get('gwnClients')],
    count: () => this.gwn()?.clientHistory.times.length ?? 0,
    describe: i => {
      const h = this.gwn()?.clientHistory;
      const t = h?.times[i];
      if (!h || !t) return '';
      const v = h.counts[i];
      return v === null ? `${stepTitle(t)}: no sample.` : `${stepTitle(t)}: ${count(v)} clients.`;
    },
    pick: () => { /* a step has nothing to open */ },
    announce: t => this.chartAnnounce.set(t)
  });

  gwnBandwidthEmpty = computed(() => {
    const b = this.gwn()?.bandwidth;
    return !b || !(b.downloadBps.some(v => v !== null) || b.uploadBps.some(v => v !== null));
  });
  gwnBandwidthStats = computed(() => {
    const b = this.gwn()?.bandwidth;
    if (!b || this.gwnBandwidthEmpty()) return null;
    const peak = (a: (number | null)[]) => Math.max(0, ...a.filter((v): v is number => v !== null));
    return { down: mbpsText(bpsToMbps(peak(b.downloadBps))), up: mbpsText(bpsToMbps(peak(b.uploadBps))) };
  });
  gwnBandwidthAria = computed(() => {
    const s = this.gwnBandwidthStats();
    return s ? `Grandstream bandwidth over the last 24 hours: peak ${s.down} download, ${s.up} upload.` : 'Grandstream bandwidth over the last 24 hours: no samples yet.';
  });

  /** The devices, offline first, then by name; temperature written out. */
  gwnDevices = computed(() => [...(this.gwn()?.devices?.list ?? [])]
    .sort((a, b) => Number(a.online) - Number(b.online) || a.name.localeCompare(b.name))
    .map(d => ({
      d,
      temp: d.temperature !== null ? `${Math.round(d.temperature)} °C` : d.temperatureText || '-',
      hot: d.temperature !== null && d.temperature >= GWN_HOT_C
    })));

  gwnTopRows = computed(() => {
    const list = this.gwn()?.topClients ?? [];
    const max = Math.max(0, ...list.map(c => c.total)) || 1;
    return list.map((c, i) => ({
      c, rank: i + 1, key: `${c.mac}|${i}`, share: Math.max(2, (c.total / max) * 100),
      total: bytesText(c.total), down: bytesText(c.download), up: bytesText(c.upload)
    }));
  });

  gwnAlerts = computed(() => this.gwn()?.alerts ?? []);
  gwnHasCritical = computed(() => this.gwnAlerts().some(a => a.level === 'critical'));
  /** "Critical", "Warning", "Info" for the pill. */
  levelLabel(level: string): string {
    return level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Warning';
  }

  /** "updated 2 min ago" from an ISO time; "" when unknown. */
  private agoText(at: string | null | undefined): string {
    if (!at) return '';
    const t = new Date(at).getTime();
    if (isNaN(t)) return '';
    const mins = Math.floor((Date.now() - t) / 60000);
    return mins < 1 ? 'updated just now' : mins === 1 ? 'updated 1 min ago' : mins < 60 ? `updated ${mins} min ago`
      : `updated ${new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
  }

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
    const range = this.historyRange();
    const types = this.types();
    const gwnClientsCanvas = this.gwnClientsCanvas();
    const gwnBandwidthCanvas = this.gwnBandwidthCanvas();
    const g = this.gwn();
    if (!d) { this.destroyCharts(); return; }
    applyChartDefaults();
    this.renderGwnCharts(g && g.available ? g : null, gwnClientsCanvas, gwnBandwidthCanvas);
    if (!this.shown()) {
      (['clients', 'types', 'latency'] as ChartKey[]).forEach(k => { this.charts.get(k)?.destroy(); this.charts.delete(k); });
      return;
    }

    // 1. Clients over time: Wi-Fi / wired / guest stacked (average in each step), and the most at once as a dashed line.
    const area = (label: string, field: 'wifi' | 'wired' | 'guest', color: string, fill: string | boolean) => ({
      label, data: pts.map(p => p[field]), stack: 'clients', borderColor: color, backgroundColor: color + '59', fill,
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

  /** The Grandstream charts: clients and bandwidth over the last 24 hours (the UniFi charts' look). */
  private renderGwnCharts(
    g: NetGwnSection | null, clientsCanvas: ElementRef<HTMLCanvasElement> | undefined, bandwidthCanvas: ElementRef<HTMLCanvasElement> | undefined
  ) {
    const xScale = { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 14 } };
    const h = g?.clientHistory;
    this.upsert('gwnClients', g && h && !this.gwnClientsEmpty() ? clientsCanvas : undefined, {
      type: 'line',
      data: {
        labels: (h?.times ?? []).map(t => stepLabel(t, 'day')),
        datasets: [{
          label: 'Clients', data: h?.counts ?? [], borderColor: WIFI, backgroundColor: WIFI + '33', fill: 'origin',
          borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 8, spanGaps: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => stepTitle(h?.times[items[0]?.dataIndex] ?? ''),
              label: (c: any) => c.parsed.y === null ? '' : ` Clients: ${count(c.parsed.y)}`
            }
          }
        },
        scales: { x: xScale, y: { beginAtZero: true, grid: GRID, border: { display: false }, ticks: { precision: 0, padding: 8 } } }
      }
    });

    const b = g?.bandwidth;
    const mbps = (a: (number | null)[] | undefined) => (a ?? []).map(v => bpsToMbps(v));
    this.upsert('gwnBandwidth', g && b && !this.gwnBandwidthEmpty() ? bandwidthCanvas : undefined, {
      type: 'line',
      data: {
        labels: (b?.times ?? []).map(t => stepLabel(t, 'day')),
        datasets: [
          {
            label: 'Download', data: mbps(b?.downloadBps), borderColor: WIFI, backgroundColor: WIFI + '22', fill: 'origin',
            borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 8, spanGaps: false
          },
          {
            label: 'Upload', data: mbps(b?.uploadBps), borderColor: WIRED, backgroundColor: WIRED, fill: false,
            borderWidth: 1.5, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 8, spanGaps: false
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
              title: (items: any[]) => stepTitle(b?.times[items[0]?.dataIndex] ?? ''),
              label: (c: any) => c.parsed.y === null ? '' : ` ${c.dataset.label}: ${mbpsText(c.parsed.y)}`
            }
          }
        },
        scales: { x: xScale, y: { beginAtZero: true, grid: GRID, border: { display: false }, ticks: { padding: 8, callback: (v: any) => `${v} Mbps` } } }
      }
    });
  }

  /** Colours for the template (teal accents match the rest of the dashboard). */
  readonly teal = TEAL;
  readonly tealDark = TEAL_DARK;
}
