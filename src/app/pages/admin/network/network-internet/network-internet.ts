import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { UnifiService } from '../../../../services/unifi.service';
import { UnifiIspResponse, UnifiIspWan } from '../../../../models/unifi.model';
import {
  AMBER, ChartBag, ExportKind, NET_SHARED, S1, S2, ago, baseOptions, bytes, dateTime, dur, errMsg, exportCard, exportPagePdf, fmt, line,
  linkText, pct, shortDate, timeLabel
} from '../network-shared';

/** One colour per line in every chart on this page (colour follows the WAN, not its rank). */
const WAN_COLOR: Record<string, string> = { WAN1: S1, WAN2: S2, WAN3: AMBER };
const wanColor = (k: string) => WAN_COLOR[k] || S1;
const MODE_NAME: Record<string, string> = { failover_only: 'Failover mode', failover: 'Failover mode', weighted: 'Load balancing', distributed: 'Load balancing' };

interface CompareCell { text: string; sub?: string; best: boolean; badge?: 'ok' | 'bad'; muted?: boolean }
interface CompareRow { label: string; cells: CompareCell[] }
type Better = 'high' | 'low' | null;

@Component({
  selector: 'app-network-internet',
  standalone: true,
  imports: [...NET_SHARED],
  templateUrl: './network-internet.html',
  styleUrls: ['../network-shared.css', './network-internet.css']
})
export class NetworkInternet implements OnInit, OnDestroy {
  private unifi = inject(UnifiService);

  page = viewChild<ElementRef<HTMLElement>>('page');
  testsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cTests');
  failoverCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cFailover');
  compareTable = viewChild<ElementRef<HTMLTableElement>>('compareTable');

  private charts = new ChartBag();
  private timers: ReturnType<typeof setInterval>[] = [];

  isp = signal<UnifiIspResponse | null>(null);
  loadedAt = signal<number | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  now = signal(Date.now());

  measure = signal<'down' | 'up' | 'ping'>('down');
  foDays = signal(7);

  readonly fmt = fmt;
  readonly wanColor = wanColor;

  updatedText = computed(() => { this.now(); const t = this.loadedAt(); return t ? `Updated ${ago(t)}` : ''; });

  tiles = computed(() => {
    const isp = this.isp();
    if (!isp) return null;
    const w = isp.wans;
    const primary = w.find(x => x.priority === 1) || w[0];
    const eps = isp.episodes;
    const lastEp = eps[eps.length - 1];
    return {
      up: w.filter(x => x.up).length, total: w.length, mode: MODE_NAME[String(isp.mode).toLowerCase()] || '',
      primaryIsp: primary?.isp || '–', primaryAvg: primary?.tests.avgDown ?? null, primaryCount: primary?.tests.count || 0,
      backup: isp.failoverSeconds ? dur(isp.failoverSeconds) : 'None',
      gwDays: isp.gatewayUptime ? Math.round(isp.gatewayUptime / 86400) : null,
      failovers: eps.length,
      lastEp: lastEp ? `Last: ${shortDate(lastEp.from)} via ${lastEp.via.join(', ')}` : 'None in the last 60 days'
    };
  });

  compare = computed<CompareRow[]>(() => {
    const w = this.isp()?.wans;
    if (!w) return [];
    const role = (x: UnifiIspWan) => (x.priority === 1 ? 'Primary' : x.priority ? `Backup ${x.priority - 1}` : '');
    const defs: [string, ((x: UnifiIspWan) => number | null | undefined) | null, (x: UnifiIspWan) => Omit<CompareCell, 'best'>, Better][] = [
      ['Role', null, x => ({ text: role(x) || '–' }), null],
      ['Status', null, x => ({ text: x.up ? 'Connected' : 'Down', badge: x.up ? 'ok' : 'bad' }), null],
      ['Availability (24h)', x => x.availability, x => ({ text: pct(x.availability) }), 'high'],
      ['Average latency (24h)', x => x.latency, x => ({ text: x.latency == null ? '–' : `${fmt(x.latency)} ms` }), 'low'],
      ['Last speed test', x => x.tests.latest?.down, x => (x.tests.latest
        ? { text: `Down ${fmt(x.tests.latest.down)} / Up ${fmt(x.tests.latest.up)} Mbps`, sub: dateTime(x.tests.latest.at) }
        : { text: 'Never', muted: true }), 'high'],
      ['Average download (90 days)', x => x.tests.avgDown, x => ({ text: x.tests.avgDown == null ? '–' : `${fmt(x.tests.avgDown)} Mbps` }), 'high'],
      ['Average upload (90 days)', x => x.tests.avgUp, x => ({ text: x.tests.avgUp == null ? '–' : `${fmt(x.tests.avgUp)} Mbps` }), 'high'],
      ['Best download', x => x.tests.bestDown, x => ({ text: x.tests.bestDown == null ? '–' : `${fmt(x.tests.bestDown)} Mbps` }), 'high'],
      ['Speed tests run', null, x => ({ text: fmt(x.tests.count) }), null],
      ['Data carried (7 days)', null, x => ({ text: bytes(x.traffic7d.down + x.traffic7d.up) }), null],
      ['Data carried (30 days)', null, x => ({ text: bytes(x.traffic30d.down + x.traffic30d.up) }), null],
      ['Connected without a drop', x => x.connectedFor, x => ({ text: x.connectedFor == null ? '–' : dur(x.connectedFor) }), 'high'],
      ['Downtime since gateway start', x => x.downtimeSec, x => ({ text: x.downtimeSec == null ? '–' : x.downtimeSec ? dur(x.downtimeSec) : 'None' }), 'low'],
      ['Port link speed', null, x => ({ text: x.linkSpeed ? linkText(x.linkSpeed) : '–' }), null]
    ];
    return defs.map(([label, val, show, better]) => {
      let best: number | null = null;
      if (better && val) {
        const vals = w.map(val).filter((v): v is number => v != null);
        // Only highlight when the lines actually differ.
        if (vals.length > 1 && new Set(vals).size > 1) best = better === 'high' ? Math.max(...vals) : Math.min(...vals);
      }
      return { label, cells: w.map(x => ({ ...show(x), best: best != null && !!val && val(x) === best })) };
    });
  });

