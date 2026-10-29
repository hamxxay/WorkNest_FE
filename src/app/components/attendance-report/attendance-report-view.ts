import { Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  ATTENDANCE_STATUS_LABEL, AttendanceDay, AttendanceReport, AttendanceStatusCode, attExtras, attHours, attMinutes, attTime, nextDay
} from '../../services/attendance.service';

/**
 * One attendance report as the staff read it: the per-person summary, then every day of every person (Name, Date,
 * Shift, In, Out, Hours, Status, Late / Early / Overtime). Presentational only: the report page
 * (/admin/reports/attendance) and the customer detail Attendance tab load the report and pass it in.
 */
@Component({
  selector: 'app-attendance-report-view',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './attendance-report-view.html',
  styleUrl: './attendance-report-view.css'
})
export class AttendanceReportView {
  readonly report = input.required<AttendanceReport>();

  readonly time = attTime;
  readonly hours = attHours;
  readonly minutes = attMinutes;
  readonly extras = attExtras;
  readonly nextDay = nextDay;

  /** Days of the report by person, then date. */
  readonly days = computed(() => [...this.report().days]
    .sort((a, b) => a.name.localeCompare(b.name) || a.personId - b.personId || a.date.localeCompare(b.date)));

  readonly summary = computed(() => [...this.report().summary].sort((a, b) => a.name.localeCompare(b.name)));

  label(s: AttendanceStatusCode): string {
    return ATTENDANCE_STATUS_LABEL[s];
  }

  /** CSS class of the status badge (colours in the stylesheet). */
  badge(d: AttendanceDay): string {
    return `att-badge st-${d.status.toLowerCase()}`;
  }

  trackDay(d: AttendanceDay): string {
    return `${d.personId}-${d.date}`;
  }
}
