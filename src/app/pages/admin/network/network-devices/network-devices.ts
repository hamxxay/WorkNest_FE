import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { UnifiService } from '../../../../services/unifi.service';
import { UnifiDevice, UnifiSummary, UnifiTopology } from '../../../../models/unifi.model';
import { ExportKind, NET_SHARED, ago, dur, errMsg, exportCard, exportPagePdf, fmt, normMac, sum, typeIcon } from '../network-shared';

type StatusFilter = '' | 'online' | 'offline' | 'update';

@Component({
  selector: 'app-network-devices',
  standalone: true,
  imports: [FormsModule, RouterLink, ...NET_SHARED],
  templateUrl: './network-devices.html',
  styleUrls: ['../network-shared.css']
})
export class NetworkDevices implements OnInit, OnDestroy {
  private unifi = inject(UnifiService);
  private router = inject(Router);

  page = viewChild<ElementRef<HTMLElement>>('page');
  devTable = viewChild<ElementRef<HTMLTableElement>>('devTable');

  data = signal<UnifiSummary | null>(null);
  topo = signal<UnifiTopology | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  now = signal(Date.now());

  search = signal('');
  dtype = signal('');
  status = signal<StatusFilter>('');

  private timers: ReturnType<typeof setInterval>[] = [];

  readonly fmt = fmt;
  readonly typeIcon = typeIcon;

  updatedText = computed(() => { this.now(); const d = this.data(); return d?.updatedAt ? `Updated ${ago(d.updatedAt)}` : ''; });
  apiError = computed(() => this.data()?.error || null);

  stats = computed(() => {
    const d = this.data();
    if (!d) return null;
    const all = d.devices;
    const real = all.filter(x => !x.placeholder);
    const online = real.filter(x => x.status === 'online').length;
    const ofType = (t: string) => real.filter(x => x.type === t);
    const onlineOf = (list: UnifiDevice[]) => list.filter(x => x.status === 'online').length;
    const aps = ofType('Access point'), sws = ofType('Switch');
    return {
      total: real.length, online, notInstalled: all.length - real.length,
      aps: aps.length, apsOnline: onlineOf(aps),
      apClients: this.topo() ? sum(aps, a => this.clientsOf(a)) : null,
      sws: sws.length, swsOnline: onlineOf(sws),
      updates: real.filter(x => x.updateAvailable).length
    };
  });

  rows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const q = this.search().trim().toLowerCase();
    const t = this.dtype(), st = this.status();
    return d.devices
      .filter(x => !q || [x.name, x.model, x.ip, x.mac, x.type].join(' ').toLowerCase().includes(q))
      .filter(x => !t || x.type === t)
      .filter(x => !st || (st === 'online' ? x.status === 'online' : st === 'offline' ? x.status !== 'online' : !!x.updateAvailable))
      .sort((a, b) => Number(a.status === 'online') - Number(b.status === 'online') || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  });

  ngOnInit() {
    this.load();
    this.loadTopo();
    this.timers.push(
      setInterval(() => this.load(true), 60000),
      setInterval(() => this.loadTopo(), 60000),
      setInterval(() => this.now.set(Date.now()), 5000)
    );
  }

  ngOnDestroy() {
    this.timers.forEach(t => clearInterval(t));
  }

  load(silent = false) {
    if (!silent) this.loading.set(true);
    this.unifi.getSummary().subscribe({
      next: res => { this.data.set(res); this.error.set(null); this.loading.set(false); },
      error: err => {
        this.loading.set(false);
        if (!silent || !this.data()) this.error.set(`Couldn't load devices: ${errMsg(err)}`);
      }
    });
  }

  loadTopo() {
    this.unifi.getTopology().subscribe({ next: t => this.topo.set(t), error: () => { /* client counts stay blank */ } });
  }

  refresh() {
    this.refreshing.set(true);
    forkJoin([this.unifi.getSummary(), this.unifi.getTopology()]).subscribe({
      next: ([s, t]) => { this.data.set(s); this.topo.set(t); this.error.set(null); this.refreshing.set(false); this.now.set(Date.now()); },
      error: err => { this.error.set(`Couldn't refresh: ${errMsg(err)}`); this.refreshing.set(false); }
    });
  }

  clientsOf(d: UnifiDevice): number | null {
    const n = this.topo()?.nodes.find(x => x.mac === normMac(d.mac));
    return n ? n.clients : null;
  }

  uptime(d: UnifiDevice) {
    return d.status === 'online' && d.startupTime ? dur((Date.now() - new Date(d.startupTime).getTime()) / 1000) : '–';
  }

  updateLabel(d: UnifiDevice) {
    return typeof d.updateAvailable === 'string' ? `Update ${d.updateAvailable}` : 'Update available';
  }

  link(d: UnifiDevice) { return ['/admin/network/device', normMac(d.mac)]; }

  open(d: UnifiDevice, e: Event) {
    if ((e.target as HTMLElement).closest('a')) return;
    this.router.navigate(this.link(d));
  }

  onExport(kind: ExportKind) {
    exportCard(kind, 'Devices', { table: this.devTable()?.nativeElement });
  }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, 'Devices'); } finally { this.exporting.set(false); }
  }
}
