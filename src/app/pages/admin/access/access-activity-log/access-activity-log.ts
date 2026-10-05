import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HikDeviceService } from '../../../../services/hik-device.service';
import { HikAccessEvent, HikAccessMethod, HikDevice, HikSyncActivity } from '../../../../models/hik-device.model';
import { METHOD_LABELS, PeriodPreset, addDays, downloadCsv, initials, localDate, periodRange, relStamp } from '../access-shared';

type LogMode = 'entries' | 'system';

@Component({
  selector: 'app-access-activity-log',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './access-activity-log.html',
  styleUrls: ['../access-shared.css']
})
export class AccessActivityLog implements OnInit, OnDestroy {
  private hik = inject(HikDeviceService);
  private refreshTimer?: ReturnType<typeof setInterval>;

  readonly pageSize = 50;
  readonly methodLabels = METHOD_LABELS;
  readonly relStamp = relStamp;
  readonly initials = initials;

  mode = signal<LogMode>('entries');
  devices = signal<HikDevice[]>([]);

  // Server-side filters (entries)
  period = signal<PeriodPreset>('today');
  customFrom = signal(localDate());
  customTo = signal(localDate());
  deviceId = signal<number | null>(null);

  // Client-side filters
  method = signal<'all' | HikAccessMethod>('all');
  result = signal<'all' | 'ok' | 'denied'>('all');
  search = signal('');
  page = signal(1);

  events = signal<HikAccessEvent[]>([]);
  activity = signal<HikSyncActivity[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  updatedAt = signal<Date | null>(null);

  filteredEvents = computed(() => {
    const q = this.search().trim().toLowerCase();
    const m = this.method();
    const r = this.result();
    return this.events().filter(e => {
      if (m !== 'all' && e.method !== m) return false;
      if (r === 'ok' && e.isDenied) return false;
      if (r === 'denied' && !e.isDenied) return false;
      if (!q) return true;
      return [e.name, e.employeeNo, e.device, e.cardNo, e.label].some(v => (v || '').toLowerCase().includes(q));
    });
  });

  filteredActivity = computed(() => {
    const q = this.search().trim().toLowerCase();
    const r = this.result();
    return this.activity().filter(a => {
      if (r === 'ok' && !a.ok) return false;
      if (r === 'denied' && a.ok) return false;
      if (!q) return true;
      return [a.action, a.employeeName, a.deviceName, a.detail].some(v => (v || '').toLowerCase().includes(q));
    });
  });

  totalRows = computed(() => this.mode() === 'entries' ? this.filteredEvents().length : this.filteredActivity().length);
  totalPages = computed(() => Math.max(1, Math.ceil(this.totalRows() / this.pageSize)));
  pagedEvents = computed(() => this.slice(this.filteredEvents()));
  pagedActivity = computed(() => this.slice(this.filteredActivity()));

  hasFilters = computed(() => this.method() !== 'all' || this.result() !== 'all' || !!this.search().trim() || !!this.deviceId());

  ngOnInit() {
    this.hik.getDevices().subscribe({ next: (d) => this.devices.set(d || []) });
    this.load();
    // Live refresh every 15s while the selected range includes today.
    this.refreshTimer = setInterval(() => {
      if (this.mode() === 'system' || periodRange(this.period(), this.customFrom(), this.customTo()).to >= localDate()) this.load(true);
    }, 15000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  load(silent = false) {
    if (!silent) this.loading.set(true);
    const done = () => { this.loading.set(false); this.updatedAt.set(new Date()); this.error.set(null); };
    const fail = (err: any) => {
      this.loading.set(false);
      if (!silent) this.error.set(err.error?.message || err.message || 'Failed to load the activity log.');
    };

    if (this.mode() === 'system') {
      this.hik.getAccessActivity(500).subscribe({ next: (rows) => { this.activity.set(rows || []); done(); }, error: fail });
      return;
    }

    const { from, to } = periodRange(this.period(), this.customFrom(), this.customTo());
    this.hik.getAccessEvents({ from, to: addDays(to, 1), deviceId: this.deviceId(), limit: 2000 }).subscribe({
      next: (rows) => { this.events.set(rows || []); done(); },
      error: fail
    });
  }

  // Filter changes that need new data from the server
  setMode(mode: LogMode) { this.mode.set(mode); this.page.set(1); this.load(); }
  setPeriod(p: PeriodPreset) { this.period.set(p); this.page.set(1); if (p !== 'custom') this.load(); }
  setDevice(id: number | null) { this.deviceId.set(id ? Number(id) : null); this.page.set(1); this.load(); }
  applyCustom() { this.page.set(1); this.load(); }

  // Client-side filter changes
  setMethod(m: 'all' | HikAccessMethod) { this.method.set(m); this.page.set(1); }
  setResult(r: 'all' | 'ok' | 'denied') { this.result.set(r); this.page.set(1); }
  setSearch(q: string) { this.search.set(q); this.page.set(1); }

  resetFilters() {
    this.method.set('all');
    this.result.set('all');
    this.search.set('');
    this.page.set(1);
    if (this.deviceId()) { this.deviceId.set(null); this.load(); }
  }

  prevPage() { this.page.update(p => Math.max(1, p - 1)); }
  nextPage() { this.page.update(p => Math.min(this.totalPages(), p + 1)); }

  exportCsv() {
    const { from, to } = periodRange(this.period(), this.customFrom(), this.customTo());
    if (this.mode() === 'entries') {
      downloadCsv(`access_entries_${from}_${to}.csv`,
        ['Time', 'Name', 'EmployeeNo', 'Machine', 'Method', 'CardNo', 'Event', 'Status'],
        this.filteredEvents().map(e => [e.time, e.name, e.employeeNo, e.device, METHOD_LABELS[e.method], e.cardNo, e.label, e.isDenied ? 'Denied' : 'Authorized']));
    } else {
      downloadCsv(`access_activity_${localDate()}.csv`,
        ['Time', 'Member', 'Machine', 'Action', 'Result', 'Detail'],
        this.filteredActivity().map(a => [a.time, a.employeeName, a.deviceName, a.action, a.ok ? 'OK' : 'Failed', a.detail]));
    }
  }

  prettyAction(action?: string | null): string {
    if (!action) return '—';
    if (action.startsWith('AUDIT:')) return 'Admin: ' + action.slice(6).replace(/[-_]/g, ' ').toLowerCase();
    if (action.startsWith('queued:')) return 'Queued for offline machine (' + action.slice(7) + ')';
    if (action.startsWith('applied-queued:')) return 'Applied queued change (' + action.slice(15) + ')';
    if (action.startsWith('dropped-queued:')) return 'Dropped queued change (' + action.slice(15) + ')';
    return action.replace(/[-_]/g, ' ').replace(/^\w/, c => c.toUpperCase());
  }

  shortDetail(detail?: string | null): string {
    if (!detail) return '';
    return detail.length > 90 ? detail.slice(0, 90) + '…' : detail;
  }

  private slice<T>(rows: T[]): T[] {
    const start = (Math.min(this.page(), this.totalPages()) - 1) * this.pageSize;
    return rows.slice(start, start + this.pageSize);
  }
}
