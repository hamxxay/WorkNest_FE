import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import type { CeoError, CeoPeriod } from '../../../../services/ceo.service';
import {
  CeoDiscountBooking, CeoDiscountGroup, CeoDiscounts, CeoDiscountsService
} from '../../../../services/ceo-discounts.service';
import type { DashParams, DashRange } from '../../../../services/dashboard-api';
import { DashKpi, count, fullMoney, money, pct } from '../ceo-shared';
import { periodTitleOf, periodWords } from '../period-range';
import { CeoDiscountsDrawer, DiscountDrill, DiscountGroupBy } from './discounts-drawer';

export { discountSheets } from './discounts-export';

/** Rows a breakdown panel shows before "Show all" (the drawer has them all). */
const PANEL_ROWS = 6;

/**
 * Discounts section of the CEO dashboard: the discount a month given on the rooms' bookings running in the period
 * (below the expected price as the Rooms section sees it: 24/7 against the room price, Morning / Evening against the
 * shift price; plus fixed PKR discounts), as a share of the expected rent; how many bookings got one; the discount on
 * the invoices issued in the period; by location, by salesperson and by shift; and the biggest discounts. Every figure
 * opens its records in the section's drawer. Follows the dashboard's period, range and location. Read-only.
 * Data: GET api/ceo/discounts (database update DD_01; before it, only the API's message shows).
 */
@Component({
  selector: 'app-ceo-discounts',
  standalone: true,
  imports: [NgTemplateOutlet, CeoDiscountsDrawer],
  templateUrl: './ceo-discounts.html',
  styleUrls: ['../ceo-dashboard.css', './ceo-discounts.css']
})
export class CeoDiscountsSection {
  private api = inject(CeoDiscountsService);

  period = input.required<CeoPeriod>();
  /** The dashboard's custom range (period custom). */
  range = input<DashRange | null>(null);
  locationId = input<number | null>(null);
  /** Bumped by the dashboard's refresh button. */
  reload = input(0);
  /** Bumped by the dashboard's auto refresh: reload without dimming the section. */
  quietReload = input(0);

  readonly money = money;
  readonly fullMoney = fullMoney;
  readonly pct = pct;
  readonly count = count;
  readonly panelRows = PANEL_ROWS;

  data = signal<CeoDiscounts | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  error = signal<CeoError | null>(null);
  drill = signal<DiscountDrill | null>(null);

