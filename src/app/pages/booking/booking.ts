import { Component, OnInit, signal, computed } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpaceService } from '../../services/space.service';
import { BookingService } from '../../services/booking.service';
import { AuthService } from '../../services/auth.service';
import { applyPercentDiscount, getWorkspaceDiscount, type BookingLike } from '../../utils/workspace-discount';

interface Workspace {
  id: number; idGuid: string; name: string; locationName: string;
  spaceTypeName: string; capacity: number; amenities: string;
  pricePerDay: number; pricePerHour: number; status: string;
  imageUrl: string; floor: string; code: string;
}

interface SpaceTypeGroup {
  spaceTypeName: string;
  pricePerHour: number;
  pricePerDay: number;
  amenities: string;
  imageUrl: string;
  spaces: Workspace[];
  availableCount: number;
  expanded: boolean;
}

interface LocationGroup {
  locationName: string;
  spaceTypes: SpaceTypeGroup[];
}

interface SpaceConfig {
  spaceCategory: string; totalSpaces: number; codePrefix: string;
  defaultCapacities: string; openingTime: string; closingTime: string;
  securityDeposit?: number;
}

// Maps DB space type name → booking category
const CATEGORY_MAP: Record<string, string> = {
  'shared space': 'Shared', 'co-working space': 'Shared', 'coworking': 'Shared',
  'private office': 'Private', 'private room': 'Private',
  'meeting room': 'Meeting', 'conference room': 'Meeting',
};

function getCategory(spaceTypeName: string): string {
  return CATEGORY_MAP[spaceTypeName.toLowerCase()] ?? 'Shared';
}

@Component({
  selector: 'app-booking',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './booking.html',
  styleUrl: './booking.css'
})
export class Booking implements OnInit {
  searchQuery  = signal('');
  workspaceType = signal('');
  loading      = signal(true);
  bookingSuccess = signal('');
  bookingError   = signal('');

  workspaces  = signal<Workspace[]>([]);
  myBookings  = signal<BookingLike[]>([]);
  spaceConfig = signal<SpaceConfig[]>([]);
  discount    = computed(() => getWorkspaceDiscount(this.myBookings()));

  availableWorkspaceTypes = computed(() => {
    const types = new Set<string>();
    for (const ws of this.workspaces()) {
      const t = (ws.spaceTypeName ?? '').trim();
      if (t) types.add(t);
    }
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  });

  filteredWorkspaces = computed(() => {
    const query = this.workspaceType().toLowerCase();
    const search = this.searchQuery().toLowerCase();
    return this.workspaces().filter(ws => {
      const matchSearch = !search || ws.name.toLowerCase().includes(search) || ws.locationName.toLowerCase().includes(search);
      const matchType   = !query  || ws.spaceTypeName.toLowerCase().includes(query);
      return matchSearch && matchType;
    });
  });

  // Expanded state: 'LocationName|SpaceTypeName' -> boolean
  expandedGroups = new Set<string>();

  toggleGroup(locationName: string, spaceTypeName: string) {
    const key = `${locationName}|${spaceTypeName}`;
    this.expandedGroups.has(key) ? this.expandedGroups.delete(key) : this.expandedGroups.add(key);
  }

  isExpanded(locationName: string, spaceTypeName: string): boolean {
    return this.expandedGroups.has(`${locationName}|${spaceTypeName}`);
  }

  locationGroups = computed<LocationGroup[]>(() => {
    const map = new Map<string, Map<string, Workspace[]>>();
    for (const ws of this.filteredWorkspaces()) {
      if (!map.has(ws.locationName)) map.set(ws.locationName, new Map());
      const typeMap = map.get(ws.locationName)!;
      if (!typeMap.has(ws.spaceTypeName)) typeMap.set(ws.spaceTypeName, []);
      typeMap.get(ws.spaceTypeName)!.push(ws);
    }
    return Array.from(map.entries()).map(([locationName, typeMap]) => ({
      locationName,
      spaceTypes: Array.from(typeMap.entries()).map(([spaceTypeName, spaces]) => ({
        spaceTypeName,
        pricePerHour:   spaces[0].pricePerHour,
        pricePerDay:    spaces[0].pricePerDay,
        amenities:      spaces[0].amenities,
        imageUrl:       spaces[0].imageUrl,
        spaces,
        availableCount: spaces.filter(s => s.status === 'Available').length,
        expanded:       false,
      }))
    }));
  });

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

