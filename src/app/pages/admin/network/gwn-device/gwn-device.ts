import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { GwnDeviceDetail, GwnDeviceStats, GwnRange, GwnService, gwnErrorText } from '../../../../services/gwn.service';
import { AuthService } from '../../../../services/auth.service';
import { ToastService } from '../../../../services/toast.service';
import {
  ChartBag, ExportKind, NET_SHARED, S1, S2, ago, avg, baseOptions, bucketPoints, bytes, dur, exportCard, exportPagePdf, fmt, glow, line, thin
} from '../network-shared';
import { NetworkSwitch } from '../gwn-switch/gwn-switch';
import { GWN_RANGES, GwnConfirm, bandLabel, bitRate, clientName, gwnClientIcon, gwnTypeIcon, mbps, ms, pctText, rangeLabel, rangeText } from '../gwn-shared/gwn-shared';

@Component({
  selector: 'app-gwn-device',
  standalone: true,
  imports: [RouterLink, ...NET_SHARED, NetworkSwitch, GwnConfirm],
  templateUrl: './gwn-device.html',
  styleUrls: ['../network-shared.css', '../gwn-shared/gwn.css']
})
export class GwnDevicePage implements OnInit, OnDestroy {
  private gwn = inject(GwnService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  page = viewChild<ElementRef<HTMLElement>>('page');
  trafficCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cTraffic');
  clientsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cClients');

  private charts = new ChartBag();
  private timers: ReturnType<typeof setInterval>[] = [];
  private sub?: Subscription;
  private firstNet = true;

  readonly isSuperAdmin = this.auth.hasRole('super_admin');

  mac = signal('');
  data = signal<GwnDeviceDetail | null>(null);
  stats = signal<GwnDeviceStats | null>(null);
  statsError = signal<string | null>(null);
  loadedAt = signal<number | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  now = signal(Date.now());
  range = signal<GwnRange>('1d');

  confirmReboot = signal(false);
  rebooting = signal(false);

  readonly ranges = GWN_RANGES;
  readonly fmt = fmt;
  readonly bytes = bytes;
  readonly dur = dur;
  readonly ago = ago;
  readonly bitRate = bitRate;
  readonly pctText = pctText;
  readonly bandLabel = bandLabel;
  readonly clientName = clientName;
  readonly gwnClientIcon = gwnClientIcon;
  readonly gwnTypeIcon = gwnTypeIcon;
  readonly clientFmt = (v: number) => `${fmt(v)} clients`;

  updatedText = computed(() => { this.now(); const t = this.loadedAt(); return t ? `Updated ${ago(t)}` : ''; });
  rangeName = computed(() => rangeText(this.range()));
  online = computed(() => this.data()?.status === 'online');
  hasUpdate = computed(() => { const d = this.data(); return !!d?.latestFirmware && d.latestFirmware !== d.firmware; });

  clientSpark = computed(() => {
    const s = this.stats();
    return s ? bucketPoints(s.times.map((t, i) => ({ t: ms(t) ?? undefined, v: s.clients?.[i] ?? null }))) : [];
  });

  clients = computed(() => [...(this.data()?.clientList || [])].sort((a, b) => b.total - a.total));

  trafficStats = computed(() => {
    const s = this.stats();
    if (!s?.times?.length) return null;
    const downs = (s.downloadBps || []).filter(v => v != null);
    return { down: s.downloadTotal, up: s.uploadTotal, avg: avg(downs), peak: downs.length ? Math.max(...downs) : null };
  });

  hasClientSeries = computed(() => (this.stats()?.clients || []).some(v => (v || 0) > 0));

  constructor() {
    effect(() => this.renderTraffic());
    effect(() => this.renderClients());
    // Another Grandstream network chosen in the switch: this device is not on it, go to its device list.
    effect(() => {
      this.gwn.net();
      if (this.firstNet) { this.firstNet = false; return; }
      this.router.navigateByUrl('/admin/network/gwn/devices');
    });
  }

  ngOnInit() {
    this.sub = this.route.paramMap.subscribe(pm => {
      this.mac.set((pm.get('mac') || '').toUpperCase());
      this.data.set(null);
      this.stats.set(null);
      this.error.set(null);
      this.charts.destroyAll();
      this.load();
      this.loadStats();
    });
    this.timers.push(
      setInterval(() => this.load(true), 30000),
      setInterval(() => this.loadStats(), 5 * 60000),
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
    this.gwn.getDevice(mac).subscribe({
      next: res => {
        if (mac !== this.mac()) return;
        this.data.set(res); this.loadedAt.set(Date.now()); this.error.set(null); this.loading.set(false); done?.();
      },
      error: err => {
        if (mac !== this.mac()) return;
        this.loading.set(false);
        if (!silent || !this.data()) this.error.set(`Couldn't load this device: ${gwnErrorText(err)}`);
        done?.();
      }
    });
  }

  loadStats() {
    const mac = this.mac(), range = this.range();
    if (!mac) return;
    this.gwn.getDeviceStats(mac, range).subscribe({
      next: s => { if (mac === this.mac() && range === this.range()) { this.stats.set(s); this.statsError.set(null); } },
      error: err => {
        if (mac !== this.mac() || range !== this.range()) return;
        this.stats.set({ times: [], clients: [], download: [], upload: [], downloadBps: [], uploadBps: [], downloadTotal: 0, uploadTotal: 0 });
        this.statsError.set(gwnErrorText(err));
      }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => this.refreshing.set(false));
    this.loadStats();
  }

  setRange(r: GwnRange) {
    if (r === this.range()) return;
    this.range.set(r);
    this.stats.set(null);
    this.loadStats();
  }

  doReboot() {
    const d = this.data();
    if (!d || !this.isSuperAdmin || this.rebooting()) return;
    this.rebooting.set(true);
    this.gwn.rebootDevice(d.mac).subscribe({
      next: () => {
        this.rebooting.set(false);
        this.confirmReboot.set(false);
        this.toast.success(`${d.name} is restarting. It is usually back in 2–3 minutes.`, 'Reboot sent');
        setTimeout(() => this.load(true), 15000);
      },
      error: err => {
        this.rebooting.set(false);
        this.toast.error(`Couldn't reboot ${d.name}: ${gwnErrorText(err)}`);
      }
    });
  }

  // ---------- Charts ----------

  private renderTraffic() {
    const s = this.stats();
    const canvas = this.trafficCanvas()?.nativeElement;
    if (!s || !canvas) return;
    const range = this.range();
    const idx = thin(s.times.map((_, i) => i));
    this.charts.upsert('traffic', canvas, {
      type: 'line',
      data: {
        labels: idx.map(i => rangeLabel(s.times[i], range)),
        datasets: [
          line('Download', idx.map(i => mbps(s.downloadBps?.[i])), S1, { fill: 'origin', backgroundColor: glow(S1) }),
          line('Upload', idx.map(i => mbps(s.uploadBps?.[i])), S2)
        ]
      },
      options: baseOptions({ unit: 'Mbps', decimals: 1 })
    });
  }

  private renderClients() {
    const s = this.stats();
    const canvas = this.clientsCanvas()?.nativeElement;
    if (!s || !canvas) return;
    const range = this.range();
    const idx = thin(s.times.map((_, i) => i));
    this.charts.upsert('clients', canvas, {
      type: 'line',
      data: { labels: idx.map(i => rangeLabel(s.times[i], range)), datasets: [line('Clients', idx.map(i => s.clients?.[i] ?? null), S1, { stepped: true, tension: 0 })] },
      options: baseOptions({ unit: 'clients', legend: false })
    });
  }

  // ---------- Export ----------

  exportChart(kind: ExportKind, title: string, canvas: HTMLCanvasElement) { exportCard(kind, `${this.data()?.name || 'device'} ${title}`, { canvas }); }
  exportTable(kind: ExportKind, title: string, table: HTMLTableElement) { exportCard(kind, `${this.data()?.name || 'device'} ${title}`, { table }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, this.data()?.name || 'Device'); } finally { this.exporting.set(false); }
  }
}
