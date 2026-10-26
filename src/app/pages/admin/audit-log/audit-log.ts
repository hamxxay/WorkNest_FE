import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AuditLogService,
  AuditLogItem,
  AuditLogDetail,
  AuditLogFilterOptions,
  AuditLogFilter
} from '../../../services/audit-log.service';
import { ToastService } from '../../../services/toast.service';

export interface DiffRow {
  key: string;
  oldValue: string;
  newValue: string;
  /** The values as shown on screen: no JSON quotes, readable dates, "empty" for null. */
  oldDisplay: string;
  newDisplay: string;
  status: 'changed' | 'added' | 'removed' | 'unchanged';
}

type DatePreset = 'today' | '7d' | '30d' | '';

interface ActiveFilter {
  key: 'dates' | 'operation' | 'entityName' | 'changedByUserEmail' | 'recordId' | 'sourceApp' | 'errorsOnly';
  label: string;
}

const OPERATION_LABELS: Record<string, string> = { I: 'Created', U: 'Updated', D: 'Deleted' };

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './audit-log.html',
  // The shared admin page look (page padding, header, cards, table, buttons, modals) lives in the Manage page
  // stylesheet; this page's own styles come after it.
  styleUrls: ['../manage-base/manage-list.css', './audit-log.css']
})
export class AuditLogComponent implements OnInit {
  private auditService = inject(AuditLogService);
  private toast = inject(ToastService);

  loading = signal(false);
  items = signal<AuditLogItem[]>([]);
  totalCount = signal(0);
  page = signal(1);
  pageSize = signal(50);
  pageSizeOptions = [25, 50, 100, 200];

  totalPages = computed(() => {
    const size = this.pageSize();
    return size > 0 ? Math.max(1, Math.ceil(this.totalCount() / size)) : 1;
  });

  canPrev = computed(() => this.page() > 1);
  canNext = computed(() => this.page() < this.totalPages());

  filterOptions = signal<AuditLogFilterOptions>({
    entityNames: [],
    sourceApps: [],
    operations: ['I', 'U', 'D']
  });

  // Filter models (persisted across pagination)
  fromDate = signal('');
  toDate = signal('');
  operation = signal('');
  entityName = signal('');
  changedByUserEmail = signal('');
  recordId = signal('');
  sourceApp = signal('');
  errorsOnly = signal(false);

