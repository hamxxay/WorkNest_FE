import { Component, DestroyRef, WritableSignal, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import {
  AttendanceEmployee, AttendanceError, AttendanceHoliday, AttendanceReport, AttendanceService, AttendanceShift,
  attendanceSheets, attTime, describeAttendanceError, rangeProblem, thisMonthRange
} from '../../../../services/attendance.service';
import { AttendanceReportView } from '../../../../components/attendance-report/attendance-report-view';
import { fileSlug } from '../../../../utils/page-pdf';
import { downloadXlsx } from '../../../../utils/xlsx';

/** One read-only list (shifts, holidays, employees) with its own loading / error state. */
interface ListState<T> { loading: boolean; error: AttendanceError | null; rows: T[]; }

/**
 * The Attendance tab of the customer detail page: the customer's report (this month by default, one person or all)
 * and, read-only, the shifts, holidays and employees (with their shift) the customer set up in the app / web portal.
 * Loads when the tab opens; each part fails on its own.
 */
@Component({
  selector: 'app-customer-attendance',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink, AttendanceReportView],
  templateUrl: './customer-attendance.html',
  styleUrl: './customer-attendance.css'
})
export class CustomerAttendance {
  private svc = inject(AttendanceService);
  private destroyRef = inject(DestroyRef);

  readonly customerId = input.required<number>();

  readonly time = attTime;

  fromDate = thisMonthRange().from;
  toDate = thisMonthRange().to;
  personId: number | null = null;
  dateError = signal('');

  report = signal<AttendanceReport | null>(null);
  loading = signal(false);
  error = signal<AttendanceError | null>(null);

  shifts = signal<ListState<AttendanceShift>>({ loading: true, error: null, rows: [] });
  holidays = signal<ListState<AttendanceHoliday>>({ loading: true, error: null, rows: [] });
  employees = signal<ListState<AttendanceEmployee>>({ loading: true, error: null, rows: [] });

  /** Employees, plus anyone in the report who is no longer one (past days still count). */
  people = computed(() => {
    const list = this.employees().rows.map(e => ({ personId: e.personId, name: e.name, active: e.active }));
    for (const s of this.report()?.summary ?? []) {
      if (!list.some(p => p.personId === s.personId)) list.push({ personId: s.personId, name: s.name, active: false });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  });

  private subs: Subscription[] = [];
  private reportSub?: Subscription;

  constructor() {
    effect(() => {
      const id = this.customerId();
      untracked(() => this.loadAll(id));
    });
    this.destroyRef.onDestroy(() => { this.subs.forEach(s => s.unsubscribe()); this.reportSub?.unsubscribe(); });
  }

  private loadAll(id: number) {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
    this.personId = null;
    if (!id) return;
    this.generate();
    this.loadList(this.svc.getShifts(id), this.shifts);
    this.loadList(this.svc.getHolidays(id), this.holidays);
    this.loadList(this.svc.getEmployees(id), this.employees);
  }

  private loadList<T>(req: Observable<T[]>, state: WritableSignal<ListState<T>>) {
    state.set({ loading: true, error: null, rows: [] });
    this.subs.push(req.subscribe({
      next: rows => state.set({ loading: false, error: null, rows }),
      error: e => state.set({ loading: false, error: describeAttendanceError(e), rows: [] })
    }));
  }

  generate() {
    const problem = rangeProblem(this.fromDate, this.toDate);
    this.dateError.set(problem);
    if (problem || !this.customerId()) return;
    this.reportSub?.unsubscribe();
    this.loading.set(true);
    this.error.set(null);
    this.reportSub = this.svc.getReport(this.customerId(), this.fromDate, this.toDate, this.personId).subscribe({
      next: r => { this.report.set(r); this.loading.set(false); },
      error: e => { this.report.set(null); this.error.set(describeAttendanceError(e)); this.loading.set(false); }
    });
  }

  exportExcel() {
    const r = this.report();
    if (!r) return;
    downloadXlsx(`${fileSlug('Attendance', r.customerName || `Customer ${r.customerId}`, r.from, 'to', r.to)}.xlsx`, attendanceSheets(r));
  }

  /** Work days as the customer chose them ("Mon, Tue, Wed"). */
  days(s: AttendanceShift): string {
    return s.workDays.length ? s.workDays.join(', ') : '-';
  }
}
