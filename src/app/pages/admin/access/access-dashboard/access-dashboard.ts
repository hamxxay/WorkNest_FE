import { ToastService } from '../../../../services/toast.service';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HikDeviceService } from '../../../../services/hik-device.service';
import { HikAccessDashboard, HikAccessEvent } from '../../../../models/hik-device.model';
import {
  ACCENT, Chart, METHOD_LABELS, addDays, downloadCsv, formatTime12, hourLabel, hourRangeLabel, initials, localDate, relStamp
} from '../access-shared';

type HourFilter = 'all' | 'fingerprint' | 'face' | 'card' | 'door' | 'denied';

@Component({
  selector: 'app-access-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './access-dashboard.html',
  styleUrls: ['../access-shared.css', './access-dashboard.css']
})
export class AccessDashboard implements OnInit, OnDestroy {
  private hik = inject(HikDeviceService);
  private toast = inject(ToastService);

  @ViewChild('inflowCanvas', { static: true }) inflowCanvas!: ElementRef<HTMLCanvasElement>;
  private inflowChart?: Chart;
  private refreshTimer?: ReturnType<typeof setInterval>;

  data = signal<HikAccessDashboard | null>(null);
  /** Machines being tested right now ("Test" button), and whether "Test all" is running. */
  testingIds = signal<number[]>([]);
  testingAll = signal(false);
  loading = signal(true);
  error = signal<string | null>(null);
  updatedAt = signal<Date | null>(null);

