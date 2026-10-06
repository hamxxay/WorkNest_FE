import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { UnifiService } from '../../../../services/unifi.service';
import { AuthService } from '../../../../services/auth.service';
import {
  UnifiClientsResponse, UnifiDeviceHistory, UnifiIspSeries, UnifiSiteWan, UnifiSummary, UnifiTopology, UnifiTopologyNode,
  UnifiWanLive, UnifiWansResponse
} from '../../../../models/unifi.model';
import {
  CRIT, ChartBag, ExportKind, MUTED, NET_SHARED, S1, S2, S3, SparkPoint, ago, avg, baseOptions, bucketPoints, bytes, clientIcon,
  errMsg, exportCard, exportPagePdf, fmt, glow, hbar, hbarOptions, line, linkText, mbpsText, pct, speedParts, sum, thin, timeLabel, typeIcon
} from '../network-shared';

interface MapNode { node: UnifiTopologyNode; children: MapNode[] }
interface TopItem { name: string; sub: string; value: string; frac: number; icon: string; link?: string[]; color?: string }

const MODE_TEXT: Record<string, string> = { failover_only: 'Failover', failover: 'Failover', weighted: 'Load balancing', distributed: 'Load balancing' };

@Component({
  selector: 'app-network-overview',
  standalone: true,
  imports: [FormsModule, RouterLink, NgTemplateOutlet, ...NET_SHARED],
  templateUrl: './network-overview.html',
  styleUrls: ['../network-shared.css', './network-overview.css']
})
export class NetworkOverview implements OnInit, OnDestroy {
  private unifi = inject(UnifiService);
  private auth = inject(AuthService);

  page = viewChild<ElementRef<HTMLElement>>('page');
  wanCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cWan');
  clientsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cClients');
  latencyCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cLatency');
  typesCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cTypes');
  sitesTable = viewChild<ElementRef<HTMLTableElement>>('sitesTable');

  private charts = new ChartBag();
  private timers: ReturnType<typeof setInterval>[] = [];
  private pollTimer?: ReturnType<typeof setTimeout>;

  readonly isAdmin = this.auth.hasRole('admin') || this.auth.hasRole('super_admin');

  data = signal<UnifiSummary | null>(null);
  wan = signal<UnifiDeviceHistory | null>(null);
  wanLive = signal<UnifiWansResponse | null>(null);
  topo = signal<UnifiTopology | null>(null);
  clientsData = signal<UnifiClientsResponse | null>(null);
  extrasLoaded = signal(false);
  extrasError = signal<string | null>(null);

  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  now = signal(Date.now());

  site = signal('');
  range = signal(24);

  speedtest = signal<{ wan: string; elapsed: number } | null>(null);
  speedtestNote = signal<Record<string, string>>({});

  readonly fmt = fmt;
  readonly pct = pct;
  readonly typeIcon = typeIcon;
  readonly linkText = linkText;
  readonly ago = ago;

  updatedText = computed(() => { this.now(); const d = this.data(); return d?.updatedAt ? `Updated ${ago(d.updatedAt)}` : ''; });
  rangeLabel = computed(() => (this.range() > 24 ? '7 days' : `${this.range()}h`));

  selected = computed(() => {
    const d = this.data();
    if (!d) return null;
    const site = this.site();
    if (!site) return { sites: d.sites, devices: d.devices, isp: d.isp };
    const sites = d.sites.filter(s => s.id === site);
    const hostIds = new Set(sites.map(s => s.hostId));
    return { sites, devices: d.devices.filter(x => hostIds.has(x.hostId)), isp: d.isp.filter(i => i.siteId === site) };
  });

  subtitle = computed(() => {
    const d = this.data(), sel = this.selected();
    if (!d || !sel) return 'Live view of the UniFi network.';
    const s0 = sel.sites[0];
    return sel.sites.length === 1
      ? [s0.name, s0.console !== s0.name ? s0.console : '', s0.gateway, s0.consoleVersion && `UniFi OS ${s0.consoleVersion}`].filter(Boolean).join(' · ')
      : `${d.sites.length} sites`;
  });

  health = computed(() => {
    const d = this.data();
    if (!d) return null;
    const site = d.sites.find(s => s.id === this.site());
    const list = site ? d.alerts.filter(a => [site.name, site.console].includes(a.where) || a.level === 'warning') : d.alerts;
    const worst = list.some(a => a.level === 'critical' || a.level === 'serious') ? 'bad' : list.length ? 'warn' : 'ok';
    return {
      worst, list,
      title: worst === 'ok' ? 'All systems operational' : `${list.length} issue${list.length > 1 ? 's' : ''} need${list.length > 1 ? '' : 's'} attention`,
      sub: worst === 'ok' ? 'All devices online and every internet connection is up.' : 'Review the items below.'
    };
  });

