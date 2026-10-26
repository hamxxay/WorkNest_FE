import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  GwnClient, GwnClientDetail, GwnClientUsage, GwnDevice, GwnHistoryClient, GwnRange, GwnService, gwnErrorText
} from '../../../../services/gwn.service';
import { AuthService } from '../../../../services/auth.service';
import { ToastService } from '../../../../services/toast.service';
import {
  ChartBag, ExportKind, NET_SHARED, S1, S2, ago, baseOptions, bytes, dur, exportCard, exportPagePdf, fmt, hbar, hbarOptions, signalInfo
} from '../network-shared';
import { NetworkSwitch } from '../gwn-switch/gwn-switch';
import { GwnConfirm, bandLabel, clientName, gwnClientIcon, ms, rangeLabel } from '../gwn-shared/gwn-shared';

type SortKey = 'name' | 'conn' | 'ap' | 'signal' | 'ip' | 'down' | 'up' | 'total' | 'uptime';
type HistSortKey = 'name' | 'ip' | 'ssid' | 'total' | 'first' | 'last';
type BandFilter = '' | '2.4G' | '5G' | '6G' | 'wired' | 'blocked';

/** One row in the drawer: a live client, or a client from the history list (fewer fields). */
type DrawerClient = Partial<GwnClient> & { mac: string; name: string };

const HISTORY_DAYS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' }
];

