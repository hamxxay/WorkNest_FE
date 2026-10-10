import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UnifiService } from '../../../../services/unifi.service';
import { UnifiWifiAp, UnifiWifiRadio, UnifiWifiResponse } from '../../../../models/unifi.model';
import { NetworkSsids } from '../network-ssids/network-ssids';
import { AMBER, ChartBag, ExportKind, NET_SHARED, S1, ago, avg, errMsg, exportCard, exportPagePdf, fmt, hbar, hbarOptions, sum, timeLabel } from '../network-shared';

/** Thresholds for flagging a radio — one place so the table and tiles agree. */
const LIMITS = { busy: 60, interference: 30, retries: 10, experience: 70 };

interface RadioRow { ap: UnifiWifiAp; r: UnifiWifiRadio; issues: [string, string][] }

function radioIssues(r: UnifiWifiRadio, sameChannel: number): [string, string][] {
  const out: [string, string][] = [];
  if ((r.utilization ?? 0) >= LIMITS.busy) out.push(['Busy channel', `${r.utilization}% of airtime in use`]);
  if ((r.interference ?? 0) >= LIMITS.interference) out.push(['Interference', `${r.interference}% airtime used by other networks`]);
  if ((r.retries ?? 0) >= LIMITS.retries) out.push(['High retries', `${fmt(r.retries, 1)}% of packets re-sent`]);
  // 2.4 GHz has only 3 usable channels, so sharing is normal; flag it only when also busy. 5 GHz: 3+ APs on one channel is worth fixing.
  const crowded = r.band === '2.4 GHz' ? sameChannel >= 4 && (r.utilization ?? 0) >= 40 : sameChannel >= 3;
  if (crowded) out.push(['Crowded channel', `${sameChannel} of your APs use channel ${r.channel}`]);
  return out;
}

@Component({
  selector: 'app-network-wifi',
  standalone: true,
  imports: [RouterLink, NetworkSsids, ...NET_SHARED],
  templateUrl: './network-wifi.html',
  styleUrls: ['../network-shared.css', './network-wifi.css']
})
export class NetworkWifi implements OnInit, OnDestroy {
  private unifi = inject(UnifiService);

  page = viewChild<ElementRef<HTMLElement>>('page');
  utilCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cUtil');
  radiosTable = viewChild<ElementRef<HTMLTableElement>>('radiosTable');

  private charts = new ChartBag();
  private timers: ReturnType<typeof setInterval>[] = [];

  wifi = signal<UnifiWifiResponse | null>(null);
  loadedAt = signal<number | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  now = signal(Date.now());
  band = signal('');

  readonly fmt = fmt;
  readonly limits = LIMITS;

  updatedText = computed(() => { this.now(); const t = this.loadedAt(); return t ? `Updated ${ago(t)}` : ''; });

  radios = computed<RadioRow[]>(() => {
    const w = this.wifi();
    if (!w) return [];
    const aps = w.aps.filter(a => !a.placeholder && a.status === 'online');
    const chan = new Map<string, number>();
    for (const a of aps) for (const r of a.radios) chan.set(`${r.band}|${r.channel}`, (chan.get(`${r.band}|${r.channel}`) || 0) + 1);
    return aps.flatMap(a => a.radios.map((r, i) => {
      const issues = radioIssues(r, chan.get(`${r.band}|${r.channel}`) || 0);
      if (i === 0 && a.satisfaction != null && a.satisfaction < LIMITS.experience) issues.push(['Poor experience', `${a.satisfaction}% Wi-Fi experience on this AP`]);
      return { ap: a, r, issues };
    }));
  });

  tiles = computed(() => {
    const w = this.wifi();
    if (!w) return null;
    const aps = w.aps.filter(a => !a.placeholder);
    const online = aps.filter(a => a.status === 'online');
    const radios = this.radios();
    const busiest = [...radios].sort((a, b) => (b.r.utilization || 0) - (a.r.utilization || 0))[0] as RadioRow | undefined;
    return {
      online: online.length, total: aps.length, clients: sum(online, a => a.clients),
      exp: avg(online.map(a => a.satisfaction).filter((v): v is number => v != null)),
      busiest,
      flagged: new Set(radios.filter(x => x.issues.length).map(x => x.ap.mac)).size
    };
  });

  rows = computed(() => {
    const b = this.band();
    return this.radios().filter(x => !b || x.r.band === b)
      .sort((a, c) => c.issues.length - a.issues.length || a.ap.name.localeCompare(c.ap.name) || a.r.band.localeCompare(c.r.band));
  });