  private inRange(t: string | number) { return new Date(t).getTime() >= Date.now() - this.range() * 36e5; }

  tiles = computed(() => {
    const d = this.data(), sel = this.selected();
    if (!d || !sel) return null;
    const { sites, isp } = sel;
    const devices = sel.devices.filter(x => !x.placeholder);
    const wifi = sum(sites, s => s.wifiClients), wired = sum(sites, s => s.wiredClients), guest = sum(sites, s => s.guestClients);
    const total = wifi + wired + guest;
    const online = devices.filter(x => x.status === 'online').length;
    const wans = sites.flatMap(s => s.wans);
    const uptimes = sites.map(s => s.wanUptime).filter((v): v is number => v != null);
    const latPts = isp.flatMap(i => i.points.filter(p => p.latency != null && this.inRange(p.t)));
    const latNow = isp.map(i => i.points[i.points.length - 1]?.latency).filter((v): v is number => v != null);
    const hist = d.history.filter(h => this.inRange(h.t));
    const wanPts = (this.wan()?.points || []).filter(p => this.inRange(p.t));
    const lastWan = wanPts[wanPts.length - 1];
    const share = (v: number) => (total ? (v / total) * 100 : 0);
    return {
      total, wifi, wired, guest, wifiPct: share(wifi), wiredPct: share(wired), guestPct: share(guest),
      clientSpark: bucketPoints(hist.map(h => ({ t: Date.parse(h.t), v: h.wifi + h.wired + h.guest }))),
      online, devices: devices.length, placeholders: sel.devices.length - devices.length,
      lastWan, wanSpark: bucketPoints(wanPts.map(p => ({ t: p.t, v: p.down }))),
      wansUp: wans.filter(w => w.up).length, wans: wans.length, minUptime: uptimes.length ? Math.min(...uptimes) : null,
      latNow: latNow.length ? Math.max(...latNow) : null,
      latAvg: latPts.length ? sum(latPts, p => p.latency) / latPts.length : null,
      latSpark: bucketPoints((isp[0]?.points || []).filter(p => this.inRange(p.t)).map(p => ({ t: Date.parse(p.t), v: p.latency }))),
      updates: devices.filter(x => x.updateAvailable).length
    };
  });

  readonly clientFmt = (v: number) => `${fmt(v)} clients`;
  readonly msFmt = (v: number) => `${fmt(v)} ms`;
  readonly mbpsFmt = mbpsText;
  readonly downFmt = (v: number) => `Down ${mbpsText(v)}`;

  wanMode = computed(() => {
    const sel = this.selected();
    if (!sel) return '';
    const modes = [...new Set(sel.sites.map(s => s.loadBalancing.toLowerCase()).filter(Boolean))];
    return modes.length ? `Mode: ${modes.map(m => MODE_TEXT[m] || m.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())).join(', ')}` : '';
  });

  wanCards = computed(() => {
    const sel = this.selected();
    if (!sel) return [];
    const multi = sel.sites.length > 1;
    const liveList = this.wanLive()?.wans;
    return sel.sites.flatMap(s => s.wans.map(w => {
      const live = liveList?.find(x => x.key === w.label) || null;
      const hist = (live?.history || []).filter(p => p.down != null);
      const peak = hist.length ? Math.max(...hist.map(p => p.down as number)) : null;
      return {
        w, live, siteName: multi ? s.name : '',
        role: w.priority === 1 ? 'Primary' : w.priority ? `Backup ${w.priority - 1}` : '',
        down: speedParts(live?.downRate), up: speedParts(live?.upRate),
        downCap: this.capacityNote(live, 'down'), upCap: this.capacityNote(live, 'up'),
        spark: bucketPoints(hist.map(p => ({ t: p.t, v: p.down })), 48) as SparkPoint[],
        peak: peak == null ? '–' : `${fmt(peak, peak < 10 ? 1 : 0)} Mbps`
      };
    }));
  });