  offlineDevices = computed(() => (this.data()?.devices || []).filter(d => !d.online));
  greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  });

  // Hourly drill-down modal
  showHourModal = signal(false);
  hourModalHour = signal(0);
  hourEvents = signal<HikAccessEvent[]>([]);
  hourLoading = signal(false);
  hourSearch = signal('');
  hourFilter = signal<HourFilter>('all');

  filteredHourEvents = computed(() => {
    const q = this.hourSearch().trim().toLowerCase();
    const f = this.hourFilter();
    return this.hourEvents().filter(e => {
      if (f === 'denied' && !e.isDenied) return false;
      if (f !== 'all' && f !== 'denied' && e.method !== f) return false;
      if (!q) return true;
      return [e.name, e.employeeNo, e.device, e.cardNo].some(v => (v || '').toLowerCase().includes(q));
    });
  });

  hourSummary = computed(() => {
    const events = this.hourEvents();
    const people = new Set(events.map(e => e.employeeNo || e.name).filter(Boolean));
    const byDevice = new Map<string, number>();
    events.forEach(e => byDevice.set(e.device || '—', (byDevice.get(e.device || '—') || 0) + 1));
    const top = [...byDevice.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      total: events.length,
      people: people.size,
      topDevice: top?.[0] || '—',
      topDeviceCount: top?.[1] || 0,
      face: events.filter(e => e.method === 'face').length,
      fingerprint: events.filter(e => e.method === 'fingerprint').length,
      card: events.filter(e => e.method === 'card').length,
      door: events.filter(e => e.method === 'door').length,
      denied: events.filter(e => e.isDenied).length
    };
  });

  readonly methodLabels = METHOD_LABELS;
  readonly relStamp = relStamp;
  readonly formatTime12 = formatTime12;
  readonly initials = initials;
  readonly hourRangeLabel = hourRangeLabel;

  ngOnInit() {
    this.load();
    // Live refresh every 30s (skipped while the drill-down is open).
    this.refreshTimer = setInterval(() => { if (!this.showHourModal()) this.load(true); }, 30000);
  }

  /** Connects to one machine now and shows / saves whether it is online. */
  testMachine(m: { id: number; name: string }) {
    if (this.testingIds().includes(m.id)) return;
    this.testingIds.update(ids => [...ids, m.id]);
    this.hik.testDevice(m.id).subscribe({
      next: (res: any) => {
        this.testingIds.update(ids => ids.filter(x => x !== m.id));
        const r = res?.data;
        if (r) this.applyTestResults([r]);
        if (r?.online) this.toast.success(res?.message || `${m.name} is online.`);
        else this.toast.error(res?.message || `${m.name} is offline.`);
      },
      error: (err: any) => {
        this.testingIds.update(ids => ids.filter(x => x !== m.id));
        this.toast.error(err?.error?.message || 'The machine could not be tested.');
      }
    });
  }

  testAllMachines() {
    if (this.testingAll()) return;
    this.testingAll.set(true);
    this.hik.testAllDevices().subscribe({
      next: (res: any) => {
        this.testingAll.set(false);
        this.applyTestResults(res?.data || []);
        this.toast.success(res?.message || 'All machines tested.');
        this.load(true);
      },
      error: (err: any) => {
        this.testingAll.set(false);
        this.toast.error(err?.error?.message || 'The machines could not be tested.');
      }
    });
  }

  isTesting(id: number): boolean { return this.testingAll() || this.testingIds().includes(id); }

  private applyTestResults(results: { deviceId: number; online: boolean }[]) {
    const d = this.data();
    if (!d) return;
    const byId = new Map(results.map(r => [r.deviceId, r.online]));
    const devices = (d.devices || []).map((m: any) => byId.has(m.id)
      ? { ...m, online: byId.get(m.id), last_seen: byId.get(m.id) ? new Date().toISOString() : m.last_seen }
      : m);
    const online = devices.filter((m: any) => m.online).length;
    this.data.set({ ...d, devices, stats: { ...d.stats, devicesOnline: online } } as any);
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.inflowChart?.destroy();
  }

  load(silent = false) {
    if (!silent) this.loading.set(true);
    this.hik.getAccessDashboard().subscribe({
      next: (res) => {
        this.data.set(res);
        this.error.set(null);
        this.loading.set(false);
        this.updatedAt.set(new Date());
        this.renderInflow(res.hourlyToday || []);
      },
      error: (err) => {
        this.loading.set(false);
        // Keep the last good data on a failed silent refresh.
        if (!silent || !this.data()) this.error.set(err.error?.message || err.message || 'Failed to load the access dashboard.');
      }
    });
  }

  private renderInflow(hourly: number[]) {
    const nowHour = new Date().getHours();
    const labels = hourly.map((_, h) => hourLabel(h));
    // Hours after "now" are in the future today — leave them blank instead of plotting zeros.
    const values = hourly.map((v, h) => (h <= nowHour ? v : null));

    if (this.inflowChart) {
      this.inflowChart.data.labels = labels;
      this.inflowChart.data.datasets[0].data = values;
      this.inflowChart.update('none');
      return;
    }

    this.inflowChart = new Chart(this.inflowCanvas.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Scans',
          data: values,
          borderColor: ACCENT,
          backgroundColor: 'rgba(13, 148, 136, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: ACCENT
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => hourRangeLabel(items[0].dataIndex),
              label: (item) => `${item.formattedValue} scans — click for details`
            }
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } },
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }
        },
        onClick: (_evt, elements, chart) => {
          const idx = elements[0]?.index ?? chart.tooltip?.dataPoints?.[0]?.dataIndex;
          if (idx != null && idx <= new Date().getHours()) this.openHour(idx);
        }
      }
    });
  }

  // ---- Hourly drill-down ----

  openHour(hour: number) {
    const today = localDate();
    const hh = String(hour).padStart(2, '0');
    const to = hour === 23 ? `${addDays(today, 1)}T00:00:00` : `${today}T${String(hour + 1).padStart(2, '0')}:00:00`;

    this.hourModalHour.set(hour);
    this.hourSearch.set('');
    this.hourFilter.set('all');
    this.hourEvents.set([]);
    this.hourLoading.set(true);
    this.showHourModal.set(true);

    this.hik.getAccessEvents({ from: `${today}T${hh}:00:00`, to, limit: 1000 }).subscribe({
      next: (events) => { this.hourEvents.set(events); this.hourLoading.set(false); },
      error: () => this.hourLoading.set(false)
    });
  }

  closeHour() {
    this.showHourModal.set(false);
  }

  exportHour() {
    const hh = String(this.hourModalHour()).padStart(2, '0');
    downloadCsv(`hourly_scans_${localDate()}_${hh}00.csv`,
      ['Time', 'Name', 'EmployeeNo', 'Machine', 'Method', 'CardNo', 'Event', 'Status'],
      this.filteredHourEvents().map(e => [
        e.time, e.name, e.employeeNo, e.device, METHOD_LABELS[e.method], e.cardNo, e.label, e.isDenied ? 'Denied' : 'Authorized'
      ]));
  }
}
