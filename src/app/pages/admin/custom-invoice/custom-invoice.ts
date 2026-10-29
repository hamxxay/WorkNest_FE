import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, Signal, computed, inject, linkedSignal, signal, untracked,
  viewChild
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import {
  CiAccount, CiBooking, CiCustomer, CiLedgerDefaults, CiLocation, CiRecentItem, CiReplaceableInvoice, CiSpace, CreateCustomInvoiceRequest,
  CreateCustomInvoiceResult, CustomInvoiceAccessMe, CustomInvoiceService, customInvoiceErrorMessage
} from '../../../services/custom-invoice.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import { localDateIso } from '../../../utils/dates';
import { CiAccountPicker } from './account-picker';
import { CiAccessPanel } from './custom-invoice-access';

type Tab = 'new' | 'recent' | 'access';
type LineRole = 'ar' | 'rent' | 'service' | 'tax' | 'deposit';

/** One voucher line in the ledger grid. Amounts stay as typed text; they are read with parseMoney. */
interface LedgerLine {
  key: number;
  /** Which amount built this line; null for a line the user added. */
  role: LineRole | null;
  account: CiAccount | null;
  debit: string;
  credit: string;
  narration: string;
}

/** Everything the ledger grid is built from ("Rebuild from amounts"). */
interface LedgerSource {
  rent: number;
  service: number;
  tax: number;
  deposit: number;
  total: number;
  defaults: CiLedgerDefaults | null;
  /** Customer and period, for the line narrations. */
  base: string;
}

interface LineCheck {
  key: number;
  debit: number;
  credit: number;
  accountMissing: boolean;
  error: string;
}

