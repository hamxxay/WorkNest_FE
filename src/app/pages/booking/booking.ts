import { Component, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpaceService } from '../../services/space.service';
import { BookingService } from '../../services/booking.service';
import { AuthService } from '../../services/auth.service';
import { applyPercentDiscount, getWorkspaceDiscount, type BookingLike } from '../../utils/workspace-discount';

interface Workspace {
  id: number;
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
  imports: [FormsModule, RouterLink],
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

  // Booking modal
  showBookingModal = false;
  showAuthPrompt = false;
  selectedSpace: Workspace | null = null;
  bookingNotes = '';
  bookingStartDate = '';
  bookingStartTime = '09:00';
  bookingEndDate = '';
  bookingEndTime = '17:00';

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
      id: Number(ws.id ?? ws.Id ?? index + 1),
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
    this.showBookingModal = true;
    this.bookingError.set('');
    this.bookingSuccess.set('');
    const today = new Date().toISOString().split('T')[0];
    this.bookingStartDate = today;
    this.bookingEndDate = today;
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

    const startDateTime = `${this.bookingStartDate}T${this.bookingStartTime}:00`;
    const endDateTime = `${this.bookingEndDate}T${this.bookingEndTime}:00`;

    if (new Date(endDateTime) <= new Date(startDateTime)) {
      this.bookingError.set('End date/time must be after start date/time.');
      return;
    }

    const breakdown = this.getPriceBreakdown();
    const space = this.selectedSpace;
    this.closeBookingModal();

    this.router.navigate(['/checkout'], {
      state: {
        pendingBooking: {
          spaceId:       space.id,
          spaceName:     space.name,
          startDateTime,
          endDateTime,
          totalAmount:   breakdown != null ? breakdown.final : 0,
          notes:         this.bookingNotes || null
        }
      }
    });
  }
}

