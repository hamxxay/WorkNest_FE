import {
  Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import type { CeoError, CeoPeriod } from '../../../../services/ceo.service';
import {
  CeoDiscountBooking, CeoDiscountGroup, CeoDiscountInvoice, CeoDiscountRecordKind, CeoDiscountRecords, CeoDiscounts, CeoDiscountsService
} from '../../../../services/ceo-discounts.service';
import type { DashParams, DashRange } from '../../../../services/dashboard-api';
import { XlsxCell, downloadXlsx } from '../../../../utils/xlsx';
import { fileDate, fileSlug } from '../../../../utils/page-pdf';
import { count, fullMoney, money, pct } from '../ceo-shared';
import { BOOKING_HEAD, INVOICE_HEAD, bookingRow, invoiceRow } from './discounts-export';

export type DiscountGroupBy = 'location' | 'seller' | 'shift';

/** A level of the drawer: a breakdown from the section's own figures, or a records list from the API. */
export type DiscountLevel =
  | { kind: 'groups'; by: DiscountGroupBy; crumb: string }
  | { kind: 'records'; records: CeoDiscountRecordKind; params: DashParams; crumb: string; highlight?: number };

/** What to open (a new id opens it again from its first level). */
export interface DiscountDrill { id: number; root: string; level: DiscountLevel; }

interface Entry {
  uid: number;
  level: DiscountLevel;
  status: 'loading' | 'ok' | 'error';
  records?: CeoDiscountRecords;
  error?: CeoError;
}

const GROUP_TITLES: Record<DiscountGroupBy, { title: string; rowLabel: string }> = {
  location: { title: 'Discount by location', rowLabel: 'Location' },
  seller: { title: 'Discount by salesperson', rowLabel: 'Sold by' },
  shift: { title: 'Discount by shift', rowLabel: 'Shift' }
};

/**
 * The Discounts section's drill-down: the CEO dashboard's right-side drawer (same look and behaviour as ceo-drawer:
 * breadcrumb, Back, Close, Escape, focus kept inside, Export Excel of the level on screen). Level 2: the section's
 * figures by location / salesperson / shift; a row opens level 3: the discounted bookings (or the invoices with a
 * discount) from GET api/ceo/discounts/records/{kind}, for the dashboard's period, range and location. Read-only.
 */
@Component({
  selector: 'app-ceo-discounts-drawer',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './discounts-drawer.html',
  styleUrls: ['../ceo-drawer/ceo-drawer.css', './ceo-discounts.css']
})
export class CeoDiscountsDrawer {
  private api = inject(CeoDiscountsService);
  private host = inject(ElementRef<HTMLElement>);

  request = input<DiscountDrill | null>(null);
  /** The section's figures (level 2 is built from them). */
  data = input<CeoDiscounts | null>(null);
  period = input<CeoPeriod>('month');
  range = input<DashRange | null>(null);
  /** The dashboard's location filter; a level's own locationId wins. */
  locationId = input<number | null>(null);
  closed = output<void>();

  readonly money = money;
  readonly fullMoney = fullMoney;
  readonly pct = pct;
  readonly count = count;

  entries = signal<Entry[]>([]);
  current = computed<Entry | null>(() => this.entries().at(-1) ?? null);
  open = computed(() => !!this.request() && this.entries().length > 0);
  crumbs = computed(() => [this.request()?.root ?? '', ...this.entries().map(e => e.level.crumb)].filter(Boolean));

  private uid = 0;
  private sub: Subscription | null = null;
  private returnFocus: HTMLElement | null = null;
  private panel = viewChild<ElementRef<HTMLElement>>('panel');
  private heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());

    effect(() => {
      const req = this.request();
      untracked(() => {
        if (!req) { this.reset(); return; }
        if (!this.entries().length) {
          const active = document.activeElement as HTMLElement | null;
          this.returnFocus = active && !this.host.nativeElement.contains(active) ? active : null;
        }
        this.sub?.unsubscribe();
        this.entries.set([]);
        this.push(req.level);
      });
    });

    // Period, range or location changed under an open drawer: reload the list on screen.
    effect(() => {
      this.period(); this.range(); this.locationId();
      untracked(() => { const e = this.current(); if (e?.level.kind === 'records') this.load(e); });
    });
  }

  // ---------- navigation ----------

  private push(level: DiscountLevel) {
    const entry: Entry = { uid: ++this.uid, level, status: level.kind === 'groups' ? 'ok' : 'loading' };
    this.entries.update(list => [...list, entry]);
    if (level.kind === 'records') this.load(entry);
    this.focusHeading();
  }

  back() {
    if (this.entries().length <= 1) return;
    this.sub?.unsubscribe();
    this.entries.update(list => list.slice(0, -1));
    const e = this.current();
    if (e && e.status !== 'ok') this.load(e);
    this.focusHeading();
  }

  goTo(crumbIndex: number) {
    if (crumbIndex < 1 || crumbIndex >= this.entries().length) return;
    this.sub?.unsubscribe();
    this.entries.update(list => list.slice(0, crumbIndex));
    const e = this.current();
    if (e && e.status !== 'ok') this.load(e);
    this.focusHeading();
  }

  close() {
    if (!this.entries().length) return;
    this.reset();
    this.closed.emit();
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target && document.contains(target)) setTimeout(() => target.focus({ preventScroll: true }));
  }

  retry() {
    const e = this.current();
    if (e) this.load(e);
  }

  private reset() {
    this.sub?.unsubscribe();
    this.entries.set([]);
  }

  private focusHeading() {
    setTimeout(() => (this.heading()?.nativeElement ?? this.panel()?.nativeElement)?.focus({ preventScroll: true }));
  }

  // ---------- data ----------

  private load(entry: Entry) {
    if (entry.level.kind !== 'records') return;
    const level = entry.level;
    this.sub?.unsubscribe();
    this.patch(entry.uid, { status: 'loading', error: undefined });
    this.sub = this.api.getRecords(level.records, this.period(), this.range(), { locationId: this.locationId(), ...level.params }).subscribe({
      next: r => this.patch(entry.uid, { status: 'ok', records: r }),
      error: (err: unknown) => this.patch(entry.uid, { status: 'error', error: CeoDiscountsService.describeError(err) })
    });
  }

  private patch(uid: number, change: Partial<Entry>) {
    this.entries.update(list => list.map(e => (e.uid === uid ? { ...e, ...change } : e)));
  }

  // ---------- level 2: groups ----------

  groupBy = computed<DiscountGroupBy | null>(() => {
    const e = this.current();
    return e?.level.kind === 'groups' ? e.level.by : null;
  });
  groupSpec = computed(() => (this.groupBy() ? GROUP_TITLES[this.groupBy()!] : null));
  groups = computed<CeoDiscountGroup[]>(() => {
    const d = this.data();
    const by = this.groupBy();
    if (!d || !by) return [];
    return by === 'location' ? d.byLocation : by === 'seller' ? d.bySeller : d.byShift;
  });
  groupMax = computed(() => Math.max(1, ...this.groups().map(g => g.discountMonthly)));
  groupTotals = computed(() => {
    const g = this.groups();
    const discount = g.reduce((a, x) => a + x.discountMonthly, 0);
    const base = g.reduce((a, x) => a + x.baseMonthly, 0);
    return {
      bookings: g.reduce((a, x) => a + x.bookings, 0), discounted: g.reduce((a, x) => a + x.discounted, 0), discount,
      pct: base > 0 ? (discount * 100) / base : 0, invoices: g.reduce((a, x) => a + x.invoiceDiscount, 0)
    };
  });

  /** A level 2 row -> its discounted bookings. */
  openGroup(g: CeoDiscountGroup) {
    const by = this.groupBy();
    if (!by) return;
    const params: DashParams = by === 'location' ? { locationId: g.key ?? 'none' } : by === 'seller' ? { sellerId: g.key ?? 'none' } : { shift: g.key ?? g.name };
    this.push({ kind: 'records', records: 'bookings', params, crumb: g.name });
  }

  /** The location's invoices with a discount. */
  openGroupInvoices(g: CeoDiscountGroup) {
    this.push({ kind: 'records', records: 'invoices', params: { locationId: g.key ?? 'none' }, crumb: `${g.name}: invoices` });
  }

  // ---------- level 3: records ----------

  recordKind = computed<CeoDiscountRecordKind | null>(() => {
    const e = this.current();
    return e?.level.kind === 'records' ? e.level.records : null;
  });
  bookingRows = computed(() => (this.recordKind() === 'bookings' ? (this.current()?.records?.rows ?? []) as CeoDiscountBooking[] : []));
  invoiceRows = computed(() => (this.recordKind() === 'invoices' ? (this.current()?.records?.rows ?? []) as CeoDiscountInvoice[] : []));
  recordTotal = computed(() => this.current()?.records?.total ?? 0);
  recordShown = computed(() => this.current()?.records?.rows.length ?? 0);
  highlight = computed<number | null>(() => {
    const e = this.current();
    return e?.level.kind === 'records' ? e.level.highlight ?? null : null;
  });
  manyLocations = computed(() => new Set(this.bookingRows().map(r => r.location)).size > 1);

  title = computed(() => {
    const e = this.current();
    if (!e) return '';
    if (e.level.kind === 'groups') return GROUP_TITLES[e.level.by].title;
    return e.records?.title || (e.level.records === 'invoices' ? 'Invoices with a discount' : 'Discounted bookings');
  });

  /** "List PKR 35,000 a seat less the Morning discount of 30%" for the expected cell's tooltip. */
  expectedNote(b: CeoDiscountBooking): string {
    if (b.expectedMonthly === null) return 'The room has no list price: not compared';
    if (b.shift === '24/7') return `List ${fullMoney(b.listSeatPrice)} a seat x ${b.seats}`;
    return b.shiftDiscountCapPct
      ? `List ${fullMoney(b.listSeatPrice)} a seat x ${b.seats}, less the ${b.shift} discount of ${pct(b.shiftDiscountCapPct)}`
      : `List ${fullMoney(b.listSeatPrice)} a seat x ${b.seats}, no ${b.shift} discount set`;
  }

  /** The line under an invoice's customer: its room and location. */
  placeOf(r: CeoDiscountInvoice): string {
    return [r.room, r.location].filter(Boolean).join(' · ');
  }

  /** How the discount is made up, for the discount cell's tooltip. */
  discountNote(b: CeoDiscountBooking): string {
    const parts: string[] = [];
    if (b.belowPriceMonthly > 0) parts.push(`${fullMoney(b.belowPriceMonthly)} below the expected price`);
    if (b.fixedMonthly > 0) parts.push(`${fullMoney(b.fixedMonthly)} fixed discount`);
    return parts.join(' + ') || 'No discount';
  }

  // ---------- Excel: the level on screen ----------

  canExport = computed(() => {
    const e = this.current();
    if (e?.status !== 'ok') return false;
    return e.level.kind === 'groups' ? this.groups().length > 0 : this.recordShown() > 0;
  });

  exportExcel() {
    const e = this.current();
    if (!e || !this.canExport()) return;
    let table: XlsxCell[][];
    if (e.level.kind === 'groups') {
      const seller = e.level.by === 'seller';
      const location = e.level.by === 'location';
      table = [
        [GROUP_TITLES[e.level.by].rowLabel, ...(seller ? ['Role'] : []), 'Discounted', 'Bookings', 'Discount a month (PKR)', 'Of expected (%)',
          ...(location ? ['Invoice discount (PKR)', 'Invoices'] : [])],
        ...this.groups().map(g => [g.name, ...(seller ? [g.role ?? ''] : []), g.discounted, g.bookings, g.discountMonthly,
          Math.round(g.discountPct * 10) / 10, ...(location ? [g.invoiceDiscount, g.invoicesDiscounted] : [])])
      ];
    } else if (e.level.records === 'invoices') {
      table = [INVOICE_HEAD, ...this.invoiceRows().map(invoiceRow)];
    } else {
      table = [BOOKING_HEAD, ...this.bookingRows().map(bookingRow)];
    }
    const about: XlsxCell[][] = [
      [this.title()],
      ['Path', this.crumbs().join(' / ')],
      ...(e.level.kind === 'records' ? [['Rows', `${this.recordShown()} of ${this.recordTotal()}`]] : []),
      ['Money in PKR; bookings a month'],
      ['Generated', new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })]
    ];
    downloadXlsx(`${fileSlug('WorkNest', this.request()?.root ?? 'Discounts', e.level.crumb)}-${fileDate()}.xlsx`, [
      { name: e.level.kind === 'groups' ? 'Breakdown' : e.level.records === 'invoices' ? 'Invoices' : 'Bookings', rows: table },
      { name: 'About', header: 0, rows: about }
    ]);
  }

  // ---------- keyboard: Escape closes, Tab stays inside ----------

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent) {
    if (!this.open()) return;
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key !== 'Tab') return;
    const panel = this.panel()?.nativeElement;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), select, input'
    )).filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !panel.contains(active))) { e.preventDefault(); first.focus(); }
  }
}