  /** Shown in the results card (with a Retry button) when the list could not be loaded. */
  loadError = signal('');
  activePreset = signal<DatePreset>('');
  readonly presets: { key: DatePreset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: '', label: 'All time' },
  ];

  /** "Showing 1-50 of 247,508". */
  rangeStart = computed(() => this.totalCount() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1);
  rangeEnd = computed(() => Math.min(this.page() * this.pageSize(), this.totalCount()));

  /** Filters applied to the list right now, shown as removable chips above the table. */
  activeFilters = signal<ActiveFilter[]>([]);

  // Detail Modal State
  detailModalOpen = signal(false);
  detailLoading = signal(false);
  selectedDetail = signal<AuditLogDetail | null>(null);
  diffRows = signal<DiffRow[]>([]);
  isJsonDiff = signal(false);
  prettyOldJson = signal('');
  prettyNewJson = signal('');
  showUnchanged = signal(false);
  changedRows = computed(() => this.diffRows().filter(r => r.status !== 'unchanged'));
  unchangedRows = computed(() => this.diffRows().filter(r => r.status === 'unchanged'));

  ngOnInit(): void {
    this.loadFilterOptions();
    this.loadAuditLogs();
  }

  loadFilterOptions(): void {
    this.auditService.getFilterOptions().subscribe({
      next: (res) => {
        if (res.isSuccessful && res.data) {
          this.filterOptions.set(res.data);
        }
      },
      error: () => {}
    });
  }

  loadAuditLogs(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.activeFilters.set(this.describeFilters());

    const filter: AuditLogFilter = {
      page: this.page(),
      pageSize: this.pageSize(),
      fromDate: this.fromDate() || undefined,
      toDate: this.toDate() || undefined,
      operation: this.operation() || undefined,
      entityName: this.entityName() || undefined,
      changedByUserEmail: this.changedByUserEmail() || undefined,
      recordId: this.recordId() || undefined,
      sourceApp: this.sourceApp() || undefined,
      errorsOnly: this.errorsOnly() || undefined
    };

    this.auditService.getAuditLogs(filter).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.isSuccessful && res.data) {
          this.items.set(res.data.items || []);
          this.totalCount.set(res.data.totalCount || 0);
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.items.set([]);
        this.loadError.set(err?.error?.message ?? 'The audit log could not be loaded. Please try again.');
      }
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.loadAuditLogs();
  }

  resetFilters(): void {
    this.activePreset.set('');
    this.fromDate.set('');
    this.toDate.set('');
    this.operation.set('');
    this.entityName.set('');
    this.changedByUserEmail.set('');
    this.recordId.set('');
    this.sourceApp.set('');
    this.errorsOnly.set(false);
    this.page.set(1);
    this.loadAuditLogs();
  }

  /** Quick date ranges; "All time" clears the dates. Runs the search straight away. */
  setPreset(preset: DatePreset): void {
    this.activePreset.set(preset);
    const days = preset === 'today' ? 0 : preset === '7d' ? 6 : preset === '30d' ? 29 : -1;
    if (days < 0) {
      this.fromDate.set('');
      this.toDate.set('');
    } else {
      const today = new Date();
      const from = new Date(today);
      from.setDate(today.getDate() - days);
      this.fromDate.set(this.isoDay(from));
      this.toDate.set(this.isoDay(today));
    }
    this.applyFilters();
  }

  /** Remove one filter chip and search again. */
  clearFilter(key: ActiveFilter['key']): void {
    switch (key) {
      case 'dates': this.fromDate.set(''); this.toDate.set(''); this.activePreset.set(''); break;
      case 'operation': this.operation.set(''); break;
      case 'entityName': this.entityName.set(''); break;
      case 'changedByUserEmail': this.changedByUserEmail.set(''); break;
      case 'recordId': this.recordId.set(''); break;
      case 'sourceApp': this.sourceApp.set(''); break;
      case 'errorsOnly': this.errorsOnly.set(false); break;
    }
    this.applyFilters();
  }

  private describeFilters(): ActiveFilter[] {
    const list: ActiveFilter[] = [];
    const from = this.fromDate(), to = this.toDate();
    if (from || to) {
      const preset = this.presets.find(p => p.key && p.key === this.activePreset());
      list.push({ key: 'dates', label: preset ? preset.label : `${from || '...'} to ${to || '...'}` });
    }
    if (this.operation()) list.push({ key: 'operation', label: this.operationText(this.operation()) });
    if (this.entityName()) list.push({ key: 'entityName', label: this.friendlyEntity(this.entityName()) });
    if (this.changedByUserEmail()) list.push({ key: 'changedByUserEmail', label: `By: ${this.changedByUserEmail()}` });
    if (this.recordId()) list.push({ key: 'recordId', label: `Record #${this.recordId()}` });
    if (this.sourceApp()) list.push({ key: 'sourceApp', label: this.sourceApp() });
    if (this.errorsOnly()) list.push({ key: 'errorsOnly', label: 'Errors only' });
    return list;
  }

  private isoDay(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** "WN_BookingAttendants" -> "Booking Attendants"; "WN_HIK_Users" -> "HIK Users". */
  friendlyEntity(name?: string | null): string {
    if (!name) return 'General';
    const base = name.replace(/^WN_/i, '').replace(/_/g, ' ');
    return base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  }

  operationText(op?: string | null): string {
    return OPERATION_LABELS[(op || '').toUpperCase()] ?? (op || 'Change');
  }

  /** "just now", "5 min ago", "3 h ago", "2 days ago" from the UTC time; empty for older than a month. */
  relativeTime(utc?: string | null): string {
    if (!utc) return '';
    // The API sends UTC without a zone ("2026-10-13T08:32:24"): read it as UTC, not as the browser's local time.
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(utc) ? utc : utc + 'Z';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 0) return '';
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.floor(h / 24);
    return d <= 31 ? (d === 1 ? 'yesterday' : `${d} days ago`) : '';
  }

  /** First letter for the small avatar next to "Changed by". */
  initial(email?: string | null): string {
    return (email || 'S').trim().charAt(0).toUpperCase();
  }

  onRowKey(event: KeyboardEvent, auditId: number): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openDetail(auditId);
    }
  }

  onPageChange(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.loadAuditLogs();
  }

  onPageSizeChange(newSize: number): void {
    this.pageSize.set(Number(newSize));
    this.page.set(1);
    this.loadAuditLogs();
  }

  openDetail(auditId: number): void {
    this.detailModalOpen.set(true);
    this.detailLoading.set(true);
    this.selectedDetail.set(null);
    this.diffRows.set([]);
    this.showUnchanged.set(false);
    this.isJsonDiff.set(false);
    this.prettyOldJson.set('');
    this.prettyNewJson.set('');

    this.auditService.getAuditLogDetail(auditId).subscribe({
      next: (res) => {
        this.detailLoading.set(false);
        if (res.isSuccessful && res.data) {
          const d = res.data;
          this.selectedDetail.set(d);
          this.computeDiff(d.oldValues, d.newValues);
        } else {
          this.toast.error('Audit record not found.');
        }
      },
      error: (err) => {
        this.detailLoading.set(false);
        const msg = err?.error?.message ?? err?.message ?? 'Failed to load audit record detail.';
        this.toast.error(msg);
      }
    });
  }

  closeDetail(): void {
    this.detailModalOpen.set(false);
    this.selectedDetail.set(null);
  }

  private tryParseJson(text?: string | null): any {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  private computeDiff(oldStr?: string | null, newStr?: string | null): void {
    let oldParsed = this.tryParseJson(oldStr);
    let newParsed = this.tryParseJson(newStr);
    // A created record has no "before" and a deleted one no "after": compare with an empty record.
    const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
    if (isObj(newParsed) && !oldStr) oldParsed = {};
    if (isObj(oldParsed) && !newStr) newParsed = {};

    if (oldParsed) {
      this.prettyOldJson.set(JSON.stringify(oldParsed, null, 2));
    } else {
      this.prettyOldJson.set(oldStr || '(None)');
    }

    if (newParsed) {
      this.prettyNewJson.set(JSON.stringify(newParsed, null, 2));
    } else {
      this.prettyNewJson.set(newStr || '(None)');
    }

    const isOldObj = oldParsed && typeof oldParsed === 'object' && !Array.isArray(oldParsed);
    const isNewObj = newParsed && typeof newParsed === 'object' && !Array.isArray(newParsed);

    if (isOldObj && isNewObj) {
      this.isJsonDiff.set(true);
      const allKeys = Array.from(new Set([...Object.keys(oldParsed), ...Object.keys(newParsed)])).sort();
      const rows: DiffRow[] = [];

      for (const key of allKeys) {
        const hasOld = key in oldParsed;
        const hasNew = key in newParsed;
        const vOld = hasOld ? JSON.stringify(oldParsed[key]) : '-';
        const vNew = hasNew ? JSON.stringify(newParsed[key]) : '-';

        let status: 'changed' | 'added' | 'removed' | 'unchanged' = 'unchanged';
        if (hasOld && hasNew) {
          status = vOld !== vNew ? 'changed' : 'unchanged';
        } else if (!hasOld && hasNew) {
          status = 'added';
        } else if (hasOld && !hasNew) {
          status = 'removed';
        }

        rows.push({
          key,
          oldValue: vOld,
          newValue: vNew,
          oldDisplay: hasOld ? this.displayValue(oldParsed[key]) : '',
          newDisplay: hasNew ? this.displayValue(newParsed[key]) : '',
          status
        });
      }

      this.diffRows.set(rows);
    } else {
      this.isJsonDiff.set(false);
    }
  }

  /** A value as people read it: no JSON quotes, "empty" for null / blank, ISO dates as "04 Jun 2026, 16:26:41". */
  private displayValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'empty';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string') {
      const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
      if (iso) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${iso[3]} ${months[Number(iso[2]) - 1] ?? iso[2]} ${iso[1]}, ${iso[4]}:${iso[5]}:${iso[6]}`;
      }
      return value;
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  getOperationBadgeClass(op?: string): string {
    switch (op?.toUpperCase()) {
      case 'I': return 'badge-insert';
      case 'U': return 'badge-update';
      case 'D': return 'badge-delete';
      default: return 'badge-neutral';
    }
  }
}