  hasTests = computed(() => (this.isp()?.wans || []).some(w => w.tests.history.length > 0));

  episodes = computed(() => {
    const isp = this.isp();
    if (!isp) return [];
    const from = Date.now() - this.foDays() * 864e5;
    return isp.episodes.filter(e => e.to >= from).slice().reverse().map(e => {
      const wholeDays = e.to - e.from >= 864e5;
      return {
        via: e.via.join(', '),
        when: wholeDays ? new Date(e.from).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : `${dateTime(e.from)} to ${dateTime(e.to)}`,
        length: wholeDays ? `${Math.round((e.to - e.from) / 864e5)} day${e.to - e.from >= 2 * 864e5 ? 's' : ''} (daily data)` : `about ${dur((e.to - e.from) / 1000)}`
      };
    });
  });

  constructor() {
    effect(() => this.renderTests());
    effect(() => this.renderFailover());
  }

  ngOnInit() {
    this.load();
    this.timers.push(setInterval(() => this.load(true), 5 * 60000), setInterval(() => this.now.set(Date.now()), 5000));
  }

  ngOnDestroy() {
    this.timers.forEach(t => clearInterval(t));
    this.charts.destroyAll();
  }

  load(silent = false, done?: () => void) {
    if (!silent) this.loading.set(true);
    this.unifi.getIsp().subscribe({
      next: res => { this.isp.set(res); this.loadedAt.set(Date.now()); this.error.set(null); this.loading.set(false); done?.(); },
      error: err => {
        this.loading.set(false);
        if (!silent || !this.isp()) this.error.set(`Couldn't load internet data: ${errMsg(err)}`);
        done?.();
      }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => this.refreshing.set(false));
  }

  private renderTests() {
    const isp = this.isp();
    const canvas = this.testsCanvas()?.nativeElement;
    if (!isp || !canvas) return;
    const m = this.measure();
    const opts = baseOptions({ unit: m === 'ping' ? 'ms' : 'Mbps' });
    opts.interaction = { mode: 'nearest', intersect: false };
    opts.scales.x = { type: 'linear', grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 8, callback: (v: number) => shortDate(v) } };
    opts.plugins.tooltip.callbacks.title = (items: any[]) => (items[0] ? dateTime(items[0].parsed.x) : '');
    this.charts.upsert('tests', canvas, {
      type: 'scatter',
      data: {
        datasets: isp.wans.map(x => ({
          label: `${x.key} · ${x.isp}`,
          data: x.tests.history.map(t => ({ x: t.t, y: t[m] })),
          borderColor: wanColor(x.key), backgroundColor: wanColor(x.key),
          showLine: true, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: '#fff', pointBorderWidth: 2, tension: 0.2
        }))
      },
      options: opts
    });
  }

  private renderFailover() {
    const isp = this.isp();
    const canvas = this.failoverCanvas()?.nativeElement;
    if (!isp || !canvas) return;
    const hourly = this.foDays() <= 7;
    const rows = hourly ? isp.hourly : isp.daily;
    // Hourly: average Mbps; daily: GB per day.
    const val = (r: (typeof rows)[number], k: string) => {
      const b = (r.wans[k]?.down || 0) + (r.wans[k]?.up || 0);
      return hourly ? (b * 8) / r.secs / 1e6 : b / 1e9;
    };
    const labels = rows.map(r => (hourly ? timeLabel(r.t, 168) : shortDate(r.t)));
    this.charts.upsert('failover', canvas, {
      type: hourly ? 'line' : 'bar',
      data: {
        labels,
        datasets: isp.wans.map((w, i) => {
          const color = wanColor(w.key);
          return hourly
            ? line(`${w.key} · ${w.isp}`, rows.map(r => val(r, w.key)), color, { fill: i ? '-1' : 'origin', backgroundColor: color + 'cc', borderColor: '#fff', borderWidth: 1, tension: 0.25 })
            : { label: `${w.key} · ${w.isp}`, data: rows.map(r => val(r, w.key)), backgroundColor: color, borderColor: '#fff', borderWidth: { top: 2 }, borderRadius: 6, borderSkipped: false, maxBarThickness: 26 };
        })
      },
      options: baseOptions({ stacked: true, unit: hourly ? 'Mbps' : 'GB', decimals: 1 })
    });
  }

  exportChart(kind: ExportKind, title: string, canvas: HTMLCanvasElement) { exportCard(kind, title, { canvas }); }
  exportCompare(kind: ExportKind) { exportCard(kind, 'ISP comparison', { table: this.compareTable()?.nativeElement }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, 'Internet'); } finally { this.exporting.set(false); }
  }
}
