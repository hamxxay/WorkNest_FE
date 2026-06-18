import { Component, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpaceService } from '../../services/space.service';
import { BookingService } from '../../services/booking.service';
import { AuthService } from '../../services/auth.service';
import { applyPercentDiscount, getWorkspaceDiscount, type BookingLike } from '../../utils/workspace-discount';
import { getSpaceTypeDisplayName, validateSpaceAssignment } from '../../utils/space-assignment';

interface Workspace {
  id: number;
  idGuid: string;
  name: string;
  locationName: string;
  spaceTypeName: string;
  capacity: number;
  amenities: string;
  pricePerDay: number;
  pricePerHour: number;
  status: string;
  imageUrl: string;
  floor: string;
  code: string;
}

@Component({
  selector: 'app-booking',
  imports: [FormsModule, RouterLink, NgTemplateOutlet],
  templateUrl: './booking.html',
  styleUrl: './booking.css'
})
export class Booking implements OnInit {
  searchQuery = signal('');
  workspaceType = signal('');
  loading = signal(true);
  bookingSuccess = signal('');
  bookingError = signal('');

  workspaces = signal<Workspace[]>([]);
  myBookings = signal<BookingLike[]>([]);
  discount = computed(() => getWorkspaceDiscount(this.myBookings()));

  availableWorkspaceTypes = computed(() => {
    const types = new Set<string>();
    for (const ws of this.workspaces()) {
      const t = (ws.spaceTypeName ?? '').trim();
      if (t) types.add(t);
    }
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  });

