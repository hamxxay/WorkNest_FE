import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HikDeviceService } from '../../../../services/hik-device.service';
import { HikAccessAnalytics, HikCountItem, HikUserAnalytics } from '../../../../models/hik-device.model';
import {
  ACCENT, Chart, METHOD_LABELS, PALETTE, PeriodPreset, formatTime12, hourLabel, hourRangeLabel, initials, localDate, periodRange, relStamp
} from '../access-shared';

@Component({
  selector: 'app-access-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './access-analytics.html',
  styleUrls: ['../access-shared.css', './access-analytics.css']
})
export class AccessAnalytics implements OnInit, OnDestroy {
  private hik = inject(HikDeviceService);

  @ViewChild('hourlyCanvas', { static: true }) hourlyCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('dailyCanvas', { static: true }) dailyCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('doorsCanvas', { static: true }) doorsCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('methodsCanvas', { static: true }) methodsCanvas!: ElementRef<HTMLCanvasElement>;
  private charts: Chart[] = [];

  readonly palette = PALETTE;
  readonly initials = initials;
  readonly relStamp = relStamp;
  readonly formatTime12 = formatTime12;
  readonly methodLabels = METHOD_LABELS;

  period = signal<PeriodPreset>('today');
  customFrom = signal(localDate());
  customTo = signal(localDate());

  data = signal<HikAccessAnalytics | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  isMultiDay = computed(() => { const d = this.data(); return !!d && d.from !== d.to; });
  rangeText = computed(() => { const d = this.data(); return !d ? '' : d.from === d.to ? d.from : `${d.from} → ${d.to}`; });
  topDoors = computed(() => (this.data()?.doors || []).slice(0, 6));

  // User drill-down
  showUser = signal(false);
  userLoading = signal(false);
  user = signal<HikUserAnalytics | null>(null);

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.charts.forEach(c => c.destroy());
  }

  setPeriod(p: PeriodPreset) {
    this.period.set(p);
    if (p !== 'custom') this.load();
  }

  load() {
    const { from, to } = periodRange(this.period(), this.customFrom(), this.customTo());
    this.loading.set(true);
    this.hik.getAccessAnalytics(from, to).subscribe({
      next: (res) => {
        this.data.set(res);
        this.error.set(null);
        this.loading.set(false);
        this.renderCharts(res);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.message || err.message || 'Failed to load access analytics.');
      }
    });
  }

  private renderCharts(d: HikAccessAnalytics) {
    this.charts.forEach(c => c.destroy());
    this.charts = [];

    this.charts.push(new Chart(this.hourlyCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: d.hourly.map((_, h) => hourLabel(h)),
        datasets: [{ label: 'Scans', data: d.hourly, backgroundColor: 'rgba(13, 148, 136, 0.75)', borderRadius: 4, maxBarThickness: 22 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i) => hourRangeLabel(i[0].dataIndex), label: (i) => `${i.formattedValue} scans` } } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } },
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }
        }
      }
    }));

    this.charts.push(new Chart(this.dailyCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: d.daily.map(x => x.date.slice(5)),
        datasets: [{ label: 'Scans', data: d.daily.map(x => x.count), borderColor: ACCENT, backgroundColor: 'rgba(13, 148, 136, 0.12)', fill: true, tension: 0.3, pointRadius: 3 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } }
      }
    }));

    const doors = this.topDoors();
    this.charts.push(new Chart(this.doorsCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: doors.map(x => x.name),
        datasets: [{ data: doors.map(x => x.count), backgroundColor: PALETTE.slice(0, doors.length), borderWidth: 2, borderColor: '#fff' }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } }
    }));

    const m = d.methods;
    this.charts.push(new Chart(this.methodsCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: ['Fingerprint', 'Face', 'Card', 'Door sensor', 'Other'],
        datasets: [{
          data: [m.fingerprint, m.face, m.card, m.door, m.other],
          backgroundColor: ['#7c3aed', '#0284c7', '#d97706', '#94a3b8', '#cbd5e1'],
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } } } }
    }));
  }

  // ---- User drill-down ----

  openUser(u: HikCountItem) {
    const { from, to } = periodRange(this.period(), this.customFrom(), this.customTo());
    this.user.set(null);
    this.userLoading.set(true);
    this.showUser.set(true);
    this.hik.getAccessUserAnalytics(u.employeeNo, u.employeeNo ? null : u.name, from, to).subscribe({
      next: (res) => { this.user.set(res); this.userLoading.set(false); },
      error: () => this.userLoading.set(false)
    });
  }

  closeUser() {
    this.showUser.set(false);
  }
}
