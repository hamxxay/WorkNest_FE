import { Component, signal, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { AccountCoaService } from '../../../services/account-coa.service';
import { AmountFieldService } from '../../../services/amount-field.service';
import { ASSIGNABLE_ROLES, BILLING_CYCLES, BILLING_PERIOD_OPTIONS } from '../../../utils/constants';
import { BookingService } from '../../../services/booking.service';
import { QuotationService } from '../../../services/quotation.service';
import { BookingBillingSummary } from '../../../models/admin.model';

interface ColDef { key: string; label: string; type?: string; }
interface FieldDef { key: string; label: string; type: string; options?: { v: any; l: string }[]; required?: boolean; }

interface EntityConfig {
  title: string;
  columns: ColDef[];
  fields?: FieldDef[];
  getFn: (page: number, limit: number, search: string) => any;
  createFn?: (data: any) => any;
  updateFn?: (id: any, data: any) => any;
  deleteFn?: (id: any) => any;
  statusFn?: (id: any, statusId: number) => any;
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
  config: EntityConfig = { title: '', columns: [], getFn: () => [] };

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

  get filtered() {
    let list = this.items();
    if (this.entity === 'spaces') return this.displayedItems;
    if (list.length > this.pageSize) {
      const start = (this.page() - 1) * this.pageSize;
      return list.slice(start, start + this.pageSize);
    }
    return list;
  }

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
  approvingPaymentId = signal<any>(null);

  // Invoice Details & Record Payment Modals
  showInvoiceDetailsModal = false;
  selectedInvoiceDetails = signal<any>(null);
  showRecordPaymentModal = false;
  recordPaymentFormData: any = { paidAmount: 0, paymentMethod: 'Bank Transfer', transactionRef: '', notes: '' };
  recordPaymentSaving = signal(false);

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
  selectedLocationId = '';
  securityDeposit = 0;
  securityDepositMonthsOverride: number | null = null;
  bookingDiscountType = 'Percentage';
  bookingDiscountPercentage = 0;
  bookingDiscountValue = 0;
  bookingChallanMode: 'initial' | 'full' = 'initial';
  bookingSubtotal = 0;
  bookingDiscountAmount = 0;
  bookingFloorId: number | null = null;
  bookingFloorOptions: { v: any; l: string }[] = [];

  bookingBillingPeriodMonths = 3;
  bookingSecurityDepositMonths = 2;
  readonly billingPeriodOptions = BILLING_PERIOD_OPTIONS;

  get effectiveSecurityDeposit(): number {
    if (!this.isAdminPrivateRoom) return 0;
    return parseFloat((this.securityDeposit * this.bookingSecurityDepositMonths).toFixed(2));
  }

  get bookingMonthlyRent(): number {
    const months = Number(this.adminMonths || 1);
    return parseFloat(((this.bookingSubtotal || 0) / months).toFixed(2));
  }

  get bookingBillingAmount(): number {
    return Math.max(0, this.bookingBillingPeriodMonths * this.bookingMonthlyRent);
  }

  get bookingFirstInvoiceTotal(): number {
    const subtotal = this.bookingBillingAmount + this.effectiveSecurityDeposit;
    return parseFloat(Math.max(0, subtotal - this.bookingDiscountAmount).toFixed(2));
  }
  accountOptions: { v: number; l: string }[] = [];

  // Meeting room slots (admin booking)
  adminMeetingDate = '';
  adminMeetingSlots: { label: string; start: string; end: string; isLocked?: boolean }[] = [];
  adminSelectedSlots = new Set<string>();
  meetingRoomBookingMode: 'day' | 'slot' = 'slot';

  // Private Room & Shared Space (admin booking)
  selectedAdminCapacity: number | string | null = null;
  availableAdminCapacities: number[] = [];
  adminStartDate = '';
  adminMeetingDayEnd = '';
  adminMonths = 1;
  // customer search
  customerSearchQuery = '';
  customerSearchResults: any[] = [];
  customerSearchTimer: any;
  selectedCustomer: any = null;
  // When opening customer-create from booking flow, set this to true so save() can inject created customer
  creatingCustomerFromBooking = false;

  // ── Country Codes & Dropdowns ─────────────────────────────
  countryCodeOptions: { v: string; l: string }[] = [
    { v: '+92', l: 'PK (+92)' },
    { v: '+1', l: 'US/CA (+1)' },
    { v: '+44', l: 'UK (+44)' },
    { v: '+971', l: 'UAE (+971)' },
    { v: '+966', l: 'KSA (+966)' },
    { v: '+91', l: 'IN (+91)' },
    { v: '+61', l: 'AU (+61)' },
    { v: '+49', l: 'DE (+49)' },
    { v: '+33', l: 'FR (+33)' },
    { v: '+81', l: 'JP (+81)' },
    { v: '+86', l: 'CN (+86)' },
    { v: '+974', l: 'QA (+974)' },
    { v: '+968', l: 'OM (+968)' },
    { v: '+965', l: 'KW (+965)' },
    { v: '+90', l: 'TR (+90)' },
    { v: '+60', l: 'MY (+60)' },
    { v: '+65', l: 'SG (+65)' },
  ];
  selectedCountryCode = '+92';
  branchOptions: { v: any; l: string }[] = [];
  branchesLoading = signal(false);
  branchesError = '';
  citiesLoading = signal(false);
  citiesError = '';

  // ── Quick Create Customer (from booking form) ─────────────
  showQuickCreateCustomer = false;
  quickCustomerForm: any = {
    firstName: '',
    lastName: '',
    email: '',
    countryCode: '+92',
    phoneNumber: '',
    addressLine1: '',
    addressLine2: '',
    cityId: ''
  };
  quickCustomerSaving = signal(false);
  quickCustomerError = '';

  // ── Admin Booking Receipt ─────────────────────────────────
  showReceiptModal = false;
  adminBookingReceipt = signal<any>(null);
  showChallanModal = false;
  challanData = signal<any>(null);

  showQuotationForm = false;
  quotationFormData: any = {};
  quotationFormSaving = signal(false);
  quotationFormError = '';
  showQuotationPreviewModal = false;
  selectedQuotation = signal<any>(null);
  quotationEmailSent = signal<string>('');

  selectedQuotationLocationId = '';
  selectedQuotationSpaceTypeId = '';
  selectedQuotationCapacity: number | string | null = null;
  quotationSubtotal = 0;
  quotationSecurityDeposit = 0;
  quotationSecurityDepositMonthsOverride: number | null = null;
  quotationTotal = 0;
  quotationMonths = 12;
  quotationStartDate = '';
  quotationEndDateDisplay = '';
  quotationValidUntil = '';
  quotationRemarks = '';
  quotationDiscountType = 'Percentage';
  quotationDiscountPercentage = 0;
  quotationDiscountValue = 0;
  quotationFloorId: number | null = null;
  quotationFloorOptions: { v: any; l: string }[] = [];
  quotationBillingPeriodMonths = 3;
  quotationSecurityDepositMonths = 2;

  get quotationMonthlyRent(): number {
    const spaceId = this.quotationFormData?.spaceId;
    const space = this.allSpaces.find(s => String(s.id) === String(spaceId));
    if (!space) return 0;
    return Number(space.pricePerMonth ?? space.PricePerMonth ?? space.pricePerDay ?? space.PricePerDay ?? space.pricePerHour ?? space.PricePerHour ?? space.seatPrice ?? space.SeatPrice ?? space.price ?? space.Price ?? 0);
  }

  get quotationBillingAmount(): number {
    return Math.max(0, this.quotationBillingPeriodMonths * this.quotationMonthlyRent);
  }

  get effectiveQuotationSecurityDeposit(): number {
    if (!this.isQuotationPrivateRoom) return 0;
    const months = this.quotationSecurityDepositMonthsOverride ?? this.quotationSecurityDepositMonths;
    return months != null && months >= 0
      ? parseFloat((this.quotationMonthlyRent * Math.floor(months)).toFixed(2))
      : this.quotationSecurityDeposit;
  }

  get quotationDiscountAmount(): number {
    const val = Number(this.quotationDiscountValue || this.quotationDiscountPercentage || 0);
    if (this.quotationDiscountType === 'Amount') return parseFloat(Math.max(0, val).toFixed(2));
    return parseFloat((this.quotationSubtotal * Math.min(100, Math.max(0, val)) / 100).toFixed(2));
  }

  get quotationFirstInvoiceTotal(): number {
    const subtotal = this.quotationBillingAmount + this.effectiveQuotationSecurityDeposit;
    return parseFloat(Math.max(0, subtotal - this.quotationDiscountAmount).toFixed(2));
  }


  // Meeting room slots for quotation
  quotationMeetingSlots: { label: string; start: string; end: string }[] = [];
  quotationSelectedSlots = new Set<string>();
  quotationMeetingRoomMode: 'day' | 'slot' = 'slot';
  quotationMeetingDayEnd = '';

  sendingChallanEmail = signal(false);
  challanEmailSent = signal('');

  resendingBookingEmailId = signal<number | null>(null);
  bookingEmailFeedback = signal('');

  async resendBookingEmail(item: any) {
    const bookingId = item.id ?? item.bookingId;
    if (!bookingId) return;
    this.resendingBookingEmailId.set(bookingId);

    this.bookingService.getChallan(bookingId).subscribe({
      next: async (res: any) => {
        const challan = res?.data ?? res;
        const targetEmail = challan?.customerEmail || challan?.userEmail || '';
        if (!targetEmail) {
          this.resendingBookingEmailId.set(null);
          alert('No customer email address found for this booking.');
          return;
        }

        // Temporarily show challan modal to capture PDF
        this.challanData.set({
          bookingId,
          challanNumber: challan.challanNumber,
          validity: challan.validUntil ?? challan.challanValidUntil,
          customerName: challan.customerName,
          customerEmail: challan.customerEmail,
          customerCode: challan.customerCode,
          spaceName: challan.spaceName,
          locationName: challan.locationName,
          spaceTypeName: challan.spaceTypeName,
          startDateTime: challan.startOn,
          endDateTime: challan.endOn,
          bookingDetails: challan.details ?? [],
          securityDeposit: challan.securityDeposit ?? 0,
          subtotalAmount: challan.roomPrice ?? 0,
          discountPercentage: 0,
          discountAmount: 0,
          totalAmount: challan.totalPayable ?? 0,
          createdAt: new Date().toISOString(),
        });
        this.showChallanModal = true;

        // Wait for DOM to render then capture
        setTimeout(async () => {
          try {
            const { default: html2canvas } = await import('html2canvas');
            const { jsPDF } = await import('jspdf');
            const el = document.getElementById('admin-receipt-printable');
            let pdfBase64 = '';
            if (el) {
              const actions = el.querySelector<HTMLElement>('[data-challan-actions]');
              const bodyEl = el.querySelector<HTMLElement>('[data-challan-body]');
              const origMaxHeight = el.style.maxHeight;
              const origBodyOverflow = bodyEl ? bodyEl.style.overflowY : '';
              if (actions) actions.style.display = 'none';
              el.style.maxHeight = 'none';
              if (bodyEl) bodyEl.style.overflowY = 'visible';

              const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });

              if (actions) actions.style.display = '';
              el.style.maxHeight = origMaxHeight;
              if (bodyEl) bodyEl.style.overflowY = origBodyOverflow;

              const imgData = canvas.toDataURL('image/png');
              const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
              const pageW = pdf.internal.pageSize.getWidth();
              const imgH = (canvas.height * pageW) / canvas.width;
              pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
              pdfBase64 = pdf.output('datauristring').split(',')[1];
            }
            this.showChallanModal = false;
            this.bookingService.sendChallanEmail(bookingId, targetEmail, pdfBase64).subscribe({
              next: () => {
                this.resendingBookingEmailId.set(null);
                this.bookingEmailFeedback.set(`Booking & Challan email sent to ${targetEmail}`);
                setTimeout(() => this.bookingEmailFeedback.set(''), 4000);
              },
              error: () => {
                this.resendingBookingEmailId.set(null);
                this.bookingEmailFeedback.set(`Booking & Challan email sent to ${targetEmail}`);
                setTimeout(() => this.bookingEmailFeedback.set(''), 4000);
              }
            });
          } catch {
            this.showChallanModal = false;
            this.resendingBookingEmailId.set(null);
          }
        }, 300);
      },
      error: () => {
        this.resendingBookingEmailId.set(null);
        alert('Failed to load booking details. Please try again.');
      }
    });
  }

  readonly today = new Date().toISOString().split('T')[0];
  isSuperAdmin = false;
  assignableRoles = ASSIGNABLE_ROLES;
  amountLabels: Record<string, string> = {};

  private route = inject(ActivatedRoute);
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private accountCoa = inject(AccountCoaService);
  private amountFieldSvc = inject(AmountFieldService);
  private bookingService = inject(BookingService);
  private quotationSvc = inject(QuotationService);

  constructor() {
    this.isSuperAdmin = this.auth.hasRole('super_admin');
  }

  ngOnInit() {
    this.amountFieldSvc.getLabelMap().subscribe(map => {
      this.amountLabels = map;
      this.route.data.subscribe(data => {
        const newEntity = data['entity'];
        if (newEntity !== this.entity) {
          // Reset state when switching entities
          this.items.set([]);
          this.totalCount.set(0);
          this.page.set(1);
          this.searchQuery = '';
          this.loading.set(true);
        }
        this.entity = newEntity;
        this.config = this.buildConfig(this.entity);
        this.load();
        if (this.entity === 'spaces') this.loadSpaceDropdowns();
        if (this.entity === 'bookings') this.loadSpacesForDropdown();
        if (this.entity === 'spaceconfig') {
          this.loadSpaceDropdowns();
          this.loadSpaceConfig();
        }
        if (this.entity === 'customers' || this.entity === 'users') this.loadCityOptions();
        if (this.entity === 'locations') {
          this.loadCityOptions();
          this.loadBranchOptions();
        }
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
  vacantBranchId: any = null;
  vacantBranchOptions: { id: any; name: string }[] = [];
  generateError = '';
  generateSuccess = '';

  private loadSpaceConfig() {
    this.admin.getSpaceConfig().subscribe({
      next: (res: any) => {
        this.spaceConfigItems.set(res?.data ?? []);
        this.loadSpaceInventoryForConfig();
      },
      error: () => { }
    });
    this.loadVacantSpaces();
  }

  private loadSpaceInventoryForConfig() {
    if (this.allSpaces.length) {
      return;
    }
    this.admin.getSpaces(1, 1000, '').subscribe({
      next: (res: any) => {
        this.allSpaces = res?.data ?? res ?? [];
      }
    });
  }

  private loadVacantSpaces() {
    this.vacantLoading.set(true);
    this.admin.getVacantSpaces(this.vacantBranchId ?? undefined).subscribe({
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

  actualSpaceCount(cfg: any): number {
    if (!cfg) return 0;
    const category = (cfg.spaceCategory || '').toLowerCase();
    const prefix = String(cfg.codePrefix || '').trim();
    const matches = this.allSpaces.filter((s: any) => {
      const code = String(s.code ?? '');
      const typeName = String(s.spaceTypeName ?? '').toLowerCase();
      if (prefix && code.startsWith(prefix)) {
        return true;
      }
      return !!(category && (typeName.includes(category) || category.includes(typeName)));
    });
    return matches.length || Number(cfg.totalSpaces ?? 0);
  }

  openEditConfig(cfg: any) {
    this.editingConfig = cfg;
    this.configFormData = {
      totalSpaces: cfg.totalSpaces,
      defaultCapacities: cfg.defaultCapacities,
      openingTime: cfg.openingTime,
      closingTime: cfg.closingTime,
      securityDeposit: cfg.securityDeposit ?? null,
      pricePerHour: cfg.pricePerHour ?? null,
      pricePerDay: cfg.pricePerDay ?? null,
      pricePerMonth: cfg.pricePerMonth ?? null,
    };
    this.spaceConfigError = '';
    this.spaceConfigSuccess = '';
    this.showConfigModal = true;
  }

  cancelEditConfig() {
    this.editingConfig = null;
    this.showConfigModal = false;
  }

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

  onVacantBranchChange() {
    this.loadVacantSpaces();
  }

  // ── Add / Remove Single Space ─────────────────────────────
  showAddSpaceModal = false;
  addSpaceTypeId = '';
  addSpaceLocationId = '';
  addSpacePreviewCode = '';
  addSpaceSaving = signal(false);
  addSpaceError = '';

  openAddSpaceModal() {
    this.addSpaceTypeId = '';
    this.addSpaceLocationId = '';
    this.addSpacePreviewCode = '';
    this.addSpaceError = '';
    this.generateError = '';
    this.generateSuccess = '';
    this.showAddSpaceModal = true;
  }

  closeAddSpaceModal() { this.showAddSpaceModal = false; }

  onAddSpaceSelectionChange() {
    this.addSpacePreviewCode = '';
    if (!this.addSpaceTypeId || !this.addSpaceLocationId) return;
    // Find the config for the selected space type to get codePrefix
    const typeName = this.spaceTypeOptions.find(t => String(t.v) === this.addSpaceTypeId)?.l ?? '';
    const cfg = this.spaceConfigItems().find((c: any) =>
      typeName.toLowerCase().includes((c.spaceCategory || '').toLowerCase()) ||
      (c.spaceCategory || '').toLowerCase().includes(typeName.toLowerCase())
    );
    const prefix = cfg?.codePrefix ? parseInt(cfg.codePrefix, 10) : 0;
    // Count existing spaces of this type at this location
    const existing = this.vacantSpaces().filter((s: any) =>
      (String(s.locationId ?? '') === String(this.addSpaceLocationId) ||
        String(s.locationIdGuid ?? '') === String(this.addSpaceLocationId)) &&
      (s.spaceTypeName || '').toLowerCase() === typeName.toLowerCase()
    );
    // Also count from allSpaces for a more accurate next code
    const allOfType = this.allSpaces.filter((s: any) =>
      (String(s.locationId ?? '') === String(this.addSpaceLocationId) ||
        String(s.locationIdGuid ?? '') === String(this.addSpaceLocationId)) &&
      (s.spaceTypeName || '').toLowerCase() === typeName.toLowerCase()
    );
    const count = Math.max(existing.length, allOfType.length);
    this.addSpacePreviewCode = prefix ? String(prefix + count + 1) : '';
  }

  submitAddSpace() {
    if (!this.addSpaceTypeId || !this.addSpaceLocationId) {
      this.addSpaceError = 'Space type and location are required.';
      return;
    }
    const typeName = this.spaceTypeOptions.find(t => String(t.v) === this.addSpaceTypeId)?.l ?? '';
    const locName = this.locationOptions.find(l => String(l.v) === this.addSpaceLocationId)?.l ?? '';
    const cfg = this.spaceConfigItems().find((c: any) =>
      typeName.toLowerCase().includes((c.spaceCategory || '').toLowerCase()) ||
      (c.spaceCategory || '').toLowerCase().includes(typeName.toLowerCase())
    );
    const payload: Partial<any> = {
      name: `${typeName} ${this.addSpacePreviewCode || ''}`.trim(),
      code: this.addSpacePreviewCode || undefined,
      locationId: Number(this.addSpaceLocationId) || this.addSpaceLocationId,
      spaceTypeId: Number(this.addSpaceTypeId) || this.addSpaceTypeId,
      pricePerHour: cfg?.pricePerHour ?? 0,
      pricePerDay: cfg?.pricePerDay ?? 0,
      status: 'Available',
    };
    this.addSpaceSaving.set(true);
    this.addSpaceError = '';
    this.admin.createSpace(payload).subscribe({
      next: () => {
        this.addSpaceSaving.set(false);
        this.showAddSpaceModal = false;
        this.generateSuccess = `Space "${payload['name']}" added at ${locName}.`;
        setTimeout(() => this.generateSuccess = '', 4000);
        this.loadVacantSpaces();
        if (this.allSpaces.length) this.loadSpacesForDropdown();
      },
      error: (e: any) => {
        this.addSpaceSaving.set(false);
        this.addSpaceError = e?.error?.message ?? 'Failed to add space.';
      }
    });
  }

  removeSpace(space: any) {
    if (!confirm(`Remove space "${space.name} (${space.code})"? This cannot be undone.`)) return;
    const id = space.idGuid ?? space.idGUID ?? space.id;
    this.admin.deleteSpace(id).subscribe({
      next: () => {
        this.generateSuccess = `Space "${space.name}" removed.`;
        setTimeout(() => this.generateSuccess = '', 4000);
        this.loadVacantSpaces();
      },
      error: (e: any) => {
        this.generateError = e?.error?.message ?? 'Failed to remove space.';
      }
    });
  }

  private refreshVacantBranchOptions() {
    const options = new Map<any, string>();
    for (const opt of this.locationOptions) {
      const branchId = (opt as any).branchId;
      const branchName = (opt as any).branchName ?? '';
      if (branchId != null && !options.has(branchId)) {
        options.set(branchId, branchName || String(branchId));
      }
    }
    this.vacantBranchOptions = Array.from(options.entries()).map(([id, name]) => ({ id, name }));
  }

  private loadSpaceDropdowns() {
    this.admin.getLocations(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.locationOptions = items.map((l: any) => {
          const opt: any = { v: l.idGuid ?? l.idGUID ?? l.id, l: l.name };
          if (l.branchId) { opt.branchId = l.branchId; opt.branchName = l.branchName ?? l.branchCode; }
          return opt;
        });
        this.refreshVacantBranchOptions();
        this.config = this.buildConfig('spaces');
      }
    });
    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.populateSpaceTypeOptions(items);
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
    this.citiesLoading.set(true);
    this.citiesError = '';
    this.admin.getCities().subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.cityOptions = items.map((c: any) => ({ v: c.id, l: c.name }));
        this.citiesLoading.set(false);
        if (this.entity === 'customers' || this.entity === 'users' || this.entity === 'locations') {
          this.config = this.buildConfig(this.entity);
        }
      },
      error: () => {
        this.citiesError = 'Failed to load cities.';
        this.citiesLoading.set(false);
      }
    });
  }

  private loadBranchOptions() {
    if (this.branchOptions.length) return;
    this.branchesLoading.set(true);
    this.branchesError = '';
    this.admin.getBranches().subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.branchOptions = items.map((b: any) => ({ v: b.id ?? b.branchId ?? b.v, l: b.name || b.branchName || b.l }));
        this.branchesLoading.set(false);
        if (this.entity === 'locations') {
          this.config = this.buildConfig(this.entity);
        }
      },
      error: () => {
        // Fallback: extract distinct branches from locations list
        this.admin.getLocations(1, 1000, '').subscribe({
          next: (locRes: any) => {
            const locs = locRes?.data ?? (Array.isArray(locRes) ? locRes : []);
            const map = new Map<any, string>();
            locs.forEach((l: any) => {
              const bId = l.branchId ?? l.branchCode ?? l.id;
              const bName = l.branchName ?? l.branchCode ?? `Branch ${bId}`;
              if (bId && !map.has(bId)) map.set(bId, bName);
            });
            if (map.size === 0) {
              map.set(1, 'Main Branch');
            }
            this.branchOptions = Array.from(map.entries()).map(([v, l]) => ({ v, l }));
            this.branchesLoading.set(false);
            if (this.entity === 'locations') {
              this.config = this.buildConfig(this.entity);
            }
          },
          error: () => {
            this.branchesError = 'Failed to load branches.';
            this.branchesLoading.set(false);
          }
        });
      }
    });
  }

  openAdminBookingForm() {
    this.bookingFormData = {};
    this.bookingFormError = '';
    this.selectedSpaceTypeId = '';
    this.selectedLocationId = '';
    this.selectedAdminCapacity = null;
    this.availableAdminCapacities = [];
    this.adminStartDate = '';
    this.adminMonths = 12;
    this.filteredSpaceOptions = [];
    this.customerSearchQuery = '';
    this.customerSearchResults = [];
    this.selectedCustomer = null;
    this.securityDeposit = 0;
    this.securityDepositMonthsOverride = null;
    this.bookingDiscountType = 'Percentage';
    this.bookingDiscountPercentage = 0;
    this.bookingDiscountValue = 0;
    this.bookingSubtotal = 0;
    this.bookingDiscountAmount = 0;
    this.bookingFloorId = null;
    this.bookingFloorOptions = [];
    this.adminMeetingDate = '';
    this.adminMeetingSlots = [];
    this.adminSelectedSlots = new Set();
    this.meetingRoomBookingMode = 'slot';
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
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.populateSpaceTypeOptions(items);
        if (this.allSpaces.length) this.applyBookingSpaceFilter();
      },
      error: () => {
        this.populateSpaceTypeOptions([]);
        if (this.allSpaces.length) this.applyBookingSpaceFilter();
      }
    });
    if (!this.locationOptions.length) {
      this.admin.getLocations(1, 1000, '').subscribe({
        next: (res: any) => {
          this.locationOptions = (res?.data ?? []).map((l: any) => ({ v: l.idGuid ?? l.id, l: l.name }));
        }
      });
    }
    if (this.allSpaces.length) {
      this.populateSpaceTypeOptions(this.spaceTypeOptions);
      this.applyBookingSpaceFilter();
    } else {
      this.admin.getSpaces(1, 1000, '').subscribe({
        next: (res: any) => {
          this.allSpaces = res?.data ?? [];
          this.populateSpaceTypeOptions(this.spaceTypeOptions);
          this.applyBookingSpaceFilter();
        }
      });
    }
  }

  private populateSpaceTypeOptions(apiTypes: any[]) {
    const map = new Map<string, { v: any; l: string }>();

    const getGroup = (label: string): string => {
      const l = label.toLowerCase();
      if (l.includes('private') || l.includes('office') || l.includes('desk')) return 'private';
      if (l.includes('meeting') || l.includes('conference') || l.includes('board')) return 'meeting';
      if (l.includes('shared') || l.includes('co-working') || l.includes('coworking') || l.includes('open')) return 'shared';
      return l;
    };

    const addedGroups = new Set<string>();

    // 1. From /spacetype API — use categoryCode as value so all types in same category are matched
    (apiTypes || []).forEach((s: any) => {
      // Prefer name over description so "Meeting/Conference" is not reduced to just "Conference"
      const name = (s.name || s.displayName || s.label || s.typeName || s.description || s.l || '').trim();
      const label = name ? name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim() : '';
      if (!label) return;

      const group = getGroup(label);
      if (!addedGroups.has(group)) {
        const key = label.toLowerCase();
        // Use group name as value so all space types in same category share one dropdown option
        map.set(key, { v: group, l: group === 'meeting' ? 'Meeting Room' : group === 'private' ? 'Private Room' : group === 'shared' ? 'Shared Space' : label });
        addedGroups.add(group);
      }
    });

    // 2. From /spaceconfig API
    (this.spaceConfigItems() || []).forEach((c: any) => {
      const cat = (c.spaceCategory || c.name || '').trim();
      if (cat) {
        let label = cat.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
        if (label.toLowerCase() === 'meeting') label = 'Meeting Room';
        if (label.toLowerCase() === 'private') label = 'Private Room';
        if (label.toLowerCase() === 'shared') label = 'Shared Space';

        const group = getGroup(label);
        if (!addedGroups.has(group)) {
          const key = label.toLowerCase();
          map.set(key, { v: group, l: label });
          addedGroups.add(group);
        }
      }
    });

    // 3. From allSpaces items
    (this.allSpaces || []).forEach((s: any) => {
      const typeName = (s.spaceTypeName || s.SpaceTypeName || s.spaceType || '').trim();
      if (typeName) {
        let label = typeName.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
        if (label.toLowerCase() === 'meeting') label = 'Meeting Room';

        const group = getGroup(label);
        if (!addedGroups.has(group)) {
          const key = label.toLowerCase();
          map.set(key, { v: group, l: label });
          addedGroups.add(group);
        }
      }
    });

    // 4. Guarantee standard core space types exist
    const standardTypes = [
      { v: 'meeting', l: 'Meeting Room' },
      { v: 'private', l: 'Private Room' },
      { v: 'shared', l: 'Shared Space' }
    ];

    standardTypes.forEach(std => {
      const group = getGroup(std.l);
      if (!addedGroups.has(group)) {
        const key = std.l.toLowerCase();
        map.set(key, std);
        addedGroups.add(group);
      }
    });

    this.spaceTypeOptions = Array.from(map.values());
  }

  onBookingSpaceSelected() { this.recalcAmount(); }

  onQuotationSpaceSelected() { this.recalcQuotationAmount(); }

  onBookingLocationChange() {
    this.bookingFormData.spaceId = '';
    this.bookingFormData.totalAmount = null;
    this.securityDeposit = 0;
    this.bookingFloorId = null;
    this.bookingFloorOptions = [];
    if (this.selectedLocationId) {
      this.loadBookingFloors(this.selectedLocationId);
    }
    if (this.isAdminPrivateRoom) {
      this.updateAvailableAdminCapacities();
    }
    this.applyBookingSpaceFilter();
  }

  loadBookingFloors(locationId: any) {
    const locInt = parseInt(String(locationId), 10);
    if (!locInt) return;
    this.admin.getFloors(locInt).subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.bookingFloorOptions = items.map((f: any) => ({
          v: f.id ?? f.Id,
          l: f.name || f.floorName || f.Name || (f.floorNumber != null ? `Floor ${f.floorNumber}` : `Floor #${f.id}`)
        }));
      }
    });
  }

  getSpaceCapacity(s: any): number {
    if (s.capacity != null && !isNaN(Number(s.capacity)) && Number(s.capacity) > 0) {
      return Number(s.capacity);
    }
    if (s.Capacity != null && !isNaN(Number(s.Capacity)) && Number(s.Capacity) > 0) {
      return Number(s.Capacity);
    }
    const str = String(s.defaultCapacities || s.defaultCapacity || s.capacity || s.Capacity || '');
    const num = parseInt(str.replace(/\D/g, ''), 10);
    return !isNaN(num) && num > 0 ? num : 0;
  }

  updateAvailableAdminCapacities() {
    let spaces = this.allSpaces;
    if (this.selectedLocationId) {
      spaces = spaces.filter((s: any) =>
        String(s.locationId ?? s.locationIdGuid ?? s.LocationId ?? '') === String(this.selectedLocationId) ||
        String(s.locationIdGuid ?? s.locationId ?? s.LocationIdGuid ?? '') === String(this.selectedLocationId)
      );
    }
    if (this.selectedSpaceTypeId) {
      spaces = spaces.filter((s: any) => {
        const categoryCode = (s.categoryCode || '').toLowerCase();
        const sTypeName = (s.spaceTypeName || '').toLowerCase();
        return categoryCode.includes('private') || sTypeName.includes('private') || sTypeName.includes('office');
      });
    }

    const capsSet = new Set<number>();
    spaces.forEach((s: any) => {
      const c = this.getSpaceCapacity(s);
      if (c > 0) capsSet.add(c);
    });

    const cfg = this.spaceConfigItems().find((c: any) =>
      (c.spaceCategory || '').toLowerCase().includes('private') ||
      String(c.spaceTypeId) === String(this.selectedSpaceTypeId)
    );
    if (cfg?.defaultCapacities) {
      String(cfg.defaultCapacities).split(',').forEach((str: string) => {
        const num = parseInt(str.trim(), 10);
        if (!isNaN(num) && num > 0) capsSet.add(num);
      });
    }

    if (capsSet.size === 0) {
      [2, 4, 6, 8, 10, 12, 16, 20].forEach(c => capsSet.add(c));
    }

    this.availableAdminCapacities = Array.from(capsSet).sort((a, b) => a - b);
  }

  applyBookingSpaceFilter() {
    if (!this.selectedSpaceTypeId) {
      this.filteredSpaceOptions = [];
      return;
    }

    let spaces = this.allSpaces;

    // 1. Filter by location if selected
    if (this.selectedLocationId) {
      spaces = spaces.filter((s: any) =>
        String(s.locationId ?? s.locationIdGuid ?? s.LocationId ?? '') === String(this.selectedLocationId) ||
        String(s.locationIdGuid ?? s.locationId ?? s.LocationIdGuid ?? '') === String(this.selectedLocationId)
      );
    }

    // 2. Filter by space type using categoryCode
    if (this.selectedSpaceTypeId) {
      spaces = spaces.filter((s: any) => {
        const categoryCode = (s.categoryCode || '').toLowerCase();
        const sTypeName = (s.spaceTypeName || '').toLowerCase();
        const sName = (s.name || '').toLowerCase();
        if (this.selectedSpaceTypeId === 'meeting') return categoryCode.includes('meeting') || sTypeName.includes('meeting') || sTypeName.includes('conference') || sName.includes('meeting') || sName.includes('conference');
        if (this.selectedSpaceTypeId === 'private') return categoryCode.includes('private') || sTypeName.includes('private') || sTypeName.includes('office');
        if (this.selectedSpaceTypeId === 'shared') return categoryCode.includes('shared') || categoryCode.includes('coworking') || sTypeName.includes('shared') || sTypeName.includes('co-working');
        return false;
      });
    }

    // 3. For Private Room, filter by capacity if selected
    if (this.isAdminPrivateRoom) {
      if (!this.selectedAdminCapacity) {
        this.filteredSpaceOptions = [];
        return;
      }
      const targetCap = Number(this.selectedAdminCapacity);

      const matchingCapSpaces = spaces.filter((s: any) => {
        const c = this.getSpaceCapacity(s);
        return c === targetCap;
      });

      if (matchingCapSpaces.length > 0) {
        spaces = matchingCapSpaces;
      } else {
        spaces = spaces.filter((s: any) => {
          const c = this.getSpaceCapacity(s);
          return c === 0 || c === targetCap;
        });
      }
    }

    // 4. Map space options with [Booked] or [Available] tag
    this.filteredSpaceOptions = spaces
      .filter((s: any) => s.idGuid || s.id)
      .map((s: any) => {
        const cap = this.getSpaceCapacity(s);
        const capLabel = cap > 0 ? ` — Cap: ${cap}` : '';
        const codeLabel = s.code ? ` (${s.code})` : '';
        const locLabel = s.locationName ? ` — ${s.locationName}` : '';

        const st = (s.status || s.Status || '').toString().trim().toLowerCase();
        const isBooked = st === 'booked' || st === 'occupied';
        const tag = isBooked ? ' [Booked]' : ' [Available]';

        return {
          v: s.idGuid ?? s.id,
          l: `${s.name}${codeLabel}${capLabel}${locLabel}${tag}`
        };
      });
  }

  closeAdminBookingForm() {
    this.showBookingForm = false;
    this.bookingDiscountType = 'Percentage';
    this.bookingDiscountPercentage = 0;
    this.bookingDiscountValue = 0;
    this.bookingSubtotal = 0;
    this.bookingDiscountAmount = 0;
    this.securityDepositMonthsOverride = null;
    this.bookingFloorId = null;
    this.bookingFloorOptions = [];
  }

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
    const query = (this.customerSearchQuery || '').trim().toLowerCase();

    // If search text changed from selected customer's name, reset selection
    if (this.selectedCustomer) {
      const selectedName = (this.selectedCustomer.fullName || [this.selectedCustomer.firstName, this.selectedCustomer.lastName].filter(Boolean).join(' ') || this.selectedCustomer.name || this.selectedCustomer.email || '').toLowerCase();
      if (!selectedName || !selectedName.includes(query)) {
        this.selectedCustomer = null;
        this.bookingFormData.customerName = '';
        this.bookingFormData.customerEmail = '';
        this.bookingFormData.customerCode = '';
        this.bookingFormData.phone = '';
        this.bookingFormData.cnicOrPassport = '';
        this.bookingFormData.address = '';
        this.bookingFormData.cityId = '';
      }
    }

    if (!query) {
      this.customerSearchResults = [];
      return;
    }

    this.customerSearchTimer = setTimeout(() => {
      this.admin.searchCustomers(query).subscribe({
        next: (res: any) => {
          const results = res?.data ?? (Array.isArray(res) ? res : []);
          if (results.length > 0) {
            this.customerSearchResults = results;
          } else {
            this.fallbackCustomerSearch(query);
          }
        },
        error: () => {
          this.fallbackCustomerSearch(query);
        }
      });
    }, 250);
  }

  private fallbackCustomerSearch(query: string) {
    this.admin.getCustomers(1, 100, query).subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        const filtered = items.filter((u: any) => {
          const name = (u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || '').toLowerCase();
          const email = (u.email || '').toLowerCase();
          const code = (u.customerCode || u.code || '').toLowerCase();
          const phone = (u.phoneNumber || u.phone || '').toLowerCase();
          return name.includes(query) || email.includes(query) || code.includes(query) || phone.includes(query);
        });
        this.customerSearchResults = filtered;
      },
      error: () => {
        this.customerSearchResults = [];
      }
    });
  }

  selectCustomer(user: any) {
    this.selectedCustomer = user;
    const fullName = user.fullName
      || [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
      || user.name
      || user.email
      || '';
    this.customerSearchQuery = fullName;
    this.customerSearchResults = [];
    this.bookingFormData.customerName = fullName;
    this.bookingFormData.customerEmail = user.email || '';
    this.bookingFormData.customerCode = user.code || '';
    this.bookingFormData.phone = user.phoneNumber || '';
    this.bookingFormData.cnicOrPassport = user.cnicOrPassport || '';
    this.bookingFormData.address = user.address || '';
    this.bookingFormData.cityId = user.cityId || '';
    this.quotationFormData.customerName = fullName;
    this.quotationFormData.customerEmail = user.email || '';
  }

  isCustomerFieldEmpty(field: string): boolean {
    const u = this.selectedCustomer;
    if (!u) return false;
    switch (field) {
      case 'phone': return !u.phoneNumber;
      case 'cnicOrPassport': return !u.cnicOrPassport;
      case 'address': return !u.address;
      case 'cityId': return !u.cityId;
      case 'customerCode': return !u.code;
      default: return false;
    }
  }

  private getCustomerUserId(u: any): string {
    // WN_Customers has no WN_Users link — use customerEmail to resolve at booking time
    return u.idGUID ?? u.idGuid ?? String(u.id ?? '');
  }

  get isAdminMeetingRoom(): boolean {
    return this.selectedSpaceTypeId === 'meeting';
  }

  get isAdminMeetingRoomDayMode(): boolean {
    return this.isAdminMeetingRoom && this.meetingRoomBookingMode === 'day';
  }

  get isAdminMeetingRoomSlotMode(): boolean {
    return this.isAdminMeetingRoom && this.meetingRoomBookingMode === 'slot';
  }

  get isAdminPrivateRoom(): boolean {
    return this.selectedSpaceTypeId === 'private';
  }

  get isAdminSharedSpace(): boolean {
    return this.selectedSpaceTypeId === 'shared';
  }

  get adminEndDateDisplay(): string {
    if (!this.bookingFormData.endDateTime) return '';
    const d = new Date(this.bookingFormData.endDateTime);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  }

  generateAdminMeetingSlots() {
    if (!this.adminMeetingDate) { this.adminMeetingSlots = []; return; }
    const cfg = this.spaceConfigItems().find((c: any) =>
      (c.spaceCategory || '').toLowerCase() === 'meeting'
    );
    const openH = parseInt((cfg?.openingTime || '08:00').split(':')[0], 10);
    const closeH = parseInt((cfg?.closingTime || '20:00').split(':')[0], 10);
    this.adminMeetingSlots = [];
    for (let h = openH; h < closeH; h++) {
      const start = `${String(h).padStart(2, '0')}:00`;
      const end = `${String(h + 1).padStart(2, '0')}:00`;
      this.adminMeetingSlots.push({ label: `${start} – ${end}`, start, end });
    }
    this.adminSelectedSlots = new Set();
    this.applyAdminSlotsToDates();
  }

  toggleAdminSlot(slot: { start: string; end: string; isLocked?: boolean }) {
    this.adminSelectedSlots.has(slot.start)
      ? this.adminSelectedSlots.delete(slot.start)
      : this.adminSelectedSlots.add(slot.start);
    this.applyAdminSlotsToDates();
    this.recalcAmount();
  }

  isAdminSlotSelected(slot: { start: string; isLocked?: boolean }): boolean {
    return this.adminSelectedSlots.has(slot.start);
  }

  private applyAdminSlotsToDates() {
    if (!this.adminMeetingDate || !this.adminSelectedSlots.size) {
      this.bookingFormData.startDateTime = '';
      this.bookingFormData.endDateTime = '';
      return;
    }
    const sorted = Array.from(this.adminSelectedSlots).sort();
    const lastHour = +sorted[sorted.length - 1].split(':')[0] + 1;
    this.bookingFormData.startDateTime = `${this.adminMeetingDate}T${sorted[0]}:00`;
    this.bookingFormData.endDateTime = `${this.adminMeetingDate}T${String(lastHour).padStart(2, '0')}:00:00`;
  }

  onAdminMeetingModeChange() {
    this.adminMeetingDate = '';
    this.adminMeetingDayEnd = '';
    this.adminMeetingSlots = [];
    this.adminSelectedSlots = new Set();
    this.adminStartDate = '';
    this.bookingFormData.startDateTime = '';
    this.bookingFormData.endDateTime = '';
    this.recalcAmount();
  }

  onAdminMeetingDayChange() {
    if (!this.adminStartDate || !this.adminMeetingDayEnd) {
      this.bookingFormData.startDateTime = '';
      this.bookingFormData.endDateTime = '';
      this.recalcAmount();
      return;
    }
    this.bookingFormData.startDateTime = `${this.adminStartDate}T00:00:00`;
    this.bookingFormData.endDateTime = `${this.adminMeetingDayEnd}T23:59:59`;
    this.recalcAmount();
  }

  onSpaceTypeChange() {
    this.bookingFormData.spaceId = '';
    this.bookingFormData.totalAmount = null;
    this.securityDeposit = 0;
    this.selectedAdminCapacity = null;
    this.adminMeetingDate = '';
    this.adminMeetingDayEnd = '';
    this.adminMeetingSlots = [];
    this.adminSelectedSlots = new Set();
    this.meetingRoomBookingMode = 'slot';
    this.adminStartDate = '';
    this.adminMonths = (this.selectedSpaceTypeId === 'shared' || this.selectedSpaceTypeId === 'private') ? 12 : 1;
    this.bookingFormData.startDateTime = '';
    this.bookingFormData.endDateTime = '';

    const isPrivate = this.isAdminPrivateRoom;
    const isShared = this.isAdminSharedSpace;
    this.bookingBillingPeriodMonths = (isPrivate || isShared) ? 3 : 1;
    this.bookingSecurityDepositMonths = isPrivate ? 2 : 0;

    if (this.isAdminPrivateRoom) {
      this.updateAvailableAdminCapacities();
    }
    this.applyBookingSpaceFilter();
  }

  onAdminCapacityChange() {
    this.bookingFormData.spaceId = '';
    this.bookingFormData.totalAmount = null;
    this.applyBookingSpaceFilter();
    this.recalcAmount();
  }

  onAdminMonthPeriodChange() {
    if (!this.adminStartDate || !this.adminMonths || this.adminMonths < 1) {
      this.bookingFormData.startDateTime = '';
      this.bookingFormData.endDateTime = '';
      this.recalcAmount();
      return;
    }
    if (this.bookingBillingPeriodMonths > Number(this.adminMonths)) {
      this.bookingBillingPeriodMonths = Number(this.adminMonths);
    }
    const start = new Date(`${this.adminStartDate}T00:00:00`);
    if (isNaN(start.getTime())) {
      this.bookingFormData.startDateTime = '';
      this.bookingFormData.endDateTime = '';
      this.recalcAmount();
      return;
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + Number(this.adminMonths));

    const pad = (n: number) => String(n).padStart(2, '0');
    const startIso = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T00:00:00`;
    const endIso = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T00:00:00`;

    this.bookingFormData.startDateTime = startIso;
    this.bookingFormData.endDateTime = endIso;
    this.recalcAmount();
  }

  getSpacePrice(space: any): { hourly: number; daily: number; monthly: number } {
    let hourly = Number(space?.pricePerHour ?? space?.PricePerHour ?? space?.seatPrice ?? space?.SeatPrice ?? 0);
    let daily = Number(space?.pricePerDay ?? space?.PricePerDay ?? space?.seatPrice ?? space?.SeatPrice ?? 0);
    let monthly = Number(space?.pricePerMonth ?? space?.PricePerMonth ?? space?.pricePerDay ?? space?.PricePerDay ?? space?.seatPrice ?? space?.SeatPrice ?? space?.price ?? space?.Price ?? 0);

    const typeName = (space?.spaceTypeName || space?.SpaceTypeName || '').trim().toLowerCase();
    const cfg = this.spaceConfigItems().find((c: any) =>
      (c.spaceCategory || '').trim().toLowerCase() === typeName ||
      typeName.startsWith((c.spaceCategory || '').trim().toLowerCase()) ||
      String(c.spaceTypeId) === String(space?.spaceTypeId)
    );

    if (cfg) {
      if (!hourly && cfg.pricePerHour) hourly = Number(cfg.pricePerHour);
      if (!daily && cfg.pricePerDay) daily = Number(cfg.pricePerDay);
      if (!monthly && cfg.pricePerMonth) monthly = Number(cfg.pricePerMonth);
    }

    return { hourly, daily, monthly };
  }

  recalcAmount() {
    const { spaceId } = this.bookingFormData;
    if (!spaceId) {
      this.bookingFormData.totalAmount = null;
      this.securityDeposit = 0;
      this.bookingSubtotal = 0;
      this.bookingDiscountAmount = 0;
      return;
    }
    const space = this.allSpaces.find((s: any) =>
      String(s.idGuid ?? '') === String(spaceId) ||
      String(s.id ?? '') === String(spaceId)
    );
    if (!space) return;

    const { hourly, daily, monthly } = this.getSpacePrice(space);

    if (this.isAdminMeetingRoom) {
      const { startDateTime, endDateTime } = this.bookingFormData;
      if (!startDateTime || !endDateTime) return;
      const start = new Date(startDateTime);
      const end = new Date(endDateTime);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return;
      const rate = hourly > 0 ? hourly : (daily > 0 ? daily : (monthly > 0 ? monthly : 0));
      let amount: number;
      if (this.meetingRoomBookingMode === 'day') {
        // Full-day: count calendar days × 9 hours/day × hourly rate
        const diffDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
        amount = diffDays * 9 * rate;
      } else {
        const diffHours = (end.getTime() - start.getTime()) / 3_600_000;
        amount = Math.ceil(diffHours) * rate;
      }

      this.securityDeposit = 0;
      this.bookingSubtotal = parseFloat(amount.toFixed(2));
    } else {
      if (!this.adminStartDate || !this.adminMonths || this.adminMonths < 1) return;
      const rate = monthly > 0 ? monthly : (daily > 0 ? daily : (hourly > 0 ? hourly : 0));

      if (this.isAdminPrivateRoom) {
        const capacity = this.selectedAdminCapacity ? Number(this.selectedAdminCapacity) : Number(space.capacity ?? 1);
        const oneMonthRentOfRoom = rate * capacity;
        const totalRent = oneMonthRentOfRoom * Number(this.adminMonths);
        this.securityDeposit = parseFloat(oneMonthRentOfRoom.toFixed(2));
        this.bookingSubtotal = parseFloat(totalRent.toFixed(2));
      } else {
        // Shared Space — no security deposit
        const totalRent = rate * Number(this.adminMonths);
        this.securityDeposit = 0;
        this.bookingSubtotal = parseFloat(totalRent.toFixed(2));
      }
    }

    const discVal = Number(this.bookingDiscountValue || this.bookingDiscountPercentage || 0);
    if (this.bookingDiscountType === 'Percentage') {
      const pct = Math.min(100, Math.max(0, discVal));
      this.bookingDiscountAmount = parseFloat(((this.bookingSubtotal * pct) / 100).toFixed(2));
      this.bookingDiscountPercentage = pct;
    } else {
      this.bookingDiscountAmount = parseFloat(Math.max(0, discVal).toFixed(2));
      this.bookingDiscountPercentage = 0;
    }
    const finalRent = Math.max(0, this.bookingSubtotal - this.bookingDiscountAmount);
    this.bookingFormData = { ...this.bookingFormData, totalAmount: parseFloat(finalRent.toFixed(2)) };
  }

  submitAdminBooking() {
    this.bookingFormSaving.set(true);
    this.bookingFormError = '';

    if (!this.selectedCustomer) {
      this.bookingFormError = 'Please select a customer.';
      this.bookingFormSaving.set(false);
      return;
    }
    if (!this.selectedSpaceTypeId) {
      this.bookingFormError = 'Please select space type.';
      this.bookingFormSaving.set(false);
      return;
    }
    if (this.isAdminPrivateRoom && !this.selectedAdminCapacity) {
      this.bookingFormError = 'Please select room capacity.';
      this.bookingFormSaving.set(false);
      return;
    }
    if (!this.bookingFormData.spaceId) {
      this.bookingFormError = 'Please select a space.';
      this.bookingFormSaving.set(false);
      return;
    }
    if (this.isAdminMeetingRoom && this.meetingRoomBookingMode === 'slot' && this.adminSelectedSlots.size === 0) {
      this.bookingFormError = 'Please select at least one time slot.';
      this.bookingFormSaving.set(false);
      return;
    }
    if (!this.isAdminMeetingRoom && (!this.adminStartDate || !this.adminMonths || this.adminMonths < 1)) {
      this.bookingFormError = 'Please specify start date and number of months.';
      this.bookingFormSaving.set(false);
      return;
    }
    if (this.isAdminMeetingRoom && this.meetingRoomBookingMode === 'day' && (!this.adminStartDate || !this.adminMeetingDayEnd)) {
      this.bookingFormError = 'Please specify start and end date for the meeting room booking.';
      this.bookingFormSaving.set(false);
      return;
    }
    if (this.bookingDiscountType === 'Percentage' && (this.bookingDiscountValue < 0 || this.bookingDiscountValue > 100)) {
      this.bookingFormError = 'Percentage discount must be between 0% and 100%.';
      this.bookingFormSaving.set(false);
      return;
    }
    if (this.bookingDiscountType === 'Amount' && this.bookingDiscountValue < 0) {
      this.bookingFormError = 'Discount amount cannot be negative.';
      this.bookingFormSaving.set(false);
      return;
    }

    if (!this.bookingFormData.totalAmount || this.bookingFormData.totalAmount <= 0) {
      this.recalcAmount();
    }

    const u = this.selectedCustomer;

    const targetSpace = this.allSpaces.find((s: any) =>
      String(s.idGuid ?? '') === String(this.bookingFormData.spaceId) ||
      String(s.id ?? '') === String(this.bookingFormData.spaceId)
    );

    const numericSpaceId = targetSpace?.id
      ? Number(targetSpace.id)
      : (!isNaN(Number(this.bookingFormData.spaceId)) ? Number(this.bookingFormData.spaceId) : 0);

    const spaceGuidStr = targetSpace?.idGuid
      ? String(targetSpace.idGuid)
      : String(this.bookingFormData.spaceId);

    const doCreate = () => {
      const nameParts = (u.fullName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.name || this.bookingFormData.customerName || '').trim().split(' ');
      const customerFirstName = nameParts[0] || 'Customer';
      const customerLastName = nameParts.slice(1).join(' ') || '';
      const currentAdminId = Number((this.auth.user() as any)?.id || (this.auth.user() as any)?.userId || 1);
      const bookingUserId = Number(u.userId || u.id || 0) || currentAdminId;

      const payload = {
        userId: bookingUserId,
        spaceId: numericSpaceId,
        pricingId: 0,
        startOn: this.bookingFormData.startDateTime,
        endOn: this.bookingFormData.endDateTime,
        startDateTime: this.bookingFormData.startDateTime,
        endDateTime: this.bookingFormData.endDateTime,
        notes: this.bookingFormData.notes || null,
        createdById: currentAdminId,
        userEmail: u.email || this.bookingFormData.customerEmail || null,
        customerEmail: u.email || this.bookingFormData.customerEmail || null,
        customerFirstName,
        customerLastName,
        customerPhone: u.phoneNumber || u.phone || this.bookingFormData.phone || null,
        customerCnic: u.cnicOrPassport || this.bookingFormData.cnicOrPassport || null,
        customerAddress: u.address || this.bookingFormData.address || null,
        customerCityId: this.bookingFormData.cityId ? Number(this.bookingFormData.cityId) : (u.cityId ? Number(u.cityId) : null),
        customerNotes: this.bookingFormData.notes || null,
        // Compatibility properties
        spaceIdGuid: spaceGuidStr,
        userIdGuid: u.idGUID ?? u.idGuid ?? String(u.id ?? ''),
        customerCode: u.customerCode || u.code || '',
        customerName: `${customerFirstName} ${customerLastName}`.trim(),
        totalAmount: this.bookingFormData.totalAmount,
        subtotalAmount: this.bookingSubtotal,
        discountType: this.bookingDiscountType,
        discountPercentage: this.bookingDiscountType === 'Percentage' ? Number(this.bookingDiscountValue || this.bookingDiscountPercentage || 0) : 0,
        discountValue: Number(this.bookingDiscountValue || this.bookingDiscountPercentage || 0),
        discountAmount: this.bookingDiscountAmount,
        securityDeposit: this.effectiveSecurityDeposit,
        billingPeriodMonths: this.bookingBillingPeriodMonths,
        securityDepositMonths: this.bookingSecurityDepositMonths,
        securityDepositOverride: this.effectiveSecurityDeposit,
        floorId: this.bookingFloorId ?? null,
      };

      console.log('[BOOKING TEST] Creating admin booking with payload:', payload);

      this.admin.createAdminBooking(payload).subscribe({
        next: (res: any) => {
          console.log('[BOOKING TEST] Raw response from createAdminBooking:', res);
          const d = Array.isArray(res?.data) ? res.data[0] : (Array.isArray(res) ? res[0] : (res?.data ?? res ?? {}));
          console.log('[BOOKING TEST] Unwrapped response object d:', d);
          const errorMsg = d?.errorMessage || d?.ErrorMessage || res?.errorMessage || (res?.isSuccessful === false ? res?.message : null);

          if (errorMsg) {
            console.error('[BOOKING TEST] Creation returned error message:', errorMsg);
            this.bookingFormSaving.set(false);
            this.bookingFormError = errorMsg;
            return;
          }

          this.bookingFormSaving.set(false);
          this.showBookingForm = false;

          const bookingId = d.bookingId ?? d.BookingId ?? d.id ?? d.Id ?? null;
          const space = targetSpace || this.allSpaces.find((s: any) => String(s.id) === String(payload.spaceId) || String(s.idGuid) === String(payload.spaceIdGuid));

          const challanNumber = d.challanNumber
            ?? d.ChallanNumber
            ?? d.challanNo
            ?? d.ChallanNo
            ?? d.code
            ?? (bookingId ? `WN-CH-${String(bookingId).padStart(6, '0')}` : null);

          const validity = d.challanValidUntil
            ?? d.ChallanValidUntil
            ?? d.validity
            ?? d.Validity
            ?? d.validityDate
            ?? null;

          const details: any[] = Array.isArray(d.bookingDetails) && d.bookingDetails.length
            ? d.bookingDetails
            : (Array.isArray(d.BookingDetails) && d.BookingDetails.length
              ? d.BookingDetails
              : [
                (() => {
                  if (this.isAdminMeetingRoom && this.meetingRoomBookingMode === 'day' && this.adminStartDate && this.adminMeetingDayEnd) {
                    const start = new Date(this.adminStartDate);
                    const end = new Date(this.adminMeetingDayEnd);
                    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1);
                    return { feeType: 'RoomRent', amount: this.bookingSubtotal, description: `Meeting Room — Full Day (${days} day${days > 1 ? 's' : ''} × 9 hrs/day)` };
                  }
                  return { feeType: 'RoomRent', amount: this.bookingSubtotal };
                })(),
                ...(this.bookingDiscountAmount > 0 ? [{ feeType: 'DISCOUNT', amount: -this.bookingDiscountAmount, notes: `Discount applied: ${Number(this.bookingDiscountPercentage).toFixed(2)}%` }] : []),
                ...(this.effectiveSecurityDeposit > 0 ? [{ feeType: 'SecurityDeposit', amount: this.effectiveSecurityDeposit }] : [])
              ]);

          let receipt;
          if (!this.isAdminMeetingRoom) {
            const billingMonths = payload.billingPeriodMonths || 3;
            const secMonths = payload.securityDepositMonths || 0;
            const billingRentAmount = this.bookingBillingAmount;
            const secDepositAmount = this.effectiveSecurityDeposit;
            const discount = this.bookingDiscountAmount;
            const firstInvoiceTotal = this.bookingFirstInvoiceTotal;

            const billingDetails = [
              { feeType: 'RoomRent', description: `Room Rent (${billingMonths} Month(s))`, amount: billingRentAmount }
            ];
            if (secMonths > 0) {
              billingDetails.push({ feeType: 'SecurityDeposit', description: `Security Deposit (${secMonths} Month(s))`, amount: secDepositAmount });
            }
            if (discount > 0) {
              billingDetails.push({ feeType: 'DISCOUNT', description: 'Discount', amount: discount });
            }

            receipt = {
              bookingId,
              challanNumber: challanNumber || `WN-BK-${bookingId}`,
              validity,
              customerName: payload.customerName,
              customerEmail: payload.customerEmail,
              customerCode: payload.customerCode,
              spaceName: space ? `${space.name} (${space.code ?? ''})` : `Space ${payload.spaceId}`,
              locationName: space?.locationName ?? '',
              spaceTypeName: space?.spaceTypeName ?? '',
              contractStartDateTime: payload.startDateTime,
              contractEndDateTime: payload.endDateTime,
              billingPeriodStart: payload.startDateTime,
              billingPeriodEnd: this.calcBillingPeriodEnd(payload.startDateTime, billingMonths),
              startDateTime: payload.startDateTime,
              endDateTime: payload.endDateTime,
              bookingDetails: billingDetails,
              securityDeposit: secDepositAmount,
              subtotalAmount: billingRentAmount,
              discountPercentage: Number(this.bookingDiscountPercentage || 0),
              discountAmount: discount,
              totalAmount: firstInvoiceTotal,
              notes: payload.notes,
              createdAt: new Date().toISOString(),
            };
          } else {
            const secMonths = payload.securityDepositMonths || 0;
            const secDepositAmount = this.effectiveSecurityDeposit;
            const billingMonths = payload.billingPeriodMonths || 3;
            const billingRentAmount = this.bookingBillingAmount;
            const firstInvoiceTotal = billingRentAmount + secDepositAmount - this.bookingDiscountAmount;

            const fullDetails = [
              { feeType: 'RoomRent', description: `Room Rent (${billingMonths} Month(s))`, amount: billingRentAmount }
            ];
            if (secMonths > 0) {
              fullDetails.push({ feeType: 'SecurityDeposit', description: `Security Deposit (${secMonths} Month(s))`, amount: secDepositAmount });
            }
            if (this.bookingDiscountAmount > 0) {
              fullDetails.push({ feeType: 'DISCOUNT', description: 'Discount', amount: this.bookingDiscountAmount });
            }

            receipt = {
              bookingId,
              challanNumber: challanNumber || `WN-BK-${bookingId}`,
              validity,
              customerName: payload.customerName,
              customerEmail: payload.customerEmail,
              customerCode: payload.customerCode,
              spaceName: space ? `${space.name} (${space.code ?? ''})` : `Space ${payload.spaceId}`,
              locationName: space?.locationName ?? '',
              spaceTypeName: space?.spaceTypeName ?? '',
              contractStartDateTime: payload.startDateTime,
              contractEndDateTime: payload.endDateTime,
              billingPeriodStart: payload.startDateTime,
              billingPeriodEnd: this.calcBillingPeriodEnd(payload.startDateTime, billingMonths),
              startDateTime: payload.startDateTime,
              endDateTime: payload.endDateTime,
              bookingDetails: fullDetails,
              securityDeposit: secDepositAmount,
              subtotalAmount: billingRentAmount,
              discountPercentage: Number(this.bookingDiscountPercentage || 0),
              discountAmount: this.bookingDiscountAmount,
              totalAmount: Math.max(0, firstInvoiceTotal),
              notes: payload.notes,
              createdAt: new Date().toISOString(),
            };
          }

          const createdBookingObj = {
            id: bookingId,
            bookingId: bookingId,
            bookingPublicId: d.bookingPublicId || d.publicId,
            userEmail: payload.customerEmail,
            userName: payload.customerName,
            customerName: payload.customerName,
            customerEmail: payload.customerEmail,
            spaceId: numericSpaceId,
            spaceName: space ? `${space.name} (${space.code ?? ''})` : `Space ${payload.spaceId}`,
            spaceTypeName: space?.spaceTypeName ?? '',
            locationName: space?.locationName ?? '',
            startOn: payload.startDateTime,
            endOn: payload.endDateTime,
            startDateTime: payload.startDateTime,
            endDateTime: payload.endDateTime,
            challanNumber: challanNumber,
            challanValidUntil: validity,
            bookingStatus: 'Confirmed',
            bookingStatusLabel: 'Confirmed',
            bookingStatusCode: 'Confirmed',
            bookedOn: new Date().toISOString(),
          };

          this.adminBookingReceipt.set(receipt);
          this.challanData.set(receipt);
          this.showChallanModal = true;
          this.items.update(curr => [createdBookingObj, ...curr]);
          this.page.set(1);
          this.load(() => {
            if (bookingId) {
              this.items.update(curr => {
                const exists = curr.some((x: any) => String(x.bookingId ?? x.id ?? x.BookingId ?? '') === String(bookingId));
                return exists ? curr : [createdBookingObj, ...curr];
              });
            }
          });
        },
        error: (err: any) => {
          this.bookingFormSaving.set(false);
          this.bookingFormError = err?.error?.errorMessage || err?.error?.ErrorMessage || err?.error?.message || err?.message || 'Failed to create booking.';
        }
      });
    };

    // Patch customer record with any newly filled fields
    const patch: any = {};
    if (!u.phoneNumber && this.bookingFormData.phone) patch.phoneNumber = this.bookingFormData.phone;
    if (!u.cnicOrPassport && this.bookingFormData.cnicOrPassport) patch.cnicOrPassport = this.bookingFormData.cnicOrPassport;
    if (!u.address && this.bookingFormData.address) patch.address = this.bookingFormData.address;
    if (!u.cityId && this.bookingFormData.cityId) patch.cityId = Number(this.bookingFormData.cityId);

    if (Object.keys(patch).length) {
      this.admin.updateCustomer(u.idGUID ?? u.idGuid ?? u.id, patch).subscribe({
        next: () => doCreate(),
        error: () => doCreate()
      });
    } else {
      doCreate();
    }
  }

  private load(cb?: () => void) {
    this.loading.set(true);
    this.config.getFn(this.page(), this.pageSize, this.searchQuery).subscribe({
      next: (res: any) => {
        if (this.entity === 'bookings') {
          console.log('[BOOKING TEST] getBookings raw response:', res);
        }
        let data = Array.isArray(res) ? res
          : Array.isArray(res?.data) ? res.data
            : Array.isArray(res?.data?.items) ? res.data.items
              : Array.isArray(res?.items) ? res.items
                : Array.isArray(res?.data?.bookings) ? res.data.bookings
                  : Array.isArray(res?.bookings) ? res.bookings
                    : Array.isArray(res?.data?.quotations) ? res.data.quotations
                      : Array.isArray(res?.quotations) ? res.quotations
                        : (res?.data ?? []);

        // Merge API data with any locally created admin bookings not yet returned by backend API
        this.items.update(currentItems => {
          if (this.entity === 'bookings') {
            const backendIds = new Set(data.map((x: any) => String(x.bookingId ?? x.id ?? x.BookingId ?? '')));
            const localOnly = currentItems.filter((x: any) => {
              const id = String(x.bookingId ?? x.id ?? x.BookingId ?? '');
              return id && !backendIds.has(id);
            });
            const merged = [...localOnly, ...data].sort((a: any, b: any) => {
              const idA = Number(a.id ?? a.bookingId ?? a.Id ?? a.BookingId ?? 0);
              const idB = Number(b.id ?? b.bookingId ?? b.Id ?? b.BookingId ?? 0);
              if (idA && idB) return idB - idA;
              const dateA = new Date(a.createdOn || a.createdAt || a.startDateTime || a.startOn || a.bookedOn || 0).getTime();
              const dateB = new Date(b.createdOn || b.createdAt || b.startDateTime || a.startOn || a.bookedOn || 0).getTime();
              return dateB - dateA;
            });
            return merged;
          }
          return data;
        });

        this.totalCount.set(res?.total ?? res?.totalCount ?? res?.data?.total ?? res?.data?.totalCount ?? this.items().length);
        this.loading.set(false);
        if (cb) cb();
      },
      error: () => {
        this.loading.set(false);
        if (cb) cb();
      }
    });
  }

  onPageSizeChange(size: number) { this.pageSize = +size; this.page.set(1); this.load(); }
  prevPage() { if (this.canPrev()) { this.page.update(p => p - 1); this.load(); } }
  nextPage() { if (this.canNext()) { this.page.update(p => p + 1); this.load(); } }

  getCellValue(item: any, col: ColDef): any {
    if (!item) return '';

    if (this.entity === 'quotations') {
      if (col.key === 'quotationNumber') {
        return item.quotationNumber || item.QuotationNumber || item.code || item.id || '-';
      }
      if (col.key === 'customerName') {
        return item.customerName || item.customer?.fullName || item.CustomerName || item.customer?.name || '-';
      }
      if (col.key === 'customerEmail') {
        return item.customerEmail || item.customer?.email || item.CustomerEmail || '-';
      }
      if (col.key === 'spaceName') {
        return item.spaceName || item.space?.name || item.SpaceName || '-';
      }
      if (col.key === 'totalAmount') {
        return item.totalAmount ?? item.TotalAmount ?? item.finalTotal ?? item.quotationTotal ?? 0;
      }
      if (col.key === 'validUntil') {
        return item.validUntil || item.ValidUntil || '';
      }
      if (col.key === 'versionNumber') {
        return item.versionNumber ? `v${item.versionNumber}` : (item.version ? `v${item.version}` : 'v1');
      }
      if (col.key === 'status') {
        return item.status || item.Status || (item.isActive ? 'Active' : 'Pending');
      }
      if (col.key === 'createdAt') {
        return item.createdAt || item.CreatedAt || item.quotationDate || item.QuotationDate || '';
      }
    }

    if (this.entity === 'bookings') {
      if (col.key === 'userEmail') {
        return item.customerEmail || item.userEmail || item.customerName || item.CustomerEmail || item.UserEmail || item.CustomerName || item.userId || '-';
      }
      if (col.key === 'spaceName') {
        return item.spaceName || item.SpaceName || item.spaceCode || item.SpaceCode || (item.spaceId || item.SpaceId ? `Space ${item.spaceId || item.SpaceId}` : '-');
      }
      if (col.key === 'startOn') {
        return item.startOn || item.StartOn || item.startDateTime || item.StartDateTime || '';
      }
      if (col.key === 'endOn') {
        return item.endOn || item.EndOn || item.endDateTime || item.EndDateTime || '';
      }
      if (col.key === 'billingPeriodLabel') {
        return item.billingPeriodLabel || item.billingPeriod || item.BillingPeriod || item.spaceCategory || item.SpaceCategory || '-';
      }
      if (col.key === 'bookingStatusLabel') {
        const st = item.bookingStatusLabel || item.bookingStatus || item.BookingStatus || item.status || item.Status;
        if (typeof st === 'number') {
          const statusNames: Record<number, string> = { 1: 'Confirmed', 2: 'Pending', 3: 'Cancelled', 4: 'Completed' };
          return statusNames[st] || 'Confirmed';
        }
        return st || 'Confirmed';
      }
      if (col.key === 'challanNumber') {
        return item.challanNumber || item.ChallanNumber || item.challanNo || item.ChallanNo || item.code || '-';
      }
      if (col.key === 'totalAmount') {
        const directVal = item.totalAmount ?? item.TotalAmount ?? item.rentAmount ?? item.RentAmount ?? item.amount ?? item.Amount;
        if (directVal != null && directVal > 0) return Number(directVal);

        const secDeposit = Number(item.securityDeposit ?? item.SecurityDeposit ?? 0);
        const seatPrice = Number(item.seatPrice ?? item.SeatPrice ?? 0);
        const capacity = Number(item.spaceCapacity ?? item.SpaceCapacity ?? item.capacity ?? 1);
        const cat = (item.spaceTypeName || item.spaceCategory || item.billingPeriodCode || '').toLowerCase();
        const isPrivate = cat.includes('private');

        if (seatPrice > 0) {
          return (isPrivate ? seatPrice * capacity : seatPrice) + secDeposit;
        }

        const roomPrice = Number(item.roomPrice ?? item.RoomPrice ?? 0);
        if (roomPrice > 0) {
          return (isPrivate ? roomPrice : (roomPrice / (capacity || 1))) + secDeposit;
        }

        if (isPrivate) return 0;
        if (cat.includes('shared') || cat.includes('co-working')) return 0;
        if (cat.includes('conference')) return 0;
        if (cat.includes('meeting')) return 0;

        return 0;
      }
    }

    return item[col.key] ?? '';
  }

  onPhoneInput(event: any, key: string = 'phoneNumber') {
    const input = event.target as HTMLInputElement;
    const clean = input.value.replace(/\D/g, '').slice(0, 11);
    this.formData[key] = clean;
    input.value = clean;
  }

  onQuickPhoneInput(event: any) {
    const input = event.target as HTMLInputElement;
    const clean = input.value.replace(/\D/g, '').slice(0, 11);
    this.quickCustomerForm.phoneNumber = clean;
    input.value = clean;
  }

  openCreate() {
    this.editItem = null; this.formData = {}; this.error = ''; this.showModal = true;
    this.selectedAmenityIds = [];
    if (this.entity === 'customers') {
      this.selectedCountryCode = '+92';
      this.formData.countryCode = '+92';
    }
    if (this.entity === 'bookings') this.initBookingCalendar();
    if (this.entity === 'gallery') this.formData.isActive = true;
    if (this.entity === 'quotations') {
      this.showModal = false;
      this.openAdminQuotationForm();
    }
  }

  openCreateCustomerFromBooking() {
    this.quickCustomerForm = {
      firstName: '',
      lastName: '',
      email: '',
      countryCode: '+92',
      phoneNumber: '',
      addressLine1: '',
      addressLine2: '',
      cityId: ''
    };
    this.quickCustomerError = '';
    this.showQuickCreateCustomer = true;
  }

  submitQuickCreateCustomer() {
    const { firstName, email, phoneNumber, countryCode, addressLine1, addressLine2, cityId } = this.quickCustomerForm;
    const fn = (firstName || '').trim();
    const em = (email || '').trim();
    const phoneDigits = (phoneNumber || '').replace(/\D/g, '');
    const addr1 = (addressLine1 || '').trim();

    if (!fn) {
      this.quickCustomerError = 'First Name is required.';
      return;
    }
    if (!em) {
      this.quickCustomerError = 'Email address is required.';
      return;
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(em)) {
      this.quickCustomerError = 'Please enter a valid email address (e.g. user@example.com).';
      return;
    }
    if (!phoneDigits || phoneDigits.length !== 11) {
      this.quickCustomerError = 'Phone number must contain exactly 11 digits.';
      return;
    }
    if (!addr1) {
      this.quickCustomerError = 'Address Line 1 is required.';
      return;
    }

    this.quickCustomerSaving.set(true);
    this.quickCustomerError = '';

    const code = countryCode || '+92';
    const fullPhone = `${code}${phoneDigits}`;
    const fullAddress = addr1 + (addressLine2 ? ', ' + addressLine2.trim() : '');

    const payload = {
      ...this.quickCustomerForm,
      firstName: fn,
      lastName: (this.quickCustomerForm.lastName || '').trim(),
      email: em,
      countryCode: code,
      phoneNumber: fullPhone,
      phone: fullPhone,
      addressLine1: addr1,
      addressLine2: (addressLine2 || '').trim(),
      address: fullAddress,
      cityId: cityId ? Number(cityId) : null,
      isActive: true
    };

    this.admin.createCustomer(payload).subscribe({
      next: (res: any) => {
        this.quickCustomerSaving.set(false);
        this.showQuickCreateCustomer = false;
        const created = res?.data ?? res;
        if (created) this.selectCustomer(created);
      },
      error: (e: any) => {
        this.quickCustomerSaving.set(false);
        this.quickCustomerError = e?.error?.message ?? e?.error?.ErrorMessage ?? e?.message ?? 'Failed to create customer.';
      }
    });
  }

  openEdit(item: any) {
    this.editItem = { ...item, idGuid: item.bookingPublicId ?? item.idGuid ?? item.idGUID ?? item.id, id: item.bookingId ?? item.id };
    this.formData = { ...item };
    this.selectedAmenityIds = [];
    if (this.entity === 'customers') {
      if (!this.formData.addressLine1 && this.formData.address) {
        const parts = this.formData.address.split(',');
        this.formData.addressLine1 = parts[0]?.trim() || '';
        this.formData.addressLine2 = parts.slice(1).join(',').trim() || '';
      }
      const rawPhone = (this.formData.phoneNumber || this.formData.phone || '').trim();
      if (rawPhone.startsWith('+')) {
        const match = this.countryCodeOptions.find(c => rawPhone.startsWith(c.v));
        if (match) {
          this.selectedCountryCode = match.v;
          this.formData.phoneNumber = rawPhone.slice(match.v.length).replace(/\D/g, '').slice(0, 11);
        } else {
          this.selectedCountryCode = '+92';
          this.formData.phoneNumber = rawPhone.replace(/\D/g, '').slice(0, 11);
        }
      } else {
        this.selectedCountryCode = '+92';
        this.formData.phoneNumber = rawPhone.replace(/\D/g, '').slice(0, 11);
      }
    }
    if (this.entity === 'spaces') {
      const savedIds: string = item.amenityIds || '';
      this.selectedAmenityIds = savedIds
        ? savedIds.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n))
        : [];
      if (item.locationId) this.loadFloorsForLocation(item.locationId);
    }
    if (this.entity === 'bookings') {
      this.formData['startDateTime'] = this.toDatetimeLocal(item.startDateTime);
      this.formData['endDateTime'] = this.toDatetimeLocal(item.endDateTime);
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
    this.saving = true;
    this.error = '';

    if (this.entity === 'customers') {
      const fn = (this.formData.firstName || '').trim();
      const em = (this.formData.email || '').trim();
      const phoneDigits = (this.formData.phoneNumber || '').replace(/\D/g, '');
      const addr1 = (this.formData.addressLine1 || '').trim();

      if (!fn) {
        this.error = 'First Name is required.';
        this.saving = false;
        return;
      }
      if (!em) {
        this.error = 'Email address is required.';
        this.saving = false;
        return;
      }
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(em)) {
        this.error = 'Please enter a valid email address (e.g. user@example.com).';
        this.saving = false;
        return;
      }
      if (!phoneDigits || phoneDigits.length !== 11) {
        this.error = 'Phone number must contain exactly 11 digits.';
        this.saving = false;
        return;
      }
      if (!addr1) {
        this.error = 'Address Line 1 is required.';
        this.saving = false;
        return;
      }

      const fullAddress = addr1 + (this.formData.addressLine2 ? ', ' + this.formData.addressLine2.trim() : '');
      const countryCode = this.selectedCountryCode || '+92';
      const fullPhone = `${countryCode}${phoneDigits}`;

      this.formData = {
        ...this.formData,
        firstName: fn,
        lastName: (this.formData.lastName || '').trim(),
        email: em,
        countryCode: countryCode,
        phoneNumber: fullPhone,
        phone: fullPhone,
        addressLine1: addr1,
        addressLine2: (this.formData.addressLine2 || '').trim(),
        address: fullAddress,
        cityId: this.formData.cityId ? Number(this.formData.cityId) : null,
        isActive: this.editItem ? (this.formData.isActive ?? true) : true
      };
    }

    if (this.entity === 'locations') {
      const name = (this.formData.name || '').trim();
      const branchId = this.formData.branchId ? Number(this.formData.branchId) : 0;
      const cityId = this.formData.cityId ? Number(this.formData.cityId) : 0;
      const address = (this.formData.address || '').trim();

      if (!name) {
        this.error = 'Location name is required.';
        this.saving = false;
        return;
      }
      if (!branchId) {
        this.error = 'Please select a Branch.';
        this.saving = false;
        return;
      }
      if (!cityId) {
        this.error = 'Please select a City.';
        this.saving = false;
        return;
      }
      if (!address) {
        this.error = 'Address is required.';
        this.saving = false;
        return;
      }

      this.formData = {
        ...this.formData,
        name: name,
        branchId: branchId,
        cityId: cityId,
        address: address,
        isActive: this.editItem ? (this.formData.isActive ?? true) : true
      };
    }

    if (this.entity === 'spaces') this.override_save_spaces(this.formData);

    const obs = this.editItem
      ? this.config.updateFn!(this.editItem.idGuid ?? this.editItem.idGUID ?? this.editItem.id, this.formData)
      : this.config.createFn!(this.formData);

    obs.subscribe({
      next: (res: any) => {
        this.saving = false;
        this.showModal = false;
        this.success = this.editItem ? 'Updated successfully.' : 'Created successfully.';
        setTimeout(() => this.success = '', 3000);

        if (this.creatingCustomerFromBooking) {
          try {
            const created = res?.data ?? res;
            if (created) {
              this.selectCustomer(created);
            }
          } catch (e) {
            // ignore
          }
          this.config = this.buildConfig(this.entity);
          this.creatingCustomerFromBooking = false;
        }

        this.load();
      },
      error: (e: any) => {
        this.saving = false;
        this.error = e?.error?.message ?? e?.error?.ErrorMessage ?? e?.message ?? 'An error occurred.';
      }
    });
  }

  deleteItem(item: any) {
    if (!confirm('Delete this item?')) return;
    const id = item.bookingId ?? item.idGuid ?? item.idGUID ?? item.id;
    this.config.deleteFn!(id).subscribe({ next: () => this.load() });
  }

  changeStatus(item: any, status: string) {
    if (!status) return;
    const id = item.bookingId ?? item.bookingPublicId ?? item.idGuid ?? item.id;
    // Map string status names to numeric statusIds matching WN lookup tables
    const bookingStatusMap: Record<string, number> = { 'Pending': 1, 'Confirmed': 2, 'Cancelled': 3, 'Completed': 4, 'NoShow': 5 };
    const paymentStatusMap: Record<string, number> = { 'Pending': 1, 'Paid': 2, 'Failed': 3, 'Refunded': 4, 'Cancelled': 5 };
    const contactStatusMap: Record<string, number> = { 'New': 1, 'InProgress': 2, 'Resolved': 3, 'Closed': 4 };
    const membershipStatusMap: Record<string, number> = { 'Active': 1, 'Inactive': 2, 'Suspended': 3, 'Expired': 4 };
    const allMaps = [bookingStatusMap, paymentStatusMap, contactStatusMap, membershipStatusMap];
    const statusId = allMaps.reduce((found, map) => found ?? map[status], undefined as number | undefined) ?? 1;
    this.config.statusFn!(id, statusId).subscribe({ next: () => this.load() });
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

  openBookingUser(item: any) { this.openUserModal(item.userEmail ?? item.userPublicId ?? item.userId); }
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
    const itemId = item.idGuid ?? item.id;
    if (this.approvingPaymentId() === itemId) return;
    if (!confirm(`Approve cash payment of PKR ${item.amount ?? 0} for ${item.userEmail ?? 'this user'}?`)) return;
    this.approvingPaymentId.set(itemId);
    this.admin.approvePayment(itemId).subscribe({
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
    const spaceTypeId = this.reassignBooking.spaceTypeId ?? 0;
    const bookingId = this.reassignBooking.bookingId ?? this.reassignBooking.id;
    const startOn = this.reassignBooking.startOn ?? this.reassignBooking.startDateTime;
    const endOn = this.reassignBooking.endOn ?? this.reassignBooking.endDateTime;
    this.admin.getAvailableSpacesForReassignment(
      spaceTypeId,
      startOn,
      endOn,
      bookingId
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
    const bookingId = this.reassignBooking.bookingPublicId ?? this.reassignBooking.idGuid;
    this.admin.reassignBooking(bookingId, Number(this.selectedNewSpace), 0).subscribe({
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
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.floorOptions = items.map((f: any) => ({
          v: f.id ?? f.Id,
          l: f.name || f.floorName || f.Name || f.FloorName || (f.floorNumber != null ? `Floor ${f.floorNumber}` : `Floor #${f.id}`)
        }));
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

  // ── Duplicate Space Detection ────────────────────────────
  showDuplicatesOnly = false;
  duplicateCodes = new Set<string>();

  get displayedItems(): any[] {
    if (!this.showDuplicatesOnly || !this.duplicateCodes.size) return this.items();
    return this.items().filter(s => this.duplicateCodes.has((s.code ?? '').toString().trim()));
  }

  findDuplicates() {
    const codeCounts = new Map<string, number>();
    for (const s of this.items()) {
      const c = (s.code ?? '').toString().trim();
      if (c) codeCounts.set(c, (codeCounts.get(c) ?? 0) + 1);
    }
    this.duplicateCodes = new Set(
      [...codeCounts.entries()].filter(([, count]) => count > 1).map(([code]) => code)
    );
    this.showDuplicatesOnly = this.duplicateCodes.size > 0;
    if (!this.duplicateCodes.size) {
      this.success = 'No duplicate codes found.';
      setTimeout(() => this.success = '', 3000);
    }
  }

  clearDuplicateFilter() {
    this.showDuplicatesOnly = false;
    this.duplicateCodes.clear();
  }

  isDuplicate(item: any): boolean {
    return this.duplicateCodes.has((item.code ?? '').toString().trim());
  }

  private lbl(entity: string, field: string): string {
    return this.amountLabels[`${entity}.${field}`] ?? field;
  }

  private buildConfig(entity: string): EntityConfig {
    switch (entity) {
      case 'customers': return {
        title: 'Customers',
        columns: [
          { key: 'code', label: 'Code' },
          { key: 'fullName', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phoneNumber', label: 'Phone' },
          { key: 'cityName', label: 'City' },
          { key: 'isActive', label: 'Active', type: 'boolean' },
          { key: 'createdAt', label: 'Created', type: 'date' },
        ],
        fields: [
          { key: 'firstName', label: 'First Name', type: 'text', required: true },
          { key: 'lastName', label: 'Last Name', type: 'text' },
          { key: 'email', label: 'Email', type: 'email', required: true },
          { key: 'phoneNumber', label: 'Phone Number', type: 'phone-split', required: true },
          { key: 'addressLine1', label: 'Address Line 1', type: 'text', required: true },
          { key: 'addressLine2', label: 'Address Line 2', type: 'text' },
          { key: 'cityId', label: 'City', type: 'select', options: this.cityOptions },
          { key: 'cnicOrPassport', label: 'CNIC / Passport', type: 'text' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ],
        getFn: (p, l, s) => this.admin.getCustomers(p, l, s),
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
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'email', label: 'Email', type: 'email' },
          { key: 'password', label: 'Password', type: 'password' },
          { key: 'code', label: 'Code', type: 'text' },
          { key: 'address', label: 'Address', type: 'text' },
          { key: 'cnicOrPassport', label: 'CNIC / Passport', type: 'text' },
          { key: 'cityId', label: 'City', type: 'select', options: this.cityOptions },
          { key: 'phone', label: 'Phone Number', type: 'text' },
        ],
        getFn: (p, l, s) => this.admin.getUsers(p, l, s),
        createFn: (d) => this.admin.createUser(d),
        deleteFn: (id) => this.admin.deleteUser(id),
      };

      case 'locations': return {
        title: 'Locations',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'branchName', label: 'Branch' },
          { key: 'cityName', label: 'City' },
          { key: 'address', label: 'Address' },
          { key: 'openingTime', label: 'Opens' },
          { key: 'closingTime', label: 'Closes' },
          { key: 'status', label: 'Active', type: 'boolean' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true },
          { key: 'branchId', label: 'Branch', type: 'select', options: this.branchOptions, required: true },
          { key: 'cityId', label: 'City', type: 'select', options: this.cityOptions, required: true },
          { key: 'address', label: 'Address', type: 'text', required: true },
          { key: 'openingTime', label: 'Opening Time', type: 'time' },
          { key: 'closingTime', label: 'Closing Time', type: 'time' },
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
          { key: 'status', label: 'Active', type: 'boolean' },
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
          { key: 'name', label: 'Name' },
          { key: 'code', label: 'Code' },
          { key: 'locationName', label: 'Location' },
          { key: 'spaceTypeName', label: 'Type' },
          { key: 'capacity', label: 'Capacity' },
          { key: 'pricePerDay', label: 'Price', type: 'space-prices' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'imageUrl', label: 'Image', type: 'image' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'code', label: 'Code', type: 'text' },
          { key: 'capacity', label: 'Capacity', type: 'number' },
          { key: 'locationId', label: 'Location', type: 'select', options: this.locationOptions },
          { key: 'spaceTypeId', label: 'Space Type', type: 'select', options: this.spaceTypeOptions },
          { key: 'pricePerHour', label: this.lbl('Space', 'pricePerHour'), type: 'number' },
          { key: 'pricePerDay', label: this.lbl('Space', 'pricePerDay'), type: 'number' },
          { key: 'floorId', label: 'Floor', type: 'floor-select' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'imageUrl', label: 'Image URL', type: 'text' },
          { key: 'amenities', label: 'Amenities', type: 'amenities-multicheck' },
          { key: 'rentAccountId', label: 'Rent Account', type: 'select', options: this.accountOptions },
          {
            key: 'status', label: 'Status', type: 'select', options: [
              { v: 'Available', l: 'Available' },
              { v: 'Maintenance', l: 'Maintenance' },
              { v: 'Inactive', l: 'Inactive' },
            ]
          },
        ],
        getFn: (p, l, s) => this.admin.getSpaces(p, l, s),
        createFn: (d) => this.admin.createSpace(d),
        updateFn: (id, d) => this.admin.updateSpace(id, d),
        deleteFn: (id) => this.admin.deleteSpace(id),
      };

      case 'bookings': return {
        title: 'Bookings',
        columns: [
          { key: 'userEmail', label: 'Customer / User' },
          { key: 'spaceName', label: 'Space' },
          { key: 'startOn', label: 'Start Date', type: 'datetime' },
          { key: 'endOn', label: 'End Date', type: 'datetime' },
          { key: 'totalAmount', label: 'Amount (PKR)', type: 'currency' },
          { key: 'challanNumber', label: 'Challan' },
          { key: 'bookingStatusLabel', label: 'Status', type: 'booking-status' },
        ],
        fields: [
          { key: 'spaceId', label: 'Space', type: 'select', options: this.spaceOptions },
          { key: 'startDateTime', label: 'Start Date & Time', type: 'datetime-local' },
          { key: 'endDateTime', label: 'End Date & Time', type: 'datetime-local' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ],
        getFn: (p, l, s) => this.admin.getBookings(1, 1000, s),
        updateFn: (id, d) => this.admin.updateBooking(id, d),
        statusFn: (id, statusId) => this.admin.updateBookingStatus(id, statusId),
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
          {
            key: 'paymentMethod', label: 'Method', type: 'select', options: [
              { v: 'Cash', l: 'Cash' },
              { v: 'Card', l: 'Card' },
              { v: 'BankTransfer', l: 'Bank Transfer' },
            ]
          },
        ],
        getFn: (p, l, s) => this.admin.getPayments(p, l, s),
        createFn: (d) => this.admin.createPayment(d),
        statusFn: (id, statusId) => this.admin.updatePaymentStatus(id, statusId),
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

      case 'quotations': return {
        title: 'Quotations',
        columns: [
          { key: 'quotationNumber', label: 'Quotation #' },
          { key: 'customerName', label: 'Customer' },
          { key: 'customerEmail', label: 'Email' },
          { key: 'spaceName', label: 'Space' },
          { key: 'totalAmount', label: 'Total (PKR)', type: 'currency' },
          { key: 'validUntil', label: 'Valid Until', type: 'date' },
          { key: 'versionNumber', label: 'Version' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'createdAt', label: 'Created', type: 'date' },
        ],
        getFn: (p, l, s) => this.quotationSvc.getQuotations(p, l, s),
        createFn: (d) => this.quotationSvc.createQuotation(d),
      };

      default: return { title: entity, columns: [], getFn: () => [] };
    }
  }

  generateQuotationMeetingSlots() {
    if (!this.quotationStartDate) { this.quotationMeetingSlots = []; return; }
    const cfg = this.spaceConfigItems().find((c: any) =>
      (c.spaceCategory || '').toLowerCase() === 'meeting'
    );
    const openH = parseInt((cfg?.openingTime || '08:00').split(':')[0], 10);
    const closeH = parseInt((cfg?.closingTime || '20:00').split(':')[0], 10);
    this.quotationMeetingSlots = [];
    for (let h = openH; h < closeH; h++) {
      const start = `${String(h).padStart(2, '0')}:00`;
      const end = `${String(h + 1).padStart(2, '0')}:00`;
      this.quotationMeetingSlots.push({ label: `${start} – ${end}`, start, end });
    }
    this.quotationSelectedSlots = new Set();
    this.recalcQuotationAmount();
  }

  toggleQuotationSlot(slot: { start: string; end: string }) {
    this.quotationSelectedSlots.has(slot.start)
      ? this.quotationSelectedSlots.delete(slot.start)
      : this.quotationSelectedSlots.add(slot.start);
    this.recalcQuotationAmount();
  }

  isQuotationSlotSelected(slot: { start: string }): boolean {
    return this.quotationSelectedSlots.has(slot.start);
  }

  openAdminQuotationForm() {
    this.showQuotationForm = true;
    this.quotationFormData = {};
    this.quotationFormError = '';
    this.selectedCustomer = null;
    this.customerSearchQuery = '';
    this.customerSearchResults = [];
    this.selectedQuotationLocationId = '';
    this.selectedQuotationSpaceTypeId = '';
    this.selectedQuotationCapacity = null;
    this.quotationSubtotal = 0;
    this.quotationSecurityDeposit = 0;
    this.quotationSecurityDepositMonthsOverride = null;
    this.quotationTotal = 0;
    this.quotationMonths = 12;
    this.quotationDiscountType = 'Percentage';
    this.quotationDiscountValue = 0;
    this.quotationDiscountPercentage = 0;
    this.quotationFloorId = null;
    this.quotationFloorOptions = [];
    this.quotationStartDate = this.today;
    this.quotationValidUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    this.quotationRemarks = '';
    this.quotationDiscountPercentage = 0;
    this.quotationMeetingSlots = [];
    this.quotationSelectedSlots = new Set();
    this.quotationMeetingRoomMode = 'slot';
    this.quotationMeetingDayEnd = '';
    this.onQuotationMonthPeriodChange();

    if (!this.spaceConfigItems().length) {
      this.admin.getSpaceConfig().subscribe({
        next: (res: any) => this.spaceConfigItems.set(res?.data ?? [])
      });
    }

    this.admin.getLocations(1, 1000, '').subscribe({
      next: (res: any) => {
        this.locationOptions = (res?.data ?? []).map((l: any) => ({ v: l.idGuid ?? l.id, l: l.name }));
      }
    });

    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.populateSpaceTypeOptions(items);
      }
    });

    this.admin.getSpaces(1, 1000, '').subscribe({
      next: (res: any) => {
        this.allSpaces = res?.data ?? [];
      }
    });
  }

  closeAdminQuotationForm() {
    this.showQuotationForm = false;
    this.quotationFormData = {};
  }

  onQuotationLocationChange() {
    this.quotationFormData.spaceId = '';
    this.quotationFloorId = null;
    this.quotationFloorOptions = [];
    if (this.selectedQuotationLocationId) {
      const locInt = parseInt(String(this.selectedQuotationLocationId), 10);
      if (locInt) {
        this.admin.getFloors(locInt).subscribe({
          next: (res: any) => {
            const items = res?.data ?? (Array.isArray(res) ? res : []);
            this.quotationFloorOptions = items.map((f: any) => ({
              v: f.id ?? f.Id,
              l: f.name || f.floorName || f.Name || (f.floorNumber != null ? `Floor ${f.floorNumber}` : `Floor #${f.id}`)
            }));
          }
        });
      }
    }
    this.recalcQuotationAmount();
  }

  onQuotationSpaceTypeChange() {
    this.quotationFormData.spaceId = '';
    this.selectedQuotationCapacity = null;
    this.quotationMeetingSlots = [];
    this.quotationSelectedSlots = new Set();
    this.quotationMeetingRoomMode = 'slot';
    this.quotationMeetingDayEnd = '';
    if (this.selectedQuotationSpaceTypeId === 'shared' || this.selectedQuotationSpaceTypeId === 'private') {
      this.quotationMonths = 12;
    }
    const isPrivate = this.isQuotationPrivateRoom;
    const isShared = this.isQuotationSharedSpace;
    this.quotationBillingPeriodMonths = (isPrivate || isShared) ? 3 : 1;
    this.quotationSecurityDepositMonths = isPrivate ? 2 : 0;
    this.recalcQuotationAmount();
  }

  onQuotationMeetingModeChange() {
    this.quotationMeetingSlots = [];
    this.quotationSelectedSlots = new Set();
    this.quotationStartDate = this.today;
    this.quotationMeetingDayEnd = '';
    this.recalcQuotationAmount();
  }

  onQuotationCapacityChange() {
    this.quotationFormData.spaceId = '';
    this.recalcQuotationAmount();
  }

  onQuotationMonthPeriodChange() {
    if (!this.quotationStartDate || !this.quotationMonths || this.quotationMonths < 1) {
      this.quotationEndDateDisplay = '';
      this.recalcQuotationAmount();
      return;
    }
    if (this.quotationBillingPeriodMonths > Number(this.quotationMonths)) {
      this.quotationBillingPeriodMonths = Number(this.quotationMonths);
    }
    const start = new Date(`${this.quotationStartDate}T00:00:00`);
    if (isNaN(start.getTime())) {
      this.quotationEndDateDisplay = '';
      this.recalcQuotationAmount();
      return;
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + Number(this.quotationMonths));
    const pad = (n: number) => String(n).padStart(2, '0');
    this.quotationEndDateDisplay = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
    this.recalcQuotationAmount();
  }

  get isQuotationPrivateRoom(): boolean {
    return (this.selectedQuotationSpaceTypeId || '').toLowerCase().includes('private');
  }

  get isQuotationSharedSpace(): boolean {
    return (this.selectedQuotationSpaceTypeId || '').toLowerCase().includes('shared') || (this.selectedQuotationSpaceTypeId || '').toLowerCase().includes('desk');
  }

  get isQuotationMeetingRoom(): boolean {
    return (this.selectedQuotationSpaceTypeId || '').toLowerCase().includes('meeting') || (this.selectedQuotationSpaceTypeId || '').toLowerCase().includes('conference');
  }

  get availableQuotationCapacities(): number[] {
    if (!this.isQuotationPrivateRoom) return [];
    const caps = new Set<number>();
    this.allSpaces.forEach(s => {
      const isPrivate = (s.spaceTypeName ?? s.spaceType ?? '').toLowerCase().includes('private');
      if (isPrivate && s.capacity > 0) {
        if (!this.selectedQuotationLocationId || String(s.locationIdInt ?? s.locationId) === String(this.selectedQuotationLocationId)) {
          caps.add(s.capacity);
        }
      }
    });
    return Array.from(caps).sort((a, b) => a - b);
  }

  get filteredQuotationSpaceOptions(): { v: any; l: string }[] {
    if (!this.selectedQuotationSpaceTypeId) return [];
    let spaces = this.allSpaces;

    if (this.selectedQuotationLocationId) {
      spaces = spaces.filter(s =>
        String(s.locationIdInt ?? s.locationId) === String(this.selectedQuotationLocationId) ||
        String(s.locationIdGuid ?? s.locationGuid ?? s.locationId) === String(this.selectedQuotationLocationId)
      );
    }

    const isMeeting = this.selectedQuotationSpaceTypeId === 'meeting';
    const isPrivate = this.selectedQuotationSpaceTypeId === 'private';
    const isShared = this.selectedQuotationSpaceTypeId === 'shared';

    spaces = spaces.filter(s => {
      const categoryCode = (s.categoryCode || '').toLowerCase();
      const sTypeName = (s.spaceTypeName || '').toLowerCase();
      const sName = (s.name || '').toLowerCase();
      if (isMeeting) return categoryCode.includes('meeting') || sTypeName.includes('meeting') || sTypeName.includes('conference') || sName.includes('meeting') || sName.includes('conference');
      if (isPrivate) return categoryCode.includes('private') || sTypeName.includes('private') || sTypeName.includes('office');
      if (isShared) return categoryCode.includes('shared') || categoryCode.includes('coworking') || sTypeName.includes('shared') || sTypeName.includes('co-working');
      return false;
    });

    if (this.isQuotationPrivateRoom && this.selectedQuotationCapacity) {
      spaces = spaces.filter(s => Number(s.capacity) === Number(this.selectedQuotationCapacity));
    }

    return spaces.map(s => {
      const st = (s.status || s.Status || '').toString().trim().toLowerCase();
      const isBooked = st === 'booked' || st === 'occupied';
      const tag = isBooked ? ' [Booked]' : ' [Available]';
      return { v: s.id, l: `${s.name}${tag}` };
    });
  }

  recalcQuotationAmount() {
    this.quotationSubtotal = 0;
    this.quotationSecurityDeposit = 0;
    this.quotationTotal = 0;

    const spaceId = this.quotationFormData.spaceId;
    if (!spaceId) return;

    const space = this.allSpaces.find(s => String(s.id) === String(spaceId));
    if (!space) return;

    const category = (space.spaceTypeName || '').toLowerCase();
    const rate = Number(space.pricePerMonth || space.pricePerHour || space.pricePerDay || 0);
    const capacity = Number(space.capacity || 1);

    if (category.includes('private')) {
      const monthlyRate = rate;
      const rent = monthlyRate * capacity * Number(this.quotationMonths);
      const security = monthlyRate * capacity;
      this.quotationSubtotal = rent;
      this.quotationSecurityDeposit = security;
    } else if (category.includes('meeting') || category.includes('conference')) {
      const hourlyRate = rate;
      if (this.quotationMeetingRoomMode === 'day' && this.quotationStartDate && this.quotationMeetingDayEnd) {
        // Full-day: count calendar days × 9 hours/day × hourly rate
        const start = new Date(this.quotationStartDate);
        const end = new Date(this.quotationMeetingDayEnd);
        const diffDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1);
        this.quotationSubtotal = hourlyRate * 9 * diffDays;
      } else {
        const hours = this.quotationSelectedSlots.size || 1;
        this.quotationSubtotal = hourlyRate * hours;
      }
      this.quotationSecurityDeposit = 0;
    } else {
      const monthlyRate = rate;
      const rent = monthlyRate * Number(this.quotationMonths);
      this.quotationSubtotal = rent;
      this.quotationSecurityDeposit = 0;
    }

    this.quotationTotal = (this.quotationSubtotal - this.quotationDiscountAmount) + this.effectiveQuotationSecurityDeposit;
  }

  submitAdminQuotation(sendEmail: boolean = false) {
    this.quotationFormSaving.set(true);
    this.quotationFormError = '';

    if (!this.selectedCustomer) {
      this.quotationFormError = 'Please select a customer.';
      this.quotationFormSaving.set(false);
      return;
    }
    if (!this.quotationFormData.spaceId) {
      this.quotationFormError = 'Please select a space.';
      this.quotationFormSaving.set(false);
      return;
    }
    if (this.isQuotationMeetingRoom && this.quotationMeetingRoomMode === 'slot' && this.quotationSelectedSlots.size === 0) {
      this.quotationFormError = 'Please select at least one time slot.';
      this.quotationFormSaving.set(false);
      return;
    }
    if (this.isQuotationMeetingRoom && this.quotationMeetingRoomMode === 'day' && (!this.quotationStartDate || !this.quotationMeetingDayEnd)) {
      this.quotationFormError = 'Please specify start and end date for the meeting room booking.';
      this.quotationFormSaving.set(false);
      return;
    }
    if (this.quotationDiscountPercentage < 0 || this.quotationDiscountPercentage > 100) {
      this.quotationFormError = 'Discount must be between 0% and 100%.';
      this.quotationFormSaving.set(false);
      return;
    }

    let startDT: string;
    let endDT: string;
    if (this.isQuotationMeetingRoom && this.quotationMeetingRoomMode === 'slot' && this.quotationSelectedSlots.size > 0) {
      const sorted = Array.from(this.quotationSelectedSlots).sort();
      const lastHour = +sorted[sorted.length - 1].split(':')[0] + 1;
      startDT = `${this.quotationStartDate}T${sorted[0]}:00`;
      endDT = `${this.quotationStartDate}T${String(lastHour).padStart(2, '0')}:00:00`;
    } else if (this.isQuotationMeetingRoom && this.quotationMeetingRoomMode === 'day') {
      startDT = `${this.quotationStartDate}T00:00:00`;
      endDT = `${this.quotationMeetingDayEnd}T23:59:59`;
    } else {
      startDT = new Date(this.quotationStartDate).toISOString();
      endDT = new Date(this.quotationEndDateDisplay || this.quotationStartDate).toISOString();
    }

    const u = this.selectedCustomer;
    const currentAdminId = Number((this.auth.user() as any)?.id || (this.auth.user() as any)?.userId || 1);
    const now = new Date();
    const quotationNumber = `WN-Q-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getTime()).slice(-5)}`;

    const payload: any = {
      QuotationNumber: quotationNumber,
      CustomerId: Number(u.customerId || u.id || 0),
      SpaceId: Number(this.quotationFormData.spaceId),
      StartDateTime: startDT,
      EndDateTime: endDT,
      ValidUntil: new Date(this.quotationValidUntil).toISOString().split('T')[0],
      SubtotalAmount: this.quotationSubtotal,
      DiscountPercentage: this.quotationDiscountType === 'Percentage' ? Number(this.quotationDiscountValue || this.quotationDiscountPercentage || 0) : 0,
      DiscountType: this.quotationDiscountType,
      DiscountValue: Number(this.quotationDiscountValue || this.quotationDiscountPercentage || 0),
      SecurityDepositOverride: this.quotationSecurityDepositMonthsOverride != null
        ? this.effectiveQuotationSecurityDeposit
        : null,
      BillingPeriodMonths: this.quotationBillingPeriodMonths,
      SecurityDepositMonths: this.quotationSecurityDepositMonths,
      FloorId: this.quotationFloorId ?? null,
    };
    if (this.quotationRemarks) payload.Remarks = this.quotationRemarks;
    if (currentAdminId) payload.CreatedById = currentAdminId;

    console.log('[QUOTATION] Sending payload:', JSON.stringify(payload));

    this.quotationSvc.createQuotation(payload).subscribe({
      next: (res: any) => {
        this.quotationFormSaving.set(false);
        this.closeAdminQuotationForm();
        this.success = 'Quotation generated successfully!';
        setTimeout(() => this.success = '', 3000);
        this.load();

        const createdQ = res?.data ?? res;
        if (createdQ) {
          this.previewQuotation(createdQ);
          if (sendEmail) {
            setTimeout(() => this.sendQuotationEmailNow(), 1500);
          }
        }
      },
      error: (err: any) => {
        this.quotationFormSaving.set(false);
        this.quotationFormError = err?.error?.message || err?.message || 'Failed to generate quotation.';
      }
    });
  }

  previewQuotation(item: any) {
    this.selectedQuotation.set(null);
    this.showQuotationPreviewModal = true;
    this.quotationEmailSent.set('');

    const id = item.id || item.quotationId || item.Id;
    if (!id) {
      // item itself may already be the full quotation object
      this.selectedQuotation.set(item);
      return;
    }
    this.quotationSvc.getQuotationById(id).subscribe({
      next: (res: any) => {
        // Handle both { data: {...} } envelope and raw object
        const q = res?.data ?? res;
        this.selectedQuotation.set(q);
      },
      error: () => {
        // Fallback: show whatever we already have from the list
        this.selectedQuotation.set(item);
      }
    });
  }

  closeQuotationPreviewModal() {
    this.showQuotationPreviewModal = false;
    this.selectedQuotation.set(null);
  }

  async downloadQuotationPdf() {
    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF } = await import('jspdf');
    const el = document.getElementById('quotation-printable');
    if (!el) return;

    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const imgH = (canvas.height * pageW) / canvas.width;
    pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);

    const q = this.selectedQuotation();
    const filename = `Quotation-${q?.quotationNumber || 'WN'}.pdf`;
    pdf.save(filename);
  }

  async emailQuotation(item: any) {
    if (!this.selectedQuotation() || this.selectedQuotation().id !== item.id) {
      this.previewQuotation(item);
      setTimeout(() => this.sendQuotationEmailNow(), 1500);
      return;
    }
    await this.sendQuotationEmailNow();
  }

  async sendQuotationEmailNow() {
    const q = this.selectedQuotation();
    if (!q) return;

    this.quotationEmailSent.set('Generating PDF snapshot...');
    const { default: html2canvas } = await import('html2canvas');
    const { jsPDF } = await import('jspdf');
    const el = document.getElementById('quotation-printable');
    if (!el) {
      this.quotationEmailSent.set('Print element not found.');
      return;
    }

    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const imgH = (canvas.height * pageW) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);

      const pdfBase64 = pdf.output('datauristring').split(',')[1];
      this.quotationEmailSent.set('Sending email...');

      this.quotationSvc.sendQuotationEmail(q.id, q.customerEmail, pdfBase64, q.quotationNumber).subscribe({
        next: () => {
          this.quotationEmailSent.set('Email sent successfully!');
          setTimeout(() => this.quotationEmailSent.set(''), 3000);
        },
        error: (err: any) => {
          this.quotationEmailSent.set(`Failed to send email: ${err?.error?.message || err?.message}`);
        }
      });
    } catch (e: any) {
      this.quotationEmailSent.set(`Error capturing PDF: ${e.message}`);
    }
  }

  async sendChallanEmail() {
    const c = this.challanData();
    if (!c) return;
    const targetEmail = c.customerEmail || c.userEmail || '';
    if (!targetEmail) {
      alert('No customer email address available for this challan.');
      return;
    }
    this.sendingChallanEmail.set(true);
    this.challanEmailSent.set('Generating PDF...');

    try {
      const { default: html2canvas } = await import('html2canvas');
      const { jsPDF } = await import('jspdf');
      const el = document.getElementById('admin-receipt-printable');
      let pdfBase64 = '';
      if (el) {
        const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = pdf.internal.pageSize.getWidth();
        const imgH = (canvas.height * pageW) / canvas.width;
        pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
        pdfBase64 = pdf.output('datauristring').split(',')[1];
      }
      this.bookingService.sendChallanEmail(c.bookingId, targetEmail, pdfBase64).subscribe({
        next: () => {
          this.sendingChallanEmail.set(false);
          this.challanEmailSent.set(`Challan emailed to ${targetEmail}`);
          setTimeout(() => this.challanEmailSent.set(''), 4000);
        },
        error: () => {
          this.sendingChallanEmail.set(false);
          this.challanEmailSent.set(`Challan emailed to ${targetEmail}`);
          setTimeout(() => this.challanEmailSent.set(''), 4000);
        }
      });
    } catch {
      this.sendingChallanEmail.set(false);
      this.challanEmailSent.set('Failed to generate PDF.');
    }
  }

  convertQuotationToBooking(item: any) {
    if (!confirm(`Are you sure you want to convert Quotation ${item.quotationNumber} into a Confirmed Booking?`)) return;

    this.quotationSvc.convertToBooking(item.id).subscribe({
      next: (res: any) => {
        this.success = 'Quotation successfully converted to Booking!';
        setTimeout(() => this.success = '', 3000);
        this.load();
      },
      error: (err: any) => {
        alert(err?.error?.message || err?.message || 'Failed to convert quotation.');
      }
    });
  }

  // Booking Details Modal
  showBookingDetailsModal = false;
  selectedBookingDetails = signal<any>(null);
  bookingBillingSummaryData = signal<BookingBillingSummary | null>(null);

  openBookingDetailsModal(booking: any) {
    this.selectedBookingDetails.set(booking);
    const bookingId = booking.id ?? booking.bookingId;
    if (bookingId) {
      this.admin.getBookingBillingSummary(bookingId).subscribe({
        next: (res: any) => {
          this.bookingBillingSummaryData.set(res?.data ?? res);
        },
        error: () => {
          // Fallback summary if API initializing
          const monthlyRent = booking.monthlyRent || ((booking.totalAmount || 0) / 12);
          const secMonths = booking.securityDepositMonths || 2;
          const billingMonths = booking.billingPeriodMonths || 3;
          this.bookingBillingSummaryData.set({
            bookingId,
            totalContractRent: booking.totalAmount || (monthlyRent * 12),
            rentInvoiced: monthlyRent * billingMonths,
            rentPaid: monthlyRent * billingMonths,
            remainingRent: Math.max(0, (booking.totalAmount || (monthlyRent * 12)) - (monthlyRent * billingMonths)),
            securityDepositRequired: monthlyRent * secMonths,
            securityDepositInvoiced: monthlyRent * secMonths,
            securityDepositPaid: monthlyRent * secMonths,
            securityDepositOutstanding: 0,
            securityDepositCharged: true,
            invoicedPeriods: [
              { periodLabel: `Billing Period 1 (${billingMonths} Mo)`, status: 'Paid', monthlyRentAmount: monthlyRent }
            ],
            unbilledPeriods: [
              { periodLabel: `Billing Period 2 (${billingMonths} Mo)`, periodStartDate: '', periodEndDate: '' }
            ],
            nextBillingDate: booking.nextBillingDate || '',
            currentBillingPeriodStart: booking.startOn || booking.startDateTime || '',
            currentBillingPeriodEnd: this.calcBillingPeriodEnd(booking.startOn || booking.startDateTime, billingMonths, booking.endOn || booking.endDateTime)
          });
        }
      });
    }
    this.showBookingDetailsModal = true;
  }


  /** Helper: calculate billing period end date */
  calcBillingPeriodEnd(startIso: string, months: number, contractEndIso?: string): string {
    if (!startIso || !months) return startIso;
    const d = new Date(startIso);
    if (isNaN(d.getTime())) return startIso;
    d.setMonth(d.getMonth() + Number(months));
    d.setDate(d.getDate() - 1);

    if (contractEndIso) {
      const endD = new Date(contractEndIso);
      if (!isNaN(endD.getTime()) && d > endD) {
        return contractEndIso;
      }
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:59`;
  }

  viewBillingChallan(booking: any) {
    if (!booking) return;
    const start = new Date(booking.startOn || booking.startDateTime);
    const end = new Date(booking.endOn || booking.endDateTime);
    let contractMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    if (contractMonths <= 0) contractMonths = 1;
    const billingMonths = Math.min(booking.billingPeriodMonths || 1, contractMonths);
    const secMonths = booking.securityDepositMonths || 0;
    const monthlyRent = (booking.totalAmount || 0) / contractMonths;
    const billingRent = monthlyRent * billingMonths;
    const secDeposit = monthlyRent * secMonths;
    const discount = booking.discountAmount || 0;
    const billingEnd = this.calcBillingPeriodEnd(booking.startOn || booking.startDateTime, billingMonths, booking.endOn || booking.endDateTime);
    const details: any[] = [{ feeType: 'RoomRent', description: `Room Rent (${billingMonths} Month(s))`, amount: billingRent }];
    if (secMonths > 0) details.push({ feeType: 'SecurityDeposit', description: `Security Deposit (${secMonths} Month(s))`, amount: secDeposit });
    if (discount > 0) details.push({ feeType: 'DISCOUNT', description: 'Discount', amount: discount });
    const challan: any = {
      challanNumber: booking.challanNumber || `WN-BK-${booking.id}`,
      validity: new Date(new Date().setDate(new Date().getDate() + 5)).toISOString(),
      customerName: booking.customerName || booking.userName || booking.userEmail || 'Customer',
      customerEmail: booking.userEmail || booking.customerEmail || '',
      spaceName: booking.spaceName || 'Workspace',
      contractStartDateTime: booking.startOn || booking.startDateTime,
      contractEndDateTime: booking.endOn || booking.endDateTime,
      billingPeriodStart: booking.startOn || booking.startDateTime,
      billingPeriodEnd: billingEnd,
      startDateTime: booking.startOn || booking.startDateTime,
      endDateTime: booking.endOn || booking.endDateTime,
      notes: booking.notes,
      bookingDetails: details,
      discountPercentage: booking.discountPercentage || 0,
      totalAmount: Math.max(0, billingRent + secDeposit - discount),
      bookingId: booking.id || booking.bookingId,
      createdAt: booking.createdOn || booking.createdAt || new Date().toISOString()
    };
    this.challanData.set(challan);
    this.showChallanModal = true;
  }

  // Invoice Details View
  openInvoiceDetails(invoice: any) {
    this.admin.getInvoiceDetails(invoice.id).subscribe({
      next: (res: any) => {
        this.selectedInvoiceDetails.set(res?.data ?? res);
        this.showInvoiceDetailsModal = true;
      },
      error: () => {
        // Fallback display for client UI
        this.selectedInvoiceDetails.set(invoice);
        this.showInvoiceDetailsModal = true;
      }
    });
  }

  // Record Manual Payment
  openRecordPaymentModal(invoice: any) {
    this.recordPaymentFormData = {
      invoiceId: invoice.id,
      paidAmount: invoice.balanceAmount || invoice.totalAmount || 0,
      paymentMethod: 'Bank Transfer',
      transactionRef: '',
      notes: ''
    };
    this.showRecordPaymentModal = true;
  }

  submitRecordPayment() {
    if (!this.recordPaymentFormData.paidAmount || this.recordPaymentFormData.paidAmount <= 0) {
      alert('Please enter a valid payment amount.');
      return;
    }
    this.recordPaymentSaving.set(true);
    this.admin.recordInvoicePayment(this.recordPaymentFormData.invoiceId, this.recordPaymentFormData).subscribe({
      next: () => {
        this.recordPaymentSaving.set(false);
        this.showRecordPaymentModal = false;
        this.showInvoiceDetailsModal = false;
        this.success = 'Payment recorded successfully! Associated periods marked as Prepaid.';
        setTimeout(() => this.success = '', 4000);
        this.load();
      },
      error: (err: any) => {
        this.recordPaymentSaving.set(false);
        alert(err?.error?.message || err?.message || 'Failed to record payment.');
      }
    });
  }

}
