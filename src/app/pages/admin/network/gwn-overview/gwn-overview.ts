import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  GwnBandwidth, GwnClient, GwnClientCounts, GwnDevice, GwnOverview, GwnRange, GwnService, gwnErrorText
} from '../../../../services/gwn.service';
import {
  CRIT, ChartBag, ExportKind, NET_SHARED, S1, S2, SparkPoint, ago, avg, baseOptions, bucketPoints, bytes, dur, exportCard,
  exportPagePdf, fmt, glow, line, speedParts, thin
} from '../network-shared';
import { NetworkSwitch } from '../gwn-switch/gwn-switch';
import { GWN_RANGES, bandLabel, bitRate, clientName, gwnClientIcon, gwnTypeIcon, mbps, ms, rangeLabel, rangeText } from '../gwn-shared/gwn-shared';

interface TopItem { name: string; sub: string; value: string; frac: number; icon: string; link?: string[]; color?: string }

@Component({
  selector: 'app-gwn-overview',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, ...NET_SHARED, NetworkSwitch],
  templateUrl: './gwn-overview.html',
  styleUrls: ['../network-shared.css', '../gwn-shared/gwn.css']
})
export class GwnOverviewPage implements OnInit, OnDestroy {
  private gwn = inject(GwnService);

  page = viewChild<ElementRef<HTMLElement>>('page');
  trafficCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cTraffic');
  clientsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cClients');
  devTable = viewChild<ElementRef<HTMLTableElement>>('devTable');

  private charts = new ChartBag();
  private timers: ReturnType<typeof setInterval>[] = [];

  data = signal<GwnOverview | null>(null);
  clients = signal<GwnClient[] | null>(null);
  bandwidth = signal<GwnBandwidth | null>(null);
  counts = signal<GwnClientCounts | null>(null);
  statsError = signal<string | null>(null);

  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  now = signal(Date.now());
  range = signal<GwnRange>('1d');

  readonly ranges = GWN_RANGES;
  readonly fmt = fmt;
  readonly bytes = bytes;
  readonly dur = dur;
  readonly bitRate = bitRate;
  readonly gwnTypeIcon = gwnTypeIcon;
  readonly clientFmt = (v: number) => `${fmt(v)} clients`;
  readonly mbpsFmt = (v: number) => `${fmt(v, v < 10 ? 1 : 0)} Mbps`;

  unavailable = computed(() => { const d = this.data(); return d && !d.available ? d.message || 'Grandstream is not set up on this server.' : null; });
  updatedText = computed(() => { this.now(); const d = this.data(); return d?.updatedAt ? `Updated ${ago(d.updatedAt)}` : ''; });
  rangeName = computed(() => rangeText(this.range()));

  subtitle = computed(() => {
    const n = this.data()?.network;
    return n ? [n.name, n.country, n.timezone, 'Grandstream GWN Cloud'].filter(Boolean).join(' · ') : 'Live view of the Grandstream network (F-7).';
  });

  health = computed(() => {
    const d = this.data();
    if (!d || !d.available) return null;
    const list = d.alerts || [];
    const worst = list.some(a => a.level === 'critical' || a.level === 'serious') ? 'bad' : list.length ? 'warn' : 'ok';
    return {
      worst, list,
      title: worst === 'ok' ? 'All systems operational' : `${list.length} issue${list.length > 1 ? 's' : ''} need${list.length > 1 ? '' : 's'} attention`,
      sub: worst === 'ok' ? 'Every Grandstream device is online.' : 'Review the items below.'
    };
  });

