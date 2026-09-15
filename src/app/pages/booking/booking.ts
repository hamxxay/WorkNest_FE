import { Component, OnInit, signal, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpaceService } from '../../services/space.service';
import { BookingService } from '../../services/booking.service';
import { AuthService } from '../../services/auth.service';
import { AdminService } from '../../services/admin.service';


interface Workspace {
  price?: number;
  seatPrice?: number;
  billingPeriodId?: number;
  billingPeriodLabel?: string;
  id: number; idGuid: string; name: string; locationName: string;
  companyName: string;
  spaceTypeId: number;
  spaceTypeName: string; capacity: number; amenities: string;
  securityDeposit: number; status: string;
  imageUrl: string; floor: string; code: string;
}

interface SpaceTypeGroup {
  spaceTypeId: number;
  spaceTypeName: string;
  capacity: number;
  price: number;
  Price?: number;
  seatPrice?: number;
  SeatPrice?: number;
  billingPeriodId: number;
  billingPeriodLabel?: string;
  billingPeriodCode?: string;
  amenities: string;
  imageUrl: string;
  spaces: Workspace[];
  availableCount: number;
  expanded: boolean;
  capacities: number[];
  selectedCapacity: number | null;
}

interface LocationGroup {
  locationName: string;
  companyName: string;
  spaceTypes: SpaceTypeGroup[];
}

interface SpaceConfig {
  spaceCategory: string; totalSpaces: number; codePrefix: string;
  defaultCapacities: string; openingTime: string; closingTime: string;
  securityDeposit?: number;
}

const CATEGORY_CODE_MAP: Record<string, string> = {
  'Shared':  'SharedSpace',
  'Private': 'PrivateOffice',
  'Meeting': 'MeetingRoom',
};

const CATEGORY_MAP: Record<string, string> = {
  'shared space': 'Shared', 'co-working space': 'Shared', 'coworking': 'Shared', 'shared': 'Shared',
  'private office': 'Private', 'private room': 'Private', 'private': 'Private',
  'meeting room': 'Meeting', 'conference room': 'Meeting', 'meeting/conference room': 'Meeting',
  'meeting / conference room': 'Meeting', 'meeting/conference': 'Meeting', 'meeting': 'Meeting', 'conference': 'Meeting'
};

function getCategory(spaceTypeName: string): string {
  if (!spaceTypeName) return 'Shared';
  const name = spaceTypeName.toLowerCase().trim();
  if (CATEGORY_MAP[name]) return CATEGORY_MAP[name];
  if (name.includes('meeting') || name.includes('conference')) return 'Meeting';
  if (name.includes('private') || name.includes('office')) return 'Private';
  if (name.includes('shared') || name.includes('working') || name.includes('desk')) return 'Shared';
  return 'Shared';
}

// Convert PascalCase/camelCase → spaced words: "PrivateOffice" → "Private Office"
function toDisplayName(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
}

@Component({
  selector: 'app-booking',
  imports: [ReactiveFormsModule, RouterLink, DecimalPipe],
  templateUrl: './booking.html',
  styleUrl: './booking.css'
})
export class Booking implements OnInit {
  searchQuery          = signal('');
  workspaceType        = signal('');
  locationFilter       = signal('');
  categoryFilter       = signal<'Meeting' | 'Shared' | 'Private' | ''>('');
  privateCapacityFilter = signal<number | null>(null);
  loading              = signal(true);
  bookingSuccess       = signal('');
  bookingError         = signal('');

  workspaces  = signal<Workspace[]>([]);
  spaceConfig = signal<SpaceConfig[]>([]);
  spaceTypeMap = new Map<number, string>(); // spaceTypeId → name from DB

  availableWorkspaceTypes = computed(() => {
    const types = new Set<string>();
    for (const ws of this.workspaces()) {
      const t = (ws.spaceTypeName ?? '').trim();
      if (t) types.add(t);
    }
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  });

  availableLocations = computed(() => {
    const locs = new Set<string>();
    for (const ws of this.workspaces()) {
      const l = (ws.locationName ?? '').trim();
      if (l) locs.add(l);
    }
    return Array.from(locs).sort((a, b) => a.localeCompare(b));
  });