  utilHeight = computed(() => Math.max(240, this.rows().length * 24 + 70));

  channels = computed(() => {
    const radios = this.radios();
    const b = this.band();
    return ['2.4 GHz', '5 GHz', '6 GHz'].filter(x => radios.some(r => r.r.band === x) && (!b || b === x)).map(x => {
      const byCh = new Map<number | null, string[]>();
      for (const r of radios.filter(r => r.r.band === x)) byCh.set(r.r.channel, [...(byCh.get(r.r.channel) || []), r.ap.name]);
      const crowd = x === '2.4 GHz' ? 4 : 3; // same rule as the "Crowded channel" flag
      return {
        band: x,
        rows: [...byCh].sort((a, c) => (a[0] ?? 0) - (c[0] ?? 0)).map(([ch, names]) => ({ ch, names, crowded: names.length >= crowd }))
      };
    });
  });

  heatmap = computed(() => {
    const w = this.wifi();
    if (!w) return null;
    const hours = Array.from({ length: 24 }, (_, i) => {
      const d = new Date();
      d.setMinutes(0, 0, 0);
      return d.getTime() - (23 - i) * 36e5;
    });
    const aps = w.aps.filter(a => !a.placeholder && a.status === 'online').sort((a, b) => a.name.localeCompare(b.name));
    return {
      hours: hours.map((h, i) => (i % 3 === 0 ? String(new Date(h).getHours()).padStart(2, '0') : '')),
      rows: aps.map(ap => ({
        ap,
        cells: hours.map(h => {
          const p = ap.history.find(x => Math.abs(x.t - h) < 18e5);
          if (!p || p.satisfaction == null) return { empty: true, alpha: 0, title: `${ap.name} · ${timeLabel(h, 24)} · no data` };
          const bad = Math.max(0, Math.min(1, (100 - p.satisfaction) / 40)); // 100% → 0, 60% or worse → 1
          return { empty: false, alpha: 0.06 + bad * 0.94, title: `${ap.name} · ${timeLabel(h, 24)} · ${fmt(p.satisfaction)}% experience · ${p.clients} clients` };
        })
      }))
    };
  });

  constructor() {
    effect(() => this.renderUtil());
  }

  ngOnInit() {
    this.load();
    this.timers.push(setInterval(() => this.load(true), 60000), setInterval(() => this.now.set(Date.now()), 5000));
  }

  ngOnDestroy() {
    this.timers.forEach(t => clearInterval(t));
    this.charts.destroyAll();
  }

  load(silent = false, done?: () => void) {
    if (!silent) this.loading.set(true);
    this.unifi.getWifi().subscribe({
      next: res => { this.wifi.set(res); this.loadedAt.set(Date.now()); this.error.set(null); this.loading.set(false); done?.(); },
      error: err => {
        this.loading.set(false);
        if (!silent || !this.wifi()) this.error.set(`Couldn't load Wi-Fi data: ${errMsg(err)}`);
        done?.();
      }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => this.refreshing.set(false));
  }

  heat(alpha: number) { return `rgba(239, 68, 68, ${alpha.toFixed(2)})`; }

  private renderUtil() {
    const canvas = this.utilCanvas()?.nativeElement;
    if (!this.wifi() || !canvas) return;
    const list = [...this.rows()].sort((a, b) => (b.r.utilization || 0) - (a.r.utilization || 0));
    const opts = hbarOptions('%');
    opts.scales.x.max = 100;
    opts.scales.y.ticks.font = { size: 11 };
    this.charts.upsert('util', canvas, {
      type: 'bar',
      data: {
        labels: list.map(x => `${x.ap.name} · ${x.r.band.replace(' GHz', 'G')}`),
        datasets: [
          hbar("This AP's traffic", list.map(x => Math.max(0, (x.r.utilization || 0) - (x.r.interference || 0))), S1, 12),
          hbar('Interference', list.map(x => x.r.interference || 0), AMBER, 12)
        ]
      },
      options: opts
    });
  }

  exportUtil(kind: ExportKind, canvas: HTMLCanvasElement) { exportCard(kind, 'Channel utilisation', { canvas }); }
  exportRadios(kind: ExportKind) { exportCard(kind, 'Access point health', { table: this.radiosTable()?.nativeElement }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, 'Wi-Fi'); } finally { this.exporting.set(false); }
  }
}