  private sub: Subscription | null = null;
  private dataKey = '';
  private drillId = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
    effect(() => {
      this.period();
      this.range();
      this.locationId();
      this.reload();
      untracked(() => this.load());
    });
    effect(() => {
      if (this.quietReload()) untracked(() => this.load(true));
    });
  }

  // ---------- loading ----------

  /** The range the requests use: only with period custom. */
  activeRange = computed(() => (this.period() === 'custom' ? this.range() : null));

  load(quiet = false) {
    this.sub?.unsubscribe();
    if (!quiet) { if (this.data()) this.refreshing.set(true); else this.loading.set(true); }
    const range = this.activeRange();
    const key = `${this.period()}|${range?.from ?? ''}|${range?.to ?? ''}|${this.locationId() ?? ''}`;
    this.sub = this.api.getDiscounts(this.period(), this.locationId(), range).subscribe({
      next: d => {
        this.data.set(d);
        this.dataKey = key;
        this.error.set(null);
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: (err: CeoError) => {
        const e = CeoDiscountsService.describeError(err);
        this.error.set(e.status === 404
          ? { ...e, message: 'The server does not have the discounts yet. It will work once the API update is live.' }
          : e);
        // Figures of another period / location would be misleading: keep them only for a plain refresh.
        if (this.dataKey !== key) { this.data.set(null); this.dataKey = ''; }
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }

  // ---------- figures ----------

  s = computed(() => (this.data()?.available ? this.data()!.summary : null));
  private shownPeriod = computed<CeoPeriod>(() => this.data()?.period ?? this.period());
  private shownRange = computed(() => this.data()?.range ?? this.activeRange());
  periodTitle = computed(() => this.data()?.periodLabel || periodTitleOf(this.shownPeriod(), this.shownRange()));
  /** "this month" / "in this range". */
  thisWord = computed(() => periodWords(this.shownPeriod(), this.shownRange()).thisP);
  noBookings = computed(() => !this.s()?.bookings);

  kpis = computed<DashKpi[]>(() => {
    const s = this.s();
    if (!s) return [];
    const word = this.thisWord();
    return [
      {
        key: 'discount', label: 'Discount a month', value: money(s.discountMonthly), full: `${fullMoney(s.discountMonthly)} a month`,
        sub: s.baseMonthly ? `${pct(s.discountPct)} of the expected rent` : 'No bookings to compare',
        tone: s.discountMonthly > 0 ? 'danger' : 'ok',
        action: () => this.openGroups('location'), actionLabel: 'Open the discount by location'
      },
      {
        key: 'discounted', label: 'Bookings discounted', value: `${count(s.discounted)} of ${count(s.bookings)}`,
        sub: s.discounted ? `${pct(s.averageDiscountPct)} off on average` : `None ${word}`,
        tone: s.discounted ? 'warn' : 'ok',
        action: s.discounted ? () => this.openRecords({}, 'Discounted bookings') : undefined,
        actionLabel: 'Open the discounted bookings'
      },
      {
        key: 'new', label: 'New deals discounted', value: `${count(s.newDiscounted)} of ${count(s.newBookings)}`,
        sub: s.newDiscounted ? `${money(s.newDiscountMonthly)} a month off` : s.newBookings ? 'All at the price or above' : `No bookings started ${word}`,
        full: 'Bookings that started in the period', tone: s.newDiscounted ? 'warn' : 'neutral',
        action: s.newDiscounted ? () => this.openRecords({ newOnly: true }, 'New deals') : undefined,
        actionLabel: 'Open the new deals with a discount'
      },
      {
        key: 'invoices', label: 'Discount on invoices', value: money(s.invoiceDiscount), full: fullMoney(s.invoiceDiscount),
        sub: s.invoicesDiscounted ? `${count(s.invoicesDiscounted)} invoice${s.invoicesDiscounted === 1 ? '' : 's'} · ${money(s.invoiceDiscountPaid)} on paid ones` : `No invoice discounts ${word}`,
        tone: 'neutral',
        action: s.invoicesDiscounted ? () => this.openInvoices() : undefined,
        actionLabel: 'Open the invoices with a discount'
      }
    ];
  });

  byLocation = computed(() => this.data()?.byLocation ?? []);
  bySeller = computed(() => this.data()?.bySeller ?? []);
  byShift = computed(() => this.data()?.byShift ?? []);
  biggest = computed(() => this.data()?.biggest ?? []);
  locationMax = computed(() => Math.max(1, ...this.byLocation().map(g => g.discountMonthly)));
  sellerMax = computed(() => Math.max(1, ...this.bySeller().map(g => g.discountMonthly)));
  shiftMax = computed(() => Math.max(1, ...this.byShift().map(g => g.discountMonthly)));
  biggestMax = computed(() => Math.max(1, ...this.biggest().map(b => b.discountMonthly)));

  /** "2 of 9 discounted" under a breakdown row. */
  groupSub(g: CeoDiscountGroup): string {
    if (!g.bookings) return g.invoicesDiscounted ? 'Invoices only' : 'No bookings';
    return `${count(g.discounted)} of ${count(g.bookings)} discounted${g.discountMonthly ? ' · ' + pct(g.discountPct) : ''}`;
  }

  /** The line under a big discount: room, shift, location. */
  roomLine(b: CeoDiscountBooking): string {
    return [b.room, b.shift, this.byLocation().length > 1 ? b.location : ''].filter(Boolean).join(' · ');
  }

  // ---------- drill-down ----------

  openGroups(by: DiscountGroupBy) {
    const crumb = by === 'location' ? 'By location' : by === 'seller' ? 'By salesperson' : 'By shift';
    this.drill.set({ id: ++this.drillId, root: 'Discounts', level: { kind: 'groups', by, crumb } });
  }

  openRecords(params: DashParams, crumb: string, highlight?: number) {
    this.drill.set({ id: ++this.drillId, root: 'Discounts', level: { kind: 'records', records: 'bookings', params, crumb, highlight } });
  }

  /** A breakdown row -> its discounted bookings (key null: no location / no salesperson recorded). */
  openGroupRow(by: DiscountGroupBy, g: CeoDiscountGroup) {
    const params: DashParams = by === 'location' ? { locationId: g.key ?? 'none' } : by === 'seller' ? { sellerId: g.key ?? 'none' } : { shift: g.key ?? g.name };
    this.openRecords(params, g.name);
  }
  openBooking(b: CeoDiscountBooking) {
    this.openRecords(b.locationId ? { locationId: b.locationId } : {}, b.location || 'Discounted bookings', b.bookingId);
  }

  openInvoices() {
    this.drill.set({ id: ++this.drillId, root: 'Discounts', level: { kind: 'records', records: 'invoices', params: {}, crumb: 'Invoices' } });
  }

  closeDrill() { this.drill.set(null); }
}
