import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { UnifiService } from '../../../../services/unifi.service';
import { UnifiDeviceDetail, UnifiDeviceHistory, UnifiNetPort } from '../../../../models/unifi.model';
import {
  ChartBag, ExportKind, NET_SHARED, S1, S2, TimelineMarker, ago, avg, baseOptions, bucketPoints, buildTimeline, bytes, clientIcon, clock,
  dur, errMsg, exportCard, exportPagePdf, fmt, glow, line, linkText, logWhen, normMac, rate, sum, thin, timeLabel, timelineStats, typeIcon
} from '../network-shared';

@Component({
  selector: 'app-network-device',
  standalone: true,
  imports: [RouterLink, ...NET_SHARED],
  templateUrl: './network-device.html',
  styleUrls: ['../network-shared.css', './network-device.css']
})
export class NetworkDevice implements OnInit, OnDestroy {
  private unifi = inject(UnifiService);
  private route = inject(ActivatedRoute);

  page = viewChild<ElementRef<HTMLElement>>('page');
  trafficCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cTraffic');
  clientsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cClients');
  sysCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cSys');

  private charts = new ChartBag();
  private timers: ReturnType<typeof setInterval>[] = [];
  private sub?: Subscription;

  mac = signal('');
  data = signal<UnifiDeviceDetail | null>(null);
  history = signal<UnifiDeviceHistory | null>(null);
  historyError = signal<string | null>(null);
  loadedAt = signal<number | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  now = signal(Date.now());

  range = signal(24);
  ctype = signal<'' | 'wifi' | 'wired'>('');

  readonly fmt = fmt;
  readonly bytes = bytes;
  readonly rate = rate;
  readonly dur = dur;
  readonly ago = ago;
  readonly clientIcon = clientIcon;
  readonly typeIcon = typeIcon;
  readonly logWhen = logWhen;
  readonly linkText = linkText;
  readonly clientFmt = (v: number) => `${fmt(v)} clients`;
  readonly cpuFmt = (v: number) => `${fmt(v, 1)}% CPU`;
  readonly memFmt = (v: number) => `${fmt(v, 1)}% memory`;

  updatedText = computed(() => { this.now(); const t = this.loadedAt(); return t ? `Updated ${ago(t)}` : ''; });

  tiles = computed(() => {
    const d = this.data();
    if (!d) return null;
    const dev = d.device;
    const hp = this.history()?.points || [];
    const temps = dev.temps || [];
    const poe = sum(dev.ports, p => p.poe);
    return {
      wifiClients: d.clients.filter(c => !c.wired).length,
      wiredClients: d.clients.filter(c => c.wired).length,
      clientSpark: hp.some(p => p.clients) ? bucketPoints(hp.map(p => ({ t: p.t, v: p.clients }))) : [],
      cpuSpark: bucketPoints(hp.map(p => ({ t: p.t, v: p.cpu }))),
      memSpark: bucketPoints(hp.map(p => ({ t: p.t, v: p.mem }))),
      maxTemp: temps.length ? Math.max(...temps.map(t => t.value)) : null,
      temps: temps.map(t => `${t.name} ${fmt(t.value)}°C`).join(' · ') || 'Not reported',
      last: dev.txRate != null ? 'traffic' : dev.kind !== 'uap' && dev.ports.length ? 'ports' : 'exp',
      portsUp: dev.ports.filter(p => p.up).length,
      poe
    };
  });

  availability = computed(() => {
    const d = this.data();
    if (!d) return null;
    this.now();
    const dev = d.device;
    const to = Date.now(), from = to - this.range() * 36e5;
    const online = dev.status === 'online';
    // Only the device's own events — an AP's log also holds its clients' connects/disconnects.
    const own = d.logs.filter(l => l.conn && !l.event.startsWith('CLIENT_'));
    const segs = buildTimeline(own, { online, from, to, downSince: dev.lastSeen });
    // For a UniFi device, being offline before the first reconnect is a real outage.
    segs.forEach(x => (x.lead = false));
    const st = timelineStats(segs);
    const restartAt = online && dev.uptime != null ? to - dev.uptime * 1000 : null;
    const markers: TimelineMarker[] = restartAt && restartAt > from ? [{ t: restartAt, label: 'Restarted' }] : [];
    return { from, to, online, segs, st, markers, restartText: markers.length ? clock(markers[0].t, true) : '' };
  });

  ports = computed(() => {
    const d = this.data();
    if (!d) return [];
    const byPort = new Map<number, string[]>();
    for (const c of d.clients.filter(x => x.wired && x.port != null)) byPort.set(c.port as number, [...(byPort.get(c.port as number) || []), c.name]);
    return [...d.device.ports].sort((a, b) => a.idx - b.idx).map(p => {
      const names = byPort.get(p.idx) || [];
      return { p, connected: names.slice(0, 2).join(', ') + (names.length > 2 ? '…' : '') };
    });
  });

  portsNote = computed(() => {
    const d = this.data();
    if (!d) return '';
    const up = d.device.ports.filter(p => p.up).length;
    const poe = sum(d.device.ports, p => p.poe);
    return `${up} of ${d.device.ports.length} connected${poe ? ` · PoE draw ${fmt(poe, 1)} W` : ''}`;
  });

  clients = computed(() => {
    const t = this.ctype();
    return (this.data()?.clients || []).filter(c => !t || (t === 'wired' ? c.wired : !c.wired)).sort((a, b) => b.dataBytes - a.dataBytes).slice(0, 50);
  });

