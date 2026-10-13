import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LoginHistoryService,
  LoginHistoryItem,
  LoginHistoryStats,
  LoginHistoryFilter
} from '../../../services/login-history.service';
import { ToastService } from '../../../services/toast.service';

type DatePreset = 'today' | '7d' | '30d' | '';

interface ActiveFilter {
  key: 'dates' | 'eventType' | 'email' | 'ipAddress' | 'latestOnly';
  label: string;
}

@Component({
  selector: 'app-login-history',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './login-history.html',
  styleUrls: ['./login-history.css']
})
export class LoginHistoryComponent implements OnInit {
  private readonly loginService = inject(LoginHistoryService);
  private readonly toast = inject(ToastService);

  // Data signals
  readonly items = signal<LoginHistoryItem[]>([]);
  readonly totalCount = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  // Summary stats signal
  readonly stats = signal<LoginHistoryStats>({
    loginsToday: 0,
    failedToday: 0,
    distinctUsersToday: 0
  });

  // Filter signals
  readonly fromDate = signal<string>('');
  readonly toDate = signal<string>('');
  readonly email = signal<string>('');
  readonly eventType = signal<string>('');
  readonly ipAddress = signal<string>('');
  readonly latestOnly = signal<boolean>(false);
  readonly activePreset = signal<DatePreset>('today');

  readonly pageSizeOptions = [25, 50, 100, 200];
  readonly presets: { key: DatePreset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: '', label: 'All time' }
  ];

  readonly totalPages = computed(() => {
    const s = this.pageSize();
    return s > 0 ? Math.ceil(this.totalCount() / s) : 0;
  });

  readonly activeFilters = computed(() => this.describeFilters());

  ngOnInit(): void {
    this.setPreset('today');
  }

  setPreset(preset: DatePreset): void {
    this.activePreset.set(preset);
    const now = new Date();
    if (preset === 'today') {
      const day = this.isoDay(now);
      this.fromDate.set(day);
      this.toDate.set(day);
    } else if (preset === '7d') {
      const past = new Date(now.getTime() - 6 * 86400000);
      this.fromDate.set(this.isoDay(past));
      this.toDate.set(this.isoDay(now));
    } else if (preset === '30d') {
      const past = new Date(now.getTime() - 29 * 86400000);
      this.fromDate.set(this.isoDay(past));
      this.toDate.set(this.isoDay(now));
    } else {
      this.fromDate.set('');
      this.toDate.set('');
    }
    this.page.set(1);
    this.loadLoginHistory();
  }

  applyFilters(): void {
    this.page.set(1);
    this.loadLoginHistory();
  }

  resetFilters(): void {
    this.fromDate.set('');
    this.toDate.set('');
    this.email.set('');
    this.eventType.set('');
    this.ipAddress.set('');
    this.latestOnly.set(false);
    this.activePreset.set('');
    this.page.set(1);
    this.loadLoginHistory();
  }

  clearFilter(key: ActiveFilter['key']): void {
    switch (key) {
      case 'dates': this.fromDate.set(''); this.toDate.set(''); this.activePreset.set(''); break;
      case 'eventType': this.eventType.set(''); break;
      case 'email': this.email.set(''); break;
      case 'ipAddress': this.ipAddress.set(''); break;
      case 'latestOnly': this.latestOnly.set(false); break;
    }
    this.applyFilters();
  }

  loadLoginHistory(): void {
    this.loading.set(true);
    this.loadError.set(null);

    const filter: LoginHistoryFilter = {
      page: this.page(),
      pageSize: this.pageSize(),
      fromDate: this.fromDate() || undefined,
      toDate: this.toDate() || undefined,
      email: this.email() || undefined,
      eventType: this.eventType() || undefined,
      ipAddress: this.ipAddress() || undefined,
      latestOnly: this.latestOnly()
    };

    this.loginService.getPagedLoginHistory(filter).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.isSuccessful && res.data) {
          this.items.set(res.data.items ?? []);
          this.totalCount.set(res.data.totalCount ?? 0);
          if (res.data.stats) {
            this.stats.set(res.data.stats);
          }
        }
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.message ?? err?.message ?? 'Failed to load login history.';
        this.loadError.set(msg);
        this.toast.error(msg);
      }
    });
  }

  onPageChange(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.loadLoginHistory();
  }

  onPageSizeChange(newSize: number): void {
    this.pageSize.set(Number(newSize));
    this.page.set(1);
    this.loadLoginHistory();
  }

  private describeFilters(): ActiveFilter[] {
    const list: ActiveFilter[] = [];
    const from = this.fromDate(), to = this.toDate();
    if (from || to) {
      const preset = this.presets.find(p => p.key && p.key === this.activePreset());
      list.push({ key: 'dates', label: preset ? preset.label : `${from || '...'} to ${to || '...'}` });
    }
    if (this.eventType()) list.push({ key: 'eventType', label: `Event: ${this.eventType()}` });
    if (this.email()) list.push({ key: 'email', label: `Email: ${this.email()}` });
    if (this.ipAddress()) list.push({ key: 'ipAddress', label: `IP: ${this.ipAddress()}` });
    if (this.latestOnly()) list.push({ key: 'latestOnly', label: 'Last login per user' });
    return list;
  }

  private isoDay(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  initial(email?: string | null): string {
    return (email || 'U').trim().charAt(0).toUpperCase();
  }

  relativeTime(utc?: string | null): string {
    if (!utc) return '';
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(utc) ? utc : utc + 'Z';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 0) return '';
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return d <= 31 ? (d === 1 ? 'yesterday' : `${d}d ago`) : '';
  }

  getEventBadgeClass(eventType?: string): string {
    switch (eventType?.toUpperCase()) {
      case 'LOGIN': return 'badge-login';
      case 'FAILED': return 'badge-failed';
      case 'LOGOUT': return 'badge-logout';
      default: return 'badge-logout';
    }
  }
}