  filteredWorkspaces = computed(() => {
    const query    = this.workspaceType().toLowerCase();
    const search   = this.searchQuery().toLowerCase().trim();
    const location = this.locationFilter().toLowerCase();
    const cat      = this.categoryFilter();
    const capFilter = this.privateCapacityFilter();
    return this.workspaces().filter(ws => {
      const matchSearch = !search ||
        (ws.name || '').toLowerCase().includes(search) ||
        (ws.locationName || '').toLowerCase().includes(search) ||
        (ws.spaceTypeName || '').toLowerCase().includes(search) ||
        (ws.companyName || '').toLowerCase().includes(search) ||
        (ws.code || '').toLowerCase().includes(search) ||
        (ws.floor || '').toLowerCase().includes(search);
      const matchType     = !query    || (ws.spaceTypeName || '').toLowerCase().includes(query);
      const matchLocation = !location || (ws.locationName || '').toLowerCase() === location;
      const matchCat      = !cat      || getCategory(ws.spaceTypeName) === cat;
      const matchCap      = !capFilter || cat !== 'Private' || ws.capacity === capFilter;
      return matchSearch && matchType && matchLocation && matchCat && matchCap;
    });
  });

  privateCapacityOptions = computed(() => {
    const caps = new Set<number>();
    for (const ws of this.workspaces()) {
      if (getCategory(ws.spaceTypeName) === 'Private' && ws.capacity > 0) caps.add(ws.capacity);
    }
    return Array.from(caps).sort((a, b) => a - b);
  });

  setCategoryFilter(cat: 'Meeting' | 'Shared' | 'Private' | '') {
    this.categoryFilter.set(cat);
    this.privateCapacityFilter.set(null);
  }

  // Expanded state: 'LocationName|SpaceTypeName' -> boolean
  expandedGroups = new Set<string>();

  toggleGroup(locationName: string, spaceTypeId: number) {
    const key = `${locationName}|${spaceTypeId}`;
    this.expandedGroups.has(key) ? this.expandedGroups.delete(key) : this.expandedGroups.add(key);
  }

  isExpanded(locationName: string, spaceTypeId: number): boolean {
    return this.expandedGroups.has(`${locationName}|${spaceTypeId}`);
  }

  locationGroups = computed<LocationGroup[]>(() => {
    const locMap = new Map<string, Map<number, Workspace[]>>();
    for (const ws of this.filteredWorkspaces()) {
      if (!locMap.has(ws.locationName)) locMap.set(ws.locationName, new Map());
      const typeMap = locMap.get(ws.locationName)!;
      if (!typeMap.has(ws.spaceTypeId)) typeMap.set(ws.spaceTypeId, []);
      typeMap.get(ws.spaceTypeId)!.push(ws);
    }
    return Array.from(locMap.entries()).map(([locationName, typeMap]) => ({
      locationName,
      companyName: Array.from(typeMap.values())[0][0].companyName,
      spaceTypes: Array.from(typeMap.entries()).map(([spaceTypeId, spaces]) => {
        const caps = [...new Set(spaces.map(s => s.capacity).filter(c => c > 0))].sort((a, b) => a - b);
        return {
          spaceTypeId,
          spaceTypeName:    spaces[0].spaceTypeName,
          capacity:         spaces[0].capacity,
          price:            (spaces[0] as any).price || (spaces[0] as any).seatPrice || 0,
          billingPeriodId:  spaces[0].billingPeriodId || 4,
          amenities:        spaces[0].amenities,
          imageUrl:         spaces[0].imageUrl,
          spaces,
          availableCount:   spaces.filter(s => s.status === 'Available').length,
          expanded:         false,
          capacities:       caps,
          selectedCapacity: caps.length ? caps[0] : null,
        };
      })
    }));
  });

  capacityGroups = computed<any[]>(() => []);

  // T&C modal state
  showTncModal      = false;
  tncAcceptEnabled  = false;
  private pendingBookingSubmit = false;

  // Modal state
  showBookingModal  = false;
  showAuthPrompt    = false;
  selectedSpace: Workspace | null = null;
  bookingCategory   = '';          // 'Shared' | 'Private' | 'Meeting'
  bookingForm!: FormGroup;
  availabilityLoading = signal(false);
  availableCount      = signal(0);
  isSpaceFull = computed(() => this.availableCount() === 0 && !this.availabilityLoading());
  availableCapacities: number[] = [];

  // Meeting room slots
  meetingSlots: { label: string; start: string; end: string; isLocked?: boolean }[] = [];
  selectedSlots = signal<Set<string>>(new Set());

