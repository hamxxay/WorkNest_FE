import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { GwnDevice, GwnService, gwnErrorText } from '../../../../services/gwn.service';
import { ExportKind, NET_SHARED, ago, bytes, dur, exportCard, exportPagePdf, fmt } from '../network-shared';
import { NetworkSwitch } from '../gwn-switch/gwn-switch';
import { gwnTypeIcon, pctText } from '../gwn-shared/gwn-shared';

type StatusFilter = '' | 'online' | 'offline' | 'update';
type SortKey = 'name' | 'status' | 'type' | 'clients' | 'ip' | 'today' | 'memory' | 'temp' | 'firmware' | 'uptime';

/** Temperature (°C) from which a device is shown in amber. */
export const HOT_C = 70;

@Component({
  selector: 'app-gwn-devices',
  standalone: true,
  imports: [FormsModule, RouterLink, ...NET_SHARED, NetworkSwitch],
  templateUrl: './gwn-devices.html',
  styleUrls: ['../network-shared.css', '../gwn-shared/gwn.css'],
  styles: [`.temp-hot { color: #b45309; font-weight: 700; }`]
})
export class GwnDevicesPage implements OnInit, OnDestroy {
  private gwn = inject(GwnService);
  private router = inject(Router);

  page = viewChild<ElementRef<HTMLElement>>('page');
  devTable = viewChild<ElementRef<HTMLTableElement>>('devTable');

  data = signal<GwnDevice[] | null>(null);
  loadedAt = signal<number | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  unavailable = signal<string | null>(null);
  now = signal(Date.now());

  search = signal('');
  dtype = signal('');
  status = signal<StatusFilter>('');
  /** null = default order (offline first, then type, then name). */
  sort = signal<SortKey | null>(null);
  dir = signal<1 | -1>(1);

  private timers: ReturnType<typeof setInterval>[] = [];

  readonly fmt = fmt;
  readonly bytes = bytes;
  readonly pctText = pctText;
  readonly gwnTypeIcon = gwnTypeIcon;
  readonly HOT_C = HOT_C;

  updatedText = computed(() => { this.now(); const t = this.loadedAt(); return t ? `Updated ${ago(t)}` : ''; });

  types = computed(() => [...new Set((this.data() || []).map(d => d.type).filter(Boolean))].sort());

  stats = computed(() => {
    const all = this.data();
    if (!all) return null;
    const on = (l: GwnDevice[]) => l.filter(x => x.status === 'online').length;
    const aps = all.filter(x => /access point/i.test(x.type || ''));
    const routers = all.filter(x => /router|gateway/i.test(x.type || ''));
    return {
      total: all.length, online: on(all),
      aps: aps.length, apsOnline: on(aps), apClients: aps.reduce((a, x) => a + (x.clients || 0), 0),
      routers: routers.length, routersOnline: on(routers),
      today: all.reduce((a, x) => a + (x.today?.total || 0), 0),
      updates: all.filter(x => this.hasUpdate(x)).length
    };
  });

  rows = computed(() => {
    const q = this.search().trim().toLowerCase();
    const t = this.dtype(), st = this.status();
    const list = (this.data() || [])
      .filter(x => !q || [x.name, x.model, x.ip, x.publicIp, x.mac, x.type, x.firmware].join(' ').toLowerCase().includes(q))
      .filter(x => !t || x.type === t)
      .filter(x => !st || (st === 'online' ? x.status === 'online' : st === 'offline' ? x.status !== 'online' : this.hasUpdate(x)));
    const sk = this.sort();
    if (!sk) {
      return list.sort((a, b) => Number(a.status === 'online') - Number(b.status === 'online') || (a.type || '').localeCompare(b.type || '') || (a.name || '').localeCompare(b.name || ''));
    }
    const dir = this.dir();
    const on = (d: GwnDevice) => d.status === 'online';
    const key: (d: GwnDevice) => string | number = {
      name: (d: GwnDevice) => (d.name || '').toLowerCase(),
      status: (d: GwnDevice) => (on(d) ? 1 : 0),
      type: (d: GwnDevice) => (d.type || '').toLowerCase(),
      clients: (d: GwnDevice) => d.clients || 0,
      ip: (d: GwnDevice) => (d.ip || '').split('.').map(n => n.padStart(3, '0')).join('.'),
      today: (d: GwnDevice) => d.today?.total || 0,
      memory: (d: GwnDevice) => d.memory ?? -1,
      temp: (d: GwnDevice) => d.temperature ?? -999,
      firmware: (d: GwnDevice) => (d.firmware || '').split('.').map(n => n.padStart(6, '0')).join('.'),
      uptime: (d: GwnDevice) => (on(d) ? d.uptimeSeconds ?? 0 : -1)
    }[sk];
    return list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * dir || (a.name || '').localeCompare(b.name || ''));
  });

  constructor() {
    effect(() => { this.gwn.net(); untracked(() => { this.data.set(null); this.load(); }); });
  }

  ngOnInit() {
    this.timers.push(
      setInterval(() => this.load(true), 60000),
      setInterval(() => this.now.set(Date.now()), 5000)
    );
  }

  ngOnDestroy() { this.timers.forEach(t => clearInterval(t)); }

  load(silent = false, done?: () => void) {
    if (!silent) this.loading.set(true);
    this.gwn.getDevices().subscribe({
      next: res => { this.data.set(res); this.loadedAt.set(Date.now()); this.error.set(null); this.unavailable.set(null); this.loading.set(false); done?.(); },
      error: err => {
        this.loading.set(false);
        if (err?.unavailable) this.unavailable.set(gwnErrorText(err));
        else if (!silent || !this.data()) this.error.set(`Couldn't load devices: ${gwnErrorText(err)}`);
        done?.();
      }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => { this.refreshing.set(false); this.now.set(Date.now()); });
  }

  setSort(key: SortKey) {
    if (this.sort() === key) this.dir.set(this.dir() > 0 ? -1 : 1);
    else this.dir.set(['clients', 'today', 'memory', 'temp', 'uptime', 'status'].includes(key) ? -1 : 1);
    this.sort.set(key);
  }
  sortMark(key: SortKey) { return this.sort() === key ? (this.dir() > 0 ? ' (asc)' : ' (desc)') : ''; }
  ariaSort(key: SortKey) { return this.sort() === key ? (this.dir() > 0 ? 'ascending' : 'descending') : 'none'; }

  isHot(d: GwnDevice) { return d.temperature != null && d.temperature >= HOT_C; }

  hasUpdate(d: GwnDevice) { return !!d.latestFirmware && d.latestFirmware !== d.firmware; }
  uptime(d: GwnDevice) { return d.status === 'online' ? dur(d.uptimeSeconds) : '–'; }
  lastSeen(d: GwnDevice) { return d.status === 'online' ? '' : d.lastSeen ? `Last seen ${ago(d.lastSeen)}` : ''; }

  link(d: GwnDevice) { return ['/admin/network/gwn/device', d.mac]; }

  open(d: GwnDevice, e: Event) {
    if ((e.target as HTMLElement).closest('a')) return;
    this.router.navigate(this.link(d));
  }

  onExport(kind: ExportKind) { exportCard(kind, 'F-7 devices', { table: this.devTable()?.nativeElement }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, 'F-7 Devices'); } finally { this.exporting.set(false); }
  }
}