@Component({
  selector: 'app-gwn-clients',
  standalone: true,
  imports: [FormsModule, RouterLink, ...NET_SHARED, NetworkSwitch, GwnConfirm],
  templateUrl: './gwn-clients.html',
  styleUrls: ['../network-shared.css', '../gwn-shared/gwn.css']
})
export class GwnClientsPage implements OnInit, OnDestroy {
  private gwn = inject(GwnService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

  page = viewChild<ElementRef<HTMLElement>>('page');
  apsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cAps');
  signalCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cSignal');
  usageCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cUsage');
  clientsTable = viewChild<ElementRef<HTMLTableElement>>('clientsTable');
  historyTable = viewChild<ElementRef<HTMLTableElement>>('historyTable');

  private charts = new ChartBag();
  private timers: ReturnType<typeof setInterval>[] = [];

  /** Admins rename; only super admins block / unblock. Sales executives read only. */
  readonly canRename = this.auth.hasRole('admin') || this.auth.hasRole('super_admin');
  readonly isSuperAdmin = this.auth.hasRole('super_admin');

  data = signal<GwnClient[] | null>(null);
  devices = signal<GwnDevice[]>([]);
  loadedAt = signal<number | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  unavailable = signal<string | null>(null);
  now = signal(Date.now());

  tab = signal<'live' | 'history'>('live');

  search = signal('');
  band = signal<BandFilter>('');
  ap = signal('');
  ssid = signal('');
  sort = signal<SortKey>('total');
  dir = signal(-1);

  // History
  historyDays = signal(1);
  history = signal<GwnHistoryClient[] | null>(null);
  historyLoading = signal(false);
  historyError = signal<string | null>(null);
  hSearch = signal('');
  hSort = signal<HistSortKey>('last');
  hDir = signal(-1);
  readonly historyDaysOptions = HISTORY_DAYS;

  // Drawer
  openMac = signal<string | null>(null);
  drawerFallback = signal<DrawerClient | null>(null);
  detail = signal<GwnClientDetail | null>(null);
  usage = signal<GwnClientUsage | null>(null);
  usageError = signal<string | null>(null);
  usageRange = signal<GwnRange>('1d');
  renaming = signal(false);
  renameValue = signal('');
  renameSaving = signal(false);
  renameError = signal<string | null>(null);

  // Block / unblock
  confirmBlock = signal<{ mac: string; name: string; block: boolean } | null>(null);
  blocking = signal(false);

  readonly fmt = fmt;
  readonly bytes = bytes;
  readonly dur = dur;
  readonly bandLabel = bandLabel;
  readonly clientName = clientName;
  readonly gwnClientIcon = gwnClientIcon;

  updatedText = computed(() => { this.now(); const t = this.loadedAt(); return t ? `Updated ${ago(t)}` : ''; });

  private apNames = computed(() => new Map(this.devices().map(d => [d.mac, d.name] as [string, string])));
  apName(mac: string | null | undefined) { return mac ? this.apNames().get(mac) || mac : '–'; }

  live = computed(() => (this.data() || []).filter(c => c.online !== false));

  stats = computed(() => {
    const cl = this.data();
    if (!cl) return null;
    const on = this.live();
    const wifi = on.filter(c => !c.wired);
    const top = [...on].sort((a, b) => b.total - a.total)[0] as GwnClient | undefined;
    const bandCount = (b: string) => wifi.filter(c => (c.band || '').toUpperCase() === b).length;
    return {
      total: on.length,
      wifi: wifi.length,
      b24: bandCount('2.4G'), b5: bandCount('5G'), b6: bandCount('6G'),
      ssids: [...new Set(wifi.map(c => c.ssid).filter(Boolean))].join(', ') || '–',
      wired: on.length - wifi.length,
      weak: wifi.filter(c => c.rssi != null && c.rssi < -75).length,
      blocked: cl.filter(c => c.blocked).length,
      total24: on.reduce((a, c) => a + (c.total || 0), 0),
      top
    };
  });

  apOptions = computed(() => {
    const used = new Map<string, string>();
    for (const c of this.live()) if (c.apMac) used.set(c.apMac, this.apName(c.apMac));
    if (this.ap() && !used.has(this.ap())) used.set(this.ap(), this.apName(this.ap()));
    return [...used].sort((a, b) => a[1].localeCompare(b[1]));
  });

  ssidOptions = computed(() => [...new Set(this.live().map(c => c.ssid).filter((s): s is string => !!s))].sort());

  private byBand = (c: GwnClient) => {
    const b = this.band();
    if (!b) return true;
    if (b === 'blocked') return !!c.blocked;
    if (b === 'wired') return c.wired;
    return !c.wired && (c.band || '').toUpperCase() === b;
  };

  rows = computed(() => {
    const all = this.band() === 'blocked' ? (this.data() || []) : this.live();
    const q = this.search().trim().toLowerCase();
    const ap = this.ap(), ssid = this.ssid(), dir = this.dir();
    const key: (c: GwnClient) => string | number = {
      name: (c: GwnClient) => clientName(c).toLowerCase(),
      conn: (c: GwnClient) => (c.wired ? 'b' : 'a') + (c.ssid || '') + (c.band || ''),
      ap: (c: GwnClient) => this.apName(c.apMac).toLowerCase(),
      signal: (c: GwnClient) => c.rssi ?? -999,
      ip: (c: GwnClient) => (c.ip || '').split('.').map(n => n.padStart(3, '0')).join('.'),
      down: (c: GwnClient) => c.download || 0,
      up: (c: GwnClient) => c.upload || 0,
      total: (c: GwnClient) => c.total || 0,
      uptime: (c: GwnClient) => c.connectedSeconds ?? 0
    }[this.sort()];
    return all
      .filter(this.byBand)
      .filter(c => !ap || c.apMac === ap)
      .filter(c => !ssid || c.ssid === ssid)
      .filter(c => !q || [clientName(c), c.name, c.host, c.manufacturer, c.os, c.ip, c.mac, c.ssid, this.apName(c.apMac)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir);
  });

  historyRows = computed(() => {
    const list = this.history() || [];
    const q = this.hSearch().trim().toLowerCase();
    const dir = this.hDir();
    const key: (c: GwnHistoryClient) => string | number = {
      name: (c: GwnHistoryClient) => clientName({ ...c, host: null }).toLowerCase(),
      ip: (c: GwnHistoryClient) => (c.ip || '').split('.').map(n => n.padStart(3, '0')).join('.'),
      ssid: (c: GwnHistoryClient) => (c.ssid || '').toLowerCase(),
      total: (c: GwnHistoryClient) => c.total || 0,
      first: (c: GwnHistoryClient) => ms(c.firstSeen) ?? 0,
      last: (c: GwnHistoryClient) => ms(c.lastSeen) ?? 0
    }[this.hSort()];
    return list
      .filter(c => !q || [c.alias, c.name, c.ip, c.mac, c.ssid].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir);
  });

  client = computed<DrawerClient | null>(() => {
    const mac = this.openMac();
    if (!mac) return null;
    return this.data()?.find(c => c.mac === mac) || this.detail() || this.drawerFallback();
  });

  facts = computed(() => {
    const c = this.client();
    if (!c) return [];
    const d = this.detail();
    const rows: { k: string; v: string; mono?: boolean }[] = [
      { k: 'IP address', v: c.ip || '–', mono: true },
      { k: 'MAC address', v: c.mac, mono: true },
      { k: 'Manufacturer', v: c.manufacturer || d?.manufacturer || '–' },
      { k: 'Operating system', v: c.os || d?.os || '–' },
      { k: 'Hostname', v: c.host || d?.host || '–' }
    ];
    if (!c.wired) {
      rows.push(
        { k: 'Wi-Fi network', v: c.ssid || '–' },
        { k: 'Band / channel', v: `${bandLabel(c.band)}${c.channel ? ` · Ch ${c.channel}` : ''}` }
      );
    }
    rows.push(
      { k: 'Downloaded', v: bytes(c.download) },
      { k: 'Uploaded', v: bytes(c.upload) },
      { k: 'Connected for', v: c.connectedSeconds != null ? dur(c.connectedSeconds) : c.connectedFor || '–' },
      { k: 'First seen', v: c.firstSeen ? new Date(c.firstSeen).toLocaleString() : '–' }
    );
    return rows;
  });

  usageStats = computed(() => {
    const u = this.usage();
    return u ? { down: bytes(u.downloadTotal), up: bytes(u.uploadTotal), total: bytes((u.downloadTotal || 0) + (u.uploadTotal || 0)) } : null;
  });

  constructor() {
    effect(() => this.renderAps());
    effect(() => this.renderSignal());
    effect(() => this.renderUsage());
    effect(() => { this.gwn.net(); untracked(() => this.reloadAll()); });
  }

  ngOnInit() {
    const ap = this.route.snapshot.queryParamMap.get('ap');
    if (ap) this.ap.set(ap.toUpperCase());
    this.timers.push(
      setInterval(() => this.load(true), 30000),
      setInterval(() => this.now.set(Date.now()), 5000)
    );
  }

  ngOnDestroy() {
    this.timers.forEach(t => clearInterval(t));
    this.charts.destroyAll();
  }

  // ---------- Data ----------

  private reloadAll() {
    this.data.set(null);
    this.history.set(null);
    this.closeDrawer();
    this.load();
    this.gwn.getDevices().subscribe({ next: d => this.devices.set(d), error: () => { /* AP names fall back to MACs */ } });
    if (this.tab() === 'history') this.loadHistory();
  }

  load(silent = false, done?: () => void) {
    if (!silent) this.loading.set(true);
    this.gwn.getClients().subscribe({
      next: res => { this.data.set(res); this.loadedAt.set(Date.now()); this.error.set(null); this.unavailable.set(null); this.loading.set(false); done?.(); },
      error: err => {
        this.loading.set(false);
        if (err?.unavailable) this.unavailable.set(gwnErrorText(err));
        else if (!silent || !this.data()) this.error.set(`Couldn't load clients: ${gwnErrorText(err)}`);
        done?.();
      }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => this.refreshing.set(false));
    if (this.tab() === 'history') this.loadHistory();
  }

  setTab(t: 'live' | 'history') {
    this.tab.set(t);
    if (t === 'history' && !this.history() && !this.historyLoading()) this.loadHistory();
  }

  loadHistory() {
    const days = this.historyDays();
    const to = Date.now();
    const from = days === 1 ? new Date().setHours(0, 0, 0, 0) : to - days * 864e5;
    this.historyLoading.set(true);
    this.historyError.set(null);
    this.gwn.getClientHistory(from, to).subscribe({
      next: list => { if (days === this.historyDays()) { this.history.set(list); this.historyLoading.set(false); } },
      error: err => { if (days === this.historyDays()) { this.historyLoading.set(false); this.historyError.set(`Couldn't load the history: ${gwnErrorText(err)}`); } }
    });
  }

  setHistoryDays(d: number) {
    if (d === this.historyDays()) return;
    this.historyDays.set(d);
    this.history.set(null);
    this.loadHistory();
  }

  setSort(key: SortKey) {
    if (this.sort() === key) this.dir.set(-this.dir());
    else this.dir.set(['down', 'up', 'total', 'uptime', 'signal'].includes(key) ? -1 : 1);
    this.sort.set(key);
  }
  sortMark(key: SortKey) { return this.sort() === key ? (this.dir() > 0 ? ' (asc)' : ' (desc)') : ''; }
  ariaSort(key: SortKey) { return this.sort() === key ? (this.dir() > 0 ? 'ascending' : 'descending') : 'none'; }

  setHSort(key: HistSortKey) {
    if (this.hSort() === key) this.hDir.set(-this.hDir());
    else this.hDir.set(['total', 'first', 'last'].includes(key) ? -1 : 1);
    this.hSort.set(key);
  }
  hSortMark(key: HistSortKey) { return this.hSort() === key ? (this.hDir() > 0 ? ' (asc)' : ' (desc)') : ''; }
  hAriaSort(key: HistSortKey) { return this.hSort() === key ? (this.hDir() > 0 ? 'ascending' : 'descending') : 'none'; }

  when(t: string | null | undefined) { return t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–'; }

  signalClass(rssi: number | null | undefined) {
    const b = signalInfo(rssi).bars;
    return b >= 3 ? 'good' : b === 2 ? 'warn' : b === 1 ? 'bad' : 'mute';
  }

  // ---------- Drawer ----------

  openClient(c: DrawerClient, e?: Event) {
    if (e && (e.target as HTMLElement).closest('a')) return;
    const mac = c.mac;
    this.openMac.set(mac);
    this.drawerFallback.set(c);
    this.detail.set(null);
    this.renaming.set(false);
    this.renameError.set(null);
    this.usage.set(null);
    this.usageError.set(null);
    this.gwn.getClient(mac).subscribe({ next: d => { if (this.openMac() === mac) this.detail.set(d); }, error: () => { /* the list row is enough */ } });
    this.loadUsage();
  }

  closeDrawer() {
    this.openMac.set(null);
    this.confirmBlock.set(null);
    this.charts.destroy('usage');
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.confirmBlock()) return; // the dialog closes itself first
    if (this.openMac()) this.closeDrawer();
  }

  setUsageRange(r: GwnRange) {
    if (r === this.usageRange()) return;
    this.usageRange.set(r);
    this.loadUsage();
  }

  loadUsage() {
    const mac = this.openMac();
    if (!mac) return;
    const range = this.usageRange();
    this.usage.set(null);
    this.usageError.set(null);
    this.gwn.getClientUsage(mac, range).subscribe({
      next: u => { if (this.openMac() === mac && range === this.usageRange()) this.usage.set(u); },
      error: err => { if (this.openMac() === mac) this.usageError.set(gwnErrorText(err)); }
    });
  }

  startRename(c: DrawerClient) {
    this.renameValue.set(c.alias || c.name);
    this.renameError.set(null);
    this.renaming.set(true);
  }

  saveRename(c: DrawerClient) {
    if (!this.canRename || this.renameSaving()) return;
    const name = this.renameValue().trim();
    this.renameSaving.set(true);
    this.gwn.setAlias(c.mac, name === c.name ? '' : name).subscribe({
      next: r => {
        this.toast.success(r.alias ? `Renamed to ${r.alias}.` : 'Custom name removed.');
        const fb = this.drawerFallback();
        if (fb?.mac === c.mac) this.drawerFallback.set({ ...fb, alias: r.alias });
        this.load(true, () => { this.renameSaving.set(false); this.renaming.set(false); });
        if (this.history()) this.loadHistory();
      },
      error: err => { this.renameSaving.set(false); this.renameError.set(`Couldn't rename: ${gwnErrorText(err)}`); }
    });
  }

  askBlock(c: DrawerClient) {
    if (!this.isSuperAdmin) return;
    this.confirmBlock.set({ mac: c.mac, name: clientName({ alias: c.alias ?? null, name: c.name, host: c.host ?? null, mac: c.mac }), block: !c.blocked });
  }

  doBlock() {
    const req = this.confirmBlock();
    if (!req || this.blocking()) return;
    this.blocking.set(true);
    this.gwn.blockClient(req.mac, req.block).subscribe({
      next: r => {
        this.blocking.set(false);
        this.confirmBlock.set(null);
        this.toast.success(r.blocked ? `${req.name} is blocked from the network.` : `${req.name} is unblocked.`);
        const fb = this.drawerFallback();
        if (fb?.mac === req.mac) this.drawerFallback.set({ ...fb, blocked: r.blocked });
        this.load(true);
      },
      error: err => {
        this.blocking.set(false);
        this.toast.error(`Couldn't ${req.block ? 'block' : 'unblock'} ${req.name}: ${gwnErrorText(err)}`);
      }
    });
  }

  // ---------- Charts ----------

  private renderAps() {
    const d = this.data();
    const canvas = this.apsCanvas()?.nativeElement;
    if (!d || !canvas) return;
    this.band();
    const groups = new Map<string, { b24: number; b5: number; other: number }>();
    for (const c of this.live().filter(x => !x.wired && this.byBand(x))) {
      const k = this.apName(c.apMac);
      const g = groups.get(k) || { b24: 0, b5: 0, other: 0 };
      const b = (c.band || '').toUpperCase();
      if (b === '2.4G') g.b24++; else if (b === '5G') g.b5++; else g.other++;
      groups.set(k, g);
    }
    const top = [...groups].sort((a, b) => b[1].b24 + b[1].b5 + b[1].other - (a[1].b24 + a[1].b5 + a[1].other)).slice(0, 12);
    const datasets = [hbar('2.4 GHz', top.map(([, g]) => g.b24), S1), hbar('5 GHz', top.map(([, g]) => g.b5), S2)];
    if (top.some(([, g]) => g.other)) datasets.push(hbar('6 GHz / other', top.map(([, g]) => g.other), '#f59e0b'));
    this.charts.upsert('aps', canvas, { type: 'bar', data: { labels: top.map(([k]) => k), datasets }, options: hbarOptions('clients') });
  }

  private renderSignal() {
    const d = this.data();
    const canvas = this.signalCanvas()?.nativeElement;
    if (!d || !canvas) return;
    this.band();
    const buckets = ['Poor', 'Fair', 'Good', 'Excellent'];
    const colors = ['#ef4444', '#f59e0b', '#10b981', '#0d9488'];
    const counts = buckets.map(b => this.live().filter(c => this.byBand(c) && !c.wired && signalInfo(c.rssi).label === b).length);
    const opts = baseOptions({ unit: 'clients', legend: false });
    opts.interaction = { mode: 'index', intersect: true };
    this.charts.upsert('signal', canvas, {
      type: 'bar',
      data: { labels: buckets, datasets: [{ label: 'Clients', data: counts, backgroundColor: colors, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 40 }] },
      options: opts
    });
  }

  private renderUsage() {
    const u = this.usage();
    const canvas = this.usageCanvas()?.nativeElement;
    if (!u || !canvas) { if (!canvas) this.charts.destroy('usage'); return; }
    const range = this.usageRange();
    const max = Math.max(0, ...u.times.map((_, i) => (u.download[i] || 0) + (u.upload[i] || 0)));
    const unit = max >= 1e9 ? 'GB' : max >= 1e6 ? 'MB' : 'KB';
    const div = unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : 1e3;
    const ds = (label: string, vals: number[], color: string) => ({
      label, data: u.times.map((_, i) => (vals[i] || 0) / div), backgroundColor: color, borderColor: '#fff', borderWidth: { top: 1 }, borderRadius: 2, borderSkipped: false
    });
    const opts = baseOptions({ stacked: true, unit, decimals: 1 });
    opts.scales.x.ticks.maxTicksLimit = 6;
    this.charts.upsert('usage', canvas, {
      type: 'bar',
      data: { labels: u.times.map(t => rangeLabel(t, range)), datasets: [ds('Download', u.download, S1), ds('Upload', u.upload, S2)] },
      options: opts
    });
  }

  // ---------- Export ----------

  exportChart(kind: ExportKind, title: string, canvas: HTMLCanvasElement) { exportCard(kind, `F-7 ${title}`, { canvas }); }
  exportClients(kind: ExportKind) { exportCard(kind, 'F-7 clients', { table: this.clientsTable()?.nativeElement }); }
  exportHistory(kind: ExportKind) { exportCard(kind, 'F-7 client history', { table: this.historyTable()?.nativeElement }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, 'F-7 Clients'); } finally { this.exporting.set(false); }
  }
}