  wanStats = computed(() => {
    const pts = thin((this.wan()?.points || []).filter(p => this.inRange(p.t)));
    const downs = pts.map(p => p.down).filter((v): v is number => v != null);
    const ups = pts.map(p => p.up).filter((v): v is number => v != null);
    return downs.length ? { avgDown: avg(downs), peakDown: Math.max(...downs), avgUp: avg(ups), peakUp: ups.length ? Math.max(...ups) : null } : null;
  });

  latInfo = computed(() => {
    const isp = this.selected()?.isp[0];
    const pts = isp ? thin(isp.points.filter(p => this.inRange(p.t))) : [];
    const lat = pts.map(p => p.latency).filter((v): v is number => v != null);
    return {
      note: `${isp?.points[isp.points.length - 1]?.isp || 'Primary WAN'} · 5-minute intervals${this.range() > 24 ? ' · last 24h available' : ''}`,
      stats: lat.length ? {
        avg: avg(lat), peak: Math.max(...pts.map(p => p.maxLatency ?? p.latency ?? 0)), loss: Math.max(...pts.map(p => p.loss ?? 0))
      } : null
    };
  });

  mapRoot = computed<{ root: UnifiTopologyNode; branches: MapNode[] } | null>(() => {
    const nodes = this.topo()?.nodes;
    if (!nodes) return null;
    const kids = (mac: string) => nodes.filter(n => n.uplinkMac === mac && n.mac !== mac)
      .sort((a, b) => Number(a.type === 'Access point') - Number(b.type === 'Access point') || a.name.localeCompare(b.name));
    const root = nodes.find(n => !n.uplinkMac) || nodes.find(n => n.type === 'Console / Gateway');
    if (!root) return null;
    const tree = (n: UnifiTopologyNode, depth: number): MapNode => ({ node: n, children: depth > 6 ? [] : kids(n.mac).map(k => tree(k, depth + 1)) });
    return { root, branches: kids(root.mac).map(b => tree(b, 0)) };
  });

  tops = computed(() => {
    const cl = this.clientsData()?.clients;
    if (!cl) return null;
    const byData = [...cl].sort((a, b) => b.dataBytes - a.dataBytes).slice(0, 5);
    const maxData = byData[0]?.dataBytes || 1;
    const aps = new Map<string, { name: string; mac: string; n: number }>();
    for (const c of cl.filter(x => !x.wired)) aps.set(c.uplinkMac, { name: c.uplinkName, mac: c.uplinkMac, n: (aps.get(c.uplinkMac)?.n || 0) + 1 });
    const busiest = [...aps.values()].sort((a, b) => b.n - a.n).slice(0, 5);
    const maxN = busiest[0]?.n || 1;
    const weak = cl.filter(c => !c.wired && c.signal != null && c.signal < -70).sort((a, b) => (a.signal as number) - (b.signal as number)).slice(0, 5);
    return {
      data: byData.map<TopItem>(c => ({ name: c.name, sub: `${c.kindLabel} · ${c.wired ? 'Wired' : c.uplinkName}`, value: bytes(c.dataBytes), frac: c.dataBytes / maxData, icon: clientIcon(c.kind) })),
      aps: busiest.map<TopItem>(a => ({ name: a.name, sub: 'Access point', value: `${a.n}`, frac: a.n / maxN, icon: 'ap', link: a.mac ? ['/admin/network/device', a.mac] : undefined })),
      weak: weak.map<TopItem>(c => ({
        name: c.name, sub: `on ${c.uplinkName}`, value: `${c.signal} dBm`, frac: Math.min(1, ((c.signal as number) + 95) / 45), icon: clientIcon(c.kind),
        color: (c.signal as number) < -75 ? CRIT : '#b45309'
      }))
    };
  });

  constructor() {
    effect(() => this.renderWanChart());
    effect(() => this.renderClientsChart());
    effect(() => this.renderLatencyChart());
    effect(() => this.renderTypesChart());
  }

  ngOnInit() {
    this.load();
    this.loadExtras();
    this.loadWans();
    this.timers.push(
      setInterval(() => this.load(true), 60000),
      setInterval(() => this.loadWans(), 30000),
      setInterval(() => this.loadExtras(), 60000),
      setInterval(() => this.now.set(Date.now()), 5000)
    );
  }

  ngOnDestroy() {
    this.timers.forEach(t => clearInterval(t));
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.charts.destroyAll();
  }

  // ---------- Data ----------

