import { Component, signal, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { ASSIGNABLE_ROLES, BILLING_CYCLES } from '../../../utils/constants';

interface ColDef { key: string; label: string; type?: string; }
interface FieldDef { key: string; label: string; type: string; options?: { v: any; l: string }[]; }

interface EntityConfig {
  title: string;
  columns: ColDef[];
  fields?: FieldDef[];
  getFn: (page: number, limit: number, search: string) => any;
  createFn?: (data: any) => any;
  updateFn?: (id: any, data: any) => any;
  deleteFn?: (id: any) => any;
  statusFn?: (id: any, status: string) => any;
  statusOptions?: string[];
}

@Component({
  selector: 'app-manage',
  imports: [CommonModule, FormsModule],
  templateUrl: './manage.html',
  styleUrl: './manage.css'
})
export class Manage implements OnInit {
  entity = '';
  config!: EntityConfig;

  loading = signal(true);
  items = signal<any[]>([]);
  totalCount = signal(0);

  page = signal(1);
  pageSize = 10;
  pageSizeOptions = [10, 25, 50];
  totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize)));
  canPrev = computed(() => this.page() > 1);
  canNext = computed(() => this.page() < this.totalPages());

  searchQuery = '';
  private searchTimer: any;

  onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, 400);
  }

  get filtered() { return this.items(); }

  showModal = false;
  editItem: any = null;
  formData: any = {};
  saving = false;
  error = '';
  success = '';

  showUserModal = false;
  selectedUser = signal<any>(null);
  userHistory = signal<any>(null);
  userDetailsLoading = signal(false);
  userDetailsError = '';
  userDisplayName = '';

  showSpaceModal = false;
  spaceSummary = signal<any>(null);
  spaceSummaryLoading = signal(false);
  spaceSummaryError = '';

  showPlanModal = false;
  planSummary = signal<any>(null);
  planSummaryLoading = signal(false);
  planSummaryError = '';

  showPaymentModal = false;
  paymentSummary = signal<any>(null);
  paymentSummaryLoading = signal(false);
  paymentSummaryError = '';

  showReassignModal = false;
  reassignBooking: any = null;
  availableSpacesForReassign = signal<any[]>([]);
  reassignLoading = signal(false);
  reassignError = '';
  selectedNewSpace = '';

  bookingCalendarLoading = signal(false);
  bookingMonthCells: any[] = [];
  bookingMonthTitle = '';
  private bookingCalendarDate = new Date();
  weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  locationOptions: { v: any; l: string }[] = [];
  spaceTypeOptions: { v: any; l: string }[] = [];
  spaceOptions: { v: any; l: string }[] = [];
  floorOptions: { v: any; l: string }[] = [];
  amenityOptions: { id: number; name: string }[] = [];
  selectedAmenityIds: number[] = [];

  isSuperAdmin = false;
  assignableRoles = ASSIGNABLE_ROLES;

  private route = inject(ActivatedRoute);
  private admin = inject(AdminService);
  private auth = inject(AuthService);

  constructor() {
    this.isSuperAdmin = this.auth.hasRole('super_admin');
  }

  ngOnInit() {
    this.route.data.subscribe(data => {
      this.entity = data['entity'];
      this.config = this.buildConfig(this.entity);
      this.load();
      if (this.entity === 'spaces') this.loadSpaceDropdowns();
      if (this.entity === 'bookings') this.loadSpacesForDropdown();
    });
  }

  private loadSpaceDropdowns() {
    this.admin.getLocations(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.locationOptions = items.map((l: any) => ({ v: l.id, l: l.name }));
        this.config = this.buildConfig('spaces');
      }
    });
    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.spaceTypeOptions = items.map((s: any) => ({ v: s.id, l: s.name }));
        this.config = this.buildConfig('spaces');
      }
    });
    this.admin.getAmenities().subscribe({
      next: (res: any) => {
        this.amenityOptions = (res?.data ?? []).map((a: any) => ({ id: a.id, name: a.name }));
      }
    });
  }

  private loadSpacesForDropdown() {
    this.admin.getSpaces(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.spaceOptions = items.map((s: any) => ({ v: s.idGuid, l: `${s.name} (${s.code ?? ''}) — ${s.locationName ?? ''}` }));
        this.config = this.buildConfig('bookings');
      }
    });
  }

  private load() {
    this.loading.set(true);
    this.config.getFn(this.page(), this.pageSize, this.searchQuery).subscribe({
      next: (res: any) => {
        this.items.set(res?.data ?? []);
        this.totalCount.set(res?.total ?? (res?.data?.length ?? 0));
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  onPageSizeChange(size: number) { this.pageSize = +size; this.page.set(1); this.load(); }
  prevPage() { if (this.canPrev()) { this.page.update(p => p - 1); this.load(); } }
  nextPage() { if (this.canNext()) { this.page.update(p => p + 1); this.load(); } }

  getCellValue(item: any, col: ColDef): any { return item[col.key] ?? ''; }

  openCreate() {
    this.editItem = null; this.formData = {}; this.error = ''; this.showModal = true;
    this.selectedAmenityIds = [];
    if (this.entity === 'bookings') this.initBookingCalendar();
    if (this.entity === 'gallery') this.formData.isActive = true;
  }

  openEdit(item: any) {
    this.editItem = item;
    this.formData = { ...item };
    this.selectedAmenityIds = [];
    if (this.entity === 'spaces') {
      // Use amenityIds (comma-sep int IDs) returned by the API
      const savedIds: string = item.amenityIds || '';
      this.selectedAmenityIds = savedIds
        ? savedIds.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n))
        : [];
      if (item.locationId) this.loadFloorsForLocation(item.locationId);
    }
    // Format datetimes for datetime-local input (needs 'YYYY-MM-DDTHH:mm')
    if (this.entity === 'bookings') {
      this.formData['startDateTime'] = this.toDatetimeLocal(item.startDateTime);
      this.formData['endDateTime']   = this.toDatetimeLocal(item.endDateTime);
      // Pre-select current space in dropdown
      if (!this.formData['spaceId'] && item.spaceGuid) {
        this.formData['spaceId'] = item.spaceGuid;
      }
    }
    this.error = '';
    this.showModal = true;
  }

  private toDatetimeLocal(val: any): string {
    if (!val) return '';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      return d.toISOString().slice(0, 16);
    } catch { return val; }
  }

  closeModal() { this.showModal = false; }

  save() {
    this.saving = true; this.error = '';
    if (this.entity === 'spaces') this.override_save_spaces(this.formData);
    const obs = this.editItem
      ? this.config.updateFn!(this.editItem.idGuid, this.formData)
      : this.config.createFn!(this.formData);
    obs.subscribe({
      next: () => {
        this.saving = false; this.showModal = false;
        this.success = this.editItem ? 'Updated successfully.' : 'Created successfully.';
        setTimeout(() => this.success = '', 3000);
        this.load();
      },
      error: (e: any) => { this.saving = false; this.error = e?.error?.message ?? 'An error occurred.'; }
    });
  }

  deleteItem(item: any) {
    if (!confirm('Delete this item?')) return;
    this.config.deleteFn!(item.idGuid).subscribe({ next: () => this.load() });
  }

  changeStatus(item: any, status: string) {
    if (!status) return;
    this.config.statusFn!(item.idGuid, status).subscribe({ next: () => this.load() });
  }

  toggleActive(item: any) {
    const obs = item.isActive ? this.admin.deactivateUser(item.idGuid) : this.admin.activateUser(item.idGuid);
    obs.subscribe({ next: () => this.load() });
  }

  changeUserRole(item: any, role: string) {
    if (!role || !this.isSuperAdmin) return;
    this.admin.updateUserRole(item.idGuid, role).subscribe({
      next: () => {
        this.success = `Role updated to "${role}" successfully.`;
        setTimeout(() => this.success = '', 3000);
        this.load();
      }
    });
  }

  openBookingUser(item: any) { this.openUserModal(item.userId ?? item.userEmail); }
  openUserFromUsers(item: any) { this.openUserModal(item.idGuid); }

  private openUserModal(idOrEmail: any) {
    this.showUserModal = true;
    this.userDetailsLoading.set(true);
    this.userDetailsError = '';
    this.selectedUser.set(null);
    this.userHistory.set(null);
    this.admin.getUserHistory(idOrEmail).subscribe({
      next: (histRes: any) => {
        this.userHistory.set(histRes?.data ?? histRes);
        this.admin.getUserById(String(idOrEmail)).subscribe({
          next: (res: any) => {
            const u = res?.data ?? res;
            this.selectedUser.set(u);
            this.userDisplayName = [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.name || u?.email || 'N/A';
            this.userDetailsLoading.set(false);
          },
          error: () => this.userDetailsLoading.set(false)
        });
      },
      error: () => {
        this.userDetailsError = 'Failed to load user history.';
        this.userDetailsLoading.set(false);
      }
    });
  }

  closeUserModal() { this.showUserModal = false; }

  openSpaceDetails(item: any) {
    this.showSpaceModal = true; this.spaceSummaryLoading.set(true);
    this.spaceSummaryError = ''; this.spaceSummary.set(null);
    this.admin.getSpaceSummary(item.idGuid).subscribe({
      next: (res: any) => { this.spaceSummary.set(res?.data ?? res); this.spaceSummaryLoading.set(false); },
      error: () => { this.spaceSummaryLoading.set(false); this.spaceSummaryError = 'Failed to load space summary.'; }
    });
  }
  closeSpaceModal() { this.showSpaceModal = false; }

  openPricingPlanSummary(item: any) {
    this.showPlanModal = true; this.planSummaryLoading.set(true);
    this.planSummaryError = ''; this.planSummary.set(null);
    this.admin.getPricingPlanSummary(item.idGuid).subscribe({
      next: (res: any) => { this.planSummary.set(res?.data ?? res); this.planSummaryLoading.set(false); },
      error: () => { this.planSummaryLoading.set(false); this.planSummaryError = 'Failed to load plan summary.'; }
    });
  }
  closePlanModal() { this.showPlanModal = false; }

  openPaymentSummary(item: any) {
    this.showPaymentModal = true; this.paymentSummaryLoading.set(true);
    this.paymentSummaryError = ''; this.paymentSummary.set(null);
    this.admin.getPaymentSummary(item.idGuid).subscribe({
      next: (res: any) => { this.paymentSummary.set(res?.data ?? res); this.paymentSummaryLoading.set(false); },
      error: () => { this.paymentSummaryLoading.set(false); this.paymentSummaryError = 'Failed to load payment summary.'; }
    });
  }
  closePaymentModal() { this.showPaymentModal = false; }

  openReassignModal(booking: any) {
    this.reassignBooking = booking;
    this.showReassignModal = true;
    this.reassignError = '';
    this.selectedNewSpace = '';
    this.loadAvailableSpacesForReassign();
  }

  closeReassignModal() {
    this.showReassignModal = false;
    this.reassignBooking = null;
    this.availableSpacesForReassign.set([]);
  }

  private loadAvailableSpacesForReassign() {
    if (!this.reassignBooking) return;
    
    this.reassignLoading.set(true);
    this.admin.getAvailableSpacesForReassignment(
      this.reassignBooking.spaceTypeName || 'Private Office',
      this.reassignBooking.startDateTime,
      this.reassignBooking.endDateTime,
      this.reassignBooking.id
    ).subscribe({
      next: (res: any) => {
        this.availableSpacesForReassign.set(res?.data || []);
        this.reassignLoading.set(false);
      },
      error: () => {
        this.reassignError = 'Failed to load available spaces';
        this.reassignLoading.set(false);
      }
    });
  }

  submitReassignment() {
    if (!this.selectedNewSpace || !this.reassignBooking) {
      this.reassignError = 'Please select a space to reassign';
      return;
    }

    this.reassignLoading.set(true);
    this.admin.reassignBooking(this.reassignBooking.id, Number(this.selectedNewSpace)).subscribe({
      next: () => {
        this.success = 'Booking reassigned successfully';
        setTimeout(() => this.success = '', 3000);
        this.closeReassignModal();
        this.load();
      },
      error: (err: any) => {
        this.reassignError = err?.error?.message || 'Failed to reassign booking';
        this.reassignLoading.set(false);
      }
    });
  }

  private initBookingCalendar() { this.bookingCalendarDate = new Date(); this.buildBookingCalendar(); }
  prevBookingMonth() { this.bookingCalendarDate.setMonth(this.bookingCalendarDate.getMonth() - 1); this.buildBookingCalendar(); }
  nextBookingMonth() { this.bookingCalendarDate.setMonth(this.bookingCalendarDate.getMonth() + 1); this.buildBookingCalendar(); }

  private buildBookingCalendar() {
    const d = this.bookingCalendarDate;
    this.bookingMonthTitle = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    const year = d.getFullYear(), month = d.getMonth() + 1;
    const first = new Date(year, month - 1, 1).getDay();
    const days = new Date(year, month, 0).getDate();
    const spaceId = this.formData['spaceId'];
    this.bookingMonthCells = [];
    const fill = (bookedDates: string[]) => {
      const cells: any[] = [];
      for (let i = 0; i < first; i++) cells.push({ placeholder: true });
      for (let d = 1; d <= days; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells.push({ day: d, date: dateStr, isBooked: bookedDates.includes(dateStr) });
      }
      this.bookingMonthCells = cells;
    };
    if (spaceId) {
      this.bookingCalendarLoading.set(true);
      this.admin.getBookingCalendar(spaceId, year, month).subscribe({
        next: (res: any) => { fill(res?.data?.bookedDates ?? []); this.bookingCalendarLoading.set(false); },
        error: () => { fill([]); this.bookingCalendarLoading.set(false); }
      });
    } else { fill([]); }
  }

  pickBookingDate(day: any) {
    if (!day.date || day.isBooked) return;
    if (!this.formData['startDateTime']) {
      this.formData['startDateTime'] = day.date;
    } else if (!this.formData['endDateTime'] && day.date >= this.formData['startDateTime']) {
      this.formData['endDateTime'] = day.date;
    } else {
      this.formData['startDateTime'] = day.date;
      this.formData['endDateTime'] = '';
    }
  }

  isBookingInRange(date: string): boolean {
    const s = this.formData['startDateTime'], e = this.formData['endDateTime'];
    return s && e && date > s && date < e;
  }

  isBookingPast(date: string): boolean { return !!date && date < new Date().toISOString().slice(0, 10); }

  loadFloorsForLocation(locationId: number) {
    this.floorOptions = [];
    if (!locationId) return;
    this.admin.getFloors(locationId).subscribe({
      next: (res: any) => {
        this.floorOptions = (res?.data ?? []).map((f: any) => ({ v: f.id, l: f.floorName }));
      }
    });
  }

  toggleAmenity(id: number) {
    const idx = this.selectedAmenityIds.indexOf(id);
    if (idx === -1) this.selectedAmenityIds.push(id);
    else this.selectedAmenityIds.splice(idx, 1);
  }

  isAmenitySelected(id: number): boolean { return this.selectedAmenityIds.includes(id); }

  onFieldChange(key: string) {
    if (key === 'spaceId' && this.entity === 'bookings') this.buildBookingCalendar();
    if (key === 'locationId' && this.entity === 'spaces') this.loadFloorsForLocation(this.formData['locationId']);
  }

  override_save_spaces(d: any): any {
    d.amenities = this.selectedAmenityIds.join(',');
    // ensure numeric types for FK fields
    if (d.locationId) d.locationId = Number(d.locationId);
    if (d.spaceTypeId) d.spaceTypeId = Number(d.spaceTypeId);
    if (d.floorId) d.floorId = Number(d.floorId);
    return d;
  }

  private buildConfig(entity: string): EntityConfig {
    switch (entity) {
      case 'users': return {
        title: 'Users',
        columns: [
          { key: 'email', label: 'Email' },
          { key: 'name', label: 'Name' },
          { key: 'role', label: 'Role', type: 'role' },
          { key: 'isActive', label: 'Active', type: 'boolean' },
          { key: 'createdAt', label: 'Created', type: 'date' },
        ],
        fields: [
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'password', label: 'Password', type: 'password' },
        ],
        getFn: (p, l, s) => this.admin.getUsers(p, l, s),
        createFn: (d) => this.admin.createUser(d),
        deleteFn: (id) => this.admin.deleteUser(id),
      };

      case 'locations': return {
        title: 'Locations',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'address', label: 'Address' },
          { key: 'city', label: 'City' },
          { key: 'openingTime', label: 'Opens' },
          { key: 'closingTime', label: 'Closes' },
          { key: 'isActive', label: 'Active', type: 'boolean' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'address', label: 'Address', type: 'text' },
          { key: 'city', label: 'City', type: 'text' },
          { key: 'openingTime', label: 'Opening Time', type: 'time' },
          { key: 'closingTime', label: 'Closing Time', type: 'time' },
          { key: 'isActive', label: 'Active', type: 'checkbox' },
        ],
        getFn: (p, l, s) => this.admin.getLocations(p, l, s),
        createFn: (d) => this.admin.createLocation(d),
        updateFn: (id, d) => this.admin.updateLocation(id, d),
        deleteFn: (id) => this.admin.deleteLocation(id),
      };

      case 'spacetypes': return {
        title: 'Space Types',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'capacity', label: 'Capacity' },
          { key: 'hourlyAllowed', label: 'Hourly', type: 'boolean' },
          { key: 'isActive', label: 'Active', type: 'boolean' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'capacity', label: 'Capacity', type: 'number' },
          { key: 'hourlyAllowed', label: 'Hourly Allowed', type: 'checkbox' },
          { key: 'isActive', label: 'Active', type: 'checkbox' },
        ],
        getFn: (p, l, s) => this.admin.getSpaceTypes(p, l, s),
        createFn: (d) => this.admin.createSpaceType(d),
        updateFn: (id, d) => this.admin.updateSpaceType(id, d),
        deleteFn: (id) => this.admin.deleteSpaceType(id),
      };

      case 'spaces': return {
        title: 'Spaces',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'code', label: 'Code' },
          { key: 'locationName', label: 'Location' },
          { key: 'spaceTypeName', label: 'Type' },
          { key: 'pricePerDay', label: 'Price/Day', type: 'currency' },
          { key: 'spaceStatus', label: 'Status', type: 'status' },
          { key: 'imageUrl', label: 'Image', type: 'image' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'code', label: 'Code', type: 'text' },
          { key: 'locationId', label: 'Location', type: 'select', options: this.locationOptions },
          { key: 'spaceTypeId', label: 'Space Type', type: 'select', options: this.spaceTypeOptions },
          { key: 'pricePerHour', label: 'Price/Hour', type: 'number' },
          { key: 'pricePerDay', label: 'Price/Day', type: 'number' },
          { key: 'floorId', label: 'Floor', type: 'floor-select' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'imageUrl', label: 'Image URL', type: 'text' },
          { key: 'amenities', label: 'Amenities', type: 'amenities-multicheck' },
          { key: 'status', label: 'Status', type: 'select', options: [
            { v: 'Available', l: 'Available' },
            { v: 'Maintenance', l: 'Maintenance' },
            { v: 'Inactive', l: 'Inactive' },
          ]},
        ],
        getFn: (p, l, s) => this.admin.getSpaces(p, l, s),
        createFn: (d) => this.admin.createSpace(d),
        updateFn: (id, d) => this.admin.updateSpace(id, d),
        deleteFn: (id) => this.admin.deleteSpace(id),
      };

      case 'bookings': return {
        title: 'Bookings',
        columns: [
          { key: 'userEmail', label: 'User' },
          { key: 'spaceName', label: 'Space' },
          { key: 'startDateTime', label: 'Start', type: 'date' },
          { key: 'endDateTime', label: 'End', type: 'date' },
          { key: 'totalAmount', label: 'Amount', type: 'currency' },
          { key: 'bookingStatus', label: 'Status', type: 'status' },
        ],
        fields: [
          { key: 'spaceId', label: 'Space', type: 'select', options: this.spaceOptions },
          { key: 'startDateTime', label: 'Start Date & Time', type: 'datetime-local' },
          { key: 'endDateTime', label: 'End Date & Time', type: 'datetime-local' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ],
        getFn: (p, l, s) => this.admin.getBookings(p, l, s),
        updateFn: (id, d) => this.admin.updateBooking(id, d),
        statusFn: (id, status) => this.admin.updateBookingStatus(id, status),
        statusOptions: ['Confirmed', 'Cancelled', 'Completed'],
      };

      case 'pricing': return {
        title: 'Pricing Plans',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'price', label: 'Price', type: 'currency' },
          { key: 'billingCycle', label: 'Cycle' },
          { key: 'includesHours', label: 'Hours' },
          { key: 'isActive', label: 'Active', type: 'boolean' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'price', label: 'Price', type: 'number' },
          { key: 'billingCycle', label: 'Billing Cycle', type: 'select', options: BILLING_CYCLES },
          { key: 'includesHours', label: 'Includes Hours', type: 'number' },
          { key: 'isActive', label: 'Active', type: 'checkbox' },
        ],
        getFn: (p, l, s) => this.admin.getPricingPlans(p, l, s),
        createFn: (d) => this.admin.createPricingPlan(d),
        updateFn: (id, d) => this.admin.updatePricingPlan(id, d),
        deleteFn: (id) => this.admin.deletePricingPlan(id),
      };

      case 'payments': return {
        title: 'Payments',
        columns: [
          { key: 'userEmail', label: 'User' },
          { key: 'amount', label: 'Amount', type: 'currency' },
          { key: 'paymentMethod', label: 'Method' },
          { key: 'paymentStatus', label: 'Status', type: 'status' },
          { key: 'paidAt', label: 'Paid At', type: 'date' },
        ],
        fields: [
          { key: 'amount', label: 'Amount', type: 'number' },
          { key: 'paymentMethod', label: 'Method', type: 'select', options: [
            { v: 'Cash', l: 'Cash' },
            { v: 'Card', l: 'Card' },
            { v: 'BankTransfer', l: 'Bank Transfer' },
          ]},
        ],
        getFn: (p, l, s) => this.admin.getPayments(p, l, s),
        createFn: (d) => this.admin.createPayment(d),
        statusFn: (id, status) => this.admin.updatePaymentStatus(id, status),
        statusOptions: ['Paid', 'Failed', 'Refunded'],
        deleteFn: (id) => this.admin.deletePayment(id),
      };

      case 'contacts': return {
        title: 'Contacts',
        columns: [
          { key: 'fullName', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'message', label: 'Message' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'createdAt', label: 'Date', type: 'date' },
        ],
        getFn: (p, l, s) => this.admin.getContacts(p, l, s),
        statusFn: (id, status) => this.admin.updateContactStatus(id, status),
        statusOptions: ['New', 'InProgress', 'Resolved'],
        deleteFn: (id) => this.admin.deleteContact(id),
      };

      case 'gallery': return {
        title: 'Gallery',
        columns: [
          { key: 'title', label: 'Title' },
          { key: 'imageUrl', label: 'Image', type: 'image' },
          // { key: 'sortOrder', label: 'Order' },
          // { key: 'isActive', label: 'Active', type: 'boolean' },

        ],
        fields: [
          { key: 'title', label: 'Title', type: 'text' },
          { key: 'imageUrl', label: 'Image URL', type: 'text' },
          { key: 'sortOrder', label: 'Sort Order', type: 'number' },
          { key: 'isActive', label: 'Active', type: 'checkbox' },
        ],
        getFn: (p, l, s) => this.admin.getGalleryAll(p, l, s),
        createFn: (d) => this.admin.createGalleryImage(d),
        updateFn: (id, d) => this.admin.updateGalleryImage(id, d),
        deleteFn: (id) => this.admin.deleteGalleryImage(id),
      };

      default: return { title: entity, columns: [], getFn: () => [] };
    }
  }
}