  trafficInfo = computed(() => {
    const h = this.history();
    const gw = h?.kind === 'gw', sw = h?.kind === 'sw';
    const pts = thin(h?.points || []);
    const downs = pts.map(p => p.down).filter((v): v is number => v != null);
    const ups = pts.map(p => p.up).filter((v): v is number => v != null);
    return {
      title: gw ? 'Internet traffic (WAN)' : sw ? 'Switch traffic' : 'Wi-Fi traffic',
      downLabel: gw ? 'Download' : sw ? 'Sent' : 'To clients',
      upLabel: gw ? 'Upload' : sw ? 'Received' : 'From clients',
      stats: downs.length ? { avgDown: avg(downs), peakDown: Math.max(...downs), avgUp: avg(ups) } : null,
      hasClients: pts.some(p => (p.clients || 0) > 0),
      hasSys: pts.some(p => p.cpu != null || p.mem != null),
      empty: !!h && !pts.length
    };
  });

  constructor() {
    effect(() => this.renderTraffic());
    effect(() => this.renderClients());
    effect(() => this.renderSys());
  }

  ngOnInit() {
    // /admin/network/device/:mac (or ?mac=…); reloads when navigating between devices.
    this.sub = this.route.paramMap.subscribe(pm => {
      const mac = normMac(pm.get('mac') || this.route.snapshot.queryParamMap.get('mac'));
      this.mac.set(mac);
      this.data.set(null);
      this.history.set(null);
      this.error.set(null);
      this.charts.destroyAll();
      this.load();
      this.loadHistory();
    });
    this.timers.push(
      setInterval(() => this.load(true), 30000),
      setInterval(() => this.loadHistory(), 5 * 60000),
      setInterval(() => this.now.set(Date.now()), 5000)
    );
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.timers.forEach(t => clearInterval(t));
    this.charts.destroyAll();
  }

  load(silent = false, done?: () => void) {
    const mac = this.mac();
    if (!mac) { this.loading.set(false); return; }
    if (!silent) this.loading.set(true);
    this.unifi.getDevice(mac).subscribe({
      next: res => {
        if (mac !== this.mac()) return;
        this.data.set(res); this.loadedAt.set(Date.now()); this.error.set(null); this.loading.set(false); done?.();
      },
      error: err => {
        if (mac !== this.mac()) return;
        this.loading.set(false);
        if (!silent || !this.data()) this.error.set(`Couldn't load this device: ${errMsg(err)}`);
        done?.();
      }
    });
  }

  loadHistory() {
    const mac = this.mac();
    if (!mac) return;
    const range = this.range();
    this.unifi.getDeviceHistory(mac, range).subscribe({
      next: h => { if (mac === this.mac() && range === this.range()) { this.history.set(h); this.historyError.set(null); } },
      error: err => { if (mac === this.mac()) { this.history.set({ kind: '', points: [] }); this.historyError.set(errMsg(err)); } }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => this.refreshing.set(false));
    this.loadHistory();
  }

  setRange(r: number) {
    this.range.set(r);
    this.loadHistory();
  }

  gaugeClass(v: number | null, higherIsBetter = false) {
    if (v == null) return '';
    return higherIsBetter ? (v >= 80 ? 'good' : v >= 50 ? 'hot' : 'crit') : v >= 90 ? 'crit' : v >= 75 ? 'hot' : '';
  }

  portSpeed(p: UnifiNetPort) { return p.speed ? linkText(p.speed) : '–'; }

  // ---------- Charts ----------

  private labels() {
    const range = this.range();
    return thin(this.history()?.points || []).map(p => timeLabel(p.t, range));
  }

  private renderTraffic() {
    const h = this.history();
    const canvas = this.trafficCanvas()?.nativeElement;
    if (!h || !canvas) return;
    const pts = thin(h.points);
    const info = this.trafficInfo();
    this.charts.upsert('traffic', canvas, {
      type: 'line',
      data: {
        labels: this.labels(),
        datasets: [line(info.downLabel, pts.map(p => p.down), S1, { fill: 'origin', backgroundColor: glow(S1) }), line(info.upLabel, pts.map(p => p.up), S2)]
      },
      options: baseOptions({ unit: 'Mbps', decimals: 1 })
    });
  }

  private renderClients() {
    const h = this.history();
    const canvas = this.clientsCanvas()?.nativeElement;
    if (!h || !canvas || !this.trafficInfo().hasClients) return;
    const pts = thin(h.points);
    this.charts.upsert('clients', canvas, {
      type: 'line',
      data: { labels: this.labels(), datasets: [line('Clients', pts.map(p => p.clients), S1, { stepped: true, tension: 0 })] },
      options: baseOptions({ unit: 'clients', legend: false })
    });
  }

  private renderSys() {
    const h = this.history();
    const canvas = this.sysCanvas()?.nativeElement;
    if (!h || !canvas || !this.trafficInfo().hasSys) return;
    const pts = thin(h.points);
    const o = baseOptions({ unit: '%', decimals: 1 });
    o.scales.y.max = 100;
    this.charts.upsert('sys', canvas, {
      type: 'line',
      data: { labels: this.labels(), datasets: [line('CPU', pts.map(p => p.cpu), S1), line('Memory', pts.map(p => p.mem), S2)] },
      options: o
    });
  }

  // ---------- Export ----------

  exportChart(kind: ExportKind, title: string, canvas: HTMLCanvasElement) { exportCard(kind, `${this.data()?.device.name || 'device'} ${title}`, { canvas }); }
  exportTable(kind: ExportKind, title: string, table: HTMLTableElement) { exportCard(kind, `${this.data()?.device.name || 'device'} ${title}`, { table }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, this.data()?.device.name || 'Device'); } finally { this.exporting.set(false); }
  }
}
