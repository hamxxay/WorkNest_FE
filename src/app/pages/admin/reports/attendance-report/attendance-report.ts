import { Component, DestroyRef, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  AttendanceCustomer, AttendanceEmployee, AttendanceError, AttendanceReport, AttendanceService, attHours, attendanceSheets,
  describeAttendanceError, rangeProblem, thisMonthRange
} from '../../../../services/attendance.service';
import { AttendanceReportView } from '../../../../components/attendance-report/attendance-report-view';
import { exportPagePdf, fileSlug } from '../../../../utils/page-pdf';
import { downloadXlsx } from '../../../../utils/xlsx';
import { AuthService } from '../../../../services/auth.service';
import { ToastService } from '../../../../services/toast.service';

/**
 * Attendance report (/admin/reports/attendance): one customer's employees for a range of at most 62 days (this month
 * by default), optionally one person, as computed by the API from the room machines' scans. Customers with
 * attendance switched on come first; staff can open a switched-off customer too (the report still works).
 * ?customer=<id> preselects a customer (link from the customer detail Attendance tab).
 */
@Component({
  selector: 'app-attendance-report',
  standalone: true,
  imports: [FormsModule, RouterLink, AttendanceReportView],
  templateUrl: './attendance-report.html',
  styleUrl: './attendance-report.css'
})
export class AttendanceReportComponent {
  private svc = inject(AttendanceService);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  /** Admins and sales executives switch attendance on/off here (the API limits them to their locations' customers). */
  readonly canToggle = this.auth.hasRole('admin') || this.auth.hasRole('super_admin') || this.auth.hasRole('sales_executive');
  /** The customer page is admin-only. */
  readonly canOpenCustomer = this.auth.hasRole('admin') || this.auth.hasRole('super_admin');
  toggling = signal(false);

  private readonly printArea = viewChild<ElementRef<HTMLElement>>('printArea');

  customerId: number | null = null;
  fromDate = thisMonthRange().from;
  toDate = thisMonthRange().to;
  personId: number | null = null;
  dateError = signal('');

  customers = signal<AttendanceCustomer[]>([]);
  customersLoading = signal(true);
  customersError = signal<AttendanceError | null>(null);

  employees = signal<AttendanceEmployee[]>([]);

  report = signal<AttendanceReport | null>(null);
  loading = signal(false);
  error = signal<AttendanceError | null>(null);
  exporting = signal(false);
  exportError = signal('');

  private reportSub?: Subscription;
  private employeesSub?: Subscription;

  enabledCustomers = computed(() => this.customers().filter(c => c.enabled));
  disabledCustomers = computed(() => this.customers().filter(c => !c.enabled));

  selectedCustomer = computed(() => this.customers().find(c => c.customerId === this.selected()) ?? null);
  private selected = signal<number | null>(null);

  /** Employees of the customer, plus anyone in the report who is no longer one (past days still count). */
  people = computed(() => {
    const list = this.employees().map(e => ({ personId: e.personId, name: e.name, active: e.active }));
    for (const s of this.report()?.summary ?? []) {
      if (!list.some(p => p.personId === s.personId)) list.push({ personId: s.personId, name: s.name, active: false });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  });

  totals = computed(() => {
    const sum = this.report()?.summary ?? [];
    const add = (f: (s: (typeof sum)[number]) => number) => sum.reduce((a, s) => a + f(s), 0);
    return {
      people: sum.length,
      present: add(s => s.present),
      late: add(s => s.late),
      absent: add(s => s.absent),
      missingOut: add(s => s.missingOut),
      worked: attHours(add(s => s.workedMinutes)),
      overtime: attHours(add(s => s.overtimeMinutes))
    };
  });

  constructor() {
    const fromLink = Number(this.route.snapshot.queryParamMap.get('customer'));
    this.svc.getCustomers().subscribe({
      next: list => {
        this.customers.set(list);
        this.customersLoading.set(false);
        if (fromLink > 0 && list.some(c => c.customerId === fromLink)) {
          this.customerId = fromLink;
          this.onCustomerChange();
        }
      },
      error: e => { this.customersError.set(describeAttendanceError(e)); this.customersLoading.set(false); }
    });
    this.destroyRef.onDestroy(() => { this.reportSub?.unsubscribe(); this.employeesSub?.unsubscribe(); });
  }

  onCustomerChange() {
    this.selected.set(this.customerId);
    this.personId = null;
    this.report.set(null);
    this.error.set(null);
    this.employees.set([]);
    this.employeesSub?.unsubscribe();
    if (!this.customerId) return;
    // The person filter only; the report shows whatever it can without it.
    this.employeesSub = this.svc.getEmployees(this.customerId).subscribe({ next: list => this.employees.set(list), error: () => {} });
    this.generate();
  }

  generate() {
    const problem = rangeProblem(this.fromDate, this.toDate);
    this.dateError.set(problem);
    if (problem || !this.customerId) return;
    this.reportSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.reportSub = this.svc.getReport(this.customerId, this.fromDate, this.toDate, this.personId).subscribe({
      next: r => { this.report.set(r); this.loading.set(false); },
      error: e => { this.report.set(null); this.error.set(describeAttendanceError(e)); this.loading.set(false); }
    });
  }

  toggleEnabled(c: AttendanceCustomer) {
    if (!this.canToggle || this.toggling()) return;
    const enabled = !c.enabled;
    this.toggling.set(true);
    this.svc.setEnabled(c.customerId, enabled).subscribe({
      next: st => {
        this.customers.update(list => list.map(x => x.customerId === c.customerId ? { ...x, enabled: st.enabled } : x));
        this.toggling.set(false);
        this.toast.success(st.enabled
          ? 'Attendance is on: the customer now sees it in the app and web portal.'
          : 'Attendance is off: the customer no longer sees it.');
      },
      error: e => { this.toggling.set(false); this.toast.error(describeAttendanceError(e).message); }
    });
  }

  private exportName(): string {
    const r = this.report()!;
    return fileSlug('Attendance', r.customerName || this.selectedCustomer()?.customerName || '', r.from, 'to', r.to);
  }

  private personName(): string {
    return this.personId ? (this.people().find(p => p.personId === this.personId)?.name ?? '') : '';
  }

  exportExcel() {
    const r = this.report();
    if (!r) return;
    downloadXlsx(`${this.exportName()}.xlsx`, attendanceSheets(r));
  }

  async exportPdf() {
    const r = this.report();
    const el = this.printArea()?.nativeElement;
    if (!r || !el || this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set('');
    try {
      await exportPagePdf(el, {
        fileName: `${this.exportName()}.pdf`,
        title: `Attendance - ${r.customerName || this.selectedCustomer()?.customerName || ''}`,
        lines: [`${r.from} to ${r.to}`, this.personName() ? `Person: ${this.personName()}` : ''].filter(Boolean),
        blocks: '.metric-card, .att-head, tr',
        orientation: 'landscape'
      });
    } catch {
      this.exportError.set('The PDF could not be made. Please try again.');
    } finally {
      this.exporting.set(false);
    }
  }
}
