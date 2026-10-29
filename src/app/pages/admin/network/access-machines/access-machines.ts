import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HikDeviceService } from '../../../../services/hik-device.service';
import { ToastService } from '../../../../services/toast.service';
import { NetworkAccessMachine } from '../../../../models/hik-device.model';
import { NET_SHARED, ago, errMsg } from '../network-shared';

type StatusFilter = '' | 'online' | 'offline';

const UNASSIGNED = 'Unassigned';

/** Minutes as "2 h 10 m" / "10 m" / "3 d 4 h". */
export function offlineText(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m >= 1440) return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
  if (m >= 60) return `${Math.floor(m / 60)} h ${m % 60} m`;
  return `${m} m`;
}

/**
 * Network > Access Machines: the Hikvision door machines with online / offline, last seen and connection details
 * (super admin: all locations; network engineer: their locations, the API scopes it). Test / Test all re-check the
 * machines. Refreshes every 60 s while the page is open and visible.
 */
@Component({
  selector: 'app-access-machines',
  standalone: true,
  imports: [FormsModule, ...NET_SHARED],
  templateUrl: './access-machines.html',
  styleUrls: ['../network-shared.css'],
  styles: [`
    .am-banner { display: flex; gap: 10px; margin-bottom: 20px; padding: 12px 16px; border-radius: 12px; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; font-size: 0.86rem; }
    .am-banner ul { margin: 4px 0 0; padding-left: 18px; }
    .am-banner li { margin: 2px 0; }
    /* Table: same look as Fee Receipts (fr-table). */
    .am-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; margin-bottom: 22px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03), 0 2px 8px -2px rgba(15, 23, 42, 0.04); }
    .am-table-wrap { overflow-x: auto; width: 100%; scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }
    .am-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; text-align: left; }
    .am-table th { background: #f8fafc; color: #475569; font-weight: 700; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.05em;
      padding: 14px 18px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
    .am-table td { padding: 14px 18px; border-bottom: 1px solid #f1f5f9; color: #0f172a; vertical-align: middle; }
    .am-table tr:hover td { background: #f8fafc; }
    .am-table tr.offline-row td:first-child { border-left: 3px solid #ef4444; }
    .am-table .num { text-align: right; }
    .am-table .text-right { text-align: right; }
    .am-table .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; }
    .am-name { font-weight: 600; color: #0f172a; }
    .am-wrap { overflow-wrap: anywhere; }
    .am-table td:nth-child(3), .am-table td:last-child { white-space: nowrap; }
    .am-subtext { font-size: 0.76rem; color: #64748b; margin-top: 2px; }
    .am-status { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 0.74rem; font-weight: 700; }
    .am-status.on { background: #dcfce7; color: #166534; }
    .am-status.off { background: #fee2e2; color: #b91c1c; }
    .am-btn-icon { width: 32px; height: 32px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #475569; display: inline-flex;
      align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; }
    .am-btn-icon:hover:not(:disabled) { background: #f0fdfa; border-color: #0d9488; color: #0d9488; }
    .am-btn-icon:disabled { opacity: 0.55; cursor: not-allowed; }
    @media (max-width: 760px) { .am-banner { padding: 12px; } .am-table th, .am-table td { padding: 12px 14px; } }`]
})
export class AccessMachinesPage implements OnInit, OnDestroy {
  private hik = inject(HikDeviceService);
  private toast = inject(ToastService);

  data = signal<NetworkAccessMachine[] | null>(null);
  loadedAt = signal<number | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  testingAll = signal(false);
  testing = signal<ReadonlySet<number>>(new Set());
  error = signal<string | null>(null);
  now = signal(Date.now());

  search = signal('');
  location = signal('');
  status = signal<StatusFilter>('');

  private timers: ReturnType<typeof setInterval>[] = [];

  updatedText = computed(() => { this.now(); const t = this.loadedAt(); return t ? `Updated ${ago(t)}` : ''; });

  /** Locations of the machines the API returned (a network engineer only gets their own). */
  locations = computed(() => [...new Set((this.data() || []).map(m => this.locOf(m)))].sort((a, b) => a.localeCompare(b)));

  offline = computed(() => (this.data() || []).filter(m => !m.online)
    .sort((a, b) => this.locOf(a).localeCompare(this.locOf(b)) || this.since(a) - this.since(b) || a.name.localeCompare(b.name)));