  load(silent = false) {
    if (!silent) this.loading.set(true);
    this.unifi.getSummary().subscribe({
      next: res => { this.data.set(res); this.error.set(null); this.loading.set(false); },
      error: err => {
        this.loading.set(false);
        if (!silent || !this.data()) this.error.set(`Network dashboard not reachable: ${errMsg(err)}`);
      }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.unifi.refresh().subscribe({
      next: res => { this.data.set(res); this.error.set(null); this.refreshing.set(false); this.now.set(Date.now()); },
      error: err => { this.error.set(`Couldn't refresh: ${errMsg(err)}`); this.refreshing.set(false); }
    });
    this.loadWans();
    this.loadExtras();
  }

  loadWans() {
    this.unifi.getWans().subscribe({
      next: w => this.wanLive.set(w),
      error: () => { if (!this.wanLive()) this.wanLive.set({ wans: [] }); }
    });
  }

  loadExtras() {
    const range = this.range() > 24 ? 168 : 24;
    let pending = 3;
    const errors: string[] = [];
    const done = (label?: string, err?: unknown) => {
      if (label) errors.push(`${label}: ${errMsg(err)}`);
      if (--pending === 0) { this.extrasLoaded.set(true); this.extrasError.set(errors.length ? errors.join(' · ') : null); }
    };
    this.unifi.getWanTraffic(range).subscribe({ next: w => { this.wan.set(w); done(); }, error: e => done('Internet traffic', e) });
    this.unifi.getTopology().subscribe({ next: t => { this.topo.set(t); done(); }, error: e => done('Network map', e) });
    this.unifi.getClients().subscribe({ next: c => { this.clientsData.set(c); done(); }, error: e => done('Clients', e) });
  }

  setRange(r: number) {
    const before = this.range() > 24;
    this.range.set(r);
    if (before !== r > 24) this.loadExtras();
  }

  // ---------- Internet connection cards ----------

  /** "7% of 292 Mbps": live use compared with the line's last speed test. */
  private capacityNote(live: UnifiWanLive | null, dir: 'down' | 'up'): string {
    const cap = live?.speedtest?.[dir];
    const r = dir === 'down' ? live?.downRate : live?.upRate;
    if (!cap || r == null) return '';
    const used = ((r * 8) / 1e6 / cap) * 100;
    return `${used < 1 ? '<1' : fmt(used)}% of ${fmt(cap)} Mbps`;
  }

  testAge(t: number) {
    const days = Math.floor((Date.now() - t) / 864e5);
    return days < 1 ? ago(t) : days === 1 ? 'yesterday' : `${days} days ago`;
  }

  runSpeedtest(w: UnifiSiteWan) {
    if (this.speedtest() || !this.isAdmin) return;
    const key = w.label;
    const ok = confirm(`Run a speed test on ${key}?\n\nIt uses the full bandwidth of this line for about 20–30 seconds, so people using it may notice a short slowdown.`);
    if (!ok) return;
    this.setNote(key, null);
    this.unifi.startSpeedtest(key).subscribe({
      next: () => { this.speedtest.set({ wan: key, elapsed: 0 }); this.pollSpeedtest(); },
      error: err => this.setNote(key, `Couldn't start the test: ${errMsg(err)}`)
    });
  }

  private setNote(key: string, text: string | null) {
    const n = { ...this.speedtestNote() };
    if (text) n[key] = text; else delete n[key];
    this.speedtestNote.set(n);
  }

  private pollSpeedtest() {
    const run = this.speedtest();
    if (!run) return;
    this.unifi.getSpeedtestStatus().subscribe({
      next: st => {
        if (st.running) {
          this.speedtest.set({ wan: run.wan, elapsed: st.elapsed || 0 });
          this.pollTimer = setTimeout(() => this.pollSpeedtest(), 3000);
          return;
        }
        this.speedtest.set(null);
        if (st.timedOut) this.setNote(run.wan, 'The test took too long and was stopped. Try again in a minute.');
        else if (st.result?.interface) {
          const w = this.wanLive()?.wans.find(x => x.key === run.wan);
          if (w && w.ifname !== st.result.interface) {
            this.setNote(run.wan, `UniFi ran the test on the primary line instead (${st.result.interface}). This UniFi version may only test the primary WAN.`);
          }
        }
        this.loadWans();
      },
      error: err => {
        this.speedtest.set(null);
        this.setNote(run.wan, `Lost track of the test: ${errMsg(err)}`);
        this.loadWans();
      }
    });
  }

  // ---------- Map ----------

  nodeMeta(n: UnifiTopologyNode): string {
    if (n.virtual) return 'Not managed by UniFi';
    if (n.placeholder) return 'Not installed';
    return [
      n.type === 'Access point' || n.clients ? `${n.clients} client${n.clients === 1 ? '' : 's'}` : n.model,
      n.uplinkPort != null && !n.uplinkUnknown ? `port ${n.uplinkPort}` : ''
    ].filter(Boolean).join(' · ');
  }

  nodeOff(n: UnifiTopologyNode) { return !n.virtual && !n.placeholder && n.status !== 'online'; }

  // ---------- Charts ----------

  private renderWanChart() {
    const w = this.wan();
    const canvas = this.wanCanvas()?.nativeElement;
    if (!w || !canvas) return;
    const range = this.range();
    const pts = thin(w.points.filter(p => this.inRange(p.t)));
    this.charts.upsert('wan', canvas, {
      type: 'line',
      data: {
        labels: pts.map(p => timeLabel(p.t, range)),
        datasets: [
          line('Download', pts.map(p => p.down), S1, { fill: 'origin', backgroundColor: glow(S1) }),
          line('Upload', pts.map(p => p.up), S2)
        ]
      },
      options: baseOptions({ unit: 'Mbps', decimals: 1 })
    });
  }

  private renderClientsChart() {
    const d = this.data();
    const canvas = this.clientsCanvas()?.nativeElement;
    if (!d || !canvas) return;
    const site = this.site(), range = this.range();
    const pts = thin(d.history.filter(h => this.inRange(h.t)));
    const pick = (h: UnifiSummary['history'][number], i: number, key: 'wifi' | 'wired' | 'guest') => (site ? h.sites?.[site]?.[i] ?? null : h[key]);
    const area = (label: string, i: number, key: 'wifi' | 'wired' | 'guest', color: string, fill: string) =>
      line(label, pts.map(h => pick(h, i, key)), color, { fill, backgroundColor: color + 'd9', borderColor: '#fff', borderWidth: 1 });
    const opts = baseOptions({ stacked: true, unit: 'clients' });
    if (pts.length < 2) opts.plugins.title = { display: true, text: 'Collecting data — the chart fills in as the dashboard runs', color: MUTED, font: { size: 12, weight: '400' } };
    this.charts.upsert('clients', canvas, {
      type: 'line',
      data: {
        labels: pts.map(h => timeLabel(h.t, range)),
        datasets: [area('Wi-Fi', 0, 'wifi', S1, 'origin'), area('Wired', 1, 'wired', S2, '-1'), area('Guest', 2, 'guest', S3, '-1')]
      },
      options: opts
    });
  }

  private renderLatencyChart() {
    const sel = this.selected();
    const canvas = this.latencyCanvas()?.nativeElement;
    if (!sel || !canvas) return;
    const range = this.range();
    const s: UnifiIspSeries | undefined = sel.isp[0];
    const pts = s ? thin(s.points.filter(p => this.inRange(p.t))) : [];
    this.charts.upsert('latency', canvas, {
      type: 'line',
      data: {
        labels: pts.map(p => timeLabel(p.t, range)),
        datasets: [
          line('Average', pts.map(p => p.latency), S1, { fill: 'origin', backgroundColor: glow(S1) }),
          line('Peak', pts.map(p => p.maxLatency), S2, { borderWidth: 1.5, borderDash: [4, 3] })
        ]
      },
      options: baseOptions({ unit: 'ms' })
    });
  }

  private renderTypesChart() {
    const sel = this.selected();
    const canvas = this.typesCanvas()?.nativeElement;
    if (!sel || !canvas) return;
    const devices = sel.devices.filter(x => !x.placeholder);
    const types = [...new Set(devices.map(x => x.type))].sort();
    const count = (t: string, on: boolean) => devices.filter(x => x.type === t && (x.status === 'online') === on).length;
    this.charts.upsert('types', canvas, {
      type: 'bar',
      data: { labels: types, datasets: [hbar('Online', types.map(t => count(t, true)), S1, 16), hbar('Offline', types.map(t => count(t, false)), CRIT, 16)] },
      options: hbarOptions('devices')
    });
  }

  // ---------- Export ----------

  exportChart(kind: ExportKind, title: string, canvas: HTMLCanvasElement) { exportCard(kind, title, { canvas }); }

  exportSites(kind: ExportKind) { exportCard(kind, 'Sites', { table: this.sitesTable()?.nativeElement }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, 'Overview'); } finally { this.exporting.set(false); }
  }
}
