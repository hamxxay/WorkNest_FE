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
  status: 'changed' | 'added' | 'removed' | 'unchanged';
}

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './audit-log.html',
  styleUrl: './audit-log.css'
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

  // Detail Modal State
  detailModalOpen = signal(false);
  detailLoading = signal(false);
  selectedDetail = signal<AuditLogDetail | null>(null);
  diffRows = signal<DiffRow[]>([]);
  isJsonDiff = signal(false);
  prettyOldJson = signal('');
  prettyNewJson = signal('');

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
        const msg = err?.error?.message ?? err?.message ?? 'Failed to load audit logs.';
        this.toast.error(msg);
      }
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.loadAuditLogs();
  }

  resetFilters(): void {
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
    const oldParsed = this.tryParseJson(oldStr);
    const newParsed = this.tryParseJson(newStr);

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
          status
        });
      }

      this.diffRows.set(rows);
    } else {
      this.isJsonDiff.set(false);
    }
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