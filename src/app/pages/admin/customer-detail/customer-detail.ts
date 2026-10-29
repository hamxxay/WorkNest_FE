import { Component, DestroyRef, WritableSignal, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription } from 'rxjs';
import {
  CustomerDetailService, CustomerInvoice, CustomerOverview, CustomerProfile, CustomerQuotation, PagedRows, SectionError,
  TimelineEvent, TimelineKind, describeSectionError, humanize
} from '../../../services/customer-detail.service';
import { ToastService } from '../../../services/toast.service';
import { AuthService } from '../../../services/auth.service';
import { AttendanceError, AttendanceService, AttendanceStatus, describeAttendanceError } from '../../../services/attendance.service';
import { CustomerAttendance } from './customer-attendance/customer-attendance';

type TabKey = 'bookings' | 'quotations' | 'invoices' | 'payments' | 'agreements' | 'activity' | 'attendance';

/** One paged list (invoices, quotations) with its own loading / error state. */
interface PagedState<T> {
  loading: boolean;
  error: SectionError | null;
  data: PagedRows<T> | null;
}

const PAGE_SIZE = 10;
/** Rows shown per list before "Show all" (bookings, receipts, payments, agreements, deposits, activity). */
const SHORT_LIST = 10;
/** Events in the "Recent activity" card. */
const RECENT_EVENTS = 5;

/**
 * Customer detail (/admin/customers/:id), opened from the Customers list: profile, money summary and the customer's
 * bookings, quotations, invoices, payments (fee receipts, payments, security deposits), agreements and activity.
 * Every section loads and fails on its own (see CustomerDetailService). Read-only: changes are made on the
 * existing pages (bookings, quotations, invoices, receipts), which the rows link to where they can be opened.
 * The one exception is the Attendance switch (admin / super admin): attendance for the customer's employees on or off.
 */