  readonly today = new Date().toISOString().split('T')[0];
  private pendingTypeFilter = '';

  constructor(
    private fb: FormBuilder,
    private spaceService: SpaceService,
    private bookingService: BookingService,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    this.pendingTypeFilter = this.route.snapshot.queryParamMap.get('type') ?? '';
    this.loadSpaces();
    this.loadMyBookingsForDiscount();
    this.loadSpaceConfig();
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

  private loadMyBookingsForDiscount() {
    if (!this.authService.getToken()) return;
    this.bookingService.getMyBookings().subscribe({
      next: (res: any) => {
        const data = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
        this.myBookings.set(data);
      },
      error: () => this.myBookings.set([])
    });
  }

  filterWorkspaces() { /* computed signal reactive — no-op */ }

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
    if (this.isShared || this.isMeeting) {
      this.bookingForm = this.fb.group({
        startDate:  ['', Validators.required],
        startTime:  ['09:00', Validators.required],
        hours:      [1, [Validators.required, Validators.min(1), this.positiveInt]],
        ...(this.isMeeting ? { capacity: [null, Validators.required] } : {}),
        notes:      [''],
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

    // Auto-recalculate end time when relevant fields change
    const recalc$ = () => this.checkAvailability();
    this.bookingForm.get('startDate')?.valueChanges.subscribe(recalc$);
    this.bookingForm.get('startTime')?.valueChanges.subscribe(recalc$);
    this.bookingForm.get('hours')?.valueChanges.subscribe(recalc$);
    this.bookingForm.get('months')?.valueChanges.subscribe(recalc$);
    this.bookingForm.get('capacity')?.valueChanges.subscribe(recalc$);
  }

  get endDateTimeDisplay(): string {
    const [start, end] = this.calcDateRange();
    return end ? end.toLocaleString() : '—';
  }

  private calcDateRange(): [Date | null, Date | null] {
    const f = this.bookingForm?.value;
    if (!f?.startDate) return [null, null];

    if (this.isShared || this.isMeeting) {
      const time  = f.startTime || '09:00';
      const start = new Date(`${f.startDate}T${time}:00`);
      if (isNaN(start.getTime()) || !f.hours || +f.hours < 1) return [null, null];
      const end = new Date(start.getTime() + +f.hours * 3600_000);
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
      this.bookingCategory,
      start.toISOString().slice(0, 19),
      end.toISOString().slice(0, 19),
      cap
    ).subscribe({
      next: (res) => {
        const spaces = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        this.availableCount.set(spaces.length);
        this.availabilityLoading.set(false);
      },
      error: () => { this.availableCount.set(1); this.availabilityLoading.set(false); }
    });
  }

  // ── Modal open/close ──────────────────────────────────────────────────────

  openBookingModal(ws: Workspace) {
    if (!this.authService.isAuthenticated()) { this.showAuthPrompt = true; return; }
    this.selectedSpace     = ws;
    this.bookingCategory   = getCategory(ws.spaceTypeName);
    this.bookingSuccess.set('');
    this.bookingError.set('');
    this.availableCount.set(0);
    this.availableCapacities = this.parseCapacities(this.getConfigFor(this.bookingCategory)?.defaultCapacities);
    this.buildForm();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    this.bookingForm.patchValue({ startDate: tomorrow.toISOString().split('T')[0] });
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
      this.bookingError.set('Please fill in all required fields correctly.');
      return;
    }
    const [start, end] = this.calcDateRange();
    if (!start || !end) { this.bookingError.set('Invalid date/time selection.'); return; }
    if (!this.isPrivate) {
      const [openH, openM] = this.openingTime.split(':').map(Number);
      const [closeH, closeM] = this.closingTime.split(':').map(Number);
      const startMins = start.getHours() * 60 + start.getMinutes();
      const endMins   = end.getHours()   * 60 + end.getMinutes();
      if (startMins < openH * 60 + openM || endMins > closeH * 60 + closeM) {
        this.bookingError.set(`Booking must be between ${this.openingTime} and ${this.closingTime}.`);
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
    let base: number;
    if (this.isPrivate) {
      const months = this.bookingForm?.value?.months ?? 1;
      base = months * +this.selectedSpace.pricePerDay * 30;
    } else {
      const hours = (end.getTime() - start.getTime()) / 3_600_000;
      base = Math.ceil(hours) * +this.selectedSpace.pricePerHour;
    }
    const percent  = this.discount().percent;
    const final    = applyPercentDiscount(base, percent);
    // Read directly from spaceConfig signal so latest DB value is always used
    const deposit  = this.isPrivate
      ? +(this.spaceConfig().find(c => c.spaceCategory === 'Private')?.securityDeposit ?? 0)
      : 0;
    return { base, percent, discountAmount: Math.max(0, base - final), final, securityDeposit: deposit, total: final + deposit };
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  submitBooking() {
    this.bookingForm.markAllAsTouched();
    if (this.bookingForm.invalid) {
      this.bookingError.set('Please fill in all required fields correctly.');
      return;
    }

    const [start, end] = this.calcDateRange();
    if (!start || !end) {
      this.bookingError.set('Invalid date/time selection.');
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

    const breakdown    = this.getPriceBreakdown();
    const cap          = this.bookingForm.value.capacity ? +this.bookingForm.value.capacity : undefined;
    const spaceTypeName = this.selectedSpace!.spaceTypeName;

    // Close modal first but keep selectedSpace reference via local var
    this.showBookingModal = false;
    this.showAuthPrompt  = false;

    this.router.navigate(['/checkout'], {
      state: {
        pendingBooking: {
          spaceCategory:   this.bookingCategory,
          spaceName:       `${spaceTypeName} (Auto-assigned)`,
          startDateTime:   start.toISOString().slice(0, 19),
          endDateTime:     end.toISOString().slice(0, 19),
          totalAmount:     breakdown?.total ?? 0,
          rentAmount:      breakdown?.final ?? 0,
          baseAmount:      breakdown?.base ?? 0,
          discountAmount:  breakdown?.discountAmount ?? 0,
          discountPercent: breakdown?.percent ?? 0,
          securityDeposit: breakdown?.securityDeposit ?? 0,
          months:          this.isPrivate ? (+this.bookingForm.value.months || 1) : undefined,
          pricePerHour:    this.selectedSpace?.pricePerHour ?? 0,
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
      id:            Number(ws.numericId ?? ws.Id ?? 0) || (i + 1),
      idGuid:        ws.idGuid || ws.id || '',
      name:          ws.name || ws.Name || `Workspace ${i + 1}`,
      locationName:  ws.locationName || ws.LocationName || 'Unknown',
      spaceTypeName: ws.spaceTypeName || ws.SpaceTypeName || 'Workspace',
      capacity:      Number(ws.capacity ?? ws.Capacity ?? 0),
      amenities:     typeof ws.amenities === 'string' ? ws.amenities : (Array.isArray(ws.amenities) ? ws.amenities.join(', ') : ''),
      pricePerDay:   Number(ws.pricePerDay ?? ws.PricePerDay ?? 0),
      pricePerHour:  (() => { const h = Number(ws.pricePerHour ?? ws.PricePerHour ?? 0); if (h > 0) return h; const d = Number(ws.pricePerDay ?? 0); return d > 0 ? Math.round(d / 8) : 0; })(),
      status:        (() => { const s = ws.spaceStatus || ws.SpaceStatus || ''; if (s) return s.toLowerCase() === 'available' ? 'Available' : 'Unavailable'; return (ws.status === 1 || ws.status === true) ? 'Available' : 'Unavailable'; })(),
      imageUrl:      ws.imageUrl || ws.ImageUrl || 'images/spaces/modern-office.jpg',
      floor:         ws.floor || ws.floorName || '-',
      code:          ws.code || ws.Code || '',
    }));
  }
}
