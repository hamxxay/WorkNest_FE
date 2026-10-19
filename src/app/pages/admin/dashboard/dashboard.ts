import { Component, signal, OnInit, OnDestroy, computed, inject, viewChild } from '@angular/core';
import { ToastService } from '../../../services/toast.service';
import { RouterLink, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import {
  MainDashboardService, MainDetailRow, MainInventoryRow, MainSortField, MainStatus, MainTag
} from '../../../services/main-dashboard.service';
import { DashError } from '../../../services/dashboard-api';
import { AccessOverview } from './access-overview/access-overview';
import { DashboardOverview, DashPeriod, dashDay, dashRangeDays } from './dashboard-overview/dashboard-overview';
import { RoleDashboard, DashRole } from './role-dashboard/role-dashboard';
import { ForecastPanel } from './forecast-panel/forecast-panel';
import { WeeklyReportMenu } from './weekly-report-menu/weekly-report-menu';
import { KeepInView } from '../../../components/keep-in-view/keep-in-view.directive';
import { Location, AnnouncementItem, CreateAnnouncementRequest } from '../../../models/admin.model';

export type TagFilterType = MainTag;

/** A row of the Space Operations & Inventory table (one page comes from GET api/dashboard/inventory). */
export interface SpaceOperationItem {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  spaceTypeId: number;
  spaceTypeName: string;
  locationId?: number | null;
  locationName?: string | null;
  status: MainStatus;
  bookingId?: number | null;
  customerName?: string | null;
  companyName?: string | null;
  bookingStart?: string | Date | null;
  bookingEnd?: string | Date | null;
  bookingStatus?: string | null;
  shiftType?: string | null;
  quotationId?: number | null;
  quotationNumber?: string | null;
  quotationCustomerName?: string | null;
  quotationDate?: string | Date | null;
  quotationExpiryDate?: string | Date | null;
  quotationAmount?: number | null;
  quotationStatus?: string | null;
  daysRemainingNum?: number | null;
  remainingTimeFormatted?: string;
  isExpiringSoon?: boolean;
  isPrivateSpace?: boolean;
}

export interface SpaceTypeBookedDetail {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  locationName?: string;
  customerName: string;
  companyName?: string;
  occupiedShifts: string[];
  openShifts: string[];
  bookingId?: number | null;
  bookingStart?: string | Date | null;
  bookingEnd?: string | Date | null;
  bookingStatus?: string;
}

export interface SpaceTypeVacantDetail {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  locationName?: string;
  nextBookingDate?: string | Date | null;
  nextBookingCustomer?: string | null;
}

export interface SpaceTypeQuotedDetail {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  locationName?: string;
  customerName: string;
  companyName?: string;
  quotationId?: number;
  quotationNumber: string;
  quotationStatus: string;
  quotationDate: string | Date;
  quotationExpiryDate?: string | Date | null;
  quotationAmount?: number | null;
  isAlsoBooked: boolean;
}

export interface SpaceTypeExpiringDetail {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  locationName?: string;
  customerName: string;
  companyName?: string;
  bookingId?: number;
  bookingStart: string | Date;
  bookingEnd: string | Date;
  daysRemaining: number;
  remainingTimeFormatted: string;
  bookingStatus: string;
}

/** A space type card (GET api/dashboard/main-summary: counted by the API for every space, booking and quotation). */
export interface SpaceTypeCardData {
  spaceTypeId: number;
  spaceTypeName: string;
  locationId: number | null;
  locationName: string | null;
  totalSpaces: number;
  bookedCount: number;
  vacantCount: number;
  quotedCount: number;
  expiringCount: number;
}

/** The list open under a card tag: loaded page by page from GET api/dashboard/main-summary/details. */
interface TagTray {
  spaceTypeId: number;
  tag: TagFilterType;
  status: 'loading' | 'ok' | 'error';
  error: DashError | null;
  rows: MainDetailRow[];
  total: number;
  page: number;
  /** Loading the next page (the rows so far stay). */
  more: boolean;
}

type LoadStatus = 'loading' | 'ok' | 'error';
type SortField = MainSortField;

/** Longest custom range (as the API): two years. */
const MAX_CUSTOM_DAYS = 731;
/** Rows a card tag list loads at a time. */
const TRAY_PAGE_SIZE = 25;

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, FormsModule, DatePipe, AccessOverview, DashboardOverview, RoleDashboard, ForecastPanel, WeeklyReportMenu, KeepInView],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard implements OnInit, OnDestroy {
  private admin = inject(AdminService);
  private mainApi = inject(MainDashboardService);
  private router = inject(Router);
  protected auth = inject(AuthService);
  private toast = inject(ToastService);

  protected readonly Math = Math;

  get isSuperAdmin(): boolean {
    return this.auth.hasRole('super_admin');
  }

  /** Which role sections the dashboard shows (same order of precedence as the API's api/dashboard/role). */
  get dashRole(): DashRole {
    if (this.auth.hasRole('super_admin')) return 'super_admin';
    if (this.auth.hasRole('admin')) return 'admin';
    return 'sales_executive';
  }

  /** Door access card: machines + challan suspensions (sales executives can set access too; the API limits bookings to their locations). */
  get canSeeAccess(): boolean {
    return this.auth.hasRole('admin') || this.auth.hasRole('super_admin') || this.auth.hasRole('sales_executive');
  }

  get userLocationId(): number | null {
    // Admins and Sales Executives are tied to their location(s); only Super Admins cover every location.
    if (!this.auth.isLocationBound()) return null;
    return this.auth.user()?.locationId ?? null;
  }

  // ---------- space type cards (GET api/dashboard/main-summary) ----------
  summaryStatus = signal<LoadStatus>('loading');
  summaryError = signal<DashError | null>(null);
  spaceTypeCards = signal<SpaceTypeCardData[]>([]);
  /** Every space in scope ("All Types (N Spaces)"). */
  totalSpacesCount = signal(0);
  /** Cards span more than one location: each card names its location (types belong to a location). */
  cardsShowLocation = computed(() => new Set(this.spaceTypeCards().map(c => c.locationId ?? 0)).size > 1);

  // ---------- Space Operations & Inventory table (GET api/dashboard/inventory, one page at a time) ----------
  inventoryStatus = signal<LoadStatus>('loading');
  inventoryError = signal<DashError | null>(null);
  inventoryRows = signal<SpaceOperationItem[]>([]);
  inventoryTotal = signal(0);
  /** A reload while the table (and its filters) stay on screen. */
  inventoryBusy = signal(false);
  private inventoryLoaded = false;

  /** First load of either section (skeletons, header spinner); later loads keep the figures on screen. */
  loading = computed(() => this.summaryStatus() === 'loading' || this.inventoryStatus() === 'loading');

  // Active Dropdown state: { spaceTypeId, tag } or null
  activeDropdown = signal<{ spaceTypeId: number; tag: TagFilterType } | null>(null);
  /** The list under the open tag. */
  tray = signal<TagTray | null>(null);

  // Locations list signal
  locationsList = signal<Location[]>([]);
  /** Locations the KPIs and lists cover: one or several. Empty = every location the user may see. */
  readonly kpiLocationIds = signal<number[]>([]);
  readonly locationMenuOpen = signal(false);
  private kpiLocationsInitialised = false;
  isKpiLocationSelected(id: number): boolean {
    return this.kpiLocationIds().includes(Number(id));
  }
  toggleKpiLocation(id: number) {
    const n = Number(id);
    const cur = this.kpiLocationIds();
    const next = cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n];
    // Unticking the last one means "all": a sales executive then sees all of their locations.
    this.kpiLocationIds.set(next);
    this.onScopeChange();
  }
  selectAllKpiLocations() {
    this.kpiLocationIds.set([]);
    this.onScopeChange();
  }
  /** Admin or sales executive (not super admin): sees only the locations assigned to them. */
  get isSalesExecutiveOnly(): boolean {
    return this.auth.isLocationBound();
  }

  /**
   * Space Types dropdown options: the names of the cards' types (the types of the dashboard's locations), narrowed to
   * the inventory Location filter's location when one is chosen (types belong to a location).
   */
  readonly spaceTypeOptions = computed(() => {
    let cards = this.spaceTypeCards();
    const sel = this.selectedLocation();
    if (sel !== 'ALL') cards = cards.filter(c => c.locationId == null || String(c.locationId) === sel);
    return Array.from(new Set(cards.map(c => c.spaceTypeName)));
  });

  // Filter Signals for Inventory Table
  searchSpace = signal('');
  searchCustomer = signal('');
  selectedSpaceType = signal('ALL');
  /** 'ALL' or a location id. */
  selectedLocation = signal('ALL');
  selectedStatus = signal<'ALL' | MainStatus>('ALL');
  readonly statusOptions: MainStatus[] = ['Available', 'Quoted', 'Booked'];
  privateSpacesOnlyFilter = signal(false);
  expiringThreshold = signal(30); // Default 30 days threshold

  // Sorting Signals
  sortBy = signal<SortField>('urgency');
  sortOrder = signal<'asc' | 'desc'>('asc');

  // Pagination Signals
  page = signal(1);
  pageSize = signal(10);
  pageSizeOptions = [10, 25, 50, 100];

  // ============= ANNOUNCEMENTS & ALERTS STATE SIGNALS =============
  announcementsList = signal<AnnouncementItem[]>([]);
  announcementsLoading = signal<boolean>(false);
  announcementCreating = signal<boolean>(false);
  selectedAnnouncement = signal<AnnouncementItem | null>(null);
  showAnnouncementModal = signal<boolean>(false);
  showAnnouncementDetailModal = signal<boolean>(false);

  // Computed Announcement KPIs
  announcementsTotalBroadcasts = computed(() => this.announcementsList().length);
  announcementsTotalDelivered = computed(() => this.announcementsList().reduce((acc, a) => acc + (a.sentCount || 0) + (a.readCount || 0), 0));
  announcementsTotalRead = computed(() => this.announcementsList().reduce((acc, a) => acc + (a.readCount || 0), 0));
  announcementsTotalFailed = computed(() => this.announcementsList().reduce((acc, a) => acc + (a.failedCount || 0), 0));
  announcementsTotalPending = computed(() => this.announcementsList().reduce((acc, a) => acc + (a.pendingCount || 0), 0));

  // Form State Signals
  announcementTitle = signal<string>('');
  announcementBody = signal<string>('');
  announcementFormType = signal<'Announcement' | 'Alert'>('Announcement');
  announcementTargetScope = signal<'All' | 'Location' | 'Space' | 'CustomList'>('All');
  announcementLocationId = signal<number | null>(null);
  announcementSpaceId = signal<number | null>(null);
  announcementCustomUsersText = signal<string>('');
  announcementScheduleMode = signal<'now' | 'later'>('now');
  announcementScheduledDate = signal<string>('');
  announcementFormError = signal<string>('');
  announcementFormSuccess = signal<string>('');

  // "By Space" picker: spaces of the dashboard's locations, searched on the server (code or name), 50 at a time.
  spacePickerOptions = signal<{ spaceId: number; label: string }[]>([]);
  spacePickerSearch = signal('');
  spacePickerStatus = signal<LoadStatus>('ok');
  spacePickerError = signal('');
  spacePickerTotal = signal(0);
  private spacePickerSub: Subscription | null = null;
  private spacePickerTimer?: ReturnType<typeof setTimeout>;

  // ---------- Period selector (month / quarter / year / custom) + one-page PDF report ----------
  period = signal<DashPeriod>('month');
  readonly periods: { key: Exclude<DashPeriod, 'custom'>; label: string }[] = [
    { key: 'month', label: 'This month' }, { key: 'quarter', label: 'Quarter' }, { key: 'year', label: 'Year' }
  ];
  /** The custom range in use (period 'custom'), 'yyyy-MM-dd'. */
  customFrom = signal<string | null>(null);
  customTo = signal<string | null>(null);
  /** The custom range editor (from / to + Apply) and what is typed in it. */
  customOpen = signal(false);
  draftFrom = signal('');
  draftTo = signal('');
  customError = signal('');
  /** "1 Jul 2026 to 30 Sep 2026" while the custom range is in use. */
  customLabel = computed(() => (this.period() === 'custom' && this.customFrom() && this.customTo()
    ? `${dashDay(this.customFrom())} to ${dashDay(this.customTo())}` : ''));
  /** What the child panels get: the range only while period is custom. */
  rangeFrom = computed(() => (this.period() === 'custom' ? this.customFrom() : null));
  rangeTo = computed(() => (this.period() === 'custom' ? this.customTo() : null));

  setPeriod(p: Exclude<DashPeriod, 'custom'>) {
    this.customOpen.set(false);
    this.customError.set('');
    this.period.set(p);
  }

  /** Opens the from / to editor (the current range, else the 1st of this month to today). */
  openCustom() {
    if (this.customOpen()) { this.customOpen.set(false); return; }
    const today = this.ymd(new Date());
    this.draftFrom.set(this.customFrom() ?? `${today.slice(0, 8)}01`);
    this.draftTo.set(this.customTo() ?? today);
    this.customError.set('');
    this.customOpen.set(true);
  }

  cancelCustom() {
    this.customOpen.set(false);
    this.customError.set('');
  }

  /** Checks the range (both days, from on or before to, at most two years) and shows it everywhere. */
  applyCustom() {
    const from = this.draftFrom().trim(), to = this.draftTo().trim();
    const ok = /^\d{4}-\d{2}-\d{2}$/;
    if (!ok.test(from) || !ok.test(to)) { this.customError.set('Choose both dates.'); return; }
    if (from > to) { this.customError.set('The start date must be on or before the end date.'); return; }
    if (from < '2000-01-01' || to > '2100-12-31') { this.customError.set('Choose dates between 2000 and 2100.'); return; }
    if (dashRangeDays(from, to) > MAX_CUSTOM_DAYS) { this.customError.set(`Choose at most ${MAX_CUSTOM_DAYS} days (two years).`); return; }
    this.customError.set('');
    this.customFrom.set(from);
    this.customTo.set(to);
    this.period.set('custom');
    this.customOpen.set(false);
  }

  private ymd(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private overview = viewChild(DashboardOverview);
  downloadReport() {
    const u = this.auth.user();
    this.overview()?.downloadReport({ location: this.locationLabel(), preparedBy: u?.displayName || u?.email || 'WorkNest' });
  }
  get exporting(): boolean { return this.overview()?.exporting() ?? false; }

  // ---------- Header: greeting, date, location, last updated ----------
  readonly today = new Date();
  refreshTick = signal(0);
  lastUpdated = signal<Date | null>(null);
  private nowTick = signal(Date.now());
  private autoRefresh?: ReturnType<typeof setInterval>;
  private clock?: ReturnType<typeof setInterval>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private summarySub: Subscription | null = null;
  private inventorySub: Subscription | null = null;
  private traySub: Subscription | null = null;
  private locationsSub: Subscription | null = null;

  greeting = computed(() => {
    this.nowTick();
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  });

  firstName = computed(() => {
    const u = this.auth.user();
    const raw = (u?.displayName || u?.email?.split('@')[0] || 'there').trim();
    const first = raw.split(/[\s._-]+/)[0].replace(/\d+$/, '') || raw;
    return first.charAt(0).toUpperCase() + first.slice(1);
  });

  locationLabel = computed(() => {
    const ids = this.kpiLocationIds();
    const all = this.locationsList();
    const name = (l: any) => l?.name ?? l?.Name ?? '';
    if (!ids.length || (all.length > 0 && ids.length >= all.length)) {
      if (this.isSalesExecutiveOnly && all.length === 1) return name(all[0]) || 'Your location';
      return this.isSalesExecutiveOnly ? 'All my locations' : 'All locations';
    }
    const names = ids.map(id => name(all.find((l: any) => Number(l.id ?? l.Id) === id))).filter(Boolean);
    if (names.length <= 2) return names.join(' + ') || 'Selected locations';
    return `${names.length} locations`;
  });

  updatedAgo = computed(() => {
    const at = this.lastUpdated();
    if (!at) return '';
    const mins = Math.floor((this.nowTick() - at.getTime()) / 60000);
    return mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} min ago` : at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });

  // Occupancy ring on the space-type cards
  readonly ringLength = 2 * Math.PI * 21;
  occPct(t: SpaceTypeCardData): number {
    return t.totalSpaces > 0 ? Math.round((t.bookedCount / t.totalSpaces) * 100) : 0;
  }
  ringOffset(t: SpaceTypeCardData): number {
    return this.ringLength * (1 - Math.min(100, this.occPct(t)) / 100);
  }

  ngOnInit() {
    this.loadDashboardData();
    this.loadAnnouncements();
    // Keep the numbers current without a manual refresh.
    this.autoRefresh = setInterval(() => this.refreshAll(true), 5 * 60 * 1000);
    this.clock = setInterval(() => this.nowTick.set(Date.now()), 30 * 1000);
  }

  ngOnDestroy() {
    if (this.autoRefresh) clearInterval(this.autoRefresh);
    if (this.clock) clearInterval(this.clock);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.spacePickerTimer) clearTimeout(this.spacePickerTimer);
    [this.summarySub, this.inventorySub, this.traySub, this.locationsSub, this.spacePickerSub].forEach(s => s?.unsubscribe());
  }

  /** Reload every section (header button + 5-minute auto refresh). */
  refreshAll(silent = false) {
    this.refreshTick.update(v => v + 1);
    if (!silent) this.loadLocations();
    this.loadSpaceData();
    this.loadAnnouncements();
  }

  loadDashboardData() {
    this.loadLocations();
    this.loadSpaceData();
  }

  /** The location picker (the API lists only the user's own locations for location-bound roles). */
  private loadLocations() {
    this.locationsSub?.unsubscribe();
    this.locationsSub = this.admin.getLocations(1, 1000).subscribe({
      next: (res: any) => {
        const rows: Location[] = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data
          : Array.isArray(res?.items) ? res.items : Array.isArray(res?.data?.items) ? res.data.items : [];
        this.locationsList.set(rows);
        if (!this.kpiLocationsInitialised) {
          this.kpiLocationsInitialised = true;
          // A sales executive with one location sees just that one; with several, all of them until they pick.
          if (this.isSalesExecutiveOnly && rows.length === 1) this.kpiLocationIds.set([Number((rows[0] as any).id ?? (rows[0] as any).Id)]);
        }
      },
      // The picker stays as it is (the figures still cover every location the user may see).
      error: (e: any) => this.toast.error(e?.error?.message || 'Could not load the locations for the location picker.')
    });
  }

  /** Cards, the open tag list and the current inventory page. */
  private loadSpaceData() {
    this.loadSummary();
    this.loadInventory();
    const t = this.tray();
    if (t) this.loadTray(t.spaceTypeId, t.tag, false);
  }

  /** The dashboard's locations changed: everything that follows them, the table from its first page. */
  private onScopeChange() {
    this.page.set(1);
    this.loadSummary();
    this.loadInventory();
    const t = this.tray();
    if (t) this.loadTray(t.spaceTypeId, t.tag, false);
  }

  loadSummary() {
    this.summarySub?.unsubscribe();
    if (!this.spaceTypeCards().length || this.summaryStatus() === 'error') this.summaryStatus.set('loading');
    this.summarySub = this.mainApi.getSummary(this.kpiLocationIds(), this.expiringThreshold()).subscribe({
      next: s => {
        this.spaceTypeCards.set(s.cards);
        this.totalSpacesCount.set(s.totalSpaces);
        this.summaryError.set(null);
        this.summaryStatus.set('ok');
        this.lastUpdated.set(new Date());
        this.nowTick.set(Date.now());
      },
      error: (err: DashError) => {
        this.summaryError.set(err);
        this.summaryStatus.set('error');
      }
    });
  }

  loadInventory() {
    this.inventorySub?.unsubscribe();
    // Skeleton only before the table has loaded once; afterwards the filters stay usable while it reloads.
    if (!this.inventoryLoaded) this.inventoryStatus.set('loading');
    this.inventoryBusy.set(true);
    const loc = this.selectedLocation();
    const type = this.selectedSpaceType();
    const status = this.selectedStatus();
    this.inventorySub = this.mainApi.getInventory({
      locationIds: this.kpiLocationIds(),
      location: loc !== 'ALL' && !isNaN(Number(loc)) ? Number(loc) : null,
      search: this.searchSpace(),
      customer: this.searchCustomer(),
      spaceType: type !== 'ALL' ? type : null,
      status: status !== 'ALL' ? status : null,
      privateOnly: this.privateSpacesOnlyFilter(),
      expiringDays: this.expiringThreshold(),
      sortBy: this.sortBy(),
      sortDir: this.sortOrder(),
      page: this.page(),
      pageSize: this.pageSize()
    }).subscribe({
      next: p => {
        this.inventoryRows.set(p.items.map(r => this.toItem(r)));
        this.inventoryTotal.set(p.total);
        this.inventoryError.set(null);
        this.inventoryStatus.set('ok');
        this.inventoryBusy.set(false);
        this.inventoryLoaded = true;
        // A page past the end (rows went away since): show the last page.
        if (!p.items.length && p.total > 0 && this.page() > 1) {
          this.page.set(Math.max(1, Math.ceil(p.total / this.pageSize())));
          this.loadInventory();
        }
      },
      error: (err: DashError) => {
        this.inventoryError.set(err);
        this.inventoryStatus.set('error');
        this.inventoryBusy.set(false);
      }
    });
  }

  private toItem(r: MainInventoryRow): SpaceOperationItem {
    const time = r.status === 'Booked' ? this.formatTimeRemaining(r.bookingEnd) : null;
    return {
      ...r,
      shiftType: r.shiftType,
      daysRemainingNum: r.daysRemaining,
      remainingTimeFormatted: time?.text ?? '—'
    };
  }

  /** Occupied / open shift labels of a booked space, from the shifts its live bookings take now. */
  private shiftLabels(r: MainDetailRow): { occupied: string[]; open: string[] } {
    if (r.has247 || (!r.hasMorning && !r.hasEvening)) return { occupied: ['24/7 (Full Day)'], open: ['None (Fully Occupied)'] };
    const occupied: string[] = [], open: string[] = [];
    (r.hasMorning ? occupied : open).push('Morning (6am-6pm)');
    (r.hasEvening ? occupied : open).push('Evening (6pm-6am)');
    if (!open.length) open.push('None (Fully Occupied)');
    return { occupied, open };
  }

  bookedRows = computed<SpaceTypeBookedDetail[]>(() => {
    const t = this.tray();
    if (t?.tag !== 'booked') return [];
    return t.rows.map(r => {
      const sh = this.shiftLabels(r);
      return {
        spaceId: r.spaceId, spaceCode: r.spaceCode, spaceName: r.spaceName, capacity: r.capacity,
        locationName: r.locationName ?? undefined, customerName: r.customerName || 'Customer', companyName: r.companyName ?? undefined,
        occupiedShifts: sh.occupied, openShifts: sh.open, bookingId: r.bookingId, bookingStart: r.bookingStart, bookingEnd: r.bookingEnd,
        bookingStatus: r.bookingStatus || 'Confirmed'
      };
    });
  });

  vacantRows = computed<SpaceTypeVacantDetail[]>(() => {
    const t = this.tray();
    if (t?.tag !== 'vacant') return [];
    return t.rows.map(r => ({
      spaceId: r.spaceId, spaceCode: r.spaceCode, spaceName: r.spaceName, capacity: r.capacity,
      locationName: r.locationName ?? undefined, nextBookingDate: r.nextBookingDate, nextBookingCustomer: r.nextBookingCustomer
    }));
  });

  quotedRows = computed<SpaceTypeQuotedDetail[]>(() => {
    const t = this.tray();
    if (t?.tag !== 'quoted') return [];
    return t.rows.map(r => ({
      spaceId: r.spaceId, spaceCode: r.spaceCode, spaceName: r.spaceName, capacity: r.capacity,
      locationName: r.locationName ?? undefined, customerName: r.customerName || 'Customer', companyName: r.companyName ?? undefined,
      quotationId: r.quotationId ?? undefined, quotationNumber: r.quotationNumber || `#Q-${r.quotationId}`,
      quotationStatus: r.quotationStatus || 'Pending', quotationDate: r.quotationDate ?? '', quotationExpiryDate: r.quotationExpiryDate,
      quotationAmount: r.quotationAmount, isAlsoBooked: r.isAlsoBooked
    }));
  });

  expiringRows = computed<SpaceTypeExpiringDetail[]>(() => {
    const t = this.tray();
    if (t?.tag !== 'expiring') return [];
    return t.rows.map(r => {
      const time = this.formatTimeRemaining(r.bookingEnd);
      return {
        spaceId: r.spaceId, spaceCode: r.spaceCode, spaceName: r.spaceName, capacity: r.capacity,
        locationName: r.locationName ?? undefined, customerName: r.customerName || 'Customer', companyName: r.companyName ?? undefined,
        bookingId: r.bookingId ?? undefined, bookingStart: r.bookingStart ?? '', bookingEnd: r.bookingEnd ?? '',
        daysRemaining: r.daysRemaining ?? time.days, remainingTimeFormatted: time.text, bookingStatus: r.bookingStatus || 'Confirmed'
      };
    });
  });

  /** The open list has more rows on the server than on screen. */
  trayHasMore = computed(() => { const t = this.tray(); return !!t && t.status === 'ok' && t.rows.length < t.total; });

  /**
   * Loads a tag list: from its first page (opened, refreshed) or the next page (Show more, appended). A refresh keeps
   * the rows on screen until the new ones arrive.
   */
  loadTray(spaceTypeId: number, tag: TagFilterType, next: boolean) {
    const cur = this.tray();
    const same = cur && cur.spaceTypeId === spaceTypeId && cur.tag === tag;
    const page = next && same ? cur!.page + 1 : 1;
    this.traySub?.unsubscribe();
    if (next && same) this.tray.set({ ...cur!, more: true });
    else this.tray.set({
      spaceTypeId, tag, status: same && cur!.status === 'ok' ? 'ok' : 'loading', error: null,
      rows: same ? cur!.rows : [], total: same ? cur!.total : 0, page: 1, more: false
    });
    this.traySub = this.mainApi.getDetails(this.kpiLocationIds(), spaceTypeId, tag, this.expiringThreshold(), page, TRAY_PAGE_SIZE).subscribe({
      next: d => {
        const t = this.tray();
        if (!t || t.spaceTypeId !== spaceTypeId || t.tag !== tag) return;
        this.tray.set({ ...t, status: 'ok', error: null, rows: page > 1 ? [...t.rows, ...d.items] : d.items, total: d.total, page, more: false });
      },
      error: (err: DashError) => {
        const t = this.tray();
        if (!t || t.spaceTypeId !== spaceTypeId || t.tag !== tag) return;
        // Show more failing keeps the rows already shown and says so under them.
        this.tray.set(page > 1 ? { ...t, more: false, error: err } : { ...t, status: 'error', error: err, more: false });
      }
    });
  }

  retryTray() {
    const t = this.tray();
    if (!t) return;
    if (t.status === 'ok' && t.error) this.loadTray(t.spaceTypeId, t.tag, true);
    else this.loadTray(t.spaceTypeId, t.tag, false);
  }

  // =========================================================================
  // CARD & DROPDOWN INTERACTION HANDLERS
  // =========================================================================

  toggleTagDropdown(event: Event, spaceTypeId: number, tag: TagFilterType) {
    event.stopPropagation(); // Prevents triggering card-level filter
    const cur = this.activeDropdown();
    if (cur && cur.spaceTypeId === spaceTypeId && cur.tag === tag) {
      this.closeDropdown();
    } else {
      this.activeDropdown.set({ spaceTypeId, tag });
      this.loadTray(spaceTypeId, tag, false);
    }
  }

  closeDropdown(event?: Event) {
    if (event) event.stopPropagation();
    this.activeDropdown.set(null);
    this.traySub?.unsubscribe();
    this.tray.set(null);
  }

  selectCardSpaceType(spaceTypeName: string) {
    if (this.selectedSpaceType() === spaceTypeName) {
      this.selectedSpaceType.set('ALL');
    } else {
      this.selectedSpaceType.set(spaceTypeName);
    }
    this.onFilterChange();
  }

  // Dynamic Time Remaining Formatter
  formatTimeRemaining(endDateInput: any): { text: string; days: number; isExpired: boolean } {
    if (!endDateInput) return { text: '—', days: 99999, isExpired: false };
    const endDate = new Date(endDateInput);
    if (isNaN(endDate.getTime())) return { text: '—', days: 99999, isExpired: false };

    const now = new Date();
    const diffTime = endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      return { text: 'Expired', days: diffDays, isExpired: true };
    }

    if (diffDays >= 30) {
      const months = Math.floor(diffDays / 30);
      const remDays = diffDays % 30;
      if (remDays === 0) {
        return { text: `${months} month${months > 1 ? 's' : ''} remaining`, days: diffDays, isExpired: false };
      }
      return { text: `${months} month${months > 1 ? 's' : ''} ${remDays} day${remDays > 1 ? 's' : ''} remaining`, days: diffDays, isExpired: false };
    } else {
      return { text: `${diffDays} day${diffDays > 1 ? 's' : ''} remaining`, days: diffDays, isExpired: false };
    }
  }

  // Pagination Computations (the server pages the table)
  totalPages = computed(() => Math.max(1, Math.ceil(this.inventoryTotal() / this.pageSize())));
  canPrev = computed(() => this.page() > 1);
  canNext = computed(() => this.page() < this.totalPages());

  // Filter & Page Handlers: every change asks the server for the matching page.
  onFilterChange() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.page.set(1);
    this.loadInventory();
  }

  /** Search boxes: wait for a pause in typing before asking the server. */
  onSearchInput() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.onFilterChange(), 350);
  }

  /** Inventory Location filter changed: a chosen space type that isn't at the new location falls back to all types. */
  onInventoryLocationChange(value: string) {
    this.selectedLocation.set(value);
    const type = this.selectedSpaceType();
    if (type !== 'ALL' && !this.spaceTypeOptions().includes(type)) this.selectedSpaceType.set('ALL');
    this.onFilterChange();
  }

  setThreshold(days: number) {
    this.expiringThreshold.set(Number(days) || 30);
    this.page.set(1);
    this.loadSummary();
    this.loadInventory();
    const t = this.tray();
    if (t) this.loadTray(t.spaceTypeId, t.tag, false);
  }

  toggleSort(field: SortField) {
    if (this.sortBy() === field) {
      this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortBy.set(field);
      this.sortOrder.set('asc');
    }
    this.page.set(1);
    this.loadInventory();
  }

  prevPage() {
    if (this.canPrev()) { this.page.set(this.page() - 1); this.loadInventory(); }
  }

  nextPage() {
    if (this.canNext()) { this.page.set(this.page() + 1); this.loadInventory(); }
  }

  setPageSize(size: number) {
    this.pageSize.set(Number(size) || 10);
    this.page.set(1);
    this.loadInventory();
  }

  // Navigation Links
  viewSpaceDetails(space: { spaceCode?: string; spaceId?: number }) {
    this.router.navigate(['/admin/spaces'], { queryParams: { search: space.spaceCode || String(space.spaceId) } });
  }

  viewBookingDetails(bookingId?: number | null, spaceCode?: string) {
    if (bookingId) {
      this.router.navigate(['/admin/bookings'], { queryParams: { search: String(bookingId) } });
    } else if (spaceCode) {
      this.router.navigate(['/admin/bookings'], { queryParams: { search: spaceCode } });
    } else {
      this.router.navigate(['/admin/bookings']);
    }
  }

  viewQuotationDetails(quotationId?: number | null, quotationNumber?: string | null) {
    if (quotationNumber) {
      this.router.navigate(['/admin/quotations'], { queryParams: { search: quotationNumber } });
    } else if (quotationId) {
      this.router.navigate(['/admin/quotations'], { queryParams: { search: String(quotationId) } });
    } else {
      this.router.navigate(['/admin/quotations']);
    }
  }

  // ---------- announcement "By Space" picker ----------

  setAnnouncementScope(scope: 'All' | 'Location' | 'Space' | 'CustomList') {
    this.announcementTargetScope.set(scope);
    if (scope === 'Space' && this.spacePickerStatus() !== 'loading' && !this.spacePickerOptions().length) this.loadSpacePicker();
  }

  onSpacePickerSearch(value: string) {
    this.spacePickerSearch.set(value);
    if (this.spacePickerTimer) clearTimeout(this.spacePickerTimer);
    this.spacePickerTimer = setTimeout(() => this.loadSpacePicker(), 350);
  }

  loadSpacePicker() {
    this.spacePickerSub?.unsubscribe();
    this.spacePickerStatus.set('loading');
    this.spacePickerSub = this.mainApi.getInventory({
      locationIds: this.kpiLocationIds(), location: null, search: this.spacePickerSearch(), customer: '', spaceType: null,
      status: null, privateOnly: false, expiringDays: this.expiringThreshold(), sortBy: 'spaceCode', sortDir: 'asc', page: 1, pageSize: 50
    }).subscribe({
      next: p => {
        this.spacePickerOptions.set(p.items.map(r => ({ spaceId: r.spaceId, label: `${r.spaceCode} - ${r.spaceName} (${r.spaceTypeName})` })));
        this.spacePickerTotal.set(p.total);
        this.spacePickerStatus.set('ok');
        this.spacePickerError.set('');
      },
      error: (err: DashError) => {
        this.spacePickerStatus.set('error');
        this.spacePickerError.set(err.message);
      }
    });
  }

  // ============= ANNOUNCEMENTS & ALERTS METHODS =============

  loadAnnouncements() {
    this.announcementsLoading.set(true);
    this.admin.getAnnouncements(1, 50).subscribe({
      next: (res: any) => {
        this.announcementsLoading.set(false);
        const list = res.data?.items || (Array.isArray(res.data) ? res.data : []);
        this.announcementsList.set(list);
      },
      error: () => {
        this.announcementsLoading.set(false);
      }
    });
  }

  openCreateAnnouncementModal() {
    this.announcementTitle.set('');
    this.announcementBody.set('');
    this.announcementFormType.set('Announcement');
    this.announcementTargetScope.set('All');
    this.announcementLocationId.set(null);
    this.announcementSpaceId.set(null);
    this.announcementCustomUsersText.set('');
    this.announcementScheduleMode.set('now');
    this.announcementScheduledDate.set('');
    this.announcementFormError.set('');
    this.announcementFormSuccess.set('');
    this.showAnnouncementModal.set(true);
  }

  showDiscardAnnouncementConfirm = signal(false);

  isAnnouncementFormDirty(): boolean {
    return Boolean(
      this.announcementTitle().trim() ||
      this.announcementBody().trim() ||
      this.announcementCustomUsersText().trim() ||
      this.announcementLocationId() ||
      this.announcementScheduledDate()
    );
  }

  closeCreateAnnouncementModal() {
    if (this.isAnnouncementFormDirty()) {
      this.showDiscardAnnouncementConfirm.set(true);
    } else {
      this.forceCloseCreateAnnouncementModal();
    }
  }

  confirmDiscardAnnouncement() {
    this.showDiscardAnnouncementConfirm.set(false);
    this.forceCloseCreateAnnouncementModal();
  }

  cancelDiscardAnnouncement() {
    this.showDiscardAnnouncementConfirm.set(false);
  }

  forceCloseCreateAnnouncementModal() {
    this.showAnnouncementModal.set(false);
    this.announcementTitle.set('');
    this.announcementBody.set('');
    this.announcementCustomUsersText.set('');
    this.announcementLocationId.set(null);
    this.announcementFormError.set('');
  }

  submitAnnouncement() {
    const title = this.announcementTitle().trim();
    const body = this.announcementBody().trim();
    const type = this.announcementFormType();
    const scope = this.announcementTargetScope();

    if (!title) {
      this.announcementFormError.set('Please enter an announcement title.');
      return;
    }
    if (!body) {
      this.announcementFormError.set('Please enter a message body.');
      return;
    }

    let customIds: number[] | undefined;
    if (scope === 'CustomList') {
      const parts = this.announcementCustomUsersText()
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0 && !isNaN(Number(p)))
        .map(p => Number(p));
      if (parts.length === 0) {
        this.announcementFormError.set('Please enter at least one valid numeric User ID.');
        return;
      }
      customIds = parts;
    }

    if (scope === 'Location' && !this.announcementLocationId()) {
      this.announcementFormError.set('Please select a target Location.');
      return;
    }

    if (scope === 'Space' && !this.announcementSpaceId()) {
      this.announcementFormError.set('Please select a target Space.');
      return;
    }

    let scheduledAt: string | null = null;
    if (this.announcementScheduleMode() === 'later' && this.announcementScheduledDate()) {
      scheduledAt = new Date(this.announcementScheduledDate()).toISOString();
    }

    const payload: CreateAnnouncementRequest = {
      title,
      body,
      type,
      targetScope: scope,
      locationId: scope === 'Location' ? this.announcementLocationId() : null,
      spaceId: scope === 'Space' ? this.announcementSpaceId() : null,
      customUserIds: customIds,
      scheduledAt
    };

    this.announcementCreating.set(true);
    this.announcementFormError.set('');
    this.announcementFormSuccess.set('');

    this.admin.createAnnouncement(payload).subscribe({
      next: () => {
        this.announcementCreating.set(false);
        this.announcementFormSuccess.set('Announcement broadcasted and recipients queued successfully!');
        setTimeout(() => {
          this.closeCreateAnnouncementModal();
          this.loadAnnouncements();
        }, 1200);
      },
      error: (err) => {
        this.announcementCreating.set(false);
        this.announcementFormError.set(err.error?.message || 'Failed to dispatch announcement.');
      }
    });
  }

  viewAnnouncementDetail(item: AnnouncementItem) {
    this.selectedAnnouncement.set(item);
    this.showAnnouncementDetailModal.set(true);
    // Fetch full detail with recipient rows
    this.admin.getAnnouncementById(item.id).subscribe({
      next: (res) => {
        if (res.data) {
          this.selectedAnnouncement.set(res.data);
        }
      },
      error: (e: any) => this.toast.error(e?.error?.message ?? e?.message ?? 'Failed to load announcement details.')
    });
  }

  closeAnnouncementDetailModal() {
    this.showAnnouncementDetailModal.set(false);
    this.selectedAnnouncement.set(null);
  }
}