@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, NgTemplateOutlet, CustomerAttendance],
  templateUrl: './customer-detail.html',
  styleUrl: './customer-detail.css'
})
export class CustomerDetail {
  private svc = inject(CustomerDetailService);
  private toast = inject(ToastService);
  private attendance = inject(AttendanceService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  readonly humanize = humanize;
  readonly shortList = SHORT_LIST;

  customerId = signal(0);

  profile = signal<CustomerProfile | null>(null);
  profileLoading = signal(true);
  profileError = signal<SectionError | null>(null);

  overview = signal<CustomerOverview | null>(null);
  overviewLoading = signal(true);
  overviewError = signal<SectionError | null>(null);

  invoices = signal<PagedState<CustomerInvoice>>({ loading: true, error: null, data: null });
  quotations = signal<PagedState<CustomerQuotation>>({ loading: true, error: null, data: null });

  /** Attendance switch: every staff member sees it, only admins / super admins change it (the API checks too). */
  attStatus = signal<AttendanceStatus | null>(null);
  attStatusLoading = signal(true);
  attStatusError = signal<AttendanceError | null>(null);
  attSaving = signal(false);
  readonly canToggleAttendance = this.auth.hasRole('admin') || this.auth.hasRole('super_admin') || this.auth.hasRole('sales_executive');

  tab = signal<TabKey>('bookings');
  /** Lists opened in full ("Show all"). */
  expanded = signal<Set<string>>(new Set());
  /** "<kind>-<id>" of the PDF being fetched. */
  downloading = signal<string | null>(null);

  private subs: Subscription[] = [];
  private invoiceSub?: Subscription;
  private quotationSub?: Subscription;

  summary = computed(() => this.overview()?.summary ?? null);
  recentEvents = computed(() => (this.overview()?.timeline ?? []).slice(0, RECENT_EVENTS));
  paymentsCount = computed(() => {
    const o = this.overview();
    return o ? o.receipts.length + o.payments.length + o.deposits.length : null;
  });

  tabs = computed(() => {
    const o = this.overview();
    const inv = this.invoices().data;
    const q = this.quotations().data;
    const list: { key: TabKey; label: string; count: number | null }[] = [
      { key: 'bookings', label: 'Bookings', count: o ? o.bookings.length : null },
      { key: 'quotations', label: 'Quotations', count: q ? q.total : null },
      { key: 'invoices', label: 'Invoices', count: inv ? inv.total : null },
      { key: 'payments', label: 'Payments', count: this.paymentsCount() },
      { key: 'agreements', label: 'Agreements', count: o ? o.agreements.length : null },
      { key: 'activity', label: 'Activity', count: o ? o.timeline.length : null },
      { key: 'attendance', label: 'Attendance', count: null }
    ];
    return list;
  });

  initials = computed(() => {
    const name = this.profile()?.fullName ?? '';
    const parts = name.split(/\s+/).filter(p => /[A-Za-z0-9]/.test(p));
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(pm => {
      const id = Number(pm.get('id'));
      this.customerId.set(Number.isInteger(id) && id > 0 ? id : 0);
      this.tab.set('bookings');
      this.expanded.set(new Set());
      this.loadAll();
    });
    this.destroyRef.onDestroy(() => this.cancel());
  }

  // ---------- loading ----------

  private cancel() {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
    this.invoiceSub?.unsubscribe();
    this.quotationSub?.unsubscribe();
  }

  loadAll() {
    this.cancel();
    const id = this.customerId();
    // Another customer: nothing of the previous one may stay on screen.
    this.profile.set(null);
    this.overview.set(null);
    this.attStatus.set(null);
    this.invoices.set({ loading: true, error: null, data: null });
    this.quotations.set({ loading: true, error: null, data: null });
    if (!id) {
      this.profileLoading.set(false);
      this.profileError.set({ status: 404, needsDbUpdate: false, notFound: true, message: 'Customer not found.' });
      return;
    }
    this.loadProfile();
    this.loadOverview();
    this.loadInvoices(1);
    this.loadQuotations(1);
    this.loadAttendanceStatus();
  }

  loadProfile() {
    this.profileLoading.set(true);
    this.profileError.set(null);
    this.subs.push(this.svc.getProfile(this.customerId()).subscribe({
      next: p => { this.profile.set(p); this.profileLoading.set(false); },
      error: e => { this.profile.set(null); this.profileError.set(describeSectionError(e)); this.profileLoading.set(false); }
    }));
  }

  loadOverview() {
    this.overviewLoading.set(true);
    this.overviewError.set(null);
    this.subs.push(this.svc.getOverview(this.customerId()).subscribe({
      next: o => { this.overview.set(o); this.overviewLoading.set(false); },
      error: e => { this.overviewError.set(describeSectionError(e)); this.overviewLoading.set(false); }
    }));
  }

  loadInvoices(page: number) {
    this.invoiceSub?.unsubscribe();
    this.invoiceSub = this.loadPaged(this.svc.getInvoices(this.customerId(), page, PAGE_SIZE), this.invoices);
  }

  loadQuotations(page: number) {
    this.quotationSub?.unsubscribe();
    this.quotationSub = this.loadPaged(this.svc.getQuotations(this.customerId(), page, PAGE_SIZE), this.quotations);
  }

  private loadPaged<T>(req: Observable<PagedRows<T>>, state: WritableSignal<PagedState<T>>): Subscription {
    state.update(s => ({ ...s, loading: true, error: null }));
    return req.subscribe({
      next: data => state.set({ loading: false, error: null, data }),
      error: e => state.update(s => ({ ...s, loading: false, error: describeSectionError(e) }))
    });
  }

  /** Reloads every section and keeps the current figures on screen until the new ones arrive (and the list pages). */
  refresh() {
    if (!this.profile()) { this.loadAll(); return; }
    this.loadProfile();
    this.loadOverview();
    this.loadInvoices(this.invoices().data?.page ?? 1);
    this.loadQuotations(this.quotations().data?.page ?? 1);
    this.loadAttendanceStatus();
  }

  loadAttendanceStatus() {
    this.attStatusLoading.set(true);
    this.attStatusError.set(null);
    this.subs.push(this.attendance.getStatus(this.customerId()).subscribe({
      next: st => { this.attStatus.set(st); this.attStatusLoading.set(false); },
      error: e => { this.attStatus.set(null); this.attStatusError.set(describeAttendanceError(e)); this.attStatusLoading.set(false); }
    }));
  }

  toggleAttendance() {
    const current = this.attStatus();
    if (!this.canToggleAttendance || !current || this.attSaving()) return;
    const enabled = !current.enabled;
    this.attSaving.set(true);
    this.subs.push(this.attendance.setEnabled(this.customerId(), enabled).subscribe({
      next: st => {
        this.attStatus.set({ ...current, ...st, enabled: st.enabled });
        this.attSaving.set(false);
        this.toast.success(st.enabled
          ? 'Attendance is on: the customer now sees it in the app and web portal.'
          : 'Attendance is off: the customer no longer sees it.');
      },
      error: e => { this.attSaving.set(false); this.toast.error(describeAttendanceError(e).message); }
    }));
  }

  // ---------- paging / lists ----------

  pages(p: PagedRows<unknown> | null): number {
    return p ? Math.max(1, Math.ceil(p.total / p.limit)) : 1;
  }

  isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  toggle(key: string) {
    this.expanded.update(s => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  visible<T>(rows: T[], key: string): T[] {
    return this.isExpanded(key) ? rows : rows.slice(0, SHORT_LIST);
  }

  selectTab(key: TabKey) {
    this.tab.set(key);
  }

  /** Arrow keys move between the tabs (WAI-ARIA tabs pattern). */
  onTabKey(ev: KeyboardEvent, index: number) {
    const keys = this.tabs().map(t => t.key);
    let next = -1;
    if (ev.key === 'ArrowRight') next = (index + 1) % keys.length;
    else if (ev.key === 'ArrowLeft') next = (index - 1 + keys.length) % keys.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = keys.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    this.tab.set(keys[next]);
    const el = document.getElementById(`cd-tab-${keys[next]}`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  showAllActivity() {
    this.tab.set('activity');
    this.expanded.update(s => new Set(s).add('activity'));
    setTimeout(() => document.getElementById('cd-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // ---------- display helpers ----------

  money(v: number | null | undefined, currency?: string | null): string {
    if (v === null || v === undefined) return '-';
    return `${currency || 'PKR'} ${Math.round(Number(v)).toLocaleString('en-US')}`;
  }

  /** Short amount for the summary cards, as the CEO dashboard: "PKR 11.61M", "PKR 840K", "PKR 950" (full amount in the tooltip). */
  compact(v: number | null | undefined): string {
    const n = Number(v || 0);
    const a = Math.abs(n);
    if (a >= 1_000_000) return `PKR ${parseFloat((n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2))}M`;
    if (a >= 1_000) return `PKR ${(n / 1_000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return `PKR ${Math.round(n).toLocaleString('en-US')}`;
  }

  /** Colour of a status pill, from the words of the status the API sent (no status list here). */
  tone(status: string | null | undefined): 'ok' | 'warn' | 'bad' | 'info' | 'muted' {
    const s = (status ?? '').toLowerCase();
    if (!s) return 'muted';
    if (/(cancel|reject|declin|void|fail|forfeit|overdue|expire|no ?show|inactive)/.test(s)) return 'bad';
    if (/(partial|pending|unpaid|un paid|draft|reminder)/.test(s)) return 'warn';
    if (/(paid|confirm|accept|signed|active|released|convert|received|complete)/.test(s)) return 'ok';
    return 'info';
  }

  kindLabel(kind: TimelineKind): string {
    return kind === 'other' ? 'Update' : kind === 'deposit' ? 'Security deposit' : humanize(kind);
  }

  trackEvent(i: number, e: TimelineEvent): string {
    return `${e.kind}-${e.action}-${e.refId ?? ''}-${e.at ?? ''}-${i}`;
  }

  // ---------- documents ----------

  downloadInvoice(inv: CustomerInvoice) {
    this.download(`invoice-${inv.id}`, this.svc.invoicePdf(inv.id), `Invoice-${inv.invoiceNumber}.pdf`, 'invoice');
  }

  downloadQuotation(q: CustomerQuotation) {
    this.download(`quotation-${q.id}`, this.svc.quotationPdf(q.id, q.version), `Quotation-${q.quotationNumber}-v${q.version}.pdf`, 'quotation');
  }

  downloadAgreement(id: number, signed: boolean) {
    this.download(`agreement-${id}-${signed ? 's' : 'a'}`, this.svc.agreementPdf(id, signed),
      signed ? `Agreement-${id}-signed.pdf` : `Agreement-${id}.pdf`, signed ? 'signed agreement' : 'agreement');
  }

  private download(key: string, req: Observable<Blob>, fileName: string, what: string) {
    if (this.downloading()) return;
    this.downloading.set(key);
    this.subs.push(req.subscribe({
      next: blob => {
        this.downloading.set(null);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName.replace(/[\\/:*?"<>|\s]+/g, '-');
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
      error: () => {
        this.downloading.set(null);
        this.toast.error(`The ${what} PDF could not be downloaded. Please try again.`);
      }
    }));
  }
}