  tiles = computed(() => {
    const d = this.data();
    if (!d || !d.available) return null;
    const c = d.clients;
    const wifi = (c.band24 || 0) + (c.band5 || 0) + (c.band6 || 0);
    const total = c.total || wifi + (c.wired || 0);
    const share = (v: number) => (total ? (v / total) * 100 : 0);
    const cnt = this.counts();
    const bw = this.bandwidth();
    const ssids = d.ssids || [];
    return {
      total, wired: c.wired || 0, b24: c.band24 || 0, b5: c.band5 || 0, b6: c.band6 || 0,
      p24: share(c.band24 || 0), p5: share(c.band5 || 0), p6: share(c.band6 || 0), pWired: share(c.wired || 0),
      weak: c.weak || 0, reported: c.deviceReported,
      clientSpark: cnt ? bucketPoints(cnt.times.map((t, i) => ({ t: ms(t) ?? undefined, v: cnt.counts[i] ?? null }))) : [],
      online: d.devices.online, devices: d.devices.total,
      down: speedParts(d.trafficNow?.downloadBps != null ? d.trafficNow.downloadBps / 8 : null),
      up: bitRate(d.trafficNow?.uploadBps),
      trafficSpark: bw ? bucketPoints(bw.times.map((t, i) => ({ t: ms(t) ?? undefined, v: mbps(bw.downloadBps?.[i]) }))) as SparkPoint[] : [],
      usage: d.usage,
      ssidsOn: ssids.filter(s => s.enabled).length, ssids: ssids.length,
      updates: (d.devices.list || []).filter(x => !!x.latestFirmware && x.latestFirmware !== x.firmware).length
    };
  });

  trafficStats = computed(() => {
    const bw = this.bandwidth();
    if (!bw?.times?.length) return null;
    const downs = (bw.downloadBps || []).filter(v => v != null);
    return { total: (bw.downloadTotal || 0) + (bw.uploadTotal || 0), down: bw.downloadTotal, up: bw.uploadTotal, avg: avg(downs), peak: downs.length ? Math.max(...downs) : null };
  });

  clientStats = computed(() => {
    const c = this.counts();
    if (!c?.counts?.length) return null;
    return { avg: avg(c.counts), peak: Math.max(...c.counts), now: c.counts[c.counts.length - 1] };
  });

  devices = computed<GwnDevice[]>(() =>
    [...(this.data()?.devices.list || [])].sort((a, b) => Number(a.status === 'online') - Number(b.status === 'online') || (a.type || '').localeCompare(b.type || '') || a.name.localeCompare(b.name)));