  /** Machines per location (filtered): offline first, then name. */
  groups = computed(() => {
    const q = this.search().trim().toLowerCase(), loc = this.location(), st = this.status();
    const list = (this.data() || [])
      .filter(m => !loc || this.locOf(m) === loc)
      .filter(m => !st || (st === 'online') === m.online)
      .filter(m => !q || [m.name, m.host, m.host2, m.code, m.code ? `room ${m.code}` : ''].join(' ').toLowerCase().includes(q))
      .sort((a, b) => this.locOf(a).localeCompare(this.locOf(b)) || Number(a.online) - Number(b.online) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    const out: { name: string; items: NetworkAccessMachine[] }[] = [];
    for (const m of list) {
      const name = this.locOf(m);
      const last = out[out.length - 1];
      if (last && last.name === name) last.items.push(m); else out.push({ name, items: [m] });
    }
    return out;
  });

  stats = computed(() => {
    const all = this.data() || [];
    return { total: all.length, online: all.filter(m => m.online).length };
  });

  ngOnInit() {
    this.load();
    this.timers.push(
      setInterval(() => { if (document.visibilityState === 'visible') this.load(true); }, 60000),
      setInterval(() => this.now.set(Date.now()), 5000)
    );
  }

  ngOnDestroy() { this.timers.forEach(t => clearInterval(t)); }

  /** Back on this tab: refresh right away instead of waiting for the next tick. */
  @HostListener('document:visibilitychange')
  onVisibility() { if (document.visibilityState === 'visible' && this.data()) this.load(true); }

  load(silent = false, done?: () => void) {
    if (!silent) this.loading.set(true);
    this.hik.getNetworkAccessMachines().subscribe({
      next: res => { this.data.set(res?.data || []); this.loadedAt.set(Date.now()); this.now.set(Date.now()); this.error.set(null); this.loading.set(false); done?.(); },
      error: err => {
        this.loading.set(false);
        if (!silent || !this.data()) this.error.set(`Couldn't load the access machines: ${errMsg(err)}`);
        done?.();
      }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => this.refreshing.set(false));
  }

  test(m: NetworkAccessMachine) {
    this.testing.update(s => new Set(s).add(m.id));
    this.hik.testNetworkAccessMachine(m.id).subscribe({
      next: res => {
        this.stopTesting(m.id);
        const fresh = res?.data?.machine;
        if (fresh) this.data.update(list => (list || []).map(x => (x.id === fresh.id ? fresh : x)));
        this.toast.show(res?.message || (fresh?.online ? 'Online.' : 'Offline.'), fresh?.online ? 'success' : 'warning');
      },
      error: err => { this.stopTesting(m.id); this.toast.show(errMsg(err, 'The test failed.'), 'error'); }
    });
  }

  testAll() {
    this.testingAll.set(true);
    this.hik.testAllNetworkAccessMachines().subscribe({
      next: res => {
        this.toast.show(res?.message || 'Done.', 'info');
        this.load(true, () => this.testingAll.set(false));
      },
      error: err => { this.testingAll.set(false); this.toast.show(errMsg(err, 'The test failed.'), 'error'); }
    });
  }

  private stopTesting(id: number) { this.testing.update(s => { const n = new Set(s); n.delete(id); return n; }); }

  locOf(m: NetworkAccessMachine) { return m.locationName || UNASSIGNED; }
  label(m: NetworkAccessMachine) { return m.code ? `Room ${m.code}` : m.name; }
  lastSeen(m: NetworkAccessMachine) { return m.lastSeen ? `last seen ${ago(m.lastSeen)}` : 'never seen'; }

  /** When it was last seen, in ms (0 = never, so those sort first). */
  private since(m: NetworkAccessMachine) { return m.lastSeen ? new Date(m.lastSeen).getTime() : 0; }

  /** Banner line: "Room 313 (I-8) offline for 2 h 10 m". */
  bannerText(m: NetworkAccessMachine) {
    const base = `${this.label(m)} (${this.locOf(m)}) offline`;
    return m.lastSeen ? `${base} for ${offlineText((this.now() - this.since(m)) / 60000)}` : `${base}, never seen`;
  }

}
