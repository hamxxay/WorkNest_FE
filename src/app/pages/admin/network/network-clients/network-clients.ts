import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { UnifiService } from '../../../../services/unifi.service';
import { AuthService } from '../../../../services/auth.service';
import { UnifiClient, UnifiClientUsage, UnifiClientsResponse, UnifiLog, UnifiTopUsage } from '../../../../models/unifi.model';
import {
  ChartBag, ExportKind, NET_SHARED, S1, S2, ago, avg, baseOptions, buildTimeline, bytes, clientIcon, clock, dur, errMsg, exportCard,
  exportPagePdf, fmt, hbar, hbarOptions, logWhen, normMac, signalInfo, sum, timeLabel, timelineStats
} from '../network-shared';

type SortKey = 'name' | 'conn' | 'uplink' | 'signal' | 'ip' | 'exp' | 'data' | 'uptime';
type ConnType = '' | 'wifi' | 'wired' | 'guest';

const CLIENT_LABELS = { upLabel: 'Connected', downLabel: 'Disconnected', leadLabel: 'Not connected yet' };

@Component({
  selector: 'app-network-clients',
  standalone: true,
  imports: [FormsModule, RouterLink, ...NET_SHARED],
  templateUrl: './network-clients.html',
  styleUrls: ['../network-shared.css', './network-clients.css']
})
export class NetworkClients implements OnInit, OnDestroy {
  private unifi = inject(UnifiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  page = viewChild<ElementRef<HTMLElement>>('page');
  uplinksCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cUplinks');
  signalCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cSignal');
  usageCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cUsage');
  usageTable = viewChild<ElementRef<HTMLTableElement>>('usageTable');
  clientsTable = viewChild<ElementRef<HTMLTableElement>>('clientsTable');

  private charts = new ChartBag();
  private timers: ReturnType<typeof setInterval>[] = [];
  private slowTimer?: ReturnType<typeof setTimeout>;

  /** Only admins can rename clients; sales executives get a read-only view. */
  readonly canRename = this.auth.hasRole('admin') || this.auth.hasRole('super_admin');

  data = signal<UnifiClientsResponse | null>(null);
  loadedAt = signal<number | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  now = signal(Date.now());

  search = signal('');
  type = signal<ConnType>('');
  kind = signal('');
  uplink = signal('');
  sort = signal<SortKey>('name');
  dir = signal(1);

  usageDays = signal(7);
  topUsage = signal<UnifiTopUsage | null>(null);
  topUsageLoading = signal(true);
  topUsageError = signal<string | null>(null);

  // Drawer
  openMac = signal<string | null>(null);
  logs = signal<UnifiLog[] | null>(null);
  logsError = signal<string | null>(null);
  logsSlow = signal(false);
  usage = signal<UnifiClientUsage | null>(null);
  usageError = signal<string | null>(null);
  usageRange = signal<30 | 2>(30);
  renaming = signal(false);
  renameValue = signal('');
  renameSaving = signal(false);
  renameError = signal<string | null>(null);

  readonly fmt = fmt;
  readonly bytes = bytes;
  readonly dur = dur;
  readonly clientIcon = clientIcon;
  readonly logWhen = logWhen;
  readonly clock = clock;
  readonly labels = CLIENT_LABELS;

  updatedText = computed(() => { this.now(); const t = this.loadedAt(); return t ? `Updated ${ago(t)}` : ''; });

  stats = computed(() => {
    const cl = this.data()?.clients;
    if (!cl) return null;
    const wifi = cl.filter(c => !c.wired);
    const exps = wifi.map(c => c.experience).filter((v): v is number => v != null);
    const top = [...cl].sort((a, b) => b.dataBytes - a.dataBytes)[0] as UnifiClient | undefined;
    return {
      total: cl.length,
      guests: cl.filter(c => c.guest).length,
      wifi: wifi.length,
      ssids: [...new Set(wifi.map(c => c.ssid).filter(Boolean))].join(', ') || '–',
      wired: cl.length - wifi.length,
      exp: avg(exps),
      weak: wifi.filter(c => c.signal != null && c.signal < -75).length,
      top
    };
  });

  uplinkOptions = computed(() => {
    const cl = this.data()?.clients || [];
    const used = new Map(cl.filter(c => c.uplinkMac).map(c => [c.uplinkMac, c.uplinkName || c.uplinkMac] as [string, string]));
    // Keep a pre-selected device (from ?uplink=) selectable even before its clients load.
    if (this.uplink() && !used.has(this.uplink())) used.set(this.uplink(), this.uplink());
    return [...used].sort((a, b) => a[1].localeCompare(b[1]));
  });

  kindOptions = computed(() => {
    const counts = new Map<string, { label: string; n: number }>();
    for (const c of this.data()?.clients || []) counts.set(c.kind, { label: c.kindLabel, n: (counts.get(c.kind)?.n || 0) + 1 });
    return [...counts].sort((a, b) => b[1].n - a[1].n);
  });

  private byType = (c: UnifiClient) => {
    const t = this.type();
    return !t || (t === 'wifi' ? !c.wired : t === 'wired' ? c.wired : c.guest);
  };

  rows = computed(() => {
    const cl = this.data()?.clients || [];
    const q = this.search().trim().toLowerCase();
    const up = this.uplink(), kind = this.kind(), dir = this.dir();
    const key: (c: UnifiClient) => string | number = {
      name: (c: UnifiClient) => c.name.toLowerCase(),
      conn: (c: UnifiClient) => (c.wired ? 'b' : 'a') + (c.ssid || ''),
      uplink: (c: UnifiClient) => (c.uplinkName || '').toLowerCase(),
      signal: (c: UnifiClient) => c.signal ?? -999,
      ip: (c: UnifiClient) => (c.ip || '').split('.').map(n => n.padStart(3, '0')).join('.'),
      exp: (c: UnifiClient) => c.experience ?? -1,
      data: (c: UnifiClient) => c.dataBytes,
      uptime: (c: UnifiClient) => c.uptime ?? 0
    }[this.sort()];
    return cl
      .filter(this.byType)
      .filter(c => !up || c.uplinkMac === up)
      .filter(c => !kind || c.kind === kind)
      .filter(c => !q || [c.name, c.kindLabel, c.hostname, c.vendor, c.ip, c.macDisplay, c.ssid, c.network, c.uplinkName].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir);
  });

  topRows = computed(() => {
    const u = this.topUsage();
    if (!u) return null;
    const top = u.clients.slice(0, 10);
    const max = top[0]?.total || 1;
    return top.map(c => ({ ...c, share: (c.total / max) * 100 }));
  });

  client = computed(() => {
    const mac = this.openMac();
    return mac ? this.data()?.clients.find(c => c.mac === mac) || null : null;
  });

  facts = computed(() => {
    const c = this.client();
    if (!c) return [];
    const rows: { k: string; v: string; mono?: boolean }[] = [
      { k: 'IP address', v: c.ip || '–', mono: true },
      { k: 'MAC address', v: c.macDisplay, mono: true },
      { k: 'Vendor', v: c.vendor || '–' },
      { k: 'Hostname', v: c.hostname || '–' },
      { k: 'Network', v: `${c.network || '–'}${c.vlan != null ? ` · VLAN ${c.vlan}` : ''}` }
    ];
    if (!c.wired) {
      rows.push(
        { k: 'Wi-Fi network', v: c.ssid || '–' },
        { k: 'Band / channel', v: `${c.band || '–'}${c.channel ? ` · Ch ${c.channel}` : ''}` },
        { k: 'Link speed', v: c.txRate ? `${fmt(c.txRate)} / ${fmt(c.rxRate)} Mbps` : '–' }
      );
    }
    rows.push(
      { k: 'Data used', v: bytes(c.dataBytes) },
      { k: 'Connected for', v: dur(c.uptime) },
      { k: 'First seen', v: c.firstSeen ? new Date(c.firstSeen).toLocaleDateString() : '–' }
    );
    return rows;
  });

  usageStats = computed(() => {
    const u = this.usage();
    if (!u) return null;
    const total = (rows: { down: number; up: number }[]) => sum(rows, r => r.down + r.up);
    const midnight = new Date().setHours(0, 0, 0, 0);
    return {
      today: bytes(total(u.hourly.filter(r => r.t >= midnight))),
      week: bytes(total(u.daily.filter(r => r.t >= Date.now() - 7 * 864e5))),
      month: bytes(total(u.daily))
    };
  });

  history = computed(() => {
    const logs = this.logs();
    const c = this.client();
    if (!logs || !c) return null;
    const to = Date.now(), from = to - 864e5;
    const own = logs.filter(l => l.event.startsWith('CLIENT_'));
    const connEvents = own.filter(l => l.conn);
    const firstEv = Math.min(...connEvents.map(l => l.t), to);
    // Zoom to the part of the day with activity (padded); no connect events at all means connected all day.
    const viewFrom = connEvents.length ? Math.max(from, Math.min(to - 2 * 36e5, firstEv - Math.max(15 * 6e4, (to - firstEv) * 0.08))) : from;
    const segs = buildTimeline(own, { online: true, from: viewFrom, to });
    return {
      from: viewFrom, to, segs, stats: timelineStats(segs),
      roams: logs.filter(l => l.event === 'CLIENT_ROAMED').length,
      anyConn: logs.some(l => l.conn), wired: c.wired
    };
  });

  constructor() {
    effect(() => this.renderUplinks());
    effect(() => this.renderSignal());
    effect(() => this.renderUsage());
  }

  ngOnInit() {
    const up = this.route.snapshot.queryParamMap.get('uplink');
    if (up) this.uplink.set(normMac(up));
    this.load();
    this.loadTopUsage();
    this.timers.push(
      setInterval(() => this.load(true), 30000),
      setInterval(() => this.loadTopUsage(true), 15 * 60000),
      setInterval(() => this.now.set(Date.now()), 5000)
    );
  }

  ngOnDestroy() {
    this.timers.forEach(t => clearInterval(t));
    if (this.slowTimer) clearTimeout(this.slowTimer);
    this.charts.destroyAll();
  }

  // ---------- Data ----------

  load(silent = false, done?: () => void) {
    if (!silent) this.loading.set(true);
    this.unifi.getClients().subscribe({
      next: res => { this.data.set(res); this.loadedAt.set(Date.now()); this.error.set(null); this.loading.set(false); done?.(); },
      error: err => {
        this.loading.set(false);
        if (!silent || !this.data()) this.error.set(`Couldn't load clients: ${errMsg(err)}`);
        done?.();
      }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => this.refreshing.set(false));
    this.loadTopUsage(true);
  }

  loadTopUsage(silent = false) {
    if (!silent) this.topUsageLoading.set(true);
    const days = this.usageDays();
    this.unifi.getUsage(days).subscribe({
      next: u => { if (days === this.usageDays()) { this.topUsage.set(u); this.topUsageError.set(null); this.topUsageLoading.set(false); } },
      error: err => { this.topUsageLoading.set(false); if (!silent || !this.topUsage()) this.topUsageError.set(`Couldn't load usage: ${errMsg(err)}`); }
    });
  }

  setUsageDays(d: number) {
    this.usageDays.set(d);
    this.topUsage.set(null);
    this.loadTopUsage();
  }

  setSort(key: SortKey) {
    if (this.sort() === key) this.dir.set(-this.dir());
    else this.dir.set(['data', 'uptime', 'signal', 'exp'].includes(key) ? -1 : 1);
    this.sort.set(key);
  }

  sortMark(key: SortKey) { return this.sort() === key ? (this.dir() > 0 ? ' (asc)' : ' (desc)') : ''; }
  ariaSort(key: SortKey) { return this.sort() === key ? (this.dir() > 0 ? 'ascending' : 'descending') : 'none'; }

  expColor(v: number | null) { return v == null ? '#e2e8f0' : v >= 80 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444'; }

  // ---------- Drawer ----------

  openClient(mac: string, e?: Event) {
    if (e && (e.target as HTMLElement).closest('a')) return;
    if (!this.data()?.clients.some(c => c.mac === mac)) return;
    this.openMac.set(mac);
    this.renaming.set(false);
    this.renameError.set(null);
    this.logs.set(null);
    this.logsError.set(null);
    this.logsSlow.set(false);
    this.usage.set(null);
    this.usageError.set(null);
    this.usageRange.set(30);
    this.loadUsage(mac);
    this.loadLogs(mac);
  }

  closeDrawer() {
    this.openMac.set(null);
    if (this.slowTimer) clearTimeout(this.slowTimer);
  }

  @HostListener('document:keydown.escape')
  onEsc() { if (this.openMac()) this.closeDrawer(); }

  loadLogs(mac: string) {
    this.logs.set(null);
    this.logsError.set(null);
    this.logsSlow.set(false);
    if (this.slowTimer) clearTimeout(this.slowTimer);
    // Hint on a slow UniFi event log; late answers for another client are ignored.
    this.slowTimer = setTimeout(() => { if (this.openMac() === mac) this.logsSlow.set(true); }, 4000);
    this.unifi.getLogs(mac).subscribe({
      next: res => { if (this.openMac() === mac) { clearTimeout(this.slowTimer); this.logs.set(res.logs || []); } },
      error: err => { if (this.openMac() === mac) { clearTimeout(this.slowTimer); this.logsError.set(errMsg(err)); } }
    });
  }

  private loadUsage(mac: string) {
    this.unifi.getClientUsage(mac).subscribe({
      next: u => { if (this.openMac() === mac) this.usage.set(u); },
      error: err => { if (this.openMac() === mac) this.usageError.set(errMsg(err)); }
    });
  }

  startRename(c: UnifiClient) {
    this.renameValue.set(c.alias || c.name);
    this.renameError.set(null);
    this.renaming.set(true);
  }

  saveRename(c: UnifiClient) {
    if (!this.canRename || this.renameSaving()) return;
    const name = this.renameValue().trim();
    this.renameSaving.set(true);
    this.unifi.setAlias(c.mac, name === c.unifiName ? '' : name).subscribe({
      next: () => {
        this.load(true, () => { this.renameSaving.set(false); this.renaming.set(false); });
      },
      error: err => { this.renameSaving.set(false); this.renameError.set(`Couldn't rename: ${errMsg(err)}`); }
    });
  }

  // ---------- Charts ----------

  private renderUplinks() {
    const d = this.data();
    const canvas = this.uplinksCanvas()?.nativeElement;
    if (!d || !canvas) return;
    this.type();
    const groups = new Map<string, { wifi: number; wired: number }>();
    for (const c of d.clients.filter(this.byType)) {
      const k = c.uplinkName || 'Unknown';
      const g = groups.get(k) || { wifi: 0, wired: 0 };
      if (c.wired) g.wired++; else g.wifi++;
      groups.set(k, g);
    }
    const top = [...groups].sort((a, b) => b[1].wifi + b[1].wired - (a[1].wifi + a[1].wired)).slice(0, 12);
    this.charts.upsert('uplinks', canvas, {
      type: 'bar',
      data: { labels: top.map(([k]) => k), datasets: [hbar('Wi-Fi', top.map(([, g]) => g.wifi), S1), hbar('Wired', top.map(([, g]) => g.wired), S2)] },
      options: hbarOptions('clients')
    });
  }

  private renderSignal() {
    const d = this.data();
    const canvas = this.signalCanvas()?.nativeElement;
    if (!d || !canvas) return;
    this.type();
    const buckets = ['Poor', 'Fair', 'Good', 'Excellent'];
    const counts = buckets.map(b => d.clients.filter(c => this.byType(c) && !c.wired && signalInfo(c.signal).label === b).length);
    const opts = baseOptions({ unit: 'clients', legend: false });
    opts.interaction = { mode: 'index', intersect: true };
    this.charts.upsert('signal', canvas, {
      type: 'bar',
      data: { labels: buckets, datasets: [{ label: 'Clients', data: counts, backgroundColor: S1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 40 }] },
      options: opts
    });
  }

  private renderUsage() {
    const u = this.usage();
    const canvas = this.usageCanvas()?.nativeElement;
    if (!u || !canvas) { if (!canvas) this.charts.destroy('usage'); return; }
    const hourly = this.usageRange() <= 2;
    const rows = hourly ? u.hourly : u.daily;
    const unit = Math.max(0, ...rows.map(r => r.down + r.up)) >= 1e9 ? 'GB' : 'MB';
    const div = unit === 'GB' ? 1e9 : 1e6;
    const ds = (label: string, key: 'down' | 'up', color: string) => ({
      label, data: rows.map(r => r[key] / div), backgroundColor: color, borderColor: '#fff', borderWidth: { top: 1 }, borderRadius: 2, borderSkipped: false
    });
    const opts = baseOptions({ stacked: true, unit, decimals: 1 });
    opts.scales.x.ticks.maxTicksLimit = 6;
    this.charts.upsert('usage', canvas, {
      type: 'bar',
      data: {
        labels: rows.map(r => (hourly ? timeLabel(r.t, 48) : new Date(r.t).toLocaleDateString([], { month: 'short', day: 'numeric' }))),
        datasets: [ds('Download', 'down', S1), ds('Upload', 'up', S2)]
      },
      options: opts
    });
  }

  // ---------- Export ----------

  exportChart(kind: ExportKind, title: string, canvas: HTMLCanvasElement) { exportCard(kind, title, { canvas }); }
  exportUsage(kind: ExportKind) { exportCard(kind, 'Top data users', { table: this.usageTable()?.nativeElement }); }
  exportClients(kind: ExportKind) { exportCard(kind, 'All clients', { table: this.clientsTable()?.nativeElement }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, 'Clients'); } finally { this.exporting.set(false); }
  }
}