  readonly today = new Date().toISOString().split('T')[0];
  private pendingTypeFilter = '';

  constructor(
    private fb: FormBuilder,
    private spaceService: SpaceService,
    private bookingService: BookingService,
    private authService: AuthService,
    private adminService: AdminService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    this.pendingTypeFilter = this.route.snapshot.queryParamMap.get('type') ?? '';
    this.adminService.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        (res?.data ?? []).forEach((st: any) => {
          const displayName = st.name || st.displayName || st.label || st.typeName || st.description || '';
          this.spaceTypeMap.set(st.id, displayName);
        });
        this.loadSpaces();
      },
      error: () => this.loadSpaces()
    });
    this.loadSpaceConfig();
    this.loadExistingBookings();
  }

  private loadSpaceConfig() {
    this.bookingService.getSpaceConfig().subscribe({
      next: (res) => this.spaceConfig.set(res?.data ?? []),
      error: () => {}
    });
  }

  loadSpaces() {
    this.loading.set(true);
    this.spaceService.getAll().subscribe({
      next: (res) => {
        this.workspaces.set(this.normalizeWorkspaces(res));
        this.loading.set(false);
        if (this.pendingTypeFilter) {
          const q = this.pendingTypeFilter.toLowerCase();
          const match = this.availableWorkspaceTypes().find(t => t.toLowerCase().includes(q) || q.includes(t.toLowerCase()));
          this.workspaceType.set(match ?? this.pendingTypeFilter);
        }
      },
      error: () => this.loading.set(false)
    });
  }

  filterWorkspaces() { /* computed signal reactive — no-op */ }

  getCategory = getCategory;

  getAmenities(amenities: string): string[] {
    return amenities ? amenities.split(',').map(a => a.trim()).filter(Boolean) : [];
  }

  getConfigFor(category: string): SpaceConfig | undefined {
    return this.spaceConfig().find(c => c.spaceCategory === category);
  }

  // ── Form helpers ──────────────────────────────────────────────────────────

  get isShared()  { return this.bookingCategory === 'Shared';  }
  get isPrivate() { return this.bookingCategory === 'Private'; }
  get isMeeting() { return this.bookingCategory === 'Meeting'; }

  get openingTime(): string { return this.getConfigFor(this.bookingCategory)?.openingTime ?? '08:00'; }
  get closingTime(): string { return this.getConfigFor(this.bookingCategory)?.closingTime ?? '20:00'; }

  // Positive integer validator
  private positiveInt = (ctrl: AbstractControl) => {
    const v = ctrl.value;
    if (v == null || v === '') return null;
    return Number.isInteger(+v) && +v >= 1 ? null : { positiveInt: true };
  };

  private buildForm() {
    if (this.isShared) {
      this.bookingForm = this.fb.group({
        startDate: ['', Validators.required],
        months:    [1, [Validators.required, Validators.min(1), this.positiveInt]],
        notes:     [''],
      });
    } else if (this.isMeeting) {
      this.bookingForm = this.fb.group({
        startDate: ['', Validators.required],
        capacity:  [null, Validators.required],
        notes:     [''],
      });
    } else {
      // Private — monthly
      this.bookingForm = this.fb.group({
        startDate: ['', Validators.required],
        months:    [1, [Validators.required, Validators.min(1), this.positiveInt]],
        capacity:  [null, Validators.required],
        notes:     [''],
      });
    }

    const recalc$ = () => this.checkAvailability();
    this.bookingForm.get('startDate')?.valueChanges.subscribe(v => {
      if (this.isMeeting) { this.generateMeetingSlots(v); this.selectedSlots.set(new Set()); }
      recalc$();
    });
    this.bookingForm.get('startTime')?.valueChanges.subscribe(recalc$);
    this.bookingForm.get('hours')?.valueChanges.subscribe(recalc$);
    this.bookingForm.get('months')?.valueChanges.subscribe(recalc$);
    this.bookingForm.get('capacity')?.valueChanges.subscribe(v => {
      if (this.isMeeting) {
        const d = this.bookingForm.get('startDate')?.value;
        if (d) this.checkLockedSlots(d);
      }
      recalc$();
    });
  }

  existingBookings: any[] = [];

  loadExistingBookings() {
    this.adminService.getBookings(1, 1000, '').subscribe({
      next: (res: any) => {
        const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        this.existingBookings = list;
        if (this.bookingForm?.get('startDate')?.value) {
          this.checkLockedSlots(this.bookingForm.get('startDate')?.value);
        }
      },
      error: () => {
        this.bookingService.getMyBookings().subscribe({
          next: (res: any) => {
            const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
            this.existingBookings = list;
            if (this.bookingForm?.get('startDate')?.value) {
              this.checkLockedSlots(this.bookingForm.get('startDate')?.value);
            }
          },
          error: () => {}
        });
      }
    });
  }

  generateMeetingSlots(date: string) {
    if (!date) { this.meetingSlots = []; return; }
    const [openH] = (this.openingTime || '08:00').split(':').map(Number);
    const [closeH] = (this.closingTime || '20:00').split(':').map(Number);
    this.meetingSlots = [];
    for (let h = openH; h < closeH; h++) {
      const start = `${String(h).padStart(2,'0')}:00`;
      const end   = `${String(h + 1).padStart(2,'0')}:00`;
      this.meetingSlots.push({ label: `${start} – ${end}`, start, end, isLocked: false });
    }
    this.checkLockedSlots(date);
  }

  private checkLockedSlots(date: string) {
    if (!date || !this.meetingSlots.length) return;

    const targetSpaceId   = this.selectedSpace?.id ? String(this.selectedSpace.id) : '';
    const targetSpaceGuid = this.selectedSpace?.idGuid ? String(this.selectedSpace.idGuid) : '';
    const targetSpaceTypeId = this.selectedSpace?.spaceTypeId ? Number(this.selectedSpace.spaceTypeId) : 0;

    this.meetingSlots.forEach(slot => {
      const slotStartStr = `${date}T${slot.start}:00`;
      const slotEndStr   = `${date}T${slot.end}:00`;
      const slotStart = new Date(slotStartStr).getTime();
      const slotEnd   = new Date(slotEndStr).getTime();

      // Check overlap against existing active bookings
      const isBookedInDB = this.existingBookings.some((b: any) => {
        const status = String(b.bookingStatus || b.bookingStatusCode || b.status || '').toLowerCase();
        if (status === 'cancelled' || status === 'rejected' || status === 'expired') return false;

        const bStartStr = b.startDateTime || b.startOn || b.startDate;
        const bEndStr   = b.endDateTime   || b.endOn   || b.endDate;
        if (!bStartStr || !bEndStr) return false;

        const bStart = new Date(bStartStr).getTime();
        const bEnd   = new Date(bEndStr).getTime();
        if (isNaN(bStart) || isNaN(bEnd)) return false;

        const overlaps = (bStart < slotEnd) && (bEnd > slotStart);
        if (!overlaps) return false;

        const bSpaceId   = String(b.spaceId ?? b.spaceIdGuid ?? '');
        const bSpaceGuid = String(b.spaceIdGuid ?? b.spacePublicId ?? b.publicId ?? '');
        const bSpaceCode = String(b.spaceCode ?? b.code ?? '').toLowerCase();
        const targetCode = String(this.selectedSpace?.code ?? '').toLowerCase();

        // If a specific room/space is selected, match strictly by space ID, GUID, or Code
        if (targetSpaceId || targetSpaceGuid || targetCode) {
          if (targetSpaceId && bSpaceId === targetSpaceId) return true;
          if (targetSpaceGuid && (bSpaceId === targetSpaceGuid || bSpaceGuid === targetSpaceGuid)) return true;
          if (targetCode && bSpaceCode && bSpaceCode === targetCode) return true;
          return false;
        }

        // Fallback: only lock if duration is hourly (<= 16 hours) and space type matches meeting rooms
        const durationHours = (bEnd - bStart) / (1000 * 60 * 60);
        if (durationHours > 16) return false;

        const bCat = String(b.spaceCategory || b.spaceTypeName || '').toLowerCase();
        const isMeetingCat = bCat.includes('meeting') || bCat.includes('conference');
        const bSpaceTypeId = Number(b.spaceTypeId ?? 0);
        if (targetSpaceTypeId > 0 && bSpaceTypeId === targetSpaceTypeId && (isMeetingCat || bCat === '')) {
          return true;
        }

        return false;
      });

      slot.isLocked = isBookedInDB;

      if (slot.isLocked && this.selectedSlots().has(slot.start)) {
        const set = new Set(this.selectedSlots());
        set.delete(slot.start);
        this.selectedSlots.set(set);
        this.checkAvailability();
      }
    });
  }

  private parseAvailableCount(res: any): number {
    if (res == null) return 0;
    if (typeof res === 'number') return res;
    if (typeof res === 'boolean') return res ? 1 : 0;
    if (Array.isArray(res)) return res.length;

    const d = res?.data ?? res;
    if (typeof d === 'number') return d;
    if (typeof d === 'boolean') return d ? 1 : 0;
    if (Array.isArray(d)) return d.length;
    if (Array.isArray(d?.items)) return d.items.length;
    if (Array.isArray(d?.spaces)) return d.spaces.length;
    if (Array.isArray(d?.availableSpaces)) return d.availableSpaces.length;
    if (typeof d?.availableSpaces === 'number') return d.availableSpaces;
    if (typeof d?.availableCount === 'number') return d.availableCount;
    if (typeof d?.count === 'number') return d.count;
    if (typeof d?.isAvailable === 'boolean') return d.isAvailable ? 1 : 0;
    if (typeof d?.available === 'boolean') return d.available ? 1 : 0;

    return 0;
  }

  toggleSlot(slot: { start: string; end: string; isLocked?: boolean }) {
    if (slot.isLocked) return;
    const set = new Set(this.selectedSlots());
    set.has(slot.start) ? set.delete(slot.start) : set.add(slot.start);
    this.selectedSlots.set(set);
    this.checkAvailability();
  }

  isSlotSelected(slot: { start: string }): boolean {
    return this.selectedSlots().has(slot.start);
  }

  get endDateTimeDisplay(): string {
    const [start, end] = this.calcDateRange();
    return end ? end.toLocaleString() : '—';
  }

  private calcDateRange(): [Date | null, Date | null] {
    const f = this.bookingForm?.value;
    if (!f?.startDate) return [null, null];

    if (this.isMeeting) {
      const slots = this.selectedSlots();
      if (!slots.size) return [null, null];
      const sorted = Array.from(slots).sort();
      const start = new Date(`${f.startDate}T${sorted[0]}:00`);
      const lastHour = +sorted[sorted.length - 1].split(':')[0] + 1;
      const end = new Date(`${f.startDate}T${String(lastHour).padStart(2,'0')}:00:00`);
      return [start, end];
    } else if (this.isShared) {
      const start = new Date(`${f.startDate}T00:00:00`);
      if (isNaN(start.getTime()) || !f.months || +f.months < 1) return [null, null];
      const end = new Date(start);
      end.setMonth(end.getMonth() + +f.months);
      return [start, end];
    } else {
      // Private monthly
      const start = new Date(`${f.startDate}T00:00:00`);
      if (isNaN(start.getTime()) || !f.months || +f.months < 1) return [null, null];
      const end = new Date(start);
      end.setMonth(end.getMonth() + +f.months);
      return [start, end];
    }
  }

  private checkAvailability() {
    const [start, end] = this.calcDateRange();
    if (!start || !end) { this.availableCount.set(0); return; }

    const cap = this.bookingForm?.value?.capacity ? +this.bookingForm.value.capacity : undefined;
    this.availabilityLoading.set(true);

    this.bookingService.getSmartAvailableSpaces(
      CATEGORY_CODE_MAP[this.bookingCategory] ?? this.bookingCategory,
      start.toISOString().slice(0, 19),
      end.toISOString().slice(0, 19),
      cap
    ).subscribe({
      next: (res: any) => {
        const count = this.parseAvailableCount(res);
        this.availableCount.set(count);
        this.availabilityLoading.set(false);
      },
      error: () => {
        this.availableCount.set(1);
        this.availabilityLoading.set(false);
      }
    });
  }

  // ── Modal open/close ──────────────────────────────────────────────────────

  openBookingModal(ws: Workspace, preselectedCapacity?: number | null) {
    if (!this.authService.isAuthenticated()) { this.showAuthPrompt = true; return; }
    this.selectedSpace     = ws;
    this.bookingCategory   = getCategory(ws.spaceTypeName);
    this.bookingSuccess.set('');
    this.bookingError.set('');
    this.availableCount.set(0);
    this.selectedSlots.set(new Set());
    this.meetingSlots = [];
    this.availableCapacities = this.parseCapacities(this.getConfigFor(this.bookingCategory)?.defaultCapacities);
    this.buildForm();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    this.bookingForm.patchValue({ startDate: tomorrowStr });
    if (preselectedCapacity) this.bookingForm.patchValue({ capacity: preselectedCapacity });
    this.loadExistingBookings();
    if (this.isMeeting) this.generateMeetingSlots(tomorrowStr);
    this.showBookingModal = true;
    this.checkAvailability();
  }

  closeBookingModal() {
    this.showBookingModal = false;
    this.showAuthPrompt  = false;
    this.selectedSpace   = null;
    this.closeTncModal();
  }

  openTncModal() {
    this.bookingForm.markAllAsTouched();
    if (this.bookingForm.invalid) {
      const msg = 'Please fill in all required fields correctly.';
      alert(msg);
      this.bookingError.set(msg);
      return;
    }
    if (this.isMeeting && this.selectedSlots().size === 0) {
      const msg = 'Please select at least one time slot.';
      alert(msg);
      this.bookingError.set(msg);
      return;
    }
    if (this.isSpaceFull() || this.availableCount() === 0) {
      const msg = 'No available spaces found for the selected time slot. Please choose another date or time.';
      alert(msg);
      this.bookingError.set(msg);
      return;
    }
    const [start, end] = this.calcDateRange();
    if (!start || !end) {
      const msg = 'Invalid date/time selection.';
      alert(msg);
      this.bookingError.set(msg);
      return;
    }
    if (!this.isPrivate) {
      const [openH, openM] = this.openingTime.split(':').map(Number);
      const [closeH, closeM] = this.closingTime.split(':').map(Number);
      const startMins = start.getHours() * 60 + start.getMinutes();
      const endMins   = end.getHours()   * 60 + end.getMinutes();
      if (startMins < openH * 60 + openM || endMins > closeH * 60 + closeM) {
        const msg = `Booking must be between ${this.openingTime} and ${this.closingTime}.`;
        alert(msg);
        this.bookingError.set(msg);
        return;
      }
    }
    this.showTncModal = true;
    this.tncAcceptEnabled = true;
  }

  closeTncModal() {
    this.showTncModal = false;
    this.tncAcceptEnabled = false;
  }

  acceptTncAndBook() {
    if (!this.tncAcceptEnabled) return;
    this.closeTncModal();
    this.submitBooking();
  }

  private parseCapacities(csv?: string): number[] {
    if (!csv) return [];
    return csv.split(',').map(s => +s.trim()).filter(n => !isNaN(n) && n > 0);
  }

  // ── Security deposit ─────────────────────────────────────────────────────

  // ── Price breakdown ───────────────────────────────────────────────────────

  getPriceBreakdown() {
    if (!this.selectedSpace) return null;
    const [start, end] = this.calcDateRange();
    if (!start || !end) return null;
    const seatPrice = +((this.selectedSpace as any).price || (this.selectedSpace as any).seatPrice || 0);
    let base: number;
    if (this.isPrivate) {
      const capacity  = +(this.bookingForm?.value?.capacity ?? 1);
      const months = +(this.bookingForm?.value?.months ?? 1);
      base = seatPrice * capacity * months;
    } else if (this.isShared) {
      const months = +(this.bookingForm?.value?.months ?? 1);
      base = seatPrice * months;
    } else {
      const hours = (end.getTime() - start.getTime()) / 3_600_000;
      base = Math.ceil(hours) * seatPrice;
    }
    const deposit = this.isPrivate
      ? (this.selectedSpace.securityDeposit > 0
          ? this.selectedSpace.securityDeposit
          : +(this.spaceConfig().find(c => c.spaceCategory === 'Private')?.securityDeposit ?? 0))
      : 0;
    return { base, percent: 0, discountAmount: 0, final: base, securityDeposit: deposit, total: base + deposit };
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  submitBooking() {
    this.bookingForm.markAllAsTouched();
    if (this.bookingForm.invalid) {
      const msg = 'Please fill in all required fields correctly.';
      alert(msg);
      this.bookingError.set(msg);
      return;
    }
    if (this.isMeeting && this.selectedSlots().size === 0) {
      const msg = 'Please select at least one time slot.';
      alert(msg);
      this.bookingError.set(msg);
      return;
    }
    if (this.isSpaceFull() || this.availableCount() === 0) {
      const msg = 'No available spaces found for the selected time slot. Please choose another date or time.';
      alert(msg);
      this.bookingError.set(msg);
      return;
    }

    const [start, end] = this.calcDateRange();
    if (!start || !end) {
      const msg = 'Invalid date/time selection.';
      alert(msg);
      this.bookingError.set(msg);
      return;
    }

    // Validate opening/closing hours for hourly bookings
    if (!this.isPrivate) {
      const [openH, openM] = this.openingTime.split(':').map(Number);
      const [closeH, closeM] = this.closingTime.split(':').map(Number);
      const startMins = start.getHours() * 60 + start.getMinutes();
      const endMins   = end.getHours()   * 60 + end.getMinutes();
      const openMins  = openH  * 60 + openM;
      const closeMins = closeH * 60 + closeM;
      if (startMins < openMins || endMins > closeMins) {
        this.bookingError.set(`Booking must be between ${this.openingTime} and ${this.closingTime}.`);
        return;
      }
    }

    const breakdown     = this.getPriceBreakdown();
    const cap           = this.bookingForm.value.capacity ? +this.bookingForm.value.capacity : undefined;
    const spaceTypeName = this.selectedSpace!.spaceTypeName;

    // Close modal first but keep selectedSpace reference via local var
    this.showBookingModal = false;
    this.showAuthPrompt  = false;

    this.router.navigate(['/checkout'], {
      state: {
        pendingBooking: {
          spaceCategory:   this.bookingCategory,
          categoryCode:    CATEGORY_CODE_MAP[this.bookingCategory] ?? this.bookingCategory,
          spaceName:       `${spaceTypeName} (Auto-assigned)`,
          startDateTime:   start.toISOString().slice(0, 19),
          startOn:         start.toISOString().slice(0, 19),
          endDateTime:     end.toISOString().slice(0, 19),
          endOn:           end.toISOString().slice(0, 19),
          totalAmount:     breakdown?.total ?? 0,
          rentAmount:      breakdown?.final ?? 0,
          baseAmount:      breakdown?.base ?? 0,
          securityDeposit: breakdown?.securityDeposit ?? 0,
          months:          (this.isPrivate || this.isShared) ? (+this.bookingForm.value.months || 1) : undefined,
          price:           this.selectedSpace?.price ?? 0,
          notes:           this.bookingForm.value.notes || null,
          capacity:        cap,
          smartBooking:    true,
        }
      }
    }).then(() => { this.selectedSpace = null; });
  }

  // ── Normalise spaces ──────────────────────────────────────────────────────

  private normalizeWorkspaces(res: any): Workspace[] {
    const source = Array.isArray(res) ? res
      : Array.isArray(res?.data) ? res.data
      : Array.isArray(res?.data?.items) ? res.data.items
      : Array.isArray(res?.items) ? res.items : [];
    return source.map((ws: any, i: number) => ({
      id:            Number(ws.id ?? ws.Id ?? 0) || (i + 1),
      idGuid:        ws.publicId || ws.PublicId || '',
      name:          ws.name || ws.Name || `Workspace ${i + 1}`,
      locationName:  ws.locationName || ws.LocationName || 'Unknown',
      companyName:   ws.companyName  || ws.CompanyName  || '',
      spaceTypeId:   Number(ws.spaceTypeId ?? ws.SpaceTypeId ?? 0),
      spaceTypeName: this.spaceTypeMap.get(Number(ws.spaceTypeId ?? ws.SpaceTypeId ?? 0)) || toDisplayName(ws.spaceTypeName || ws.SpaceTypeName || 'Workspace'),
      capacity:      Number(ws.capacity ?? ws.Capacity ?? 0),
      amenities:     typeof ws.amenities === 'string' ? ws.amenities : (Array.isArray(ws.amenities) ? ws.amenities.join(', ') : ''),
      pricePerDay:      Number(ws.seatPrice ?? ws.SeatPrice ?? 0),
      pricePerHour:     Number(ws.seatPrice ?? ws.SeatPrice ?? 0),
      securityDeposit:  Number(ws.securityDeposit ?? ws.SecurityDeposit ?? ws.depositAmount ?? ws.DepositAmount ?? 0),
      status:        'Available',
      imageUrl:      ws.imageUrl || ws.ImageUrl || 'images/spaces/modern-office.jpg',
      floor:         ws.floorName || ws.FloorName || ws.floor || '-',
      code:          ws.code || ws.Code || '',
    }));
  }
}