const MIN_LINES = 2;
const MAX_LINES = 5;
const REASON_MAX = 500;
const TEXT_MAX = 250;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);
/** An amount as the fields show it: 2 decimals, blank for zero. */
const moneyText = (n: number) => (Number.isFinite(n) && n > 0 ? round2(n).toFixed(2) : '');
const MONEY = /^\d+(\.\d{1,2})?$/;
/** A typed amount: blank = 0; digits with at most 2 decimals (commas allowed); NaN otherwise. */
function parseMoney(text: string): number {
  const t = (text ?? '').trim().replace(/,/g, '');
  if (!t) return 0;
  return MONEY.test(t) ? Number(t) : NaN;
}
const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;
function parsePercent(text: string): number {
  const t = (text ?? '').trim();
  if (!t) return 0;
  return PERCENT.test(t) && Number(t) <= 100 ? Number(t) : NaN;
}
const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
/** "2026-10-01" -> "1 Oct 2026" (calendar date, no time zone shift). */
function dayText(iso: string | null): string {
  if (!iso || !isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

let lineKey = 0;
function newLine(role: LineRole | null, account: CiAccount | null, debit: number, credit: number, narration: string): LedgerLine {
  return { key: ++lineKey, role, account, debit: moneyText(debit), credit: moneyText(credit), narration };
}

/** Receivable debit = total; one credit per non-zero amount, on the location's default accounts. */
function buildLines(src: LedgerSource): LedgerLine[] {
  if (!(src.total > 0)) return [];
  const d = src.defaults;
  const text = (label: string) => (src.base ? `${label}: ${src.base}` : label).slice(0, TEXT_MAX);
  const lines = [newLine('ar', d?.accountReceivable ?? null, src.total, 0, text('Custom invoice'))];
  if (src.rent > 0) lines.push(newLine('rent', d?.rent ?? null, 0, src.rent, text('Rent')));
  if (src.service > 0) lines.push(newLine('service', d?.servicesIncome ?? null, 0, src.service, text('Service charges')));
  if (src.tax > 0) lines.push(newLine('tax', d?.salesTax ?? null, 0, src.tax, text('Sales tax on service charges')));
  if (src.deposit > 0) lines.push(newLine('deposit', d?.securityReceived ?? null, 0, src.deposit, text('Security deposit')));
  return lines;
}

/** A field that shows its default (and follows it) until the user edits it. */
function followUntilEdited<T>(source: () => T, edited: Signal<boolean>) {
  return linkedSignal<T, T>({
    source,
    computation: (value, previous) => (previous !== undefined && untracked(edited) ? previous.value : value),
  });
}

@Component({
  selector: 'app-custom-invoice',
  imports: [DecimalPipe, CiAccountPicker, CiAccessPanel],
  templateUrl: './custom-invoice.html',
  styleUrls: ['./ci-shared.css', './custom-invoice.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CustomInvoicePage implements OnInit {
  private readonly api = inject(CustomInvoiceService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly reasonMax = REASON_MAX;
  readonly textMax = TEXT_MAX;
  readonly maxLines = MAX_LINES;
  readonly minLines = MIN_LINES;
  readonly dayText = dayText;

  // ── Access (api/custom-invoices/access/me) ──────────────────────────────
  readonly me = signal<CustomInvoiceAccessMe | null>(null);
  readonly meLoading = signal(false);
  readonly meError = signal('');
  readonly isSuperAdmin = computed(() => this.auth.hasRole('super_admin') || this.me()?.isSuperAdmin === true);
  readonly tab = signal<Tab>('new');

  // ── 1. Customer ──────────────────────────────────────────────────────────
  readonly customer = signal<CiCustomer | null>(null);
  readonly custQuery = signal('');
  readonly custOpen = signal(false);
  readonly custResults = signal<CiCustomer[]>([]);
  readonly custLoading = signal(false);
  readonly custError = signal('');
  readonly custActive = signal(-1);
  private custSearched = false;
  private readonly custSearch$ = new Subject<string>();
  private readonly custInput = viewChild<ElementRef<HTMLInputElement>>('custInput');

  // ── 2. Booking / location / replaced invoice ────────────────────────────
  readonly bookings = signal<CiBooking[]>([]);
  readonly bookingsLoading = signal(false);
  readonly bookingsError = signal('');
  /** A booking id, 'none' (no booking), or null while nothing is chosen. */
  readonly bookingChoice = signal<number | 'none' | null>(null);
  readonly booking = computed(() => {
    const id = this.bookingChoice();
    return typeof id === 'number' ? this.bookings().find(b => b.bookingId === id) ?? null : null;
  });
  readonly locations = signal<CiLocation[]>([]);
  readonly locationsLoading = signal(false);
  readonly locationsError = signal('');
  readonly locationId = signal<number | null>(null);
  /** Optional space of the chosen location (only when there is no booking; a booking brings its own space). */
  readonly spaces = signal<CiSpace[]>([]);
  readonly spacesLoading = signal(false);
  readonly spacesError = signal('');
  readonly spaceId = signal<number | null>(null);
  readonly spaceName = computed(() => {
    const b = this.booking();
    if (b) return b.spaceName;
    const id = this.spaceId();
    return this.spaces().find(s => s.spaceId === id)?.label ?? '';
  });
  readonly effectiveLocationId = computed<number | null>(() => {
    const b = this.booking();
    if (b) return b.locationId > 0 ? b.locationId : null;
    return this.bookingChoice() === 'none' ? this.locationId() : null;
  });
  readonly effectiveLocationName = computed(() => {
    const b = this.booking();
    if (b) return b.locationName;
    const id = this.locationId();
    return this.locations().find(l => l.id === id)?.name ?? '';
  });
  readonly replaceable = signal<CiReplaceableInvoice[]>([]);
  readonly replaceableLoading = signal(false);
  readonly replaceableError = signal('');
  readonly replaceId = signal<number | null>(null);
  readonly replaced = computed(() => {
    const id = this.replaceId();
    return id == null ? null : this.replaceable().find(r => r.invoiceId === id) ?? null;
  });
  /** Steps 3 to 5 open once the booking (or no booking + location) is settled. */
  readonly detailsReady = computed(() => !!this.customer() && this.bookingChoice() !== null && !!this.effectiveLocationId());

  // ── 3. Invoice details ───────────────────────────────────────────────────
  readonly issuedOn = signal(localDateIso());
  readonly dueOn = signal('');
  readonly periodFrom = signal('');
  readonly periodTo = signal('');
  private periodEdited = false;

  readonly rentText = signal('');
  readonly serviceText = signal('');
  readonly depositText = signal('');
  readonly rent = computed(() => parseMoney(this.rentText()));
  readonly service = computed(() => parseMoney(this.serviceText()));
  readonly deposit = computed(() => parseMoney(this.depositText()));

  /** The location's configured sales tax on service charges (api/tax-rate), once loaded. */
  readonly configuredTax = signal<{ locationId: number; percent: number; applicable: boolean } | null>(null);
  readonly taxRateLoading = signal(false);
  readonly taxRateError = signal(false);
  readonly taxPercentEdited = signal(false);
  readonly taxPercentText = followUntilEdited(() => {
    const t = this.configuredTax();
    return t ? String(t.applicable ? t.percent : 0) : '';
  }, this.taxPercentEdited);
  readonly taxPercent = computed(() => parsePercent(this.taxPercentText()));
  readonly taxPercentValid = computed(() => Number.isFinite(this.taxPercent()));
  /** Service charge x tax %; changing either one recalculates the tax amount (which stays editable). */
  private readonly computedTax = computed(() => {
    const s = this.service(), p = this.taxPercent();
    return Number.isFinite(s) && Number.isFinite(p) ? round2((s * p) / 100) : NaN;
  });
  readonly taxAmountText = linkedSignal(() => moneyText(this.computedTax()));
  readonly taxAmount = computed(() => parseMoney(this.taxAmountText()));
  readonly total = computed(() => round2(finite(this.rent()) + finite(this.service()) + finite(this.taxAmount()) + finite(this.deposit())));
  readonly amountsValid = computed(() =>
    [this.rent(), this.service(), this.taxAmount(), this.deposit()].every(Number.isFinite) && Number.isFinite(this.taxPercent()));

  readonly reason = signal('');

  // ── 4. Ledger grid ───────────────────────────────────────────────────────
  readonly defaults = signal<CiLedgerDefaults | null>(null);
  readonly defaultsLoading = signal(false);
  readonly defaultsError = signal('');
  readonly ledgerEdited = signal(false);
  /** The grid's inputs when the user first edited it, to tell them the amounts changed since. */
  private readonly editedAt = signal('');
  readonly confirmRebuild = signal(false);

  private readonly customerText = computed(() => {
    const c = this.customer();
    return c ? (c.code ? `${c.name} (${c.code})` : c.name) : '';
  });
  readonly periodText = computed(() =>
    isIsoDate(this.periodFrom()) && isIsoDate(this.periodTo()) ? `${dayText(this.periodFrom())} to ${dayText(this.periodTo())}` : '');
  private readonly narrationBase = computed(() => [this.customerText(), this.periodText()].filter(Boolean).join(', '));

  readonly ledgerSource = computed<LedgerSource>(() => ({
    rent: finite(this.rent()),
    service: finite(this.service()),
    tax: finite(this.taxAmount()),
    deposit: finite(this.deposit()),
    total: this.total(),
    defaults: this.defaults(),
    base: this.narrationBase(),
  }), { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) });

  /** Follows the amounts until the user edits a line; then only "Rebuild from amounts" replaces it. */
  readonly lines = linkedSignal<LedgerSource, LedgerLine[]>({
    source: this.ledgerSource,
    computation: (src, previous) => (previous !== undefined && untracked(this.ledgerEdited) ? previous.value : buildLines(src)),
  });
  readonly ledgerStale = computed(() => this.ledgerEdited() && JSON.stringify(this.ledgerSource()) !== this.editedAt());

  readonly lineChecks = computed<LineCheck[]>(() => this.lines().map(l => {
    const debit = parseMoney(l.debit), credit = parseMoney(l.credit);
    let error = '';
    if (!Number.isFinite(debit) || !Number.isFinite(credit)) error = 'Enter amounts as numbers with at most 2 decimals.';
    else if (debit > 0 && credit > 0) error = 'Enter a debit or a credit, not both.';
    else if (!(debit > 0) && !(credit > 0)) error = 'Enter a debit or a credit.';
    return { key: l.key, debit, credit, accountMissing: !l.account, error };
  }));
  readonly debitTotal = computed(() => round2(this.lineChecks().reduce((s, c) => s + finite(c.debit), 0)));
  readonly creditTotal = computed(() => round2(this.lineChecks().reduce((s, c) => s + finite(c.credit), 0)));
  readonly difference = computed(() => round2(this.debitTotal() - this.creditTotal()));
  readonly balanced = computed(() => this.debitTotal() > 0 && Math.abs(this.difference()) < 0.005);
  /** Amounts without a default account at this location (the user must pick one on that line). */
  readonly missingDefaults = computed(() => {
    const d = this.defaults();
    if (!d || this.defaultsLoading()) return [] as string[];
    const s = this.ledgerSource();
    const out: string[] = [];
    if (s.total > 0 && !d.accountReceivable) out.push('Accounts Receivable');
    if (s.rent > 0 && !d.rent) out.push('Rent');
    if (s.service > 0 && !d.servicesIncome) out.push('Services Income');
    if (s.tax > 0 && !d.salesTax) out.push('Sales Tax');
    if (s.deposit > 0 && !d.securityReceived) out.push('Security Received');
    return out;
  });

  // ── 5. Voucher and customer ledger ───────────────────────────────────────
  readonly voucherDateEdited = signal(false);
  readonly voucherDate = followUntilEdited(() => this.issuedOn(), this.voucherDateEdited);
  readonly voucherDescEdited = signal(false);
  readonly voucherDescription = followUntilEdited(() => this.defaultDescription(), this.voucherDescEdited);
  readonly ledgerDebitEdited = signal(false);
  readonly ledgerDebitText = followUntilEdited(() => moneyText(this.total()), this.ledgerDebitEdited);
  readonly ledgerDebit = computed(() => parseMoney(this.ledgerDebitText()));
  readonly ledgerNarrationEdited = signal(false);
  readonly ledgerNarration = followUntilEdited(() => this.defaultNarration(), this.ledgerNarrationEdited);
  readonly overrideMismatch = signal(false);
  readonly totalMismatch = computed(() =>
    this.total() > 0 && Number.isFinite(this.ledgerDebit()) && round2(this.ledgerDebit()) !== this.total());

  private readonly defaultDescription = computed(() => {
    const parts = [this.customerText() ? `Custom invoice for ${this.customerText()}` : 'Custom invoice'];
    if (this.periodText()) parts.push(this.periodText());
    const b = this.booking();
    if (b) parts.push(b.label || b.spaceName);
    const r = this.replaced();
    if (r) parts.push(`replaces ${r.invoiceNumber}`);
    return parts.filter(Boolean).join(', ').slice(0, TEXT_MAX);
  });
  private readonly defaultNarration = computed(() => {
    const parts = ['Custom invoice'];
    if (this.periodText()) parts.push(this.periodText());
    const b = this.booking();
    if (b) parts.push(b.label || b.spaceName);
    else if (this.effectiveLocationName()) parts.push(this.effectiveLocationName());
    return parts.filter(Boolean).join(', ').slice(0, TEXT_MAX);
  });

  // ── Save ─────────────────────────────────────────────────────────────────
  /** What still stops Save, in form order (empty = ready). */
  readonly blockers = computed<string[]>(() => {
    const out: string[] = [];
    if (!this.customer()) { out.push('Choose a customer.'); return out; }
    if (this.bookingChoice() === null) { out.push('Choose a booking, or No booking.'); return out; }
    if (!this.effectiveLocationId()) { out.push('Choose the location.'); return out; }
    if (!isIsoDate(this.periodFrom()) || !isIsoDate(this.periodTo())) out.push('Enter the period (from and to).');
    else if (this.periodTo() < this.periodFrom()) out.push('The period must end on or after the day it starts.');
    if (!isIsoDate(this.issuedOn())) out.push('Enter the issue date.');
    if (!isIsoDate(this.dueOn())) out.push('Enter the due date.');
    else if (isIsoDate(this.issuedOn()) && this.dueOn() < this.issuedOn()) out.push('The due date cannot be before the issue date.');
    if (!this.amountsValid()) out.push('Fix the amounts marked in red.');
    else if (!(this.total() > 0)) out.push('Enter at least one amount.');
    if (!this.reason().trim()) out.push('Enter the reason for this invoice.');
    const lines = this.lines(), checks = this.lineChecks();
    if (lines.length < MIN_LINES) out.push(`The ledger needs at least ${MIN_LINES} lines.`);
    if (lines.length > MAX_LINES) out.push(`The ledger can have at most ${MAX_LINES} lines.`);
    if (checks.some(c => c.accountMissing)) out.push('Choose an account on every ledger line.');
    if (checks.some(c => c.error)) out.push('Give every ledger line a debit or a credit (not both).');
    else if (lines.length && !this.balanced()) out.push('Total debit must equal total credit.');
    if (!isIsoDate(this.voucherDate())) out.push('Enter the voucher date.');
    if (!this.voucherDescription().trim()) out.push('Enter the voucher description.');
    if (!Number.isFinite(this.ledgerDebit()) || !(this.ledgerDebit() > 0)) out.push('Enter the customer ledger debit.');
    if (!this.ledgerNarration().trim()) out.push('Enter the customer ledger narration.');
    if (this.totalMismatch() && !this.overrideMismatch()) out.push('Tick "Post anyway", or make the customer ledger debit equal the invoice total.');
    return out;
  });
  readonly saving = signal(false);
  readonly confirmOpen = signal(false);
  readonly saveError = signal('');
  readonly result = signal<CreateCustomInvoiceResult | null>(null);

  // ── Recent custom invoices ───────────────────────────────────────────────
  readonly recent = signal<CiRecentItem[]>([]);
  readonly recentTotal = signal(0);
  readonly recentPage = signal(1);
  /** Page size the API uses (worked out from the first full page; the contract does not send it). */
  private recentPageSize = 0;
  readonly recentSearch = signal('');
  readonly recentLoading = signal(false);
  readonly recentLoaded = signal(false);
  readonly recentError = signal('');
  private readonly recentSearch$ = new Subject<string>();
  readonly recentHasNext = computed(() => {
    const size = this.recentPageSize || this.recent().length;
    return size > 0 && (this.recentPage() - 1) * size + this.recent().length < this.recentTotal();
  });

  constructor() {
    // Customer search (debounced; a newer search cancels an older one).
    this.custSearch$.pipe(
      debounceTime(300),
      tap(() => { this.custLoading.set(true); this.custError.set(''); }),
      switchMap(q => this.api.searchCustomers(q).pipe(
        map(list => ({ list, err: '' })),
        catchError(err => of({ list: [] as CiCustomer[], err: customInvoiceErrorMessage(err, "Customers couldn't be loaded.") }))
      )),
      takeUntilDestroyed()
    ).subscribe(({ list, err }) => {
      this.custLoading.set(false);
      this.custResults.set(list);
      this.custError.set(err);
      this.custActive.set(list.length ? 0 : -1);
    });

    // The location's default accounts for the issue date (refetched when either changes).
    toObservable(computed(() => {
      const loc = this.effectiveLocationId(), date = this.issuedOn();
      return loc && isIsoDate(date) ? `${loc}|${date}` : '';
    })).pipe(
      debounceTime(250),
      distinctUntilChanged(),
      tap(key => { this.defaultsError.set(''); this.defaultsLoading.set(!!key); if (!key) this.defaults.set(null); }),
      switchMap(key => {
        if (!key) return of(null);
        const [loc, date] = key.split('|');
        return this.api.getLedgerDefaults(Number(loc), date).pipe(
          map(d => ({ d, err: '' })),
          catchError(err => of({ d: null, err: customInvoiceErrorMessage(err, "The location's default accounts couldn't be loaded.") }))
        );
      }),
      takeUntilDestroyed()
    ).subscribe(res => {
      this.defaultsLoading.set(false);
      if (!res) return;
      this.defaults.set(res.d);
      this.defaultsError.set(res.err);
      this.fillMissingAccounts(res.d);
    });

    // The location's configured tax % on service charges (the field starts from it).
    toObservable(this.effectiveLocationId).pipe(
      distinctUntilChanged(),
      tap(loc => { this.taxRateError.set(false); this.taxRateLoading.set(!!loc); }),
      switchMap(loc => !loc ? of(null) : this.api.getTaxRate(loc).pipe(
        map(r => ({ locationId: loc, percent: r.taxPercentage, applicable: r.taxApplicable })),
        catchError(() => { this.taxRateError.set(true); return of(null); })
      )),
      takeUntilDestroyed()
    ).subscribe(t => {
      this.taxRateLoading.set(false);
      // null when it failed: the field is then empty for the user to fill in (no rate is assumed).
      this.configuredTax.set(t);
    });

    this.recentSearch$.pipe(debounceTime(350), distinctUntilChanged(), takeUntilDestroyed()).subscribe(() => {
      this.recentPage.set(1);
      this.loadRecent();
    });
  }

  ngOnInit(): void {
    this.loadMe();
  }

  loadMe(): void {
    this.meLoading.set(true);
    this.meError.set('');
    this.api.getMyAccess().subscribe({
      next: me => { this.me.set(me); this.meLoading.set(false); },
      error: err => {
        this.meLoading.set(false);
        this.meError.set(customInvoiceErrorMessage(err, "This page couldn't be opened. Please try again."));
      }
    });
  }

  setTab(tab: Tab): void {
    if (tab === 'access' && !this.isSuperAdmin()) return;
    this.tab.set(tab);
    if (tab === 'recent' && !this.recentLoaded() && !this.recentLoading()) this.loadRecent();
  }

  // ── 1. Customer ──────────────────────────────────────────────────────────
  onCustInput(text: string): void {
    this.custQuery.set(text);
    this.custOpen.set(true);
    this.custSearched = true;
    this.custSearch$.next(text);
  }

  onCustFocus(): void {
    this.custOpen.set(true);
    if (!this.custSearched) { this.custSearched = true; this.custSearch$.next(this.custQuery()); }
  }

  onCustKey(e: KeyboardEvent): void {
    const n = this.custResults().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.custOpen.set(true); if (n) this.custActive.set((this.custActive() + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) this.custActive.set((this.custActive() - 1 + n) % n); }
    else if (e.key === 'Enter') {
      const i = this.custActive();
      if (this.custOpen() && !this.custLoading() && i >= 0 && i < n) { e.preventDefault(); this.pickCustomer(this.custResults()[i]); }
    } else if (e.key === 'Escape' && this.custOpen()) { e.preventDefault(); e.stopPropagation(); this.custOpen.set(false); }
  }

  pickCustomer(c: CiCustomer): void {
    this.customer.set(c);
    this.custOpen.set(false);
    this.resetBookingStep();
    this.loadBookings(c.userId);
  }

  changeCustomer(): void {
    this.customer.set(null);
    this.resetBookingStep();
    this.bookings.set([]);
    setTimeout(() => this.custInput()?.nativeElement.focus(), 0);
  }

  initials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? '')).toUpperCase() || '?';
  }

  // ── 2. Booking ───────────────────────────────────────────────────────────
  private resetBookingStep(): void {
    this.bookingChoice.set(null);
    this.bookingsError.set('');
    this.locationId.set(null);
    this.spaces.set([]);
    this.spaceId.set(null);
    this.spacesError.set('');
    this.replaceable.set([]);
    this.replaceId.set(null);
    this.replaceableError.set('');
  }

  loadBookings(userId: number): void {
    this.bookingsLoading.set(true);
    this.bookingsError.set('');
    this.api.getBookings(userId).subscribe({
      next: list => {
        if (this.customer()?.userId !== userId) return;
        this.bookings.set(list);
        this.bookingsLoading.set(false);
        // Nothing to choose from: the invoice has no booking.
        if (list.length === 0) this.chooseBooking('none');
      },
      error: err => {
        if (this.customer()?.userId !== userId) return;
        this.bookings.set([]);
        this.bookingsLoading.set(false);
        this.bookingsError.set(customInvoiceErrorMessage(err, "This customer's bookings couldn't be loaded."));
      }
    });
  }

  retryBookings(): void {
    const c = this.customer();
    if (c) this.loadBookings(c.userId);
  }

  chooseBooking(choice: number | 'none'): void {
    if (this.bookingChoice() === choice) return;
    this.bookingChoice.set(choice);
    this.replaceId.set(null);
    this.replaceable.set([]);
    this.replaceableError.set('');
    this.spaceId.set(null);
    if (choice === 'none') {
      if (this.locations().length === 0 && !this.locationsLoading()) this.loadLocations();
    } else {
      this.loadReplaceable(choice);
    }
  }

  loadLocations(): void {
    this.locationsLoading.set(true);
    this.locationsError.set('');
    this.api.getLocations().subscribe({
      next: list => {
        this.locations.set(list);
        this.locationsLoading.set(false);
        if (list.length === 1 && this.locationId() === null) {
          this.locationId.set(list[0].id);
          this.loadSpaces(list[0].id);
        }
      },
      error: err => {
        this.locationsLoading.set(false);
        this.locationsError.set(customInvoiceErrorMessage(err, "Locations couldn't be loaded."));
      }
    });
  }

  onLocationChange(value: string): void {
    const id = Number(value);
    this.locationId.set(id > 0 ? id : null);
    this.spaceId.set(null);
    this.spaces.set([]);
    this.spacesError.set('');
    if (id > 0) this.loadSpaces(id);
  }

  loadSpaces(locationId: number): void {
    this.spacesLoading.set(true);
    this.spacesError.set('');
    this.api.getSpaces(locationId).subscribe({
      next: list => {
        if (this.locationId() !== locationId) return;
        this.spaces.set(list);
        this.spacesLoading.set(false);
      },
      error: err => {
        if (this.locationId() !== locationId) return;
        this.spacesLoading.set(false);
        this.spacesError.set(customInvoiceErrorMessage(err, "Spaces couldn't be loaded."));
      }
    });
  }

  onSpaceChange(value: string): void {
    const id = Number(value);
    this.spaceId.set(id > 0 ? id : null);
  }

  loadReplaceable(bookingId: number): void {
    this.replaceableLoading.set(true);
    this.replaceableError.set('');
    this.api.getReplaceable(bookingId).subscribe({
      next: list => {
        if (this.bookingChoice() !== bookingId) return;
        this.replaceable.set(list);
        this.replaceableLoading.set(false);
      },
      error: err => {
        if (this.bookingChoice() !== bookingId) return;
        this.replaceableLoading.set(false);
        this.replaceableError.set(customInvoiceErrorMessage(err, "This booking's unpaid invoices couldn't be loaded."));
      }
    });
  }

  onReplaceChange(value: string): void {
    const id = Number(value);
    this.replaceId.set(id > 0 ? id : null);
    const r = this.replaced();
    // Its period fills the period fields, unless the user already typed one.
    if (r && !this.periodEdited && r.periodStart && r.periodEnd) {
      this.periodFrom.set(r.periodStart);
      this.periodTo.set(r.periodEnd);
    }
  }

  replaceLabel(r: CiReplaceableInvoice): string {
    const period = r.periodStart && r.periodEnd ? `, ${dayText(r.periodStart)} to ${dayText(r.periodEnd)}` : '';
    const total = r.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${r.invoiceNumber}${period}, PKR ${total}`;
  }

  bookingDates(b: CiBooking): string {
    const from = dayText(b.startOn), to = dayText(b.endOn);
    return from && to ? `${from} to ${to}` : from ? `From ${from}` : to ? `Until ${to}` : '';
  }

  statusClass(label: string): string {
    return 'status-' + (label || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  // ── 3. Invoice details ───────────────────────────────────────────────────
  setPeriodFrom(v: string): void { this.periodEdited = true; this.periodFrom.set(v); }
  setPeriodTo(v: string): void { this.periodEdited = true; this.periodTo.set(v); }

  setTaxPercent(v: string): void {
    this.taxPercentEdited.set(true);
    this.taxPercentText.set(v);
  }

  useConfiguredTax(): void {
    this.taxPercentEdited.set(false);
    const t = this.configuredTax();
    this.taxPercentText.set(t ? String(t.applicable ? t.percent : 0) : '');
  }

  amountError(value: number): string {
    return Number.isFinite(value) ? '' : 'Use a number with at most 2 decimals, e.g. 25000 or 25000.50.';
  }

  readonly periodError = computed(() =>
    isIsoDate(this.periodFrom()) && isIsoDate(this.periodTo()) && this.periodTo() < this.periodFrom()
      ? 'The period must end on or after the day it starts.' : '');
  readonly dueError = computed(() =>
    isIsoDate(this.dueOn()) && isIsoDate(this.issuedOn()) && this.dueOn() < this.issuedOn()
      ? 'The due date cannot be before the issue date.' : '');

  // ── 4. Ledger grid ───────────────────────────────────────────────────────
  private markLedgerEdited(): void {
    if (this.ledgerEdited()) return;
    this.editedAt.set(JSON.stringify(this.ledgerSource()));
    this.ledgerEdited.set(true);
  }

  private updateLine(key: number, change: Partial<LedgerLine>): void {
    this.markLedgerEdited();
    this.lines.update(list => list.map(l => (l.key === key ? { ...l, ...change } : l)));
  }

  setLineAccount(key: number, account: CiAccount | null): void { this.updateLine(key, { account }); }
  setLineDebit(key: number, debit: string): void { this.updateLine(key, { debit }); }
  setLineCredit(key: number, credit: string): void { this.updateLine(key, { credit }); }
  setLineNarration(key: number, narration: string): void { this.updateLine(key, { narration }); }

  addLine(): void {
    if (this.lines().length >= MAX_LINES) return;
    this.markLedgerEdited();
    const base = this.narrationBase();
    this.lines.update(list => [...list, newLine(null, null, 0, 0, base ? `Custom invoice: ${base}`.slice(0, TEXT_MAX) : '')]);
    const key = this.lines()[this.lines().length - 1].key;
    setTimeout(() => document.getElementById(`ci-line-${key}-account`)?.focus(), 0);
  }

  removeLine(key: number): void {
    if (this.lines().length <= MIN_LINES) return;
    this.markLedgerEdited();
    this.lines.update(list => list.filter(l => l.key !== key));
  }

  /**
   * Defaults that arrive after the user started editing the grid: lines built from an amount that still have no account
   * get the default one (nothing the user chose is replaced). When every such line then matches the defaults, the
   * grid does not count as out of date because of them.
   */
  private fillMissingAccounts(d: CiLedgerDefaults | null): void {
    if (!d || !this.ledgerEdited()) return;
    const byRole: Record<LineRole, CiAccount | null> = {
      ar: d.accountReceivable, rent: d.rent, service: d.servicesIncome, tax: d.salesTax, deposit: d.securityReceived
    };
    let matches = true;
    this.lines.update(list => list.map(l => {
      if (!l.role) return l;
      const def = byRole[l.role];
      if (!l.account && def) return { ...l, account: def };
      if (l.account && def && l.account.accountId !== def.accountId) matches = false;
      return l;
    }));
    if (!matches || !this.editedAt()) return;
    try {
      this.editedAt.set(JSON.stringify({ ...JSON.parse(this.editedAt()), defaults: d }));
    } catch { /* keep the old marker */ }
  }

  /** Refills the grid from the amounts; asks first when it would replace lines the user edited. */
  rebuildLedger(): void {
    if (this.ledgerEdited() && !this.confirmRebuild()) {
      this.confirmRebuild.set(true);
      return;
    }
    this.confirmRebuild.set(false);
    this.ledgerEdited.set(false);
    this.editedAt.set('');
    this.lines.set(buildLines(this.ledgerSource()));
  }

  lineCheck(key: number): LineCheck | undefined {
    return this.lineChecks().find(c => c.key === key);
  }

  lineLabel(l: LedgerLine, index: number): string {
    const role: Record<LineRole, string> = {
      ar: 'Accounts Receivable', rent: 'Rent', service: 'Services Income', tax: 'Sales Tax', deposit: 'Security Received'
    };
    return l.role ? `Line ${index + 1}: ${role[l.role]}` : `Line ${index + 1}`;
  }

  // ── 5. Voucher and customer ledger ───────────────────────────────────────
  setVoucherDate(v: string): void { this.voucherDateEdited.set(true); this.voucherDate.set(v); }
  setVoucherDescription(v: string): void { this.voucherDescEdited.set(true); this.voucherDescription.set(v); }
  setLedgerDebit(v: string): void { this.ledgerDebitEdited.set(true); this.ledgerDebitText.set(v); }
  setLedgerNarration(v: string): void { this.ledgerNarrationEdited.set(true); this.ledgerNarration.set(v); }

  useTotalForLedgerDebit(): void {
    this.ledgerDebitEdited.set(false);
    this.ledgerDebitText.set(moneyText(this.total()));
    this.overrideMismatch.set(false);
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  openConfirm(): void {
    if (this.blockers().length > 0 || this.saving()) return;
    this.saveError.set('');
    this.confirmOpen.set(true);
    setTimeout(() => document.getElementById('ci-confirm-cancel')?.focus(), 30);
  }

  closeConfirm(): void {
    if (this.saving()) return;
    this.confirmOpen.set(false);
    setTimeout(() => document.getElementById('ci-save')?.focus(), 0);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirmOpen()) this.closeConfirm();
  }

  save(): void {
    if (this.saving() || this.blockers().length > 0) return;
    const c = this.customer(), loc = this.effectiveLocationId();
    if (!c || !loc) return;
    const b = this.booking();
    const body: CreateCustomInvoiceRequest = {
      userId: c.userId,
      bookingId: b?.bookingId ?? null,
      locationId: loc,
      spaceId: b ? (b.spaceId ?? null) : this.spaceId(),
      replaceInvoiceId: b ? this.replaceId() : null,
      issuedOn: this.issuedOn(),
      dueOn: this.dueOn(),
      periodFrom: this.periodFrom(),
      periodTo: this.periodTo(),
      rentAmount: round2(finite(this.rent())),
      serviceCharge: round2(finite(this.service())),
      taxPercent: finite(this.taxPercent()),
      taxAmount: round2(finite(this.taxAmount())),
      securityDeposit: round2(finite(this.deposit())),
      grandTotal: this.total(),
      reason: this.reason().trim(),
      voucher: { date: this.voucherDate(), description: this.voucherDescription().trim() },
      customerLedger: { debit: round2(finite(this.ledgerDebit())), narration: this.ledgerNarration().trim() },
      lines: this.lines().map(l => ({
        accountId: l.account?.accountId ?? 0,
        debit: round2(finite(parseMoney(l.debit))),
        credit: round2(finite(parseMoney(l.credit))),
        narration: l.narration.trim(),
      })),
      overrideTotalMismatch: this.totalMismatch() && this.overrideMismatch(),
    };
    this.saving.set(true);
    this.saveError.set('');
    this.api.create(body).subscribe({
      next: res => {
        this.saving.set(false);
        this.confirmOpen.set(false);
        this.result.set(res);
        this.recentLoaded.set(false);
        this.toast.success(res.message || `Custom invoice ${res.invoiceNumber} created.`, 'Saved');
        setTimeout(() => document.getElementById('ci-result-title')?.focus(), 30);
      },
      error: err => {
        this.saving.set(false);
        this.saveError.set(customInvoiceErrorMessage(err, "The custom invoice wasn't created. Please try again."));
      }
    });
  }

  /** "Create another": a clean form (the customer search starts empty too). */
  createAnother(): void {
    this.result.set(null);
    this.customer.set(null);
    this.custQuery.set('');
    this.custResults.set([]);
    this.custSearched = false;
    this.bookings.set([]);
    this.resetBookingStep();
    this.issuedOn.set(localDateIso());
    this.dueOn.set('');
    this.periodFrom.set('');
    this.periodTo.set('');
    this.periodEdited = false;
    this.rentText.set('');
    this.serviceText.set('');
    this.depositText.set('');
    this.taxPercentEdited.set(false);
    this.taxAmountText.set('');
    this.reason.set('');
    this.ledgerEdited.set(false);
    this.editedAt.set('');
    this.confirmRebuild.set(false);
    this.lines.set([]);
    this.voucherDateEdited.set(false);
    this.voucherDate.set(this.issuedOn());
    this.voucherDescEdited.set(false);
    this.voucherDescription.set(this.defaultDescription());
    this.ledgerDebitEdited.set(false);
    this.ledgerDebitText.set('');
    this.ledgerNarrationEdited.set(false);
    this.ledgerNarration.set(this.defaultNarration());
    this.overrideMismatch.set(false);
    this.saveError.set('');
    setTimeout(() => this.custInput()?.nativeElement.focus(), 30);
  }

  showRecent(): void {
    this.result.set(null);
    this.createAnother();
    this.setTab('recent');
  }

  // ── Recent ───────────────────────────────────────────────────────────────
  loadRecent(): void {
    const page = this.recentPage();
    this.recentLoading.set(true);
    this.recentError.set('');
    this.api.getRecent(page, this.recentSearch()).subscribe({
      next: res => {
        this.recent.set(res.items);
        this.recentTotal.set(res.total);
        if (page === 1 && res.items.length > 0 && res.items.length < res.total) this.recentPageSize = res.items.length;
        this.recentLoading.set(false);
        this.recentLoaded.set(true);
      },
      error: err => {
        this.recentLoading.set(false);
        this.recentError.set(customInvoiceErrorMessage(err, "Recent custom invoices couldn't be loaded."));
      }
    });
  }

  onRecentSearch(text: string): void {
    this.recentSearch.set(text);
    this.recentSearch$.next(text);
  }

  recentGo(delta: number): void {
    const page = this.recentPage() + delta;
    if (page < 1 || (delta > 0 && !this.recentHasNext())) return;
    this.recentPage.set(page);
    this.loadRecent();
  }
}
