import { Component, signal, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { AccountCoaService } from '../../../services/account-coa.service';
import { AmountFieldService } from '../../../services/amount-field.service';
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
  imports: [CommonModule, FormsModule, DatePipe],
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
  approvingPaymentId = signal<number | null>(null);

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

  // ── Admin Booking Form ────────────────────────────────────
  showBookingForm = false;
  bookingFormData: any = {};
  bookingFormSaving = signal(false);
  bookingFormError = '';
  cityOptions: { v: any; l: string }[] = [];
  allSpaces: any[] = [];
  filteredSpaceOptions: { v: any; l: string }[] = [];
  selectedSpaceTypeId = '';
  securityDeposit = 0;
  accountOptions: { v: number; l: string }[] = [];
  // customer search
  customerSearchQuery = '';
  customerSearchResults: any[] = [];
  customerSearchTimer: any;
  selectedCustomer: any = null;

  // ── Admin Booking Receipt ─────────────────────────────────
  showReceiptModal = false;
  adminBookingReceipt = signal<any>(null);
  showChallanModal = false;
  challanData = signal<any>(null);

  isSuperAdmin = false;
  assignableRoles = ASSIGNABLE_ROLES;
  amountLabels: Record<string, string> = {};

  private route = inject(ActivatedRoute);
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private accountCoa = inject(AccountCoaService);
  private amountFieldSvc = inject(AmountFieldService);

  constructor() {
    this.isSuperAdmin = this.auth.hasRole('super_admin');
  }

  ngOnInit() {
    this.amountFieldSvc.getLabelMap().subscribe(map => {
      this.amountLabels = map;
      this.route.data.subscribe(data => {
        this.entity = data['entity'];
        this.config = this.buildConfig(this.entity);
        this.load();
        if (this.entity === 'spaces') this.loadSpaceDropdowns();
        if (this.entity === 'bookings') this.loadSpacesForDropdown();
        if (this.entity === 'spaceconfig') this.loadSpaceConfig();
        if (this.entity === 'customers') this.loadCityOptions();
        if (this.entity === 'users') this.loadCityOptions();
        if (this.entity === 'spaces' || this.entity === 'spacetypes') this.loadAccountOptions();
      });
    });
  }

  spaceConfigItems = signal<any[]>([]);
  spaceConfigSaving = signal(false);
  spaceConfigError = '';
  spaceConfigSuccess = '';
  editingConfig: any = null;
  configFormData: any = {};
  showConfigModal = false;
  vacantSpaces = signal<any[]>([]);
  vacantLoading = signal(false);
  generatingInventory = signal<string | null>(null);
  generateError = '';
  generateSuccess = '';

  private loadSpaceConfig() {
    this.admin.getSpaceConfig().subscribe({
      next: (res: any) => this.spaceConfigItems.set(res?.data ?? []),
      error: () => {}
    });
    this.loadVacantSpaces();
    if (!this.amenityOptions.length) {
      this.admin.getAmenities().subscribe({
        next: (res: any) => { this.amenityOptions = (res?.data ?? []).map((a: any) => ({ id: a.id, name: a.name })); }
      });
    }
    if (!this.spaceTypeOptions.length) {
      this.admin.getSpaceTypes(1, 1000, '').subscribe({
        next: (res: any) => { this.spaceTypeOptions = (res?.data ?? []).map((s: any) => ({ v: s.idGuid ?? s.id, l: s.name })); }
      });
    }
    if (!this.locationOptions.length) {
      this.admin.getLocations(1, 1000, '').subscribe({
        next: (res: any) => { this.locationOptions = (res?.data ?? []).map((l: any) => ({ v: l.idGuid ?? l.id, l: l.name })); }
      });
    }
  }

  private loadVacantSpaces() {
    this.vacantLoading.set(true);
    this.admin.getVacantSpaces().subscribe({
      next: (res: any) => {
        const vacant = (res?.data ?? []).sort((a: any, b: any) => (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0));
        this.vacantSpaces.set(vacant);
        this.vacantLoading.set(false);
      },
      error: () => this.vacantLoading.set(false)
    });
  }

  get vacantSpacesGrouped(): { type: string; spaces: any[] }[] {
    const grouped = new Map<string, any[]>();
    for (const s of this.vacantSpaces()) {
      const code = parseInt(s.code, 10);
      const key = code >= 3200 ? 'Meeting' : code >= 3100 ? 'Private' : code >= 3000 ? 'Shared' : (s.spaceTypeName || 'Other');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(s);
    }
    return Array.from(grouped.entries()).map(([type, spaces]) => ({ type, spaces }));
  }

  openEditConfig(cfg: any) {
    this.editingConfig = cfg;
    this.configFormData = {
      totalSpaces:        cfg.totalSpaces,
      defaultCapacities:  cfg.defaultCapacities,
      openingTime:        cfg.openingTime,
      closingTime:        cfg.closingTime,
      securityDeposit:    cfg.securityDeposit ?? null,
      pricePerHour:       cfg.pricePerHour ?? null,
      pricePerDay:        cfg.pricePerDay ?? null,
      pricePerMonth:      cfg.pricePerMonth ?? null,
    };
    this.spaceConfigError = '';
    this.spaceConfigSuccess = '';
    this.showConfigModal = true;
  }

  cancelEditConfig() { this.editingConfig = null; this.showConfigModal = false; }

  saveConfig() {
    if (!this.editingConfig) return;
    this.spaceConfigSaving.set(true);
    this.admin.updateSpaceConfig(this.editingConfig.spaceCategory, this.configFormData).subscribe({
      next: () => {
        this.spaceConfigSuccess = 'Configuration saved.';
        this.spaceConfigSaving.set(false);
        this.editingConfig = null;
        this.showConfigModal = false;
        this.loadSpaceConfig();
        setTimeout(() => this.spaceConfigSuccess = '', 3000);
      },
      error: (e: any) => {
        this.spaceConfigError = e?.error?.detail || 'Failed to save config.';
        this.spaceConfigSaving.set(false);
      }
    });
  }

  // State for generate-inventory form
  generateFormCfg: any = null;
  generateFormSpaceTypeId = '';
  generateFormLocationId = '';
  generateFormPricePerHour: number | null = null;
  generateFormPricePerDay: number | null = null;
  generateFormPricePerMonth: number | null = null;
  generateFormAmenityIds: number[] = [];

  openGenerateForm(cfg: any) {
    this.generateFormCfg = cfg;
    this.generateFormSpaceTypeId = '';
    this.generateFormLocationId = '';
    this.generateFormPricePerHour = cfg.pricePerHour ?? null;
    this.generateFormPricePerDay = cfg.pricePerDay ?? null;
    this.generateFormPricePerMonth = cfg.pricePerMonth ?? null;
    this.generateFormAmenityIds = [];
    this.generateError = '';
    this.generateSuccess = '';
  }

  closeGenerateForm() { this.generateFormCfg = null; }

  submitGenerateInventory() {
    if (!this.generateFormCfg || !this.generateFormSpaceTypeId || !this.generateFormLocationId) {
      this.generateError = 'Space Type and Location are required.';
      return;
    }
    const cfg = this.generateFormCfg;
    this.generatingInventory.set(cfg.spaceCategory);
    this.generateError = '';
    this.generateSuccess = '';
    this.admin.generateSpaceInventory({
      spaceCategory: cfg.spaceCategory,
      spaceTypeId: this.generateFormSpaceTypeId,
      locationId: this.generateFormLocationId,
      pricePerHour: this.generateFormPricePerHour ?? 0,
      pricePerDay: this.generateFormPricePerDay ?? 0,
      pricePerMonth: this.generateFormPricePerMonth ?? 0,
      amenities: this.generateFormAmenityIds.join(',') || null,
    }).subscribe({
      next: (res: any) => {
        this.generateSuccess = res?.message ?? `Spaces generated for ${cfg.spaceCategory}.`;
        this.generatingInventory.set(null);
        this.generateFormCfg = null;
        this.loadVacantSpaces();
        setTimeout(() => this.generateSuccess = '', 4000);
      },
      error: (e: any) => {
        this.generateError = e?.error?.message ?? `Failed to generate spaces for ${cfg.spaceCategory}.`;
        this.generatingInventory.set(null);
      }
    });
  }

  private loadSpaceDropdowns() {
    this.admin.getLocations(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.locationOptions = items.map((l: any) => ({ v: l.idGuid ?? l.idGUID ?? l.id, l: l.name }));
        this.config = this.buildConfig('spaces');
      }
    });
    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.spaceTypeOptions = items.map((s: any) => ({ v: s.idGuid ?? s.idGUID ?? s.id, l: s.name }));
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
        this.allSpaces = items;
        this.spaceOptions = items.map((s: any) => ({ v: s.idGuid, l: `${s.name} (${s.code ?? ''}) — ${s.locationName ?? ''}` }));
        this.config = this.buildConfig('bookings');
      }
    });
  }

  private loadAccountOptions() {
    if (this.accountOptions.length) return;
    this.accountCoa.getAll().subscribe({
      next: (accounts) => {
        this.accountOptions = accounts.map(a => ({ v: a.accountId, l: a.description }));
        this.config = this.buildConfig(this.entity);
      }
    });
  }

  private loadCityOptions() {
    if (this.cityOptions.length) return;
    this.admin.getCities().subscribe({
      next: (res: any) => {
        this.cityOptions = (res?.data ?? []).map((c: any) => ({ v: c.id, l: c.name }));
        if (this.entity === 'customers' || this.entity === 'users') {
          this.config = this.buildConfig(this.entity);
        }
      }
    });
  }

  openAdminBookingForm() {
    this.bookingFormData = {};
    this.bookingFormError = '';
    this.selectedSpaceTypeId = '';
    this.filteredSpaceOptions = [];
    this.customerSearchQuery = '';
    this.customerSearchResults = [];
    this.selectedCustomer = null;
    this.securityDeposit = 0;
    this.showBookingForm = true;
    if (!this.spaceConfigItems().length) {
      this.admin.getSpaceConfig().subscribe({
        next: (res: any) => this.spaceConfigItems.set(res?.data ?? [])
      });
    }
    if (!this.cityOptions.length) {
      this.admin.getCities().subscribe({
        next: (res: any) => {
          this.cityOptions = (res?.data ?? []).map((c: any) => ({ v: c.id, l: c.name }));
        }
      });
    }
    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        this.spaceTypeOptions = (res?.data ?? []).map((s: any) => ({ v: s.id, l: s.name }));
      }
    });
    this.admin.getVacantSpaces().subscribe({
      next: (res: any) => { this.allSpaces = res?.data ?? []; }
    });
  }

  closeAdminBookingForm() { this.showBookingForm = false; }

  printReceipt() { window.print(); }

  async downloadChallan() {
    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF } = await import('jspdf');
    const el = document.getElementById('admin-receipt-printable');
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const imgH = (canvas.height * pageW) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
    const challan = this.challanData();
    const filename = `Challan-${challan?.challanNumber ?? challan?.bookingId ?? 'WN'}.pdf`;
    pdf.save(filename);
  }

  onCustomerSearch() {
    clearTimeout(this.customerSearchTimer);
    if (!this.customerSearchQuery.trim()) { this.customerSearchResults = []; return; }
    this.customerSearchTimer = setTimeout(() => {
      this.admin.searchCustomers(this.customerSearchQuery).subscribe({
        next: (res: any) => { this.customerSearchResults = res?.data ?? []; }
      });
    }, 300);
  }

  selectCustomer(user: any) {
    this.selectedCustomer = user;
    const fullName = user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || '';
    this.customerSearchQuery = fullName;
    this.customerSearchResults = [];
    this.bookingFormData.customerName   = fullName;
    this.bookingFormData.customerEmail  = user.email || '';
    this.bookingFormData.customerCode   = user.code || '';
    this.bookingFormData.phone          = user.phoneNumber || '';
    this.bookingFormData.cnicOrPassport = user.cnicOrPassport || '';
    this.bookingFormData.address        = user.address || '';
    this.bookingFormData.cityId         = user.cityId || '';
  }

  isCustomerFieldEmpty(field: string): boolean {
    const u = this.selectedCustomer;
    if (!u) return false;
    switch (field) {
      case 'phone':          return !u.phoneNumber;
      case 'cnicOrPassport': return !u.cnicOrPassport;
      case 'address':        return !u.address;
      case 'cityId':         return !u.cityId;
      case 'customerCode':   return !u.code;
      default: return false;
    }
  }

  private getCustomerUserId(u: any): string {
    // WN_Customers has no WN_Users link — use customerEmail to resolve at booking time
    return u.idGUID ?? u.idGuid ?? String(u.id ?? '');
  }

  onSpaceTypeChange() {
    this.bookingFormData.spaceId = '';
    this.bookingFormData.totalAmount = null;
    this.securityDeposit = 0;
    if (!this.selectedSpaceTypeId) { this.filteredSpaceOptions = []; return; }
    const selectedType = this.spaceTypeOptions.find(t => String(t.v) === String(this.selectedSpaceTypeId));
    const filtered = selectedType
      ? this.allSpaces.filter((s: any) => (s.spaceTypeName || s.SpaceTypeName || '').toLowerCase() === selectedType.l.toLowerCase())
      : this.allSpaces;
    this.filteredSpaceOptions = filtered.map((s: any) => ({ v: s.idGuid || s.IdGuid, l: `${s.name || s.Name} (${s.code ?? ''}) — ${s.locationName ?? s.LocationName ?? ''}` }));
  }

  recalcAmount() {
    const { spaceId, startDateTime, endDateTime } = this.bookingFormData;
    if (!spaceId || !startDateTime || !endDateTime) return;
    const space = this.allSpaces.find((s: any) => s.idGuid === spaceId);
    if (!space) return;
    const start = new Date(startDateTime);
    const end   = new Date(endDateTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return;
    const diffMs   = end.getTime() - start.getTime();
    const diffHours = diffMs / 3_600_000;
    const diffDays  = diffMs / 86_400_000;
    const amount = diffDays >= 1
      ? Math.ceil(diffDays) * Number(space.pricePerDay ?? 0)
      : Math.ceil(diffHours) * Number(space.pricePerHour ?? 0);
    // Look up security deposit from spaceConfigItems by space type name
    const typeName = (space.spaceTypeName || space.SpaceTypeName || '').trim().toLowerCase();
    const configMatch = this.spaceConfigItems().find(
      (c: any) => typeName.startsWith((c.spaceCategory || '').trim().toLowerCase())
    );
    this.securityDeposit = configMatch ? Number(configMatch.securityDeposit ?? 0) : 0;
    this.bookingFormData = { ...this.bookingFormData, totalAmount: parseFloat(amount.toFixed(2)) };
  }

  submitAdminBooking() {
    this.bookingFormSaving.set(true);
    this.bookingFormError = '';
    const u = this.selectedCustomer;

    const doCreate = () => {
      const payload = {
        ...this.bookingFormData,
        userId: u.idGUID ?? u.idGuid ?? String(u.id ?? ''),
        customerEmail: u.email || this.bookingFormData.customerEmail,
        cityId: this.bookingFormData.cityId ? Number(this.bookingFormData.cityId) : undefined,
      };
      this.admin.createAdminBooking(payload).subscribe({
        next: (res: any) => {
          this.bookingFormSaving.set(false);
          this.showBookingForm = false;
          const bookingId = res?.data?.id ?? res?.data?.bookingId ?? res?.id ?? null;
          const space = this.allSpaces.find((s: any) => s.idGuid === payload.spaceId);
          const challanNumber = res?.data?.challanNumber ?? null;
          const validity      = res?.data?.validity ?? null;
          const details: any[] = Array.isArray(res?.data?.bookingDetails) && res.data.bookingDetails.length
            ? res.data.bookingDetails
            : [
                { feeType: 'RoomRent', amount: payload.totalAmount ?? 0 },
                ...(this.securityDeposit > 0 ? [{ feeType: 'SecurityDeposit', amount: this.securityDeposit }] : [])
              ];
          const totalAmount = details.reduce((s: number, l: any) => s + (l.amount ?? l.Amount ?? 0), 0);
          const receipt = {
            bookingId,
            challanNumber,
            validity,
            customerName: payload.customerName,
            customerEmail: payload.customerEmail,
            customerCode: payload.customerCode,
            spaceName: space ? `${space.name} (${space.code ?? ''})` : payload.spaceId,
            locationName: space?.locationName ?? '',
            spaceTypeName: space?.spaceTypeName ?? '',
            startDateTime: payload.startDateTime,
            endDateTime: payload.endDateTime,
            bookingDetails: details,
            totalAmount,
            notes: payload.notes,
            createdAt: new Date().toISOString(),
          };
          this.adminBookingReceipt.set(receipt);
          this.challanData.set(receipt);
          this.showChallanModal = true;
          this.load();
        },
        error: (e: any) => {
          this.bookingFormSaving.set(false);
          this.bookingFormError = e?.error?.message ?? 'Failed to create booking.';
        }
      });
    };

    // Patch customer record with any newly filled fields
    const patch: any = {};
    if (!u.phoneNumber    && this.bookingFormData.phone)          patch.phoneNumber    = this.bookingFormData.phone;
    if (!u.cnicOrPassport && this.bookingFormData.cnicOrPassport) patch.cnicOrPassport = this.bookingFormData.cnicOrPassport;
    if (!u.address        && this.bookingFormData.address)        patch.address        = this.bookingFormData.address;
    if (!u.cityId         && this.bookingFormData.cityId)         patch.cityId         = Number(this.bookingFormData.cityId);

    if (Object.keys(patch).length) {
      this.admin.updateCustomer(u.idGUID ?? u.idGuid ?? u.id, patch).subscribe({
        next: () => doCreate(),
        error: () => doCreate()
      });
    } else {
      doCreate();
    }
  }

  private load() {
    this.loading.set(true);
    this.config.getFn(this.page(), this.pageSize, this.searchQuery).subscribe({
      next: (res: any) => {
        const data = Array.isArray(res) ? res : (res?.data ?? []);
        this.items.set(data);
        this.totalCount.set(res?.total ?? data.length);
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
      ? this.config.updateFn!(this.editItem.idGuid ?? this.editItem.idGUID, this.formData)
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
    const id = item.idGuid ?? item.idGUID ?? item.id;
    this.config.deleteFn!(id).subscribe({ next: () => this.load() });
  }

  changeStatus(item: any, status: string) {
    if (!status) return;
    this.config.statusFn!(item.idGuid, status).subscribe({ next: () => this.load() });
  }

  toggleActive(item: any) {
    const isActive = item.isActive ?? (item.status == 1);
    const obs = isActive ? this.admin.deactivateUser(item.idGuid) : this.admin.activateUser(item.idGuid);
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

  approvePayment(item: any) {
    if (item.paymentStatus !== 'Pending') return;
    if (this.approvingPaymentId() === item.id) return;
    if (!confirm(`Approve cash payment of PKR ${item.amount ?? 0} for ${item.userEmail ?? 'this user'}?`)) return;
    this.approvingPaymentId.set(item.id);
    this.admin.approvePayment(item.id).subscribe({
      next: () => {
        this.success = 'Payment approved successfully.';
        setTimeout(() => this.success = '', 3000);
        this.approvingPaymentId.set(null);
        this.load();
      },
      error: (e: any) => {
        this.error = e?.error?.message ?? 'Failed to approve payment.';
        this.approvingPaymentId.set(null);
      }
    });
  }

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
    this.admin.reassignBooking(this.reassignBooking.idGuid, Number(this.selectedNewSpace)).subscribe({
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

  get isPrivateOfficeSelected(): boolean {
    if (this.entity === 'spacetypes') {
      return (this.formData['name'] || '').toLowerCase().includes('private');
    }
    const selected = this.spaceTypeOptions.find(t => String(t.v) === String(this.formData['spaceTypeId']));
    return selected ? selected.l.toLowerCase().includes('private') : false;
  }

  override_save_spaces(d: any): any {
    d.amenities = this.selectedAmenityIds.join(',');
    // ensure numeric types for FK fields
    if (d.locationId) d.locationId = Number(d.locationId);
    if (d.spaceTypeId) d.spaceTypeId = Number(d.spaceTypeId);
    if (d.floorId) d.floorId = Number(d.floorId);
    return d;
  }

  private lbl(entity: string, field: string): string {
    return this.amountLabels[`${entity}.${field}`] ?? field;
  }

  private buildConfig(entity: string): EntityConfig {
    switch (entity) {
      case 'customers': return {
        title: 'Customers',
        columns: [
          { key: 'code',        label: 'Code' },
          { key: 'fullName',    label: 'Name' },
          { key: 'email',       label: 'Email' },
          { key: 'phoneNumber', label: 'Phone' },
          { key: 'cityName',    label: 'City' },
          { key: 'isActive',    label: 'Active', type: 'boolean' },
          { key: 'createdAt',   label: 'Created', type: 'date' },
        ],
        fields: [
          { key: 'firstName',      label: 'First Name',      type: 'text' },
          { key: 'lastName',       label: 'Last Name',       type: 'text' },
          { key: 'email',          label: 'Email',           type: 'email' },
          { key: 'phoneNumber',    label: 'Phone Number',    type: 'text' },
          { key: 'cnicOrPassport', label: 'CNIC / Passport', type: 'text' },
          { key: 'address',        label: 'Address',         type: 'text' },
          { key: 'cityId',         label: 'City',            type: 'select', options: this.cityOptions },
          { key: 'notes',          label: 'Notes',           type: 'textarea' },
          { key: 'isActive',       label: 'Active',          type: 'checkbox' },
        ],
        getFn:    (p, l, s) => this.admin.getCustomers(p, l, s),
        createFn: (d) => this.admin.createCustomer(d),
        updateFn: (id, d) => this.admin.updateCustomer(id, d),
        deleteFn: (id) => this.admin.deleteCustomer(id),
      };

      case 'users': return {
        title: 'Users',
        columns: [
          { key: 'email', label: 'Email' },
          { key: 'name', label: 'Name' },
          { key: 'phone', label: 'Phone' },
          { key: 'role', label: 'Role', type: 'role' },
          { key: 'isActive', label: 'Active', type: 'boolean' },
          { key: 'createdAt', label: 'Created', type: 'date' },
        ],
        fields: [
          { key: 'name',           label: 'Name',            type: 'text' },
          { key: 'email',          label: 'Email',           type: 'email' },
          { key: 'password',       label: 'Password',        type: 'password' },
          { key: 'code',           label: 'Code',            type: 'text' },
          { key: 'address',        label: 'Address',         type: 'text' },
          { key: 'cnicOrPassport', label: 'CNIC / Passport', type: 'text' },
          { key: 'cityId',         label: 'City',            type: 'select', options: this.cityOptions },
          { key: 'phone',          label: 'Phone Number',    type: 'text' },
        ],
        getFn: (p, l, s) => this.admin.getUsers(p, l, s),
        createFn: (d) => this.admin.createUser(d),
        deleteFn: (id) => this.admin.deleteUser(id),
      };

      case 'locations': return {
        title: 'Locations',
        columns: [
          { key: 'name',        label: 'Name' },
          { key: 'address',     label: 'Address' },
          { key: 'cityName',    label: 'City' },
          { key: 'openingTime', label: 'Opens' },
          { key: 'closingTime', label: 'Closes' },
          { key: 'status',      label: 'Active', type: 'boolean' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'address', label: 'Address', type: 'text' },
          { key: 'cityId', label: 'City ID', type: 'number' },
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
          { key: 'name',         label: 'Name' },
          { key: 'capacity',     label: 'Capacity' },
          { key: 'hourlyAllowed',label: 'Hourly', type: 'boolean' },
          { key: 'status',       label: 'Active', type: 'boolean' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'capacity', label: 'Capacity', type: 'number' },
          { key: 'hourlyAllowed', label: 'Hourly Allowed', type: 'checkbox' },
          { key: 'isActive', label: 'Active', type: 'checkbox' },
          { key: 'rentAccountId', label: 'Rent Account (applies to all spaces of this type)', type: 'select', options: this.accountOptions },
          { key: 'depositAccountId', label: 'Security Deposit Account (Private Office only)', type: 'deposit-account-select' },
        ],
        getFn: (p, l, s) => this.admin.getSpaceTypes(p, l, s),
        createFn: (d) => this.admin.createSpaceType(d),
        updateFn: (id, d) => this.admin.updateSpaceType(id, d),
        deleteFn: (id) => this.admin.deleteSpaceType(id),
      };

      case 'spaces': return {
        title: 'Spaces',
        columns: [
          { key: 'name',          label: 'Name' },
          { key: 'code',          label: 'Code' },
          { key: 'locationName',  label: 'Location' },
          { key: 'spaceTypeName', label: 'Type' },
          { key: 'pricePerDay',   label: this.lbl('Space', 'pricePerDay'), type: 'currency' },
          { key: 'status',        label: 'Status', type: 'status' },
          { key: 'imageUrl',      label: 'Image', type: 'image' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'code', label: 'Code', type: 'text' },
          { key: 'locationId', label: 'Location', type: 'select', options: this.locationOptions },
          { key: 'spaceTypeId', label: 'Space Type', type: 'select', options: this.spaceTypeOptions },
          { key: 'pricePerHour', label: this.lbl('Space', 'pricePerHour'), type: 'number' },
          { key: 'pricePerDay', label: this.lbl('Space', 'pricePerDay'), type: 'number' },
          { key: 'floorId', label: 'Floor', type: 'floor-select' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'imageUrl', label: 'Image URL', type: 'text' },
          { key: 'amenities', label: 'Amenities', type: 'amenities-multicheck' },
          { key: 'rentAccountId', label: 'Rent Account', type: 'select', options: this.accountOptions },
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
          { key: 'totalAmount', label: this.lbl('Booking', 'totalAmount'), type: 'currency' },
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
          { key: 'price', label: this.lbl('PricingPlan', 'price'), type: 'currency' },
          { key: 'billingCycle', label: 'Cycle' },
          { key: 'includesHours', label: 'Hours' },
          { key: 'isActive', label: 'Active', type: 'boolean' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'price', label: this.lbl('PricingPlan', 'price'), type: 'number' },
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
          { key: 'amount', label: this.lbl('Payment', 'amount'), type: 'currency' },
          { key: 'paymentMethod', label: 'Method' },
          { key: 'paymentStatus', label: 'Status', type: 'status' },
          { key: 'paidAt', label: 'Paid At', type: 'date' },
        ],
        fields: [
          { key: 'amount', label: this.lbl('Payment', 'amount'), type: 'number' },
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

      case 'spaceconfig': return {
        title: 'Space Configuration',
        columns: [
          { key: 'spaceCategory',     label: 'Category' },
          { key: 'totalSpaces',       label: 'Total Spaces' },
          { key: 'codePrefix',        label: 'Code Prefix' },
          { key: 'defaultCapacities', label: 'Capacities' },
          { key: 'openingTime',       label: 'Opens' },
          { key: 'closingTime',       label: 'Closes' },
        ],
        getFn: () => this.admin.getSpaceConfig(),
      }; 

      default: return { title: entity, columns: [], getFn: () => [] };
    }
  }
}