  filteredWorkspaces = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const type = this.workspaceType().toLowerCase();
    return this.workspaces().filter(ws => {
      const matchesQuery = !query ||
        ws.name.toLowerCase().includes(query) ||
        ws.locationName.toLowerCase().includes(query);
      const matchesType = !type || ws.spaceTypeName.toLowerCase().includes(type);
      return matchesQuery && matchesType;
    });
  });

  i8Workspaces = computed(() =>
    this.filteredWorkspaces().filter(ws => ws.locationName.toLowerCase().includes('i-8') || ws.locationName.toLowerCase().includes('i8'))
  );

  f7Workspaces = computed(() =>
    this.filteredWorkspaces().filter(ws => ws.locationName.toLowerCase().includes('f-7') || ws.locationName.toLowerCase().includes('f7'))
  );

  otherWorkspaces = computed(() =>
    this.filteredWorkspaces().filter(ws => {
      const loc = ws.locationName.toLowerCase();
      return !loc.includes('i-8') && !loc.includes('i8') && !loc.includes('f-7') && !loc.includes('f7');
    })
  );

  // Booking modal
  showBookingModal = false;
  showAuthPrompt = false;
  selectedSpace: Workspace | null = null;
  selectedSpaceType = '';
  bookingNotes = '';
  bookingStartDate = '';
  bookingStartTime = '09:00';
  bookingEndDate = '';
  bookingEndTime = '17:00';
  availabilityLoading = signal(false);
  availabilityError = signal('');
  availableCount = signal(0);
  isSpaceFull = computed(() => this.availableCount() === 0);
  assignedSpace = signal<any>(null);

  constructor(
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
  }

  private pendingTypeFilter = '';

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
      error: () => { this.loading.set(false); }
    });
  }

  private loadMyBookingsForDiscount() {
    if (!this.authService.getToken()) return;
    this.bookingService.getMyBookings().subscribe({
      next: (res: any) => {
        const data = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
        this.myBookings.set(data);
      },
      error: () => { this.myBookings.set([]); }
    });
  }

  filterWorkspaces() { this.filteredWorkspaces(); }

  getAmenities(amenities: string): string[] {
    if (!amenities) return [];
    return amenities.split(',').map(a => a.trim());
  }

  private normalizeWorkspaces(res: any): Workspace[] {
    const source = Array.isArray(res) ? res
      : Array.isArray(res?.data) ? res.data
      : Array.isArray(res?.data?.items) ? res.data.items
      : Array.isArray(res?.data?.results) ? res.data.results
      : Array.isArray(res?.items) ? res.items
      : Array.isArray(res?.results) ? res.results
      : [];

    return source.map((ws: any, index: number) => ({
      id: Number(ws.numericId ?? ws.numeric_id ?? ws.Id ?? 0) || (index + 1),
      idGuid: ws.idGuid || ws.IdGUID || ws.id || '',
      name: ws.name || ws.Name || ws.title || ws.Title || `Workspace ${index + 1}`,
      locationName: ws.locationName || ws.LocationName || ws.location?.name || ws.city || 'Unknown Location',
      spaceTypeName: ws.spaceTypeName || ws.SpaceTypeName || ws.spaceType?.name || ws.type || 'Workspace',
      capacity: Number(ws.capacity ?? ws.Capacity ?? 0),
      amenities: typeof ws.amenities === 'string' ? ws.amenities
        : typeof ws.Amenities === 'string' ? ws.Amenities
        : Array.isArray(ws.amenities) ? ws.amenities.map((item: any) => item?.name || item).filter(Boolean).join(', ')
        : Array.isArray(ws.Amenities) ? ws.Amenities.map((item: any) => item?.name || item).filter(Boolean).join(', ')
        : '',
      pricePerDay: Number(ws.pricePerDay ?? ws.PricePerDay ?? ws.dailyPrice ?? 0),
      pricePerHour: (() => {
        const perHour = Number(ws.pricePerHour ?? ws.PricePerHour ?? ws.hourlyPrice ?? 0);
        if (perHour > 0) return perHour;
        const perDay = Number(ws.pricePerDay ?? ws.PricePerDay ?? ws.dailyPrice ?? 0);
        return perDay > 0 ? Math.round(perDay / 8) : 0;
      })(),
      status: (() => {
        const spaceStatus = ws.spaceStatus || ws.SpaceStatus || '';
        if (spaceStatus) return spaceStatus.toLowerCase() === 'available' ? 'Available' : 'Unavailable';
        const s = ws.status ?? ws.Status;
        if (s === 1 || s === true || String(s).toLowerCase() === 'available') return 'Available';
        if (ws.isAvailable === true) return 'Available';
        return 'Unavailable';
      })(),
      imageUrl: ws.imageUrl || ws.ImageUrl || ws.image || ws.url || 'images/spaces/modern-office.jpg',
      floor: ws.floor || ws.floorName || '-',
      code: ws.code || ws.Code || ''
    }));
  }

  openBookingModal(ws: Workspace) {
    if (!this.authService.isAuthenticated()) {
      this.showAuthPrompt = true;
      return;
    }
    this.selectedSpace = ws;
    this.selectedSpaceType = ws.spaceTypeName;
    this.showBookingModal = true;
    this.bookingError.set('');
    this.bookingSuccess.set('');
    this.availabilityError.set('');
    this.assignedSpace.set(null);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    this.bookingStartDate = tomorrowStr;
    this.bookingEndDate = tomorrowStr;
    this.checkAvailability();
  }

  private checkAvailability() {
    if (!this.selectedSpaceType || !this.bookingStartDate || !this.bookingStartTime || !this.bookingEndDate || !this.bookingEndTime) {
      this.availableCount.set(0);
      return;
    }

    const startDateTime = `${this.bookingStartDate}T${this.bookingStartTime}:00`;
    const endDateTime = `${this.bookingEndDate}T${this.bookingEndTime}:00`;

    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      this.availableCount.set(0);
      return;
    }

    this.availabilityLoading.set(true);
    this.availabilityError.set('');

    this.bookingService.getAvailableSpaces(this.selectedSpaceType, startDateTime, endDateTime).subscribe({
      next: (res) => {
        const data = res?.data || res;
        const spaces = Array.isArray(data) ? data : (Array.isArray(data?.spaces) ? data.spaces : []);
        this.availableCount.set(spaces.length);
        this.availabilityLoading.set(false);
      },
      error: () => {
        // On error still allow booking — let backend validate
        this.availableCount.set(1);
        this.availabilityLoading.set(false);
      }
    });
  }

  onBookingTimeChange() {
    this.checkAvailability();
  }

  closeBookingModal() {
    this.showBookingModal = false;
    this.showAuthPrompt = false;
    this.selectedSpace = null;
    this.bookingNotes = '';
  }

  private isPadelLikeSpace(space?: Pick<Workspace, 'spaceTypeName' | 'name' | 'code'> | null): boolean {
    if (!space) return false;
    const h = `${space.spaceTypeName ?? ''} ${space.name ?? ''} ${space.code ?? ''}`.toLowerCase();
    return h.includes('padel') || h.includes('arena') || h.includes('court');
  }

  private toDateTime(date: string, time: string): Date | null {
    if (!date || !time) return null;
    const d = new Date(`${date}T${time}:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private calcBaseAmount(space: Workspace, start: Date, end: Date): number {
    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) return 0;
    const hours = diffMs / (1000 * 60 * 60);
    const days = Math.ceil(hours / 24);
    if (this.isPadelLikeSpace(space) || Number(space.pricePerDay) <= 0) {
      return Math.ceil(hours) * Number(space.pricePerHour);
    }
    if (hours <= 10) return Math.ceil(hours) * Number(space.pricePerHour);
    return days * Number(space.pricePerDay);
  }

  getPriceBreakdown(): { base: number; percent: number; discountAmount: number; final: number } | null {
    if (!this.selectedSpace) return null;
    const start = this.toDateTime(this.bookingStartDate, this.bookingStartTime);
    const end = this.toDateTime(this.bookingEndDate, this.bookingEndTime);
    if (!start || !end) return null;
    const base = this.calcBaseAmount(this.selectedSpace, start, end);
    const percent = this.discount().percent;
    const final = applyPercentDiscount(base, percent);
    return { base, percent, discountAmount: Math.max(0, base - final), final };
  }

  submitBooking() {
    if (!this.selectedSpace || !this.bookingStartDate || !this.bookingEndDate) {
      this.bookingError.set('Please select start and end dates.');
      return;
    }

    if (this.isSpaceFull()) {
      this.bookingError.set('No space available for the selected time.');
      return;
    }

    const startDateTime = `${this.bookingStartDate}T${this.bookingStartTime}:00`;
    const endDateTime = `${this.bookingEndDate}T${this.bookingEndTime}:00`;

    // Final validation before submitting
    const validation = validateSpaceAssignment(this.selectedSpaceType, startDateTime, endDateTime);
    if (!validation.valid) {
      this.bookingError.set(validation.error || 'Invalid booking parameters');
      return;
    }

    const breakdown = this.getPriceBreakdown();
    const displayName = getSpaceTypeDisplayName(this.selectedSpaceType);
    
    // Create booking with space type for auto-assignment
    const bookingData = {
      spaceType: this.selectedSpaceType,
      startDateTime,
      endDateTime,
      totalAmount: breakdown != null ? breakdown.final : 0,
      notes: this.bookingNotes || null
    };

    this.closeBookingModal();

    this.router.navigate(['/checkout'], {
      state: {
        pendingBooking: {
          ...bookingData,
          spaceName: `${displayName} (Auto-assigned)`,
          autoAssign: true
        }
      }
    });
  }
}