  ssids = computed(() => [...(this.data()?.ssids || [])].sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.clients - a.clients));

  tops = computed(() => {
    const cl = this.clients();
    if (!cl) return null;
    const online = cl.filter(c => c.online !== false);
    const byData = [...online].sort((a, b) => b.total - a.total).slice(0, 5);
    const maxData = byData[0]?.total || 1;
    const names = new Map((this.data()?.devices.list || []).map(d => [d.mac, d.name] as [string, string]));
    const aps = new Map<string, number>();
    for (const c of online.filter(x => !x.wired && x.apMac)) aps.set(c.apMac as string, (aps.get(c.apMac as string) || 0) + 1);
    const busiest = [...aps].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxN = busiest[0]?.[1] || 1;
    const weak = online.filter(c => !c.wired && c.rssi != null && c.rssi < -70).sort((a, b) => (a.rssi as number) - (b.rssi as number)).slice(0, 5);
    const conn = (c: GwnClient) => (c.wired ? 'Wired' : `${c.ssid || 'Wi-Fi'} · ${bandLabel(c.band)}`);
    return {
      data: byData.map<TopItem>(c => ({ name: clientName(c), sub: conn(c), value: bytes(c.total), frac: c.total / maxData, icon: gwnClientIcon(c) })),
      aps: busiest.map<TopItem>(([mac, n]) => ({ name: names.get(mac) || mac, sub: 'Access point', value: `${n}`, frac: n / maxN, icon: 'ap', link: ['/admin/network/gwn/device', mac] })),
      weak: weak.map<TopItem>(c => ({
        name: clientName(c), sub: `on ${names.get(c.apMac || '') || c.apMac || 'an access point'}`, value: `${c.rssi} dBm`,
        frac: Math.min(1, ((c.rssi as number) + 95) / 45), icon: gwnClientIcon(c), color: (c.rssi as number) < -75 ? CRIT : '#b45309'
      }))
    };
  });

  constructor() {
    effect(() => this.renderTraffic());
    effect(() => this.renderClients());
    // Load again when the chosen Grandstream network changes (the location switch).
    effect(() => { this.gwn.net(); untracked(() => this.reloadAll()); });
  }

  ngOnInit() {
    this.timers.push(
      setInterval(() => this.load(true), 60000),
      setInterval(() => this.loadStats(), 5 * 60000),
      setInterval(() => this.now.set(Date.now()), 5000)
    );
  }

  ngOnDestroy() {
    this.timers.forEach(t => clearInterval(t));
    this.charts.destroyAll();
  }

  private reloadAll() {
    this.data.set(null);
    this.clients.set(null);
    this.bandwidth.set(null);
    this.counts.set(null);
    this.load();
    this.loadStats();
  }

  load(silent = false, done?: () => void) {
    if (!silent) this.loading.set(true);
    this.gwn.getOverview().subscribe({
      next: res => { this.data.set(res); this.error.set(null); this.loading.set(false); done?.(); },
      error: err => {
        this.loading.set(false);
        if (!silent || !this.data()) this.error.set(`Grandstream network not reachable: ${gwnErrorText(err)}`);
        done?.();
      }
    });
    this.gwn.getClients().subscribe({ next: c => this.clients.set(c), error: () => { if (!this.clients()) this.clients.set([]); } });
  }

  loadStats() {
    const range = this.range();
    this.statsError.set(null);
    this.gwn.getBandwidth(range).subscribe({
      next: b => { if (range === this.range()) this.bandwidth.set(b); },
      error: err => { if (range === this.range()) { this.bandwidth.set({ times: [], download: [], upload: [], downloadBps: [], uploadBps: [], downloadTotal: 0, uploadTotal: 0 }); this.statsError.set(gwnErrorText(err)); } }
    });
    this.gwn.getClientStats(range).subscribe({
      next: c => { if (range === this.range()) this.counts.set(c); },
      error: err => { if (range === this.range()) { this.counts.set({ times: [], counts: [] }); this.statsError.set(gwnErrorText(err)); } }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => { this.refreshing.set(false); this.now.set(Date.now()); });
    this.loadStats();
  }

  setRange(r: GwnRange) {
    if (r === this.range()) return;
    this.range.set(r);
    this.bandwidth.set(null);
    this.counts.set(null);
    this.loadStats();
  }

  uptime(d: GwnDevice) { return d.status === 'online' ? dur(d.uptimeSeconds) : '–'; }
  hasUpdate(d: GwnDevice) { return !!d.latestFirmware && d.latestFirmware !== d.firmware; }

  // ---------- Charts ----------

  private renderTraffic() {
    const bw = this.bandwidth();
    const canvas = this.trafficCanvas()?.nativeElement;
    if (!bw || !canvas) return;
    const range = this.range();
    const idx = thin(bw.times.map((_, i) => i));
    this.charts.upsert('traffic', canvas, {
      type: 'line',
      data: {
        labels: idx.map(i => rangeLabel(bw.times[i], range)),
        datasets: [
          line('Download', idx.map(i => mbps(bw.downloadBps?.[i])), S1, { fill: 'origin', backgroundColor: glow(S1) }),
          line('Upload', idx.map(i => mbps(bw.uploadBps?.[i])), S2)
        ]
      },
      options: baseOptions({ unit: 'Mbps', decimals: 1 })
    });
  }

  private renderClients() {
    const c = this.counts();
    const canvas = this.clientsCanvas()?.nativeElement;
    if (!c || !canvas) return;
    const range = this.range();
    const idx = thin(c.times.map((_, i) => i));
    this.charts.upsert('clients', canvas, {
      type: 'line',
      data: {
        labels: idx.map(i => rangeLabel(c.times[i], range)),
        datasets: [line('Clients', idx.map(i => c.counts[i] ?? null), S1, { fill: 'origin', backgroundColor: glow(S1, '40') })]
      },
      options: baseOptions({ unit: 'clients', legend: false })
    });
  }

  // ---------- Export ----------

  exportChart(kind: ExportKind, title: string, canvas: HTMLCanvasElement) { exportCard(kind, `F-7 ${title}`, { canvas }); }
  exportDevices(kind: ExportKind) { exportCard(kind, 'F-7 devices', { table: this.devTable()?.nativeElement }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, 'F-7 Overview'); } finally { this.exporting.set(false); }
  }

}
