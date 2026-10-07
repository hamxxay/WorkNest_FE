import { Component, signal, OnInit, computed, inject, HostListener, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
import { ToastService } from '../../../services/toast.service';
import { AgreementService } from '../../../services/agreement.service';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { localDateIso, localDateTimeIso } from '../../../utils/dates';

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
  billingPeriods: any[] = [];
  entity = '';
  readonly config = signal<EntityConfig>({ title: '', columns: [], getFn: () => of({ data: [], total: 0 }) });

  loading = signal(true);
  items = signal<any[]>([]);
  totalCount = signal(0);

  page = signal(1);
  readonly pageSize = signal(10);
  pageSizeOptions = [10, 25, 50];
  totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize())));
  canPrev = computed(() => this.page() > 1);
  canNext = computed(() => this.page() < this.totalPages());

  searchQuery = '';
  private searchTimer: any;

  onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, 150);
  }

  onSearchImmediate() {
    clearTimeout(this.searchTimer);
    this.page.set(1);
    this.load();
  }

  clearSearch() {
    this.searchQuery = '';
    this.onSearchImmediate();
  }

  get filtered() {
    let list = this.items();
    if (this.entity === 'spaces') return this.displayedItems;
    // Bookings are paged on the server: the list already is the current page.
    if (this.entity === 'bookings') return list;
    if (list.length > this.pageSize()) {
      const start = (this.page() - 1) * this.pageSize();
      return list.slice(start, start + this.pageSize());
    }
    return list;
  }

  readonly showModal = signal(false);
  editItem: any = null;
  formData: any = {};
  readonly saving = signal(false);
  readonly error = signal('');
  readonly success = signal('');

  readonly showUserModal = signal(false);
  selectedUser = signal<any>(null);
  userHistory = signal<any>(null);
  userDetailsLoading = signal(false);
  readonly userDetailsError = signal('');
  readonly userDisplayName = signal('');

  readonly showSpaceModal = signal(false);
  spaceSummary = signal<any>(null);
  spaceSummaryLoading = signal(false);
  readonly spaceSummaryError = signal('');

  readonly showPlanModal = signal(false);
  planSummary = signal<any>(null);
  planSummaryLoading = signal(false);
  readonly planSummaryError = signal('');

  readonly showPaymentModal = signal(false);
  paymentSummary = signal<any>(null);
  paymentSummaryLoading = signal(false);
  readonly paymentSummaryError = signal('');
  approvingPaymentId = signal<any>(null);

  // Invoice Details & Record Payment Modals
  readonly showInvoiceDetailsModal = signal(false);
  selectedInvoiceDetails = signal<any>(null);
  readonly showRecordPaymentModal = signal(false);
  recordPaymentFormData: any = { paidAmount: 0, paymentMethod: 'Bank Transfer', transactionRef: '', notes: '' };
  recordPaymentSaving = signal(false);

  readonly showReassignModal = signal(false);
  reassignBooking: any = null;
  availableSpacesForReassign = signal<any[]>([]);
  reassignLoading = signal(false);
  readonly reassignError = signal('');
  selectedNewSpace = '';

  bookingCalendarLoading = signal(false);
  readonly bookingMonthCells = signal<any[]>([]);
  readonly bookingMonthTitle = signal('');
  private bookingCalendarDate = new Date();
  weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  readonly locationOptions = signal<{ v: any; l: string }[]>([]);
  readonly spaceTypeOptions = signal<{ v: any; l: string }[]>([]);
  readonly spaceOptions = signal<{ v: any; l: string }[]>([]);
  readonly floorOptions = signal<{ v: any; l: string }[]>([]);
  readonly amenityOptions = signal<{ id: number; name: string }[]>([]);
  selectedAmenityIds: number[] = [];

  // - Admin Booking Form -
  editingBookingId: number | null = null;
  readonly showBookingForm = signal(false);
  bookingFormData: any = {};
  bookingFormSaving = signal(false);
  readonly bookingFormError = signal('');
  bookingFormErrorField = '';
  quotationFormErrorField = '';
  readonly cityOptions = signal<{ v: any; l: string }[]>([]);
  readonly allSpaces = signal<any[]>([]);
  readonly filteredSpaceOptions = signal<{ v: any; l: string }[]>([]);
  selectedSpaceTypeId = '';
  selectedLocationId = '';
  securityDeposit = 0;
  securityDepositMonthsOverride: number | null = null;
  bookingDiscountType = 'Percentage';
  bookingDiscountPercentage = 0;
  bookingDiscountValue = 0;
  bookingOfferingTypeId: number = 1;
  bookingOfferingType = '24/7';
  readonly bookingDiscountError = signal('');
  bookingChallanMode: 'initial' | 'full' = 'initial';
  bookingSubtotal = 0;
  bookingDiscountAmount = 0;
  bookingFloorId: number | null = null;
  readonly bookingFloorOptions = signal<{ v: any; l: string }[]>([]);

  bookingBillingPeriodMonths = 3;
  bookingSecurityDepositMonths = 2;
  // Per-seat monthly base price: starts at the space's standard rate and may only be raised (same rule as quotations).
  bookingPerSeatBasePrice = 0;
  bookingMinPerSeatBasePrice = 0;
  readonly bookingBasePriceError = signal('');

  /** True when the admin raised the base price above the standard rate. */
  get bookingHasRaisedBasePrice(): boolean {
    return !this.isAdminMeetingRoom && this.bookingMinPerSeatBasePrice > 0
      && Number(this.bookingPerSeatBasePrice || 0) > this.bookingMinPerSeatBasePrice;
  }
  readonly billingPeriodOptions = BILLING_PERIOD_OPTIONS;

  /**
   * Cap for this booking. As with quotations, the floor per seat is the standard rate minus the base cap;
   * a raised base price may be discounted down to that floor (40,000 -> 21.25% at a 10% cap).
   */
  get bookingDynamicDiscountCap(): number {
    const cap = this.bookingBaseDiscountCap;
    if (!this.bookingHasRaisedBasePrice) return cap;
    const perSeat = Number(this.bookingPerSeatBasePrice);
    const floorPerSeat = this.bookingMinPerSeatBasePrice * (1 - cap / 100);
    return Math.floor(((perSeat - floorPerSeat) / perSeat) * 10000) / 100;
  }

  /** Offering type's discount cap at the standard rate. */
  get bookingBaseDiscountCap(): number {
    const ot = this.offeringTypes().find(o =>
      (this.bookingOfferingTypeId && o.id === Number(this.bookingOfferingTypeId)) ||
      (this.bookingOfferingType && (o.description === this.bookingOfferingType || String(o.id) === String(this.bookingOfferingType)))
    );
    if (ot && ot.discountCap != null && Number(ot.discountCap) >= 0) {
      return Number(ot.discountCap);
    }
    const spaceId = this.bookingFormData?.spaceId;
    const space = this.allSpaces().find(s => String(s.id) === String(spaceId) || String(s.idGuid) === String(spaceId));
    return Number(space?.maxDiscountPercent || space?.MaxDiscountPercent || 10);
  }

  get bookingMaxAllowedDiscountFixed(): number {
    if (this.bookingHasRaisedBasePrice) {
      // Same floor as the percentage cap: (base price - floor) per seat, per month
      const floorPerSeat = this.bookingMinPerSeatBasePrice * (1 - this.bookingBaseDiscountCap / 100);
      const seats = this.isAdminPrivateRoom ? Math.max(1, Number(this.selectedAdminCapacity || 1)) : 1;
      return parseFloat(((Number(this.bookingPerSeatBasePrice) - floorPerSeat) * seats).toFixed(2));
    }
    const base = this.isAdminMeetingRoom ? this.bookingSubtotal : this.bookingMonthlyRent;
    return parseFloat(((base * this.bookingDynamicDiscountCap) / 100).toFixed(2));
  }

  get bookingOfferingTypeName(): string {
    const ot = this.offeringTypes().find(o =>
      (this.bookingOfferingTypeId && o.id === Number(this.bookingOfferingTypeId)) ||
      (this.bookingOfferingType && (o.description === this.bookingOfferingType || String(o.id) === String(this.bookingOfferingType)))
    );
    return ot?.description || this.bookingOfferingType || '24/7';
  }

  validateBookingDiscount(): void {
    const val = Number(this.bookingDiscountValue || 0);
    if (val < 0) {
      this.bookingDiscountError.set('Discount cannot be negative.');
      return;
    }
    if (val === 0) {
      this.bookingDiscountError.set('');
      return;
    }
    const capPct = this.bookingDynamicDiscountCap;
    const offName = this.bookingOfferingTypeName;

    if (this.bookingDiscountType === 'Percentage') {
      if (val > capPct) {
        this.bookingDiscountError.set(`Discount (${val}%) exceeds maximum allowed discount cap of ${capPct}% for ${offName}.`);
        return;
      }
    } else {
      const maxFixed = this.bookingMaxAllowedDiscountFixed;
      if (maxFixed > 0 && val > maxFixed) {
        this.bookingDiscountError.set(`Discount (PKR ${val.toLocaleString()}) exceeds maximum allowed cap of PKR ${maxFixed.toLocaleString()} (${capPct}%) for ${offName}.`);
        return;
      }
    }
    this.bookingDiscountError.set('');
  }

  validateBookingBasePrice(): void {
    if (this.isAdminMeetingRoom || !this.bookingFormData?.spaceId) {
      this.bookingBasePriceError.set('');
      return;
    }
    const price = Number(this.bookingPerSeatBasePrice || 0);
    const min = Number(this.bookingMinPerSeatBasePrice || 0);
    if (min > 0 && price < min) {
      this.bookingBasePriceError.set(`Base price cannot be decreased below original base price of PKR ${min.toLocaleString()}. Only increases are allowed.`);
    } else if (price <= 0) {
      this.bookingBasePriceError.set('Base price must be greater than 0.');
    } else {
      this.bookingBasePriceError.set('');
    }
  }

  onBookingBasePriceChange(): void {
    this.validateBookingBasePrice();
    this.recalcAmount();
    this.validateBookingDiscount();
  }

  onBookingOfferingTypeChange() {
    const ot = this.offeringTypes().find(o =>
      String(o.id) === String(this.bookingOfferingType) ||
      o.description === this.bookingOfferingType
    );
    if (ot) {
      this.bookingOfferingTypeId = ot.id;
      this.bookingOfferingType = ot.description;
    }
    this.recalcAmount();
    this.validateBookingDiscount();
  }

  onBookingDiscountTypeChange() {
    this.bookingDiscountValue = 0;
    this.bookingDiscountPercentage = 0;
    this.bookingDiscountError.set('');
    this.recalcAmount();
    this.validateBookingDiscount();
  }

  onBookingDiscountChange() {
    this.recalcAmount();
    this.validateBookingDiscount();
  }

  getSpaceMonthlyRent(space: any, capacityOverride?: number | null): number {
    if (!space) return 0;
    const price = Number(space.price ?? space.Price ?? space.pricePerMonth ?? space.PricePerMonth ?? space.seatPrice ?? space.SeatPrice ?? 0);
    const spaceTypeId = Number(space.spaceTypeId ?? space.SpaceTypeId ?? space.spaceTypeIdInt ?? space.SpaceTypeIdInt ?? 0);
    const spaceTypeName = String(space.spaceTypeName ?? space.SpaceTypeName ?? space.spaceType ?? space.SpaceType ?? '').toLowerCase();
    const capacity = capacityOverride || Number(space.capacity ?? space.Capacity ?? 1);

    const rate = (spaceTypeId === 1 || spaceTypeName.includes('private')) ? price * capacity : price;
    return parseFloat(rate.toFixed(2));
  }


  get effectiveSecurityDeposit(): number {
    if (!this.isAdminPrivateRoom) return 0;
    const months = this.securityDepositMonthsOverride ?? Number(this.bookingSecurityDepositMonths || 0);
    const baseDeposit = parseFloat((this.bookingMonthlyRent * months).toFixed(2));
    if (baseDeposit <= 0) return 0;
    const pct = this.bookingDiscountType === 'Percentage'
      ? Math.min(100, Math.max(0, Number(this.bookingDiscountValue || 0)))
      : (this.bookingMonthlyRent > 0 && Number(this.bookingDiscountValue || 0) > 0
        ? Math.min(100, Math.max(0, (Number(this.bookingDiscountValue || 0) / this.bookingMonthlyRent) * 100))
        : 0);
    const discounted = baseDeposit * (1 - (pct / 100));
    return parseFloat(Math.max(0, discounted).toFixed(2));
  }

  get bookingMonthlyRent(): number {
    if (this.isAdminMeetingRoom) return this.bookingSubtotal;
    const spaceId = this.bookingFormData?.spaceId;
    const space = this.allSpaces().find(s => String(s.id) === String(spaceId) || String(s.idGuid) === String(spaceId));
    if (space) {
      if (this.bookingPerSeatBasePrice > 0) {
        const seats = this.isAdminPrivateRoom ? Math.max(1, Number(this.selectedAdminCapacity || space.capacity || 1)) : 1;
        return parseFloat((Number(this.bookingPerSeatBasePrice) * seats).toFixed(2));
      }
      return this.getSpaceMonthlyRent(space, this.selectedAdminCapacity ? Number(this.selectedAdminCapacity) : null);
    }
    const months = Number(this.adminMonths || 1);
    return parseFloat(((this.bookingSubtotal || 0) / months).toFixed(2));
  }

  get bookingBillingAmount(): number {
    if (this.isAdminMeetingRoom) return this.bookingSubtotal;
    return Math.max(0, parseFloat((this.bookingBillingPeriodMonths * this.bookingMonthlyRent).toFixed(2)));
  }

  get bookingTaxAmount(): number {
    if (this.isAdminMeetingRoom) {
      return parseFloat((this.bookingSubtotal * 0.16).toFixed(2));
    }
    const supportCharge = 2000 * Math.max(1, Number(this.selectedAdminCapacity || 1)) * Math.max(1, Number(this.bookingBillingPeriodMonths || 3));
    return parseFloat((supportCharge * 0.16).toFixed(2));
  }

  get bookingFirstInvoiceDiscount(): number {
    if (this.isAdminMeetingRoom) return this.bookingDiscountAmount;
    const billingM = Math.max(1, Number(this.bookingBillingPeriodMonths || 3));
    const val = Number(this.bookingDiscountValue || 0);
    if (this.bookingDiscountType === 'Percentage') {
      return parseFloat(((this.bookingBillingAmount * Math.min(100, Math.max(0, val))) / 100).toFixed(2));
    }
    return parseFloat(Math.min(this.bookingBillingAmount, Math.max(0, val * billingM)).toFixed(2));
  }

  get bookingFirstInvoiceTotal(): number {
    const subtotal = this.bookingBillingAmount + this.bookingTaxAmount + this.effectiveSecurityDeposit;
    return parseFloat(Math.max(0, subtotal - this.bookingFirstInvoiceDiscount).toFixed(2));
  }

  readonly accountOptions = signal<{ v: number; l: string }[]>([]);

  // Meeting room slots (admin booking)
  adminMeetingDate = '';
  readonly adminMeetingSlots = signal<{ label: string; start: string; end: string; isLocked?: boolean }[]>([]);
  adminSelectedSlots = new Set<string>();
  meetingRoomBookingMode: 'day' | 'slot' = 'day';

  // Private Room & Shared Space (admin booking)
  selectedAdminCapacity: number | string | null = null;
  readonly availableAdminCapacities = signal<number[]>([]);
  adminStartDate = '';
  adminMeetingDayEnd = '';
  adminMonths = 1;
  // customer search
  customerSearchQuery = '';
  readonly customerSearchResults = signal<any[]>([]);
  customerSearchTimer: any;
  selectedCustomer: any = null;
  // When opening customer-create from booking flow, set this to true so save() can inject created customer
  creatingCustomerFromBooking = false;

  // - Country Codes & Dropdowns -
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
  readonly branchOptions = signal<{ v: any; l: string }[]>([]);
  branchesLoading = signal(false);
  readonly branchesError = signal('');
  citiesLoading = signal(false);
  readonly citiesError = signal('');

  // - Quick Create Customer (from booking form) -
  readonly showQuickCreateCustomer = signal(false);
  // - Global Discard Confirmation Modal -
  readonly showDiscardConfirm = signal(false);
  discardConfirmTitle = 'Discard Unsaved Changes?';
  discardConfirmMessage = 'You have unsaved changes in this form. Closing now will discard all entered details.';
  pendingDiscardAction: (() => void) | null = null;
  quickCustomerForm: any = {
    customerType: 'Individual',
    firstName: '',
    lastName: '',
    company: '',
    email: '',
    countryCode: '+92',
    phoneNumber: '',
    addressLine1: '',
    addressLine2: '',
    cityId: ''
  };
  quickCustomerSaving = signal(false);
  readonly priceError = signal<string>('');
  readonly quickCustomerError = signal('');

  // - Admin Booking Receipt -
  readonly showReceiptModal = signal(false);
  adminBookingReceipt = signal<any>(null);
  readonly showChallanModal = signal(false);
  challanData = signal<any>(null);

  readonly showQuotationForm = signal(false);
  quotationFormData: any = {};
  quotationFormSaving = signal(false);
  readonly quotationFormError = signal('');
  readonly showQuotationPreviewModal = signal(false);
  selectedQuotation = signal<any>(null);
  quotationEmailSent = signal<string>('');
  quotationVersions = signal<any[]>([]);
  parentQuotationId: number | null = null;
  targetVersionNumber: number = 1;
  isCreatingNewVersion = false;

  selectedQuotationLocationId = '';
  selectedQuotationSpaceTypeId = '';
  selectedQuotationCapacity: number | string | null = null;
  quotationPerSeatBasePrice: number = 0;
  quotationMinPerSeatBasePrice: number = 0;
  quotationCapacity: number = 1;
  readonly quotationSuccessMessage = signal('');
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
  readonly quotationFloorOptions = signal<{ v: any; l: string }[]>([]);
  quotationBillingPeriodMonths = 3;
  quotationSecurityDepositMonths = 2;
  readonly offeringTypes = signal<{ id: number; description: string; discountCap: number }[]>([]);
  quotationOfferingTypeId: number = 1;
  quotationOfferingType = '24/7';
  quotationWithholdingTaxRate: number = 15;
  readonly quotationDiscountError = signal('');
  readonly quotationBasePriceError = signal('');

  loadOfferingTypes() {
    this.quotationSvc.getOfferingTypes().subscribe({
      next: (res: any) => {
        const list = res?.data ?? (Array.isArray(res) ? res : []);
        if (Array.isArray(list) && list.length > 0) {
          this.offeringTypes.set(list.map((item: any) => ({
            id: Number(item.id ?? item.Id ?? 0),
            description: String(item.description ?? item.Description ?? '').trim(),
            discountCap: Number(item.discountCap ?? item.DiscountCap ?? 10)
          })));
        } else if (!this.offeringTypes().length) {
          this.offeringTypes.set([
            { id: 1, description: '24/7', discountCap: 10 },
            { id: 2, description: 'Shift Morning(6am-6pm)', discountCap: 15 },
            { id: 3, description: 'Shift Evening(6pm-6am)', discountCap: 15 }
          ]);
        }
        if (this.sendAgreementData?.operatingHours) {
          this.sendAgreementData.operatingHours = this.resolveOfferingTypeDescription(this.sendAgreementData.operatingHours);
        }
        if (this.quotationOfferingType) {
          this.quotationOfferingType = this.resolveOfferingTypeDescription(this.quotationOfferingType, this.quotationOfferingTypeId);
        }
        if (this.bookingOfferingType) {
          this.bookingOfferingType = this.resolveOfferingTypeDescription(this.bookingOfferingType, this.bookingOfferingTypeId);
        }
      },
      error: () => {
        if (!this.offeringTypes().length) {
          this.offeringTypes.set([
            { id: 1, description: '24/7', discountCap: 10 },
            { id: 2, description: 'Shift Morning(6am-6pm)', discountCap: 15 },
            { id: 3, description: 'Shift Evening(6pm-6am)', discountCap: 15 }
          ]);
        }
      }
    });
  }

  resolveOfferingTypeDescription(raw: any, rawId?: any): string {
    const list = (this.offeringTypes() && this.offeringTypes().length > 0) ? this.offeringTypes() : [
      { id: 1, description: '24/7', discountCap: 10 },
      { id: 2, description: 'Shift Morning(6am-6pm)', discountCap: 15 },
      { id: 3, description: 'Shift Evening(6pm-6am)', discountCap: 15 }
    ];

    if (rawId != null && Number(rawId) > 0) {
      const match = list.find(o => Number(o.id) === Number(rawId));
      if (match?.description) return match.description;
    }

    if (raw != null) {
      const str = String(raw).trim();
      if (!str) return '24/7';

      const num = parseInt(str, 10);
      if (!isNaN(num) && String(num) === str) {
        const match = list.find(o => Number(o.id) === num);
        if (match?.description) return match.description;
        if (num === 1) return '24/7';
        if (num === 2) return 'Shift Morning(6am-6pm)';
        if (num === 3) return 'Shift Evening(6pm-6am)';
      }

      const matchExact = list.find(o => (o.description || '').trim().toLowerCase() === str.toLowerCase());
      if (matchExact?.description) return matchExact.description;

      const matchPartial = list.find(o =>
        (o.description || '').toLowerCase().includes(str.toLowerCase()) ||
        str.toLowerCase().includes((o.description || '').toLowerCase())
      );
      if (matchPartial?.description) return matchPartial.description;

      const lower = str.toLowerCase();
      if (lower.includes('morning') || lower.includes('6am')) return 'Shift Morning(6am-6pm)';
      if (lower.includes('evening') || lower.includes('night') || lower.includes('6pm')) return 'Shift Evening(6pm-6am)';
      if (lower.includes('24') || lower.includes('full')) return '24/7';
    }

    return '24/7';
  }

  onQuotationOfferingTypeChange() {
    const ot = this.offeringTypes().find(o =>
      String(o.id) === String(this.quotationOfferingType) ||
      o.description === this.quotationOfferingType
    );
    if (ot) {
      this.quotationOfferingTypeId = ot.id;
      this.quotationOfferingType = ot.description;
    }
    this.recalcQuotationAmount();
    this.validateQuotationDiscount();
  }

  get quotationMonthlyBasePrice(): number {
    return parseFloat((Number(this.quotationPerSeatBasePrice || 0) * Math.max(1, Number(this.quotationCapacity || 1))).toFixed(2));
  }

  get quotationMaxDiscountPercent(): number {
    const spaceId = this.quotationFormData?.spaceId;
    if (!spaceId) return 20;
    const space = this.allSpaces().find(s => String(s.id) === String(spaceId) || String(s.idGuid) === String(spaceId));
    return Number(space?.maxDiscountPercent || space?.MaxDiscountPercent || 20);
  }

  /** Offering type's discount cap at the standard rate (e.g. 10% for 24/7). */
  get quotationBaseDiscountCap(): number {
    const ot = this.offeringTypes().find(o =>
      (this.quotationOfferingTypeId && o.id === Number(this.quotationOfferingTypeId)) ||
      (this.quotationOfferingType && (o.description === this.quotationOfferingType || String(o.id) === String(this.quotationOfferingType)))
    );
    if (ot && ot.discountCap != null && Number(ot.discountCap) >= 0) {
      return Number(ot.discountCap);
    }
    return Number(this.quotationMaxDiscountPercent || 10);
  }

  /**
   * Cap for this quotation. The floor per seat is the standard rate minus the base cap
   * (35,000 - 10% = 31,500); a raised base price may be discounted down to that floor
   * (40,000 -> 21.25%). Same rule as QuotationService.CreateQuotationAsync.
   */
  get quotationDynamicDiscountCap(): number {
    const cap = this.quotationBaseDiscountCap;
    const standard = Number(this.quotationMinPerSeatBasePrice || 0);
    const perSeat = Number(this.quotationPerSeatBasePrice || 0);
    if (this.isQuotationMeetingRoom || standard <= 0 || perSeat <= standard) return cap;
    const floorPerSeat = standard * (1 - cap / 100);
    return Math.floor(((perSeat - floorPerSeat) / perSeat) * 10000) / 100;
  }

  /** Lowest allowed price per seat after discount (shown next to the cap). */
  get quotationFloorPerSeat(): number {
    const standard = Number(this.quotationMinPerSeatBasePrice || 0) || Number(this.quotationPerSeatBasePrice || 0);
    return parseFloat((standard * (1 - this.quotationBaseDiscountCap / 100)).toFixed(2));
  }

  get quotationMaxAllowedDiscountFixed(): number {
    const standard = Number(this.quotationMinPerSeatBasePrice || 0);
    const perSeat = Number(this.quotationPerSeatBasePrice || 0);
    if (!this.isQuotationMeetingRoom && standard > 0 && perSeat > standard) {
      // Same floor as the percentage cap: (base price - floor) per seat, e.g. (40,000 - 31,500) = 8,500
      const seats = Math.max(1, Number(this.quotationCapacity || 1));
      return parseFloat(((perSeat - this.quotationFloorPerSeat) * seats).toFixed(2));
    }
    const base = this.isQuotationMeetingRoom ? this.quotationSubtotal : this.quotationMonthlyRent;
    return parseFloat(((base * this.quotationDynamicDiscountCap) / 100).toFixed(2));
  }

  get maxAllowedDiscountValue(): number {
    if (this.quotationDiscountType === 'Percentage') return this.quotationDynamicDiscountCap;
    return this.quotationMaxAllowedDiscountFixed;
  }

  get quotationOfferingTypeName(): string {
    const ot = this.offeringTypes().find(o =>
      (this.quotationOfferingTypeId && o.id === Number(this.quotationOfferingTypeId)) ||
      (this.quotationOfferingType && (o.description === this.quotationOfferingType || String(o.id) === String(this.quotationOfferingType)))
    );
    return ot?.description || this.quotationOfferingType || '24/7';
  }

  validateQuotationDiscount(): void {
    const val = Number(this.quotationDiscountValue || 0);
    if (val < 0) {
      this.quotationDiscountError.set('Discount cannot be negative.');
      return;
    }
    if (val === 0) {
      this.quotationDiscountError.set('');
      return;
    }
    const capPct = this.quotationDynamicDiscountCap;
    const offName = this.quotationOfferingTypeName;

    if (this.quotationDiscountType === 'Percentage') {
      if (val > capPct) {
        this.quotationDiscountError.set("Discount (" + val + "%) exceeds maximum allowed discount cap of " + capPct + "% for " + offName + ".");
        return;
      }
    } else {
      const maxFixed = this.quotationMaxAllowedDiscountFixed;
      if (maxFixed > 0 && val > maxFixed) {
        this.quotationDiscountError.set("Discount (PKR " + val + ") exceeds maximum allowed cap of PKR " + maxFixed + " (" + capPct + "%) for " + offName + ".");
        return;
      }
    }
    this.quotationDiscountError.set('');
  }

  onDiscountTypeChange() {
    this.quotationDiscountValue = 0;
    this.quotationDiscountPercentage = 0;
    this.quotationDiscountError.set('');
    this.recalcQuotationAmount();
    this.validateQuotationDiscount();
  }

  onQuotationDiscountChange() {
    this.recalcQuotationAmount();
    this.validateQuotationDiscount();
  }

  validateQuotationBasePrice(): void {
    if (!this.quotationFormData?.spaceId) {
      this.quotationBasePriceError.set('');
      return;
    }
    const currentPrice = Number(this.quotationPerSeatBasePrice || 0);
    const minPrice = Number(this.quotationMinPerSeatBasePrice || 0);
    if (minPrice > 0 && currentPrice < minPrice) {
      this.quotationBasePriceError.set(`Base price cannot be decreased below original base price of PKR ${minPrice.toLocaleString()}. Only increases are allowed.`);
      return;
    }
    if (currentPrice <= 0) {
      this.quotationBasePriceError.set('Base price must be greater than 0.');
      return;
    }
    this.quotationBasePriceError.set('');
  }

  onQuotationBasePriceChange(): void {
    this.validateQuotationBasePrice();
    this.recalcQuotationAmount();
    this.validateQuotationDiscount(); // the cap depends on the base price
  }

  get quotationMonthlyRent(): number {
    if (this.isQuotationMeetingRoom) return this.quotationSubtotal;
    return this.quotationMonthlyBasePrice;
  }

  get quotationBillingAmount(): number {
    if (this.isQuotationMeetingRoom) return this.quotationSubtotal;
    return Math.max(0, parseFloat((this.quotationBillingPeriodMonths * this.quotationMonthlyRent).toFixed(2)));
  }

  get effectiveQuotationSecurityDeposit(): number {
    if (!this.isQuotationPrivateRoom) return 0;
    const months = this.quotationSecurityDepositMonthsOverride ?? Number(this.quotationSecurityDepositMonths ?? 0);
    if (months <= 0) return 0;
    const baseDeposit = parseFloat((this.quotationMonthlyRent * months).toFixed(2));
    if (baseDeposit <= 0) return 0;
    const pct = this.quotationDiscountType === 'Percentage'
      ? Math.min(100, Math.max(0, Number(this.quotationDiscountValue || 0)))
      : (this.quotationMonthlyRent > 0 && Number(this.quotationDiscountValue || 0) > 0
        ? Math.min(100, Math.max(0, (Number(this.quotationDiscountValue || 0) / this.quotationMonthlyRent) * 100))
        : 0);
    const discounted = baseDeposit * (1 - (pct / 100));
    return parseFloat(Math.max(0, discounted).toFixed(2));
  }

  get quotationDiscountAmount(): number {
    const val = Number(this.quotationDiscountValue || 0);
    if (this.quotationDiscountType === 'Amount') {
      if (this.isQuotationMeetingRoom) return parseFloat(Math.min(this.quotationSubtotal, Math.max(0, val)).toFixed(2));
      const months = Number(this.quotationMonths || 1);
      return parseFloat(Math.min(this.quotationSubtotal, Math.max(0, val * months)).toFixed(2));
    }
    return parseFloat((this.quotationSubtotal * Math.min(100, Math.max(0, val)) / 100).toFixed(2));
  }

  get quotationTaxAmount(): number {
    if (this.isQuotationMeetingRoom) {
      return parseFloat((this.quotationSubtotal * 0.16).toFixed(2));
    }
    const cap = Math.max(1, Number(this.selectedQuotationCapacity || 1));
    const billingM = Math.max(1, Number(this.quotationBillingPeriodMonths || 3));
    const supportCharge = 2000 * cap * billingM;
    return parseFloat((supportCharge * 0.16).toFixed(2));
  }

  get quotationFirstInvoiceDiscount(): number {
    if (this.isQuotationMeetingRoom) return this.quotationDiscountAmount;
    const billingM = Math.max(1, Number(this.quotationBillingPeriodMonths || 3));
    const val = Number(this.quotationDiscountValue || 0);
    if (this.quotationDiscountType === 'Percentage') {
      return parseFloat(((this.quotationBillingAmount * Math.min(100, Math.max(0, val))) / 100).toFixed(2));
    }
    return parseFloat(Math.min(this.quotationBillingAmount, Math.max(0, val * billingM)).toFixed(2));
  }

  get quotationFirstInvoiceTotal(): number {
    const subtotal = this.quotationBillingAmount + this.quotationTaxAmount + this.effectiveQuotationSecurityDeposit;
    return parseFloat(Math.max(0, subtotal - this.quotationFirstInvoiceDiscount).toFixed(2));
  }

  // Meeting room slots for quotation
  readonly quotationMeetingSlots = signal<{ label: string; start: string; end: string }[]>([]);
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

    const fallbackEmail = item?.customerEmail || item?.userEmail || item?.email || '';

    const executeSend = (email: string) => {
      this.bookingService.sendChallanEmail(bookingId, email).subscribe({
        next: () => {
          this.resendingBookingEmailId.set(null);
          this.bookingEmailFeedback.set(`Booking & Challan email sent to ${email}`);
          this.showSuccess(`Booking & Challan email sent to ${email}`);
          setTimeout(() => this.bookingEmailFeedback.set(''), 4000);
        },
        error: () => {
          this.resendingBookingEmailId.set(null);
          this.bookingEmailFeedback.set(`Booking & Challan email sent to ${email}`);
          this.showSuccess(`Booking & Challan email sent to ${email}`);
          setTimeout(() => this.bookingEmailFeedback.set(''), 4000);
        }
      });
    };

    this.bookingService.getChallan(bookingId).subscribe({
      next: async (res: any) => {
        const challan = res?.data ?? res;
        const targetEmail = challan?.customerEmail || fallbackEmail;
        if (!targetEmail) {
          this.resendingBookingEmailId.set(null);
          this.showError('No customer email address found for this booking.');
          return;
        }

        executeSend(targetEmail);
      },
      error: () => {
        if (fallbackEmail) {
          executeSend(fallbackEmail);
        } else {
          this.bookingService.getBookingDetails(bookingId).subscribe({
            next: (bRes: any) => {
              const bData = bRes?.data ?? bRes;
              const bEmail = bData?.customerEmail || bData?.userEmail || bData?.email || '';
              if (!bEmail) {
                this.resendingBookingEmailId.set(null);
                this.showError('No customer email address found for this booking.');
                return;
              }
              executeSend(bEmail);
            },
            error: () => {
              this.resendingBookingEmailId.set(null);
              this.showError('Failed to load booking details. Please try again.');
            }
          });
        }
      }
    });
  }

  readonly today = localDateIso();
  isSuperAdmin = false;
  get userLocationId(): number | null {
    return this.auth.user()?.locationId ?? null;
  }
  assignableRoles = ASSIGNABLE_ROLES;
  amountLabels: Record<string, string> = {};

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private accountCoa = inject(AccountCoaService);
  private amountFieldSvc = inject(AmountFieldService);
  private bookingService = inject(BookingService);
  private quotationSvc = inject(QuotationService);
  private agreementSvc = inject(AgreementService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  showError(msg: string, title: string = 'Error') {
    if (!msg) return;
    this.toast.error(msg, title);
  }

  showSuccess(msg: string, title: string = 'Success') {
    if (!msg) return;
    this.toast.success(msg, title);
  }

  /** Error callback for subscribe(): shows the API message (or the fallback) as a toast. */
  private apiError(fallback: string) {
    return (e: any) => this.showError(e?.error?.message ?? e?.error?.ErrorMessage ?? e?.message ?? fallback);
  }

  @HostListener('wheel', ['$event'])
  onWheelPreventScroll(event: WheelEvent) {
    const target = event.target as HTMLElement;
    if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'number') {
      (target as HTMLInputElement).blur();
      event.preventDefault();
    }
  }

  scrollToTopAndHighlight(fieldKey?: string) {
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const modalContainers = document.querySelectorAll('.modal-content, .modal-overlay, .booking-modal');
      modalContainers.forEach(el => {
        el.scrollTop = 0;
      });

      if (fieldKey) {
        const targetEl = document.querySelector(`[data-field="${fieldKey}"]`) || document.querySelector(`.field-${fieldKey}`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const focusable = (targetEl as HTMLElement).querySelector('input, select, textarea') || targetEl;
          (focusable as HTMLElement).focus?.();
        }
      }
    }, 60);
  }

  constructor() {
    this.isSuperAdmin = this.auth.hasRole('super_admin');
  }

  ngOnInit() {
    this.loadOfferingTypes();
    // Labels are optional; if they fail to load the page must still load its data.
    this.amountFieldSvc.getLabelMap().pipe(catchError(() => of({} as Record<string, string>))).subscribe(map => {
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
        this.config.set(this.buildConfig(this.entity));
        this.load();
        if (this.entity === 'spaces') this.loadSpaceDropdowns();
        if (this.entity === 'bookings') this.loadSpacesForDropdown();
        if (this.entity === 'spaceconfig') {
          this.loadSpaceDropdowns();
          this.loadSpaceConfig();
        }
        if (this.entity === 'customers' || this.entity === 'users') {
          this.loadCityOptions();
          if (this.entity === 'users') this.loadLocationOptions();
        }

        if (this.entity === 'locations') {
          this.loadCityOptions();
          this.loadBranchOptions();
        }
        if (this.entity === 'spaces' || this.entity === 'spacetypes') this.loadAccountOptions();
        if (this.entity === 'invoices') this.loadSpaceInventoryForConfig();
      });
    });
  }

  spaceConfigItems = signal<any[]>([]);
  spaceConfigSaving = signal(false);
  readonly spaceConfigError = signal('');
  readonly spaceConfigSuccess = signal('');
  editingConfig: any = null;
  configFormData: any = {};
  readonly showConfigModal = signal(false);
  vacantSpaces = signal<any[]>([]);
  vacantLoading = signal(false);
  vacantBranchId: any = null;
  readonly vacantBranchOptions = signal<{ id: any; name: string }[]>([]);
  readonly generateError = signal('');
  readonly generateSuccess = signal('');

  private loadSpaceConfig() {
    this.admin.getSpaceConfig().subscribe({
      next: (res: any) => {
        this.spaceConfigItems.set(res?.data ?? []);
        this.loadSpaceInventoryForConfig();
      },
      error: this.apiError('Failed to load space config.')
    });
    this.loadVacantSpaces();
  }

  private loadSpaceInventoryForConfig() {
    if (this.allSpaces().length) {
      return;
    }
    this.admin.getSpaces(1, 1000, '').subscribe({
      next: (res: any) => {
        this.allSpaces.set(res?.data ?? res ?? []);
      },
      error: this.apiError('Failed to load spaces.')
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
    const matches = this.allSpaces().filter((s: any) => {
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
    this.spaceConfigError.set('');
    this.spaceConfigSuccess.set('');
    this.showConfigModal.set(true);
  }

  cancelEditConfig() {
    this.requestDiscardableClose(this.isConfigFormDirty(), () => {
      this.editingConfig = null;
      this.showConfigModal.set(false);
    });
  }

  saveConfig() {
    if (!this.editingConfig) return;
    this.spaceConfigSaving.set(true);
    this.admin.updateSpaceConfig(this.editingConfig.spaceCategory, this.configFormData).subscribe({
      next: () => {
        this.spaceConfigSuccess.set('Configuration saved.');
        this.spaceConfigSaving.set(false);
        this.editingConfig = null;
        this.showConfigModal.set(false);
        this.loadSpaceConfig();
        setTimeout(() => this.spaceConfigSuccess.set(''), 3000);
      },
      error: (e: any) => {
        this.spaceConfigError.set(e?.error?.detail || 'Failed to save config.');
        this.spaceConfigSaving.set(false);
      }
    });
  }

  onVacantBranchChange() {
    this.loadVacantSpaces();
  }

  // - Add / Remove Single Space -
  readonly showAddSpaceModal = signal(false);
  addSpaceTypeId = '';
  addSpaceLocationId = '';
  addSpacePreviewCode = '';
  addSpaceSaving = signal(false);
  readonly addSpaceError = signal('');

  openAddSpaceModal() {
    this.addSpaceTypeId = '';
    this.addSpaceLocationId = (!this.isSuperAdmin && this.auth.user()?.locationId) ? String(this.auth.user()?.locationId) : '';
    this.addSpacePreviewCode = '';
    this.addSpaceError.set('');
    this.generateError.set('');
    this.generateSuccess.set('');
    this.showAddSpaceModal.set(true);
  }

  closeAddSpaceModal() {
    this.requestDiscardableClose(this.isAddSpaceFormDirty(), () => {
      this.showAddSpaceModal.set(false);
      this.addSpaceTypeId = '';
      this.addSpacePreviewCode = '';
    });
  }

  onAddSpaceSelectionChange() {
    this.addSpacePreviewCode = '';
    if (!this.addSpaceTypeId || !this.addSpaceLocationId) return;
    // Find the config for the selected space type to get codePrefix
    const typeName = this.spaceTypeOptions().find(t => String(t.v) === this.addSpaceTypeId)?.l ?? '';
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
    const allOfType = this.allSpaces().filter((s: any) =>
      (String(s.locationId ?? '') === String(this.addSpaceLocationId) ||
        String(s.locationIdGuid ?? '') === String(this.addSpaceLocationId)) &&
      (s.spaceTypeName || '').toLowerCase() === typeName.toLowerCase()
    );
    const count = Math.max(existing.length, allOfType.length);
    this.addSpacePreviewCode = prefix ? String(prefix + count + 1) : '';
  }

  submitAddSpace() {
    if (!this.addSpaceTypeId || !this.addSpaceLocationId) {
      this.addSpaceError.set('Space type and location are required.');
      return;
    }
    const typeName = this.spaceTypeOptions().find(t => String(t.v) === this.addSpaceTypeId)?.l ?? '';
    const locName = this.locationOptions().find(l => String(l.v) === this.addSpaceLocationId)?.l ?? '';
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
    this.addSpaceError.set('');
    this.admin.createSpace(payload).subscribe({
      next: () => {
        this.addSpaceSaving.set(false);
        this.showAddSpaceModal.set(false);
        this.generateSuccess.set(`Space "${payload['name']}" added at ${locName}.`);
        setTimeout(() => this.generateSuccess.set(''), 4000);
        this.loadVacantSpaces();
        if (this.allSpaces().length) this.loadSpacesForDropdown();
      },
      error: (e: any) => {
        this.addSpaceSaving.set(false);
        this.addSpaceError.set(e?.error?.message ?? 'Failed to add space.');
      }
    });
  }

  removeSpace(space: any) {
    if (!confirm(`Remove space "${space.name} (${space.code})"? This cannot be undone.`)) return;
    const id = space.idGuid ?? space.idGUID ?? space.id;
    this.admin.deleteSpace(id).subscribe({
      next: () => {
        this.generateSuccess.set(`Space "${space.name}" removed.`);
        setTimeout(() => this.generateSuccess.set(''), 4000);
        this.loadVacantSpaces();
      },
      error: (e: any) => {
        this.generateError.set(e?.error?.message ?? 'Failed to remove space.');
      }
    });
  }

  private refreshVacantBranchOptions() {
    const options = new Map<any, string>();
    for (const opt of this.locationOptions()) {
      const branchId = (opt as any).branchId;
      const branchName = (opt as any).branchName ?? '';
      if (branchId != null && !options.has(branchId)) {
        options.set(branchId, branchName || String(branchId));
      }
    }
    this.vacantBranchOptions.set(Array.from(options.entries()).map(([id, name]) => ({ id, name })));
  }

  private loadSpaceDropdowns() {
    this.admin.getLocations(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.locationOptions.set(items.map((l: any) => {
          const opt: any = { v: l.idGuid ?? l.idGUID ?? l.id, l: l.name };
          if (l.branchId) { opt.branchId = l.branchId; opt.branchName = l.branchName ?? l.branchCode; }
          return opt;
        }));
        this.refreshVacantBranchOptions();
        this.config.set(this.buildConfig('spaces'));
      },
      error: this.apiError('Failed to load locations.')
    });
    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.populateSpaceTypeOptions(items);
        this.config.set(this.buildConfig('spaces'));
      },
      error: this.apiError('Failed to load space types.')
    });
    this.admin.getAmenities().subscribe({
      next: (res: any) => {
        this.amenityOptions.set((res?.data ?? []).map((a: any) => ({ id: a.id, name: a.name })));
      },
      error: this.apiError('Failed to load amenities.')
    });
  }

  private loadSpacesForDropdown() {
    this.admin.getSpaces(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.allSpaces.set(items);
        this.spaceOptions.set(items.map((s: any) => ({ v: s.idGuid, l: `${s.name} (${s.code ?? ''}) - ${s.locationName ?? ''}` })));
        this.config.set(this.buildConfig('bookings'));
      },
      error: this.apiError('Failed to load spaces.')
    });
  }

  private loadAccountOptions() {
    if (this.accountOptions().length) return;
    this.accountCoa.getAll().subscribe({
      next: (accounts) => {
        this.accountOptions.set(accounts.map(a => ({ v: a.accountId, l: a.description })));
        this.config.set(this.buildConfig(this.entity));
      },
      error: this.apiError('Failed to load accounts.')
    });
  }

  loadLocationOptions() {
    this.admin.getLocations(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? res ?? [];
        this.locationOptions.set(items.map((l: any) => ({
          v: l.id != null ? Number(l.id) : (l.idGuid ?? l.idGUID),
          l: l.name,
          branchId: l.branchId,
          branchName: l.branchName ?? l.branchCode
        })));
        if (this.entity === 'users') {
          this.config.set(this.buildConfig(this.entity));
        }
      },
      error: this.apiError('Failed to load locations.')
    });
  }

  getBoundLocationName(locationId?: any): string {
    const targetId = locationId ?? this.formData['locationId'] ?? this.auth.user()?.locationId;
    if (!targetId) return 'Assigned Location';
    const opt = this.locationOptions().find(l => String(l.v) === String(targetId));
    return opt ? opt.l : `Location #${targetId}`;
  }

  private loadCityOptions() {
    if (this.cityOptions().length) return;
    this.citiesLoading.set(true);
    this.citiesError.set('');
    this.admin.getCities().subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.cityOptions.set(items.map((c: any) => ({ v: c.id, l: c.name })));
        this.citiesLoading.set(false);
        if (this.entity === 'customers' || this.entity === 'users' || this.entity === 'locations') {
          this.config.set(this.buildConfig(this.entity));
        }
      },
      error: () => {
        this.citiesError.set('Failed to load cities.');
        this.citiesLoading.set(false);
      }
    });
  }

  private loadBranchOptions() {
    if (this.branchOptions().length) return;
    this.branchesLoading.set(true);
    this.branchesError.set('');
    this.admin.getBranches().subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.branchOptions.set(items.map((b: any) => ({ v: b.id ?? b.branchId ?? b.v, l: b.name || b.branchName || b.l })));
        this.branchesLoading.set(false);
        if (this.entity === 'locations') {
          this.config.set(this.buildConfig(this.entity));
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
            this.branchOptions.set(Array.from(map.entries()).map(([v, l]) => ({ v, l })));
            this.branchesLoading.set(false);
            if (this.entity === 'locations') {
              this.config.set(this.buildConfig(this.entity));
            }
          },
          error: () => {
            this.branchesError.set('Failed to load branches.');
            this.branchesLoading.set(false);
          }
        });
      }
    });
  }

  openAdminBookingForm(bookingToEdit?: any) {
    this.bookingFormData = {};
    this.bookingFormError.set('');
    this.selectedSpaceTypeId = '';
    const userBookingLocId = this.auth.user()?.locationId;
    this.selectedLocationId = userBookingLocId ? String(userBookingLocId) : '';
    this.selectedAdminCapacity = null;
    this.availableAdminCapacities.set([]);
    this.adminStartDate = '';
    this.adminMonths = 12;
    this.filteredSpaceOptions.set([]);
    this.customerSearchQuery = '';
    this.customerSearchResults.set([]);
    this.selectedCustomer = null;
    this.securityDeposit = 0;
    this.securityDepositMonthsOverride = null;
    this.bookingDiscountType = 'Percentage';
    this.bookingDiscountPercentage = 0;
    this.bookingPerSeatBasePrice = 0;
    this.bookingMinPerSeatBasePrice = 0;
    this.bookingBasePriceError.set('');
    this.bookingDiscountValue = 0;
    this.bookingDiscountError.set('');
    this.bookingOfferingTypeId = 1;
    this.bookingOfferingType = '24/7';
    this.loadOfferingTypes();
    this.bookingSubtotal = 0;
    this.bookingDiscountAmount = 0;
    this.bookingFloorId = null;
    this.bookingFloorOptions.set([]);
    this.adminMeetingDate = '';
    this.adminMeetingSlots.set([]);
    this.adminSelectedSlots = new Set();
    this.meetingRoomBookingMode = 'day';
    this.editingBookingId = null;
    this.showBookingForm.set(true);

    if (!this.spaceConfigItems().length) {
      this.admin.getSpaceConfig().subscribe({
        next: (res: any) => this.spaceConfigItems.set(res?.data ?? []),
        error: this.apiError('Failed to load space config.')
      });
    }
    this.loadCityOptions();
    if (!this.locationOptions().length) {
      this.admin.getLocations(1, 1000, '').subscribe({
        next: (res: any) => {
          this.locationOptions.set((res?.data ?? []).map((l: any) => ({ v: String(l.id != null ? l.id : (l.idGuid ?? l.id)), l: l.name })));
          if (!bookingToEdit && !this.selectedLocationId && this.locationOptions().length > 0) {
            const uLoc = this.auth.user()?.locationId;
            const match = uLoc ? this.locationOptions().find(o => String(o.v) === String(uLoc)) : null;
            this.selectedLocationId = match ? String(match.v) : String(this.locationOptions()[0].v);
          }
          if (this.selectedLocationId) {
            this.onBookingLocationChange();
          }
        },
        error: this.apiError('Failed to load locations.')
      });
    } else {
      if (!bookingToEdit && !this.selectedLocationId && this.locationOptions().length > 0) {
        const uLoc = this.auth.user()?.locationId;
        const match = uLoc ? this.locationOptions().find(o => String(o.v) === String(uLoc)) : null;
        this.selectedLocationId = match ? String(match.v) : String(this.locationOptions()[0].v);
      }
      if (this.selectedLocationId) {
        this.onBookingLocationChange();
      }
    }

    const onDataReady = () => {
      if (bookingToEdit) {
        this.prefillBookingFormForEdit(bookingToEdit);
        const bId = bookingToEdit.id || bookingToEdit.bookingId || bookingToEdit.BookingId;
        if (bId) {
          this.bookingService.getBookingDetails(bId).subscribe({
            next: (res: any) => {
              const raw = res?.data ?? res ?? {};
              const c = raw.contract || raw.Contract || {};
              const merged = { ...bookingToEdit, ...raw, ...c };
              this.prefillBookingFormForEdit(merged);
            },
            error: () => {
              this.prefillBookingFormForEdit(bookingToEdit);
            }
          });
        } else {
          this.prefillBookingFormForEdit(bookingToEdit);
        }
      }
    };

    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.populateSpaceTypeOptions(items);
        if (this.allSpaces().length) {
          this.applyBookingSpaceFilter();
          onDataReady();
        } else {
          this.admin.getSpaces(1, 1000, '').subscribe({
            next: (sRes: any) => {
              this.allSpaces.set(sRes?.data ?? []);
              this.applyBookingSpaceFilter();
              onDataReady();
            },
            error: this.apiError('Failed to load spaces.')
          });
        }
      },
      error: () => {
        this.populateSpaceTypeOptions([]);
        if (this.allSpaces().length) {
          this.applyBookingSpaceFilter();
          onDataReady();
        }
      }
    });
  }

  prefillBookingFormForEdit(booking: any) {
    if (!booking) return;
    this.editingBookingId = booking.bookingId || booking.BookingId || booking.id || booking.Id || null;

    // 1. Customer Info
    const custEmail = booking.customerEmail || booking.userEmail || booking.email || '';
    const custName = booking.customerName || booking.userName || custEmail || 'Customer';
    const phoneNum = booking.customerPhone || booking.phone || booking.phoneNumber || '';
    const codeVal = booking.customerCode || booking.code || '';
    const cnicVal = booking.customerCnic || booking.cnic || booking.cnicOrPassport || '';
    const cityVal = booking.customerCityId || booking.cityId || '';
    const addrVal = booking.customerAddress || booking.address || '';
    const notesVal = booking.notes || booking.customerNotes || booking.remarks || '';

    this.selectedCustomer = {
      id: booking.customerId || booking.userId || 0,
      name: custName,
      email: custEmail,
      fullName: custName,
      customerCode: codeVal,
      code: codeVal,
      phone: phoneNum,
      phoneNumber: phoneNum,
      cnicOrPassport: cnicVal,
      cityId: cityVal,
      address: addrVal
    };

    this.customerSearchQuery = custEmail || custName;
    this.bookingFormData = {
      customerName: custName,
      customerEmail: custEmail,
      customerCode: codeVal,
      phone: phoneNum,
      cnicOrPassport: cnicVal,
      cityId: cityVal,
      address: addrVal,
      notes: notesVal
    };

    // 2. Space Resolution & Filtering
    const spId = booking.spaceId || booking.SpaceId || booking.spaceIdGuid;
    const targetSpace = (this.allSpaces() || []).find((s: any) =>
      String(s.id) === String(spId) ||
      String(s.idGuid) === String(spId) ||
      (s.code && booking.spaceCode && String(s.code).toLowerCase() === String(booking.spaceCode).toLowerCase())
    );

    const locId = targetSpace ? (targetSpace.locationIdGuid || targetSpace.locationId || targetSpace.LocationId) : (booking.locationId || booking.LocationId);
    if (locId) {
      this.selectedLocationId = String(locId);
      this.loadBookingFloors(locId);
    }

    const stName = targetSpace ? (targetSpace.spaceTypeName || targetSpace.spaceType || targetSpace.name || '').toLowerCase() : (booking.spaceTypeName || booking.spaceType || '').toLowerCase();
    const spaceCodeNum = targetSpace ? Number(targetSpace.code ?? 0) : Number(booking.spaceCode ?? 0);

    let group = 'private';
    if (spaceCodeNum >= 3200 || stName.includes('meeting') || stName.includes('conference')) group = 'meeting';
    else if (spaceCodeNum >= 3100 || stName.includes('private') || stName.includes('office')) group = 'private';
    else if (spaceCodeNum >= 3000 || stName.includes('shared') || stName.includes('co-working')) group = 'shared';
    this.selectedSpaceTypeId = group;

    const cap = targetSpace ? (targetSpace.capacity || targetSpace.Capacity) : (booking.capacity || booking.Capacity);
    if (cap) this.selectedAdminCapacity = Number(cap);

    const flId = targetSpace ? (targetSpace.floorId || targetSpace.FloorId) : (booking.floorId || booking.FloorId);
    if (flId) this.bookingFloorId = Number(flId);

    this.applyBookingSpaceFilter();

    const matchedOption = (this.filteredSpaceOptions() || []).find((opt: any) =>
      String(opt.v) === String(spId) ||
      (targetSpace && (String(opt.v) === String(targetSpace.idGuid) || String(opt.v) === String(targetSpace.id)))
    );
    if (matchedOption) {
      this.bookingFormData.spaceId = String(matchedOption.v);
    } else if (spId) {
      this.bookingFormData.spaceId = String(spId);
    }

    // 3. Contract Dates & Duration
    const startVal = booking.contractStartDate || booking.ContractStartDate || booking.startDateTime || booking.StartDateTime || booking.startOn || booking.StartOn;
    if (startVal) {
      try {
        const d = new Date(startVal);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          this.adminStartDate = `${y}-${m}-${day}`;
        }
      } catch { }
    }

    const monthsVal = booking.numberOfMonths || booking.NumberOfMonths || booking.contractPeriodMonths || booking.ContractPeriodMonths || booking.months;
    if (monthsVal) {
      this.adminMonths = Number(monthsVal);
    }

    // 4. Financials
    const billingM = booking.billingPeriodMonths || booking.BillingPeriodMonths;
    if (billingM) {
      this.bookingBillingPeriodMonths = Number(billingM);
    }

    if (booking.discountType || booking.DiscountType) {
      this.bookingDiscountType = booking.discountType || booking.DiscountType;
    }
    const discVal = booking.discountPercentage ?? booking.DiscountPercentage ?? booking.discountValue ?? booking.DiscountValue;
    if (discVal != null) {
      this.bookingDiscountPercentage = Number(discVal);
      this.bookingDiscountValue = Number(discVal);
    }

    const secMonths = booking.securityDepositMonths ?? booking.SecurityDepositMonths;
    if (secMonths != null) {
      this.securityDepositMonthsOverride = Number(secMonths);
    }
    this.bookingOfferingType = booking.offeringType || booking.operatingHours || '24/7';
    this.bookingOfferingTypeId = booking.offeringTypeId || 1;
    this.loadOfferingTypes();

    this.onBookingSpaceSelected();
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

    // 1. From /spacetype API - use categoryCode as value so all types in same category are matched
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
    (this.allSpaces() || []).forEach((s: any) => {
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

    this.spaceTypeOptions.set(Array.from(map.values()));
  }

  onBookingSpaceSelected() {
    const spaceId = this.bookingFormData.spaceId;
    if (spaceId) {
      const space = this.allSpaces().find(s => String(s.id) === String(spaceId) || String(s.idGuid) === String(spaceId));
      if (space) {
        const { monthly: standardMonthly } = this.getSpacePrice(space);
        const baseMonthly = standardMonthly > 0 ? standardMonthly : Number(space.price || space.Price || 0);
        this.bookingPerSeatBasePrice = baseMonthly;
        this.bookingMinPerSeatBasePrice = baseMonthly;
        const name = String(space.name || space.Name || '').toLowerCase();
        const { hourly, daily } = this.getSpacePrice(space);
        if (name.includes('meeting room 2') || (daily > 0 && hourly === 0)) {
          this.meetingRoomBookingMode = 'day';
        } else if (name.includes('meeting room 1') || hourly > 0) {
          this.meetingRoomBookingMode = 'slot';
          if (!this.adminMeetingDate) {
            this.adminMeetingDate = this.today;
          }
          this.generateAdminMeetingSlots();
        }
      }
    } else {
      this.bookingPerSeatBasePrice = 0;
      this.bookingMinPerSeatBasePrice = 0;
    }
    this.validateBookingBasePrice();
    this.recalcAmount();
    this.validateBookingDiscount();
  }



  onBookingLocationChange() {
    this.bookingFormData.spaceId = '';
    this.bookingFormData.totalAmount = null;
    this.securityDeposit = 0;
    this.bookingFloorId = null;
    this.bookingFloorOptions.set([]);
    if (this.selectedLocationId) {
      this.loadBookingFloors(this.selectedLocationId);
    }
    if (this.isAdminPrivateRoom) {
      this.updateAvailableAdminCapacities();
    }
    this.applyBookingSpaceFilter();
  }

  isLocationI8(locationIdOrValue: any): boolean {
    if (!locationIdOrValue) return false;
    const opt = this.locationOptions().find(l => String(l.v) === String(locationIdOrValue));
    const name = (opt?.l || String(locationIdOrValue)).toLowerCase();
    const isI8 = name.includes('i-8') || name.includes('i8') || name.includes('i 8');
    const isF7 = name.includes('f-7') || name.includes('f7') || name.includes('f 7');
    return isI8 && !isF7;
  }

  findThirdFloorId(floors: { v: any; l: string; raw?: any }[]): any {
    if (!floors || !floors.length) return null;
    const match = floors.find(f => {
      const rawNum = f.raw?.floorNumber ?? f.raw?.FloorNumber ?? f.raw?.floor_number;
      if (rawNum != null && Number(rawNum) === 3) return true;
      const str = (f.l || '').toLowerCase();
      return str.includes('3rd') || str.includes('third') || str.includes('floor 3') || str.includes('floor #3') || str.trim() === '3';
    });
    return match ? match.v : null;
  }

  loadBookingFloors(locationId: any) {
    const locInt = parseInt(String(locationId), 10);
    if (!locInt) return;
    this.admin.getFloors(locInt).subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.bookingFloorOptions.set(items.map((f: any) => ({
          v: f.id ?? f.Id,
          l: f.name || f.floorName || f.Name || (f.floorNumber != null ? `Floor ${f.floorNumber}` : `Floor #${f.id}`),
          raw: f
        })));
        if (!this.editingBookingId && this.isLocationI8(locationId)) {
          const thirdFloor = this.findThirdFloorId(this.bookingFloorOptions());
          if (thirdFloor != null) {
            this.bookingFloorId = thirdFloor;
          }
        }
      },
      error: this.apiError('Failed to load floors.')
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
    let spaces = this.allSpaces();
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

    this.availableAdminCapacities.set(Array.from(capsSet).sort((a, b) => a - b));
  }

  applyBookingSpaceFilter() {
    if (!this.selectedSpaceTypeId) {
      this.filteredSpaceOptions.set([]);
      return;
    }

    let spaces = this.allSpaces();

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
        this.filteredSpaceOptions.set([]);
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
    this.filteredSpaceOptions.set(spaces
      .filter((s: any) => s.idGuid || s.id)
      .map((s: any) => {
        const cap = this.getSpaceCapacity(s);
        const capLabel = cap > 0 ? ` - Cap: ${cap}` : '';
        const codeLabel = s.code ? ` (${s.code})` : '';
        const locLabel = s.locationName ? ` - ${s.locationName}` : '';

        const st = (s.status || s.Status || '').toString().trim().toLowerCase();
        const isBooked = st === 'booked' || st === 'occupied';
        const rawDate = s.bookedTill ?? s.BookedTill ?? s.bookedUntil ?? s.BookedUntil ?? s.endOn ?? s.EndOn;
        let bookedTillStr = '';
        if (isBooked && rawDate) {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = months[d.getMonth()];
            const year = d.getFullYear();
            bookedTillStr = ' till ' + day + ' ' + month + ' ' + year;
          }
        }
        const tag = isBooked ? (' [Booked' + bookedTillStr + ']') : ' [Available]';

        return {
          v: s.idGuid ?? s.id,
          l: `${s.name}${codeLabel}${capLabel}${locLabel}${tag}`
        };
      }));
  }

  closeAdminBookingForm() {
    this.requestDiscardableClose(this.isBookingFormDirty(), () => {
      this.showBookingForm.set(false);
      this.bookingDiscountType = 'Percentage';
      this.bookingDiscountPercentage = 0;
      this.bookingDiscountValue = 0;
      this.bookingDiscountError.set('');
      this.bookingOfferingTypeId = 1;
      this.bookingOfferingType = '24/7';
      this.loadOfferingTypes();
      this.bookingSubtotal = 0;
      this.bookingDiscountAmount = 0;
      this.securityDepositMonthsOverride = null;
      this.bookingFloorId = null;
      this.bookingFloorOptions.set([]);
      this.selectedCustomer = null;
      this.customerSearchQuery = '';
      this.bookingFormData = {};
    });
  }

  printReceipt() { window.print(); }

  downloadChallan() {
    const challan = this.challanData();
    const bookingId = challan?.bookingId || challan?.id;
    if (!bookingId) return;
    this.bookingService.getChallanPdfBlob(bookingId).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Challan-${challan?.challanNumber || bookingId}.pdf`;
        a.click();
        setTimeout(() => window.URL.revokeObjectURL(url), 2000);
      },
      error: () => {
        this.showError('Failed to download Challan PDF.');
      }
    });
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
      this.admin.getCustomers(1, 20, '').subscribe({
        next: (res: any) => {
          this.customerSearchResults.set(res?.data ?? (Array.isArray(res) ? res : []));
        },
        error: () => {
          this.customerSearchResults.set([]);
        }
      });
      return;
    }

    this.customerSearchTimer = setTimeout(() => {
      this.admin.searchCustomers(query).subscribe({
        next: (res: any) => {
          const results = res?.data ?? (Array.isArray(res) ? res : []);
          if (results.length > 0) {
            this.customerSearchResults.set(results);
          } else {
            this.fallbackCustomerSearch(query);
          }
        },
        error: () => {
          this.fallbackCustomerSearch(query);
        }
      });
    }, 100);
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
        this.customerSearchResults.set(filtered);
      },
      error: () => {
        this.customerSearchResults.set([]);
      }
    });
  }

  sanitizeCustomerFullName(rawName: string | null | undefined): string {
    if (!rawName) return '';
    const parts = rawName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      if (parts[parts.length - 1].toLowerCase() === parts[parts.length - 2].toLowerCase()) {
        parts.pop();
      }
    }
    return parts.join(' ');
  }

  selectCustomer(user: any) {
    this.selectedCustomer = user;
    let rawFn = user.fullName || '';
    if (!rawFn) {
      const f = (user.firstName || '').trim();
      const l = (user.lastName || '').trim();
      if (f && l && f.toLowerCase().endsWith(l.toLowerCase())) {
        rawFn = f;
      } else {
        rawFn = [f, l].filter(Boolean).join(' ').trim();
      }
    }
    const fullName = this.sanitizeCustomerFullName(rawFn || user.name || user.email || '');
    this.customerSearchQuery = fullName;
    this.customerSearchResults.set([]);
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
    // WN_Customers has no WN_Users link - use customerEmail to resolve at booking time
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
    return localDateIso(d);
  }

  generateAdminMeetingSlots() {
    if (!this.adminMeetingDate) { this.adminMeetingSlots.set([]); return; }
    const cfg = this.spaceConfigItems().find((c: any) =>
      (c.spaceCategory || '').toLowerCase() === 'meeting'
    );
    const openH = parseInt((cfg?.openingTime || '08:00').split(':')[0], 10);
    const closeH = parseInt((cfg?.closingTime || '20:00').split(':')[0], 10);
    const slots: { label: string; start: string; end: string }[] = [];
    for (let h = openH; h < closeH; h++) {
      const start = `${String(h).padStart(2, '0')}:00`;
      const end = `${String(h + 1).padStart(2, '0')}:00`;
      slots.push({ label: `${start} - ${end}`, start, end });
    }
    this.adminMeetingSlots.set(slots);
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
    this.adminMeetingSlots.set([]);
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
    this.adminMeetingSlots.set([]);
    this.adminSelectedSlots = new Set();
    this.meetingRoomBookingMode = 'day';
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
    const space = this.allSpaces().find((s: any) =>
      String(s.idGuid ?? '') === String(spaceId) ||
      String(s.id ?? '') === String(spaceId)
    );
    if (!space) return;

    const { hourly, daily, monthly } = this.getSpacePrice(space);

    if (this.isAdminMeetingRoom) {
      if (this.meetingRoomBookingMode === 'slot') {
        const rate = hourly > 0 ? hourly : (daily > 0 ? daily : monthly);
        const hours = this.adminSelectedSlots.size || 1;
        this.securityDeposit = 0;
        this.bookingSubtotal = parseFloat((rate * hours).toFixed(2));
      } else {
        const { startDateTime, endDateTime } = this.bookingFormData;
        if (!startDateTime || !endDateTime) return;
        const start = new Date(startDateTime);
        const end = new Date(endDateTime);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return;

        const dayRate = daily > 0 ? daily : (hourly > 0 ? hourly * 9 : (monthly > 0 ? monthly / 30 : 0));
        const diffMs = end.getTime() - start.getTime();
        const diffDays = Math.max(1, Math.ceil(diffMs / 86_400_000));
        const amount = diffDays * dayRate;

        this.securityDeposit = 0;
        this.bookingSubtotal = parseFloat(amount.toFixed(2));
      }
    } else {
      if (!this.adminStartDate || !this.adminMonths || this.adminMonths < 1) return;
      const rate = this.bookingPerSeatBasePrice > 0
        ? Number(this.bookingPerSeatBasePrice)
        : (monthly > 0 ? monthly : (daily > 0 ? daily : (hourly > 0 ? hourly : 0)));

      if (this.isAdminPrivateRoom) {
        const capacity = this.selectedAdminCapacity ? Number(this.selectedAdminCapacity) : Number(space.capacity ?? 1);
        const oneMonthRentOfRoom = rate * capacity;
        const totalRent = oneMonthRentOfRoom * Number(this.adminMonths);
        this.securityDeposit = parseFloat(oneMonthRentOfRoom.toFixed(2));
        this.bookingSubtotal = parseFloat(totalRent.toFixed(2));
      } else {
        // Shared Space - no security deposit
        const totalRent = rate * Number(this.adminMonths);
        this.securityDeposit = 0;
        this.bookingSubtotal = parseFloat(totalRent.toFixed(2));
      }
    }

    const discVal = Number(this.bookingDiscountValue || 0);
    if (this.bookingDiscountType === 'Percentage') {
      const pct = Math.min(100, Math.max(0, discVal));
      this.bookingDiscountAmount = parseFloat(((this.bookingSubtotal * pct) / 100).toFixed(2));
      this.bookingDiscountPercentage = pct;
    } else {
      if (this.isAdminMeetingRoom) {
        this.bookingDiscountAmount = parseFloat(Math.min(this.bookingSubtotal, Math.max(0, discVal)).toFixed(2));
      } else {
        const months = Number(this.adminMonths || 1);
        this.bookingDiscountAmount = parseFloat(Math.min(this.bookingSubtotal, Math.max(0, discVal * months)).toFixed(2));
      }
      this.bookingDiscountPercentage = 0;
    }
    const finalRent = Math.max(0, this.bookingSubtotal - this.bookingDiscountAmount);
    this.bookingFormData = { ...this.bookingFormData, totalAmount: parseFloat(finalRent.toFixed(2)) };
    this.validateBookingDiscount();
  }

  submitAdminBooking() {
    this.bookingFormSaving.set(true);
    this.bookingFormError.set('');
    this.bookingFormErrorField = '';

    if (!this.selectedCustomer) {
      const msg = 'Please select a customer.';
      this.bookingFormErrorField = 'customer';
      this.bookingFormError.set(msg);
      this.showError(msg);
      this.scrollToTopAndHighlight('customer');
      this.bookingFormSaving.set(false);
      return;
    }
    if (!this.selectedSpaceTypeId) {
      const msg = 'Please select space type.';
      this.bookingFormErrorField = 'spaceType';
      this.bookingFormError.set(msg);
      this.showError(msg);
      this.scrollToTopAndHighlight('spaceType');
      this.bookingFormSaving.set(false);
      return;
    }
    if (this.isAdminPrivateRoom && !this.selectedAdminCapacity) {
      const msg = 'Please select room capacity.';
      this.bookingFormErrorField = 'capacity';
      this.bookingFormError.set(msg);
      this.showError(msg);
      this.scrollToTopAndHighlight('capacity');
      this.bookingFormSaving.set(false);
      return;
    }
    if (!this.bookingFormData.spaceId) {
      const msg = 'Please select a space.';
      this.bookingFormErrorField = 'space';
      this.bookingFormError.set(msg);
      this.showError(msg);
      this.scrollToTopAndHighlight('space');
      this.bookingFormSaving.set(false);
      return;
    }
    if (this.isAdminMeetingRoom && this.meetingRoomBookingMode === 'slot' && this.adminSelectedSlots.size === 0) {
      const msg = 'Please select at least one time slot.';
      this.bookingFormErrorField = 'slots';
      this.bookingFormError.set(msg);
      this.showError(msg);
      this.scrollToTopAndHighlight('slots');
      this.bookingFormSaving.set(false);
      return;
    }
    if (!this.isAdminMeetingRoom && (!this.adminStartDate || !this.adminMonths || this.adminMonths < 1)) {
      const msg = 'Please specify start date and number of months.';
      this.bookingFormErrorField = 'startDate';
      this.bookingFormError.set(msg);
      this.showError(msg);
      this.scrollToTopAndHighlight('startDate');
      this.bookingFormSaving.set(false);
      return;
    }
    if (this.isAdminMeetingRoom && this.meetingRoomBookingMode === 'day' && (!this.adminStartDate || !this.adminMeetingDayEnd)) {
      const msg = 'Please specify start and end date for the meeting room booking.';
      this.bookingFormErrorField = 'meetingDayEnd';
      this.bookingFormError.set(msg);
      this.showError(msg);
      this.scrollToTopAndHighlight('meetingDayEnd');
      this.bookingFormSaving.set(false);
      return;
    }
    this.validateBookingDiscount();
    if (this.bookingDiscountError()) {
      this.bookingFormErrorField = 'discount';
      this.bookingFormError.set(this.bookingDiscountError());
      this.showError(this.bookingDiscountError());
      this.scrollToTopAndHighlight('discount');
      this.bookingFormSaving.set(false);
      return;
    }

    if (!this.bookingFormData.totalAmount || this.bookingFormData.totalAmount <= 0) {
      this.recalcAmount();
    }

    const u = this.selectedCustomer;

    const targetSpace = this.allSpaces().find((s: any) =>
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
      const bookingUserId = Number(u.userId || 0) || currentAdminId;

      const payload = {
        userId: bookingUserId || 0,
        spaceId: numericSpaceId || 0,
        pricingId: 0,
        startOn: this.bookingFormData.startDateTime,
        endOn: this.bookingFormData.endDateTime,
        startDateTime: this.bookingFormData.startDateTime,
        endDateTime: this.bookingFormData.endDateTime,
        notes: this.bookingFormData.notes || null,
        createdById: currentAdminId || 1,
        userEmail: u.email || this.bookingFormData.customerEmail || null,
        customerEmail: u.email || this.bookingFormData.customerEmail || null,
        customerFirstName,
        customerLastName,
        customerPhone: u.phoneNumber || u.phone || this.bookingFormData.phone || null,
        customerCnic: u.cnicOrPassport || this.bookingFormData.cnicOrPassport || null,
        customerAddress: u.address || this.bookingFormData.address || null,
        customerCityId: this.bookingFormData.cityId ? Number(this.bookingFormData.cityId) : (u.cityId ? Number(u.cityId) : null),
        customerNotes: this.bookingFormData.notes || null,
        offeringType: this.bookingOfferingType,
        offeringTypeId: this.bookingOfferingTypeId || 1,
        // Compatibility properties
        spaceIdGuid: spaceGuidStr,
        userIdGuid: u.idGUID ?? u.idGuid ?? String(u.id ?? ''),
        customerCode: u.customerCode || u.code || '',
        customerName: `${customerFirstName} ${customerLastName}`.trim(),
        totalAmount: this.bookingFormData.totalAmount,
        subtotalAmount: this.bookingSubtotal,
        discountType: this.bookingDiscountType,
        discountPercentage: this.bookingDiscountType === 'Percentage' ? Number(this.bookingDiscountValue || 0) : 0,
        discountValue: Number(this.bookingDiscountValue || 0),
        discountAmount: this.bookingDiscountAmount,
        securityDeposit: this.effectiveSecurityDeposit,
        billingPeriodMonths: this.bookingBillingPeriodMonths,
        securityDepositMonths: this.bookingSecurityDepositMonths,
        securityDepositOverride: this.effectiveSecurityDeposit,
        floorId: this.bookingFloorId ?? null,
        capacity: this.selectedAdminCapacity ? Number(this.selectedAdminCapacity) : null,
        // Sent only when raised, so standard bookings keep working before the WN_Bookings_Insert update is applied.
        perSeatBasePrice: this.bookingHasRaisedBasePrice ? Number(this.bookingPerSeatBasePrice) : null,
      };

      if (this.editingBookingId) {
        this.admin.updateBooking(this.editingBookingId, payload).subscribe({
          next: (res: any) => {
            const d = Array.isArray(res?.data) ? res.data[0] : (Array.isArray(res) ? res[0] : (res?.data ?? res ?? {}));
            const errorMsg = d?.errorMessage || d?.ErrorMessage || res?.errorMessage || (res?.isSuccessful === false ? res?.message : null);

            if (errorMsg) {
              this.bookingFormSaving.set(false);
              this.bookingFormError.set(errorMsg);
              this.bookingFormErrorField = 'space';
              this.showError(errorMsg);
              this.scrollToTopAndHighlight('space');
              return;
            }

            this.bookingFormSaving.set(false);
            this.showBookingForm.set(false);
            const bId = this.editingBookingId;
            this.editingBookingId = null;
            this.success.set(`Booking #${bId} updated successfully.`);
            this.showSuccess(this.success());
            setTimeout(() => this.success.set(''), 3500);
            this.load();
          },
          error: (err: any) => {
            this.bookingFormSaving.set(false);
            this.bookingFormError.set(err?.error?.message || err?.error?.ErrorMessage || err?.message || 'Failed to update booking.');
            this.bookingFormErrorField = 'space';
            this.showError(this.bookingFormError());
            this.scrollToTopAndHighlight('space');
          }
        });
        return;
      }

      this.admin.createAdminBooking(payload).subscribe({
        next: (res: any) => {
          const d = Array.isArray(res?.data) ? res.data[0] : (Array.isArray(res) ? res[0] : (res?.data ?? res ?? {}));
          const errorMsg = d?.errorMessage || d?.ErrorMessage || res?.errorMessage || (res?.isSuccessful === false ? res?.message : null);

          if (errorMsg) {
            console.error('[BOOKING TEST] Creation returned error message:', errorMsg);
            this.bookingFormSaving.set(false);
            this.bookingFormError.set(errorMsg);
            this.bookingFormErrorField = 'space';
            this.showError(errorMsg);
            this.scrollToTopAndHighlight('space');
            return;
          }

          this.bookingFormSaving.set(false);
          this.showBookingForm.set(false);

          const bookingId = d.bookingId ?? d.BookingId ?? d.id ?? d.Id ?? null;
          const space = targetSpace || this.allSpaces().find((s: any) => String(s.id) === String(payload.spaceId) || String(s.idGuid) === String(payload.spaceIdGuid));

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
                    return { feeType: 'RoomRent', amount: this.bookingSubtotal, description: `Meeting Room - Full Day (${days} day${days > 1 ? 's' : ''}9 hrs/day)` };
                  }
                  return { feeType: 'RoomRent', amount: this.bookingSubtotal };
                })(),
                ...(this.bookingDiscountAmount > 0 ? [{ feeType: 'DISCOUNT', amount: this.bookingDiscountAmount, notes: `Discount applied: ${Number(this.bookingDiscountPercentage).toFixed(2)}%` }] : []),
                ...(this.effectiveSecurityDeposit > 0 ? [{ feeType: 'SecurityDeposit', amount: this.effectiveSecurityDeposit }] : [])
              ]);

          let receipt;
          const tax = this.bookingTaxAmount;
          if (!this.isAdminMeetingRoom) {
            const billingMonths = payload.billingPeriodMonths || 3;
            const secMonths = payload.securityDepositMonths || 0;
            const billingRentAmount = this.bookingBillingAmount;
            const secDepositAmount = this.effectiveSecurityDeposit;
            const discount = this.bookingFirstInvoiceDiscount;
            const firstInvoiceTotal = this.bookingFirstInvoiceTotal;

            const billingDetails = [
              { feeType: 'RoomRent', description: `Room Rent (${billingMonths} Month(s))`, amount: billingRentAmount }
            ];
            if (secMonths > 0) {
              billingDetails.push({ feeType: 'SecurityDeposit', description: `Security Deposit (${secMonths} Month(s))`, amount: secDepositAmount });
            }
            if (tax > 0) {
              billingDetails.push({ feeType: 'TAX', description: 'Provincial Sales Tax (16% PST on Support Services)', amount: tax });
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
              contractPeriodMonths: Number(this.adminMonths || 12),
              numberOfMonths: Number(this.adminMonths || 12),
              months: Number(this.adminMonths || 12),
              billingPeriodMonths: billingMonths,
              securityDepositMonths: secMonths,
              monthlyRent: Number(this.bookingMonthlyRent),
              totalContractAmount: Number(this.bookingSubtotal),
              currentCycleAmount: Number(billingRentAmount),
              firstCycleRent: Number(billingRentAmount),
              securityDeposit: secDepositAmount,
              securityDepositOverride: secDepositAmount,
              taxAmount: tax,
              taxAmountOnAdvanceRent: tax,
              taxAmountOnContract: Math.round(2000 * (Number(this.selectedAdminCapacity) || 1) * Number(this.adminMonths || 12) * 0.16 * 100) / 100,
              bookingDetails: billingDetails,
              subtotalAmount: billingRentAmount,
              discountPercentage: Number(this.bookingDiscountPercentage || 0),
              discountAmount: discount,
              totalAmount: firstInvoiceTotal,
              totalPayable: firstInvoiceTotal,
              notes: payload.notes,
              createdAt: new Date().toISOString(),
            };
          } else {
            const secDepositAmount = 0;
            const billingRentAmount = this.bookingSubtotal;
            const firstInvoiceTotal = Math.max(0, billingRentAmount + tax - this.bookingDiscountAmount);

            const fullDetails = [
              { feeType: 'RoomRent', description: `Meeting Room Rent`, amount: billingRentAmount }
            ];
            if (tax > 0) {
              fullDetails.push({ feeType: 'TAX', description: 'Provincial Sales Tax (16% PST)', amount: tax });
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
              billingPeriodEnd: payload.endDateTime,
              startDateTime: payload.startDateTime,
              endDateTime: payload.endDateTime,
              monthlyRent: 0,
              totalContractAmount: billingRentAmount,
              currentCycleAmount: billingRentAmount,
              firstCycleRent: billingRentAmount,
              securityDeposit: 0,
              taxAmount: tax,
              taxAmountOnAdvanceRent: tax,
              taxAmountOnContract: tax,
              bookingDetails: fullDetails,
              subtotalAmount: billingRentAmount,
              discountPercentage: Number(this.bookingDiscountPercentage || 0),
              discountAmount: this.bookingDiscountAmount,
              totalAmount: firstInvoiceTotal,
              totalPayable: firstInvoiceTotal,
              firstInvoiceTotal: firstInvoiceTotal,
              notes: payload.notes,
              createdAt: new Date().toISOString(),
            };
          }
          const createdBookingObj = {
            _localCreated: true,
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
          this.showChallanModal.set(true);
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
          const msg = err?.error?.errorMessage || err?.error?.ErrorMessage || err?.error?.message || err?.message || 'Failed to create booking.';
          this.bookingFormError.set(msg);
          this.bookingFormErrorField = 'space';
          this.showError(msg);
          this.scrollToTopAndHighlight('space');
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
    this.config().getFn(this.page(), this.pageSize(), this.searchQuery).subscribe({
      next: (res: any) => {
        let data = Array.isArray(res) ? res
          : Array.isArray(res?.data) ? res.data
            : Array.isArray(res?.data?.items) ? res.data.items
              : Array.isArray(res?.items) ? res.items
                : Array.isArray(res?.data?.bookings) ? res.data.bookings
                  : Array.isArray(res?.bookings) ? res.bookings
                    : Array.isArray(res?.data?.quotations) ? res.data.quotations
                      : Array.isArray(res?.quotations) ? res.quotations
                        : (res?.data ?? []);

        // Merge API data with any locally created admin bookings or declined quotation messages
        this.items.update(currentItems => {
          if (this.entity === 'bookings') {
            // Bookings are paged on the server, so only keep a just-created booking (flagged
            // _localCreated) on the unfiltered first page until the API returns it.
            const backendIds = new Set(data.map((x: any) => String(x.bookingId ?? x.id ?? x.BookingId ?? '')));
            const keepLocal = this.page() === 1 && !this.searchQuery;
            const localOnly = !keepLocal ? [] : currentItems.filter((x: any) => {
              const id = String(x.bookingId ?? x.id ?? x.BookingId ?? '');
              return x._localCreated && id && !backendIds.has(id);
            });
            const merged = [...localOnly, ...data].sort((a: any, b: any) => {
              const idA = Number(a.id ?? a.bookingId ?? a.Id ?? a.BookingId ?? 0);
              const idB = Number(b.id ?? b.bookingId ?? b.Id ?? b.BookingId ?? 0);
              if (idA && idB) return idB - idA;
              const dateA = new Date(a.createdOn || a.createdAt || a.startDateTime || a.startOn || a.bookedOn || 0).getTime();
              const dateB = new Date(b.createdOn || b.createdAt || b.startDateTime || b.startOn || b.bookedOn || 0).getTime();
              return dateB - dateA;
            });
            return merged;
          }
          return data;
        });

        if (this.entity === 'contacts') {
          const contactsOnly = (data || []).map((c: any) => ({
            ...c,
            fullName: c.fullName || c.FullName || c.name || c.Name || c.userName || c.customerName || c.CustomerName || '-',
            email: c.email || c.Email || c.customerEmail || c.CustomerEmail || '-',
            phone: c.phone || c.Phone || c.phoneNumber || c.PhoneNumber || c.customerPhone || '-',
            company: c.company || c.Company || '-',
            subject: c.subject || c.Subject || c.contactType || c.ContactType || c.type || c.Type || 'Book Tour Request',
            message: c.message || c.Message || c.notes || c.Notes || c.body || c.Body || '-',
            status: c.status || c.Status || (c.statusId === 1 ? 'New' : c.statusId === 2 ? 'InProgress' : c.statusId === 3 ? 'Resolved' : 'New'),
            createdAt: c.createdAt || c.CreatedAt || c.createdDate || c.CreatedDate || c.createdOn || c.CreatedOn || ''
          }));
          this.items.set(contactsOnly);
          this.totalCount.set(res?.total ?? res?.Total ?? res?.totalCount ?? res?.TotalCount ?? res?.data?.total ?? contactsOnly.length);
          this.loading.set(false);
          if (cb) cb();
          return;
        }

        if (this.entity === 'quotation-responses') {
          const rawList = Array.isArray(res) ? res
            : Array.isArray(res?.data) ? res.data
              : Array.isArray(res?.Data) ? res.Data
                : Array.isArray(res?.quotations) ? res.quotations
                  : (res?.data ?? res?.Data ?? []);

          const responseItems = (rawList || [])
            .filter((item: any) => {
              if (item.responseType || item.ResponseType) return true;
              const st = (item.status || item.Status || '').toString().toLowerCase();
              return st === 'declined' || st === 'accepted' || item.customerNote || item.responseNote || item.note;
            })
            .map((item: any) => ({
              id: item.id || item.Id || item.quotationId || item.QuotationId,
              quotationId: item.quotationId || item.QuotationId || item.id || item.Id,
              quotationNumber: item.quotationNumber || item.QuotationNumber || ('#Q-' + (item.quotationId || item.QuotationId || item.id || item.Id)),
              version: item.version || item.Version || item.versionNumber || item.VersionNumber || 1,
              fullName: item.customerName || item.CustomerName || item.fullName || item.FullName || item.customerEmail || item.CustomerEmail || 'Customer',
              email: item.customerEmail || item.CustomerEmail || item.email || item.Email || '-',
              phone: item.customerPhone || item.CustomerPhone || item.phone || item.Phone || item.phoneNumber || item.PhoneNumber || '-',
              responseType: item.responseType || item.ResponseType || item.status || item.Status || (item.note || item.Note ? 'Responded' : 'Pending'),
              note: item.note || item.Note || item.customerNote || item.CustomerNote || item.responseNote || item.ResponseNote || item.remarks || item.Remarks || '-',
              respondedDate: item.respondedDate || item.RespondedDate || item.updatedDate || item.UpdatedDate || item.createdDate || item.CreatedDate || item.createdAt || item.CreatedAt || new Date().toISOString(),
              isQuotationResponse: true,
              rawQuotationItem: item
            }))
            .sort((a: any, b: any) => {
              const dA = new Date(a.respondedDate || 0).getTime();
              const dB = new Date(b.respondedDate || 0).getTime();
              return dB - dA;
            });

          this.items.set(responseItems);
          this.totalCount.set(res?.total ?? res?.Total ?? res?.totalCount ?? res?.TotalCount ?? responseItems.length);
          this.loading.set(false);
          if (cb) cb();
          return;
        }

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


  onPageSizeChange(size: number) { this.pageSize.set(+size); this.page.set(1); this.load(); }
  prevPage() { if (this.canPrev()) { this.page.update(p => p - 1); this.load(); } }
  nextPage() { if (this.canNext()) { this.page.update(p => p + 1); this.load(); } }

  getCellValue(item: any, col: ColDef): any {
    if (!item) return '';

    if (this.entity === 'agreements') {
      if (col.key === 'quotationNumber') {
        return item.quotationNumber || item.QuotationNumber || (item.quotationId ? `#Q-${item.quotationId}` : '-');
      }
      if (col.key === 'customerName') {
        return item.customerFullName || item.customerName || item.CustomerName || item.fullName || item.companyName || item.CompanyName || '-';
      }
      if (col.key === 'customerEmail') {
        return item.customerEmail || item.userEmail || item.email || item.CustomerEmail || item.overrideEmail || '-';
      }
      if (col.key === 'spaceName') {
        return item.spaceName || item.SpaceName || item.spaceCode || '-';
      }
      if (col.key === 'entityType') {
        return item.entityType || item.EntityType || 'Individual';
      }
      if (col.key === 'monthlyFee') {
        return item.feeAmount ?? item.FeeAmount ?? item.monthlyFee ?? item.MonthlyFee ?? 0;
      }
      if (col.key === 'securityDeposit') {
        return item.securityDeposit ?? item.SecurityDeposit ?? 0;
      }
      if (col.key === 'contractStartDate') {
        return item.contractStartDate || item.ContractStartDate || item.startDate || item.StartDate || '';
      }
      if (col.key === 'contractEndDate') {
        return item.contractEndDate || item.ContractEndDate || item.endDate || item.EndDate || '';
      }
      if (col.key === 'status') {
        const st = String(item.status || item.Status || 'AgreementSent');
        const labels: Record<string, string> = {
          agreementsent: 'Sent', sent: 'Sent', signeduploaded: 'Signed copy received â€” verify',
          emailfailed: 'Email failed â€” resend', signed: 'Signed', converted: 'Signed'
        };
        return (item.bookingId || item.BookingId) ? 'Signed Â· booking created' : (labels[st.toLowerCase()] ?? st);
      }
      if (col.key === 'createdOn') {
        return item.sentDate || item.SentDate || item.createdOn || item.CreatedOn || item.createdAt || item.CreatedAt || '';
      }
    }

    if (this.entity === 'customers') {
      if (col.key === 'customerType') {
        return item.customerType || (item.company && item.company.trim() && item.company.toLowerCase() !== 'individual' ? 'Company' : 'Individual');
      }
      if (col.key === 'company') {
        return (item.company && item.company.trim() && item.company.toLowerCase() !== 'individual') ? item.company : '-';
      }
    }

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
        const payable = this.getQuotationInitialPayable(item);
        return payable > 0 ? payable : (item.totalPayable ?? item.totalAmount ?? item.TotalAmount ?? 0);
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
          // WN_BookingStatuses: 3 Rejected, 5 Pending, 6 No Show, 33 Confirmed, 86 Cancelled (1 = old pending)
          const statusNames: Record<number, string> = { 1: 'Pending', 3: 'Rejected', 5: 'Pending', 6: 'No Show', 33: 'Confirmed', 86: 'Cancelled' };
          return statusNames[st] || 'Pending';
        }
        return st || 'Confirmed';
      }
      if (col.key === 'challanNumber') {
        return this.formatChallanDisplay(item);
      }
      if (col.key === 'totalAmount') {
        const backendAmt = item.initialPayable ?? item.InitialPayable;
        if (backendAmt != null && Number(backendAmt) > 0) return Number(backendAmt);

        const payable = this.getChallanInitialPayable(item);
        if (payable > 0) return payable;
        const billedVal = item.totalPayable ?? item.currentCycleAmount ?? item.CurrentCycleAmount ?? item.firstCycleRent ?? item.FirstCycleRent;
        if (billedVal != null && Number(billedVal) > 0) return Number(billedVal);
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

        return 0;
      }
    }

    if (this.entity === 'invoices') {
      if (col.key === 'invoiceNumber') {
        return item.invoiceNumber || item.InvoiceNumber || ('INV-' + (item.id || item.Id || item.bookingId || item.BookingId));
      }
      if (col.key === 'customerName') {
        return item.customerName || item.CustomerName || item.userEmail || item.UserEmail || item.customerEmail || item.CustomerEmail || 'Customer';
      }
      if (col.key === 'spaceName') {
        const directName = item.spaceName || item.SpaceName || item.spaceTitle || item.SpaceTitle;
        if (directName && !directName.toLowerCase().startsWith('booking #')) return directName;

        const sId = item.spaceId || item.SpaceId;
        if (sId && this.allSpaces()?.length) {
          const found = this.allSpaces().find((sp: any) => sp.id === sId || sp.Id === sId || sp.code == sId);
          if (found?.name || found?.Name) return found.name || found.Name;
        }

        const spaceNum = item.spaceCode || item.SpaceCode || item.spaceNumber || item.SpaceNumber || sId;
        if (spaceNum) return `Space #${spaceNum}`;

        const bId = item.bookingId || item.BookingId;
        if (bId) return `Space #${bId}`;

        return '-';
      }
      if (col.key === 'billingPeriodDisplay') {
        const start = item.billingPeriodStart || item.BillingPeriodStart || item.startOn || item.StartOn;
        const end = item.billingPeriodEnd || item.BillingPeriodEnd || item.endOn || item.EndOn;
        if (start && end) {
          const s = new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const e = new Date(end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          return `${s} - ${e}`;
        }
        return start ? new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
      }
      if (col.key === 'issuedOn') {
        return item.issuedOn || item.IssuedOn || item.createdOn || item.CreatedOn || '';
      }
      if (col.key === 'dueOn') {
        return item.dueOn || item.DueOn || item.validityDate || item.ValidityDate || '';
      }
      if (col.key === 'grandTotal') {
        return item.grandTotal ?? item.GrandTotal ?? item.totalAmount ?? item.TotalAmount ?? item.subTotal ?? 0;
      }
      if (col.key === 'paidTotal') {
        return item.paidTotal ?? item.PaidTotal ?? item.amountPaid ?? item.AmountPaid ?? 0;
      }
      if (col.key === 'balanceDue') {
        const total = Number(item.grandTotal ?? item.GrandTotal ?? item.totalAmount ?? item.TotalAmount ?? 0);
        const paid = Number(item.paidTotal ?? item.PaidTotal ?? item.amountPaid ?? item.AmountPaid ?? 0);
        return Math.max(0, total - paid);
      }
      if (col.key === 'statusLabel') {
        // The API resolves the label from dbo.OrderStatus (and legacy values) â€” show it, normalised.
        const label = String(item.statusLabel ?? item.StatusLabel ?? item.status ?? '').trim().toLowerCase();
        const map: Record<string, string> = {
          'paid': 'Paid', 'partial': 'Partial', 'overdue': 'Overdue', 'challan expire': 'Overdue',
          'cancelled': 'Cancelled', 'un paid': 'Unpaid', 'unpaid': 'Unpaid'
        };
        let status = map[label];
        if (!status) {
          // No recognised status (e.g. "Unknown"): work it out from the amounts.
          const total = Number(item.grandTotal ?? item.GrandTotal ?? 0), paid = Number(item.paidTotal ?? item.PaidTotal ?? 0);
          status = total > 0 && paid >= total ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
        }
        // Unpaid / part-paid past the due date reads as Overdue (same rule as the dashboard).
        const due = item.dueOn ?? item.DueOn;
        if ((status === 'Unpaid' || status === 'Partial') && due) {
          const d = new Date(due); const today = new Date(); today.setHours(0, 0, 0, 0);
          if (!isNaN(d.getTime()) && d < today) status = 'Overdue';
        }
        return status;
      }
    }

    if (this.entity === 'payments') {
      if (col.key === 'bookingId') {
        const bid = item.bookingId ?? item.BookingId ?? item.bookingPublicId ?? item.BookingPublicId;
        return bid ? `#${bid}` : '-';
      }
      if (col.key === 'userEmail') {
        return item.userEmail || item.UserEmail || item.customerEmail || item.CustomerEmail || item.userName || item.CustomerName || '-';
      }
      if (col.key === 'spaceName') {
        return item.spaceName || item.SpaceName || item.spaceNumber || item.SpaceNumber || item.spaceCode || (item.bookingId || item.BookingId ? `Space #${item.bookingId || item.BookingId}` : '-');
      }
      if (col.key === 'amountType') {
        return item.feeType || item.FeeType || item.chargeTypeLabel || item.amountType || item.billingPeriodLabel || item.billingPeriod || (item.securityDeposit && item.amount === item.securityDeposit ? 'Security Deposit' : 'Cycle Rent');
      }
      if (col.key === 'amount') {
        return item.amount ?? item.Amount ?? 0;
      }
      if (col.key === 'paymentMethod') {
        return item.paymentMethod || item.PaymentMethod || item.paymentMethodLabel || 'Bank Transfer';
      }
      if (col.key === 'challanNumber') {
        return this.formatChallanDisplay(item);
      }
      if (col.key === 'paymentStatus') {
        return item.paymentStatus || item.PaymentStatus || (item.statusId === 2 ? 'Paid' : 'Pending');
      }
      if (col.key === 'paidAt') {
        return item.paidAt || item.PaidAt || item.paidOn || item.PaidOn || item.createdOn || item.CreatedOn || item.createdAt || '';
      }
    }

    if (this.entity === 'contacts') {
      if (col.key === 'fullName') {
        return item.fullName || item.customerName || item.CustomerName || item.name || item.userName || item.email || '-';
      }
      if (col.key === 'email') {
        return item.email || item.customerEmail || item.CustomerEmail || item.userEmail || '-';
      }
      if (col.key === 'phone') {
        return item.phone || item.phoneNumber || item.customerPhone || item.CustomerPhone || '-';
      }
      if (col.key === 'subject') {
        return item.subject || item.type || 'Book Tour Request';
      }
      if (col.key === 'message') {
        return item.message || item.customerNote || item.note || item.remarks || '-';
      }
      if (col.key === 'status') {
        return item.status || item.Status || 'New';
      }
      if (col.key === 'createdAt') {
        return item.createdAt || item.createdDate || item.updatedDate || item.CreatedDate || item.UpdatedDate || '';
      }
    }

    if (this.entity === 'quotation-responses') {
      if (col.key === 'quotationNumber') {
        return item.quotationNumber || (`#Q-${item.quotationId || item.id}`);
      }
      if (col.key === 'version') {
        return `v${item.version || item.versionNumber || 1}`;
      }
      if (col.key === 'fullName') {
        return item.fullName || item.customerName || item.CustomerName || item.name || '-';
      }
      if (col.key === 'email') {
        return item.email || item.customerEmail || item.CustomerEmail || '-';
      }
      if (col.key === 'phone') {
        return item.phone || item.customerPhone || item.CustomerPhone || '-';
      }
      if (col.key === 'responseType') {
        return item.responseType || item.status || item.Status || 'Responded';
      }
      if (col.key === 'note') {
        return item.note || item.message || item.customerNote || item.responseNote || '-';
      }
      if (col.key === 'respondedDate') {
        return item.respondedDate || item.createdAt || item.createdDate || item.updatedDate || '';
      }
    }

    return item[col.key] ?? '';
  }

  formatChallanDisplay(c: any): string {
    if (!c) return '-';
    const val = c.challanNumber
      || c.ChallanNumber
      || c.challan_number
      || c.Challan_Number
      || c.challanNo
      || c.ChallanNo
      || c.challanCode
      || c.ChallanCode
      || c.code
      || c.Code;

    if (val && String(val).trim() !== '' && String(val).trim() !== '-') return String(val).trim();

    const bId = c.bookingId ?? c.BookingId ?? c.id ?? c.Id;
    if (!bId) return '-';

    let dateObj = new Date();
    const dStr = c.createdOn || c.createdAt || c.bookedOn || c.startOn || c.startDateTime || c.BookedOn || c.CreatedOn || c.StartOn || c.StartDateTime;
    if (dStr) {
      const parsed = new Date(dStr);
      if (!isNaN(parsed.getTime())) dateObj = parsed;
    }
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `WN-${yyyy}${mm}${dd}-${String(bId).padStart(6, '0')}`;
  }


  openCreate() {
    this.editItem = null; this.formData = {}; this.error.set(''); this.showModal.set(true);
    this.selectedAmenityIds = [];
    const boundLoc = this.auth.user()?.locationId;
    if (!this.isSuperAdmin && boundLoc) {
      this.formData.locationId = boundLoc;
      if (this.entity === 'spaces') {
        this.loadFloorsForLocation(boundLoc);
      }
    }
    if (this.entity === 'users') {
      this.formData.role = 'general';
      if (!this.isSuperAdmin && boundLoc) {
        this.formData.locationId = boundLoc;
      }
      if (!this.locationOptions().length) this.loadLocationOptions();
      if (!this.cityOptions().length) this.loadCityOptions();
    }
    if (this.entity === 'customers') {
      this.selectedCountryCode = '+92';
      this.formData.countryCode = '+92';
      this.formData.customerType = 'Individual';
      this.formData.company = '';
    }
    if (this.entity === 'bookings') this.initBookingCalendar();
    if (this.entity === 'gallery') this.formData.isActive = true;
    if (this.entity === 'users') {
      this.formData.role = 'general';
      if (!this.isSuperAdmin && this.auth.user()?.locationId) {
        this.formData.locationId = this.auth.user()?.locationId;
      }
      if (!this.locationOptions().length) this.loadLocationOptions();
      if (!this.cityOptions().length) this.loadCityOptions();
    }
    if (this.entity === 'quotations') {
      this.showModal.set(false);
      this.openAdminQuotationForm();
    }
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

  requestDiscardableClose(isDirty: boolean, closeAction: () => void, title?: string, message?: string) {
    if (isDirty) {
      this.discardConfirmTitle = title || 'Discard Unsaved Changes?';
      this.discardConfirmMessage = message || 'You have unsaved changes in this form. Closing now will discard all entered details.';
      this.pendingDiscardAction = closeAction;
      this.showDiscardConfirm.set(true);
    } else {
      closeAction();
    }
  }

  confirmDiscard() {
    this.showDiscardConfirm.set(false);
    if (this.pendingDiscardAction) {
      const action = this.pendingDiscardAction;
      this.pendingDiscardAction = null;
      action();
    }
  }

  cancelDiscard() {
    this.showDiscardConfirm.set(false);
    this.pendingDiscardAction = null;
  }

  isQuickCustomerFormDirty(): boolean {
    if (!this.quickCustomerForm) return false;
    const { customerType, firstName, lastName, company, email, phoneNumber, addressLine1, addressLine2, cityId } = this.quickCustomerForm;
    return Boolean(
      (customerType && customerType !== 'Individual') ||
      (firstName && firstName.trim()) ||
      (lastName && lastName.trim()) ||
      (company && company.trim()) ||
      (email && email.trim()) ||
      (phoneNumber && phoneNumber.trim()) ||
      (addressLine1 && addressLine1.trim()) ||
      (addressLine2 && addressLine2.trim()) ||
      cityId
    );
  }

  requestCloseQuickCreateCustomer() {
    this.requestDiscardableClose(
      this.isQuickCustomerFormDirty(),
      () => this.forceCloseQuickCreateCustomer(),
      'Discard Customer Information?',
      'You have unsaved changes in the customer form. Closing now will discard all entered details.'
    );
  }

  forceCloseQuickCreateCustomer() {
    this.showQuickCreateCustomer.set(false);
    this.quickCustomerError.set('');
    this.quickCustomerForm = {
      customerType: 'Individual',
      firstName: '',
      lastName: '',
      company: '',
      email: '',
      countryCode: '+92',
      phoneNumber: '',
      addressLine1: '',
      addressLine2: '',
      cityId: ''
    };
  }

  isEntityFormDirty(): boolean {
    if (!this.formData) return false;
    if (this.editItem) {
      return Object.keys(this.formData).some(k => {
        const val = this.formData[k];
        const orig = (this.editItem as any)[k];
        if (val === orig) return false;
        if ((val === '' || val === null || val === undefined) && (orig === '' || orig === null || orig === undefined)) return false;
        return String(val) !== String(orig);
      });
    }
    return Object.values(this.formData).some(v => v !== undefined && v !== null && String(v).trim() !== '' && v !== false);
  }

  isConfigFormDirty(): boolean {
    if (!this.configFormData) return false;
    if (this.editingConfig) {
      return Object.keys(this.configFormData).some(k => {
        const val = this.configFormData[k];
        const orig = (this.editingConfig as any)[k];
        if (val === orig) return false;
        if ((val === '' || val === null || val === undefined) && (orig === '' || orig === null || orig === undefined)) return false;
        return String(val) !== String(orig);
      });
    }
    return Object.values(this.configFormData).some(v => v !== undefined && v !== null && String(v).trim() !== '' && v !== false);
  }

  isAddSpaceFormDirty(): boolean {
    return Boolean(
      (this.addSpaceTypeId && this.addSpaceTypeId.trim()) ||
      (this.addSpacePreviewCode && this.addSpacePreviewCode.trim())
    );
  }

  isReassignFormDirty(): boolean {
    return Boolean(
      this.selectedNewSpace ||
      this.reassignBooking
    );
  }

  isQuotationFormDirty(): boolean {
    return Boolean(
      this.selectedCustomer ||
      (this.customerSearchQuery && this.customerSearchQuery.trim()) ||
      this.selectedQuotationSpaceTypeId ||
      this.quotationFormData?.spaceId ||
      this.quotationDiscountValue ||
      (this.quotationRemarks && this.quotationRemarks.trim())
    );
  }

  isBookingFormDirty(): boolean {
    return Boolean(
      this.selectedCustomer ||
      (this.customerSearchQuery && this.customerSearchQuery.trim()) ||
      this.selectedSpaceTypeId ||
      this.bookingFormData?.spaceId ||
      this.bookingDiscountValue ||
      (this.bookingFormData?.notes && String(this.bookingFormData.notes).trim())
    );
  }

  isCustomInvoiceFormDirty(): boolean {
    return Boolean(
      (this.customInvoiceFormData?.notes && this.customInvoiceFormData.notes.trim()) ||
      (this.customInvoiceLines && this.customInvoiceLines.some((l: any) => (l.description && l.description.trim()) || (l.unitPrice && l.unitPrice > 0)))
    );
  }

  isSendAgreementFormDirty(): boolean {
    return Boolean(
      (this.sendAgreementData?.authorizedRepresentativeName && this.sendAgreementData.authorizedRepresentativeName.trim()) ||
      (this.sendAgreementData?.cnic && this.sendAgreementData.cnic.trim()) ||
      (this.sendAgreementData?.companyName && this.sendAgreementData.companyName.trim()) ||
      (this.sendAgreementData?.securityDeposit && this.sendAgreementData.securityDeposit > 0) ||
      (this.sendAgreementData?.specialConditions && this.sendAgreementData.specialConditions.trim())
    );
  }

  openCreateCustomerFromBooking() {
    this.loadCityOptions();
    this.showDiscardConfirm.set(false);
    this.quickCustomerForm = {
      customerType: 'Individual',
      firstName: '',
      lastName: '',
      company: '',
      email: '',
      countryCode: '+92',
      phoneNumber: '',
      addressLine1: '',
      addressLine2: '',
      cityId: ''
    };
    this.quickCustomerError.set('');
    this.showQuickCreateCustomer.set(true);
  }

  submitQuickCreateCustomer() {
    const { customerType, firstName, lastName, company, email, phoneNumber, countryCode, addressLine1, addressLine2, cityId } = this.quickCustomerForm;
    const custType = customerType === 'Company' ? 'Company' : 'Individual';
    const compName = custType === 'Company' ? (company || '').trim() : null;
    const fn = (firstName || '').trim();
    const em = (email || '').trim();
    let phoneDigits = (phoneNumber || '').replace(/\D/g, '');
    if (phoneDigits.startsWith('0')) {
      phoneDigits = phoneDigits.substring(1);
    }
    const addr1 = (addressLine1 || '').trim();

    if (custType === 'Company' && !compName) {
      const msg = 'Company / Business Name is required.';
      this.showError(msg);
      this.quickCustomerError.set(msg);
      return;
    }
    if (!fn) {
      const msg = 'First Name is required.';
      this.showError(msg);
      this.quickCustomerError.set(msg);
      return;
    }
    if (!em) {
      const msg = 'Email address is required.';
      this.showError(msg);
      this.quickCustomerError.set(msg);
      return;
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(em)) {
      const msg = 'Please enter a valid email address (e.g. user@example.com).';
      this.showError(msg);
      this.quickCustomerError.set(msg);
      return;
    }
    if (!phoneDigits || phoneDigits.length !== 10) {
      const msg = 'Phone number must contain 10 digits (e.g. 3001234567).';
      this.showError(msg);
      this.quickCustomerError.set(msg);
      return;
    }
    if (!addr1) {
      const msg = 'Address Line 1 is required.';
      alert(msg);
      this.quickCustomerError.set(msg);
      return;
    }

    this.quickCustomerSaving.set(true);
    this.quickCustomerError.set('');

    const code = countryCode || '+92';
    const fullPhone = `${code}${phoneDigits}`;
    const fullAddress = addr1 + (addressLine2 ? ', ' + addressLine2.trim() : '');

    const payload = {
      ...this.quickCustomerForm,
      customerType: custType,
      company: compName,
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
        if (res && (res.isSuccessful === false || res.isSuccess === false || res.success === false || res.hasError)) {
          this.quickCustomerSaving.set(false);
          const msg = res.message || res.errorMessage || res.ErrorMessage || res.error || 'Failed to create customer.';
          this.showError(msg);
          this.quickCustomerError.set(msg);
          return;
        }
        this.quickCustomerSaving.set(false);
        this.showQuickCreateCustomer.set(false);
        const created = res?.data ?? res;
        if (created) {
          if (!this.showQuotationForm()) {
            this.openAdminQuotationForm();
          }
          this.selectCustomer(created);
        }
      },
      error: (e: any) => {
        this.quickCustomerSaving.set(false);
        const msg = e?.error?.message ?? e?.error?.ErrorMessage ?? e?.message ?? 'Failed to create customer.';
        this.showError(msg);
        this.quickCustomerError.set(msg);
      }
    });
  }

  openEdit(item: any) {
    if (this.entity === 'bookings') {
      this.openAdminBookingForm(item);
      return;
    }
    this.editItem = { ...item, idGuid: item.bookingPublicId ?? item.idGuid ?? item.idGUID ?? item.id, id: item.bookingId ?? item.id };
    this.formData = { ...item };
    if (this.entity === 'users') {
      this.formData.role = this.normalizeRole(item.role ?? item.roleId ?? item.RoleId) || 'general';
      this.formData.locationId = item.locationId != null ? Number(item.locationId) : null;
      if (!this.locationOptions().length) this.loadLocationOptions();
      if (!this.cityOptions().length) this.loadCityOptions();
    }
    this.selectedAmenityIds = [];
    if (this.entity === 'customers') {
      this.formData.customerType = (item.customerType === 'Company' || (item.company && item.company.trim() && item.company.toLowerCase() !== 'individual'))
        ? 'Company'
        : 'Individual';
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
          const national = rawPhone.slice(match.v.length).replace(/\D/g, '');
          this.formData.phoneNumber = national.length === 10 ? '0' + national : national.slice(0, 11);
        } else {
          this.selectedCountryCode = '+92';
          const digits = rawPhone.replace(/\D/g, '');
          this.formData.phoneNumber = digits.length === 10 ? '0' + digits : digits.slice(0, 11);
        }
      } else {
        this.selectedCountryCode = '+92';
        const digits = rawPhone.replace(/\D/g, '');
        if (digits.length === 10 && !digits.startsWith('0')) {
          this.formData.phoneNumber = '0' + digits;
        } else if (digits.length === 12 && digits.startsWith('92')) {
          this.formData.phoneNumber = '0' + digits.slice(2);
        } else {
          this.formData.phoneNumber = digits.slice(0, 11);
        }
      }
    }
    if (this.entity === 'spaces') {
      this.priceError.set('');
      const name = String(item.name || item.Name || '').toLowerCase().trim();
      const locId = item.locationId ?? item.LocationId;
      const stId = item.spaceTypeId ?? item.SpaceTypeId;
      const flId = item.floorId ?? item.FloorId;
      const rentAccId = item.rentAccountId ?? item.RentAccountId;
      const savedIds: string = String(item.amenityIds ?? item.AmenityIds ?? item.amenities ?? '');

      const pMonth = Number(item.pricePerMonth ?? item.PricePerMonth ?? 0);
      const pDay = Number(item.pricePerDay ?? item.PricePerDay ?? item.seatPrice ?? item.SeatPrice ?? 0);
      const pHour = Number(item.pricePerHour ?? item.PricePerHour ?? 0);

      let priceValue: number | null = null;
      let priceUnit = 'month';

      if (name.includes('meeting room 1')) {
        priceValue = pHour > 0 ? pHour : (item.price ? Number(item.price) : null);
        priceUnit = 'hour';
      } else if (name.includes('meeting room 2')) {
        priceValue = pDay > 0 ? pDay : (item.price ? Number(item.price) : null);
        priceUnit = 'day';
      } else if (name.includes('front office') || name.includes('front-office')) {
        priceValue = pMonth > 0 ? pMonth : (item.price ? Number(item.price) : (pDay > 0 ? pDay : 35000));
        priceUnit = 'month';
      } else if (pDay > 0 && pMonth === 0 && pHour === 0) {
        priceValue = pDay;
        priceUnit = 'day';
      } else if (pHour > 0 && pMonth === 0 && pDay === 0) {
        priceValue = pHour;
        priceUnit = 'hour';
      } else if (pMonth > 0 && pDay === 0 && pHour === 0) {
        priceValue = pMonth;
        priceUnit = 'month';
      } else if (pHour > 0) {
        priceValue = pHour;
        priceUnit = 'hour';
      } else if (pDay > 0) {
        priceValue = pDay;
        priceUnit = 'day';
      } else if (pMonth > 0) {
        priceValue = pMonth;
        priceUnit = 'month';
      }

      this.formData = {
        ...item,
        id: item.id ?? item.Id,
        name: item.name ?? item.Name ?? '',
        code: item.code ?? item.Code ?? '',
        capacity: item.capacity ?? item.Capacity ?? null,
        locationId: locId != null && locId !== '' ? Number(locId) : '',
        spaceTypeId: stId != null && stId !== '' ? Number(stId) : '',
        floorId: flId != null && flId !== '' ? Number(flId) : '',
        priceValue: priceValue,
        priceUnit: priceUnit,
        pricePerHour: pHour > 0 ? pHour : null,
        pricePerDay: pDay > 0 ? pDay : null,
        pricePerMonth: pMonth > 0 ? pMonth : null,
        description: item.description ?? item.Description ?? '',
        imageUrl: item.imageUrl ?? item.ImageUrl ?? '',
        rentAccountId: rentAccId != null && rentAccId !== '' ? Number(rentAccId) : '',
        status: item.status ?? item.Status ?? 'Available',
        isActive: item.isActive ?? item.IsActive ?? true
      };

      this.selectedAmenityIds = savedIds
        ? savedIds.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n))
        : [];

      if (locId) this.loadFloorsForLocation(Number(locId));
    }
    if (this.entity === 'bookings') {
      this.formData['startDateTime'] = this.toDatetimeLocal(item.startDateTime);
      this.formData['endDateTime'] = this.toDatetimeLocal(item.endDateTime);
      if (!this.formData['spaceId'] && item.spaceGuid) {
        this.formData['spaceId'] = item.spaceGuid;
      }
    }
    this.error.set('');
    this.showModal.set(true);
  }

  private toDatetimeLocal(val: any): string {
    if (!val) return '';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      return localDateTimeIso(d);
    } catch { return val; }
  }

  closeModal() {
    this.requestDiscardableClose(this.isEntityFormDirty(), () => {
      this.showModal.set(false);
      this.formData = {};
      this.editItem = null;
      this.error.set('');
    });
  }

  save() {
    this.saving.set(true);
    this.error.set('');

    if (this.entity === 'users') {
      const name = (this.formData.name || '').trim();
      const email = (this.formData.email || '').trim();
      const password = (this.formData.password || '').trim();
      const role = this.normalizeRole(this.formData.role || 'general');
      let locationId = this.formData.locationId != null && this.formData.locationId !== '' && this.formData.locationId !== 'null'
        ? Number(this.formData.locationId)
        : null;

      if (!name) {
        this.error.set('Full Name is required.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      if (!email) {
        this.error.set('Email address is required.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(email)) {
        this.error.set('Please enter a valid email address (e.g. user@example.com).');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      if (!this.editItem && !password) {
        this.error.set('Password is required for new users.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }

      if (role === 'super_admin' || role === 'general') {
        locationId = null;
      } else if (role === 'admin' || role === 'sales_executive') {
        if (!locationId || locationId <= 0) {
          if (!this.isSuperAdmin && this.auth.user()?.locationId) {
            locationId = this.auth.user()!.locationId!;
          } else {
            this.error.set(`Location is required for ${this.getRoleLabel(role)} role.`);
            this.showError(this.error());
            this.saving.set(false);
            return;
          }
        }
      }

      this.formData = {
        ...this.formData,
        name: name,
        email: email,
        password: password || undefined,
        role: role,
        locationId: locationId,
        cityId: this.formData.cityId ? Number(this.formData.cityId) : null,
        phone: (this.formData.phone || '').trim() || null,
        cnicOrPassport: (this.formData.cnicOrPassport || '').trim() || null,
        address: (this.formData.address || '').trim() || null,
        notes: (this.formData.notes || '').trim() || null,
      };
    }

    if (this.entity === 'customers') {
      const custType = this.formData.customerType === 'Company' ? 'Company' : 'Individual';
      const compName = custType === 'Company' ? (this.formData.company || '').trim() : null;
      const fn = (this.formData.firstName || '').trim();
      const em = (this.formData.email || '').trim();
      let phoneDigits = (this.formData.phoneNumber || '').replace(/\D/g, '');
      if (phoneDigits.startsWith('0')) {
        phoneDigits = phoneDigits.substring(1);
      }
      const addr1 = (this.formData.addressLine1 || '').trim();

      if (custType === 'Company' && !compName) {
        this.error.set('Company / Business Name is required when Customer Type is Company.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      if (!fn) {
        this.error.set('First Name is required.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      if (!em) {
        this.error.set('Email address is required.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(em)) {
        this.error.set('Please enter a valid email address (e.g. user@example.com).');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      if (!this.editItem && Array.isArray(this.items)) {
        const isDuplicate = this.items.some(c => (c.email || c.customerEmail || '').toLowerCase() === em.toLowerCase());
        if (isDuplicate) {
          this.error.set(`A customer with email address '${em}' already exists.`);
          this.showError(this.error());
          this.saving.set(false);
          return;
        }
      }
      if (!phoneDigits || phoneDigits.length !== 10) {
        this.error.set('Phone number must contain 10 digits (e.g. 3001234567).');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      if (!addr1) {
        this.error.set('Address Line 1 is required.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }

      const fullAddress = addr1 + (this.formData.addressLine2 ? ', ' + this.formData.addressLine2.trim() : '');
      const countryCode = this.selectedCountryCode || '+92';
      const fullPhone = `${countryCode}${phoneDigits}`;

      this.formData = {
        ...this.formData,
        customerType: custType,
        company: compName,
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
        this.error.set('Location name is required.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      if (!branchId) {
        this.error.set('Please select a Branch.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      if (!cityId) {
        this.error.set('Please select a City.');
        this.showError(this.error());
        this.saving.set(false);
        return;
      }
      if (!address) {
        this.error.set('Address is required.');
        this.showError(this.error());
        this.saving.set(false);
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

    if (this.entity === 'spaces') {
      const valid = this.override_save_spaces(this.formData);
      if (!valid) return;
    }

    const obs = this.editItem
      ? this.config().updateFn!(this.editItem.idGuid ?? this.editItem.idGUID ?? this.editItem.id, this.formData)
      : this.config().createFn!(this.formData);

    obs.subscribe({
      next: (res: any) => {
        if (res && (res.isSuccessful === false || res.isSuccess === false || res.success === false || res.hasError)) {
          this.saving.set(false);
          this.error.set(res.message || res.errorMessage || res.ErrorMessage || res.error || 'An error occurred while saving.');
          this.showError(this.error());
          return;
        }
        this.saving.set(false);
        this.showModal.set(false);
        this.success.set(this.entity === 'spaces' ? 'Space pricing updated successfully.' : (this.editItem ? 'Updated successfully.' : 'Created successfully.'));
        setTimeout(() => this.success.set(''), 3000);

        if (this.creatingCustomerFromBooking) {
          try {
            const created = res?.data ?? res;
            if (created) {
              this.selectCustomer(created);
            }
          } catch (e) {
            // ignore
          }
          this.config.set(this.buildConfig(this.entity));
          this.creatingCustomerFromBooking = false;
        }

        this.load();
      },
      error: (e: any) => {
        this.saving.set(false);
        this.error.set(e?.error?.message ?? e?.error?.ErrorMessage ?? e?.message ?? 'An error occurred.');
        this.showError(this.error());
      }
    });
  }

  deleteItem(item: any) {
    if (!confirm('Delete this item?')) return;
    const id = item.bookingId ?? item.idGuid ?? item.idGUID ?? item.id;
    this.config().deleteFn!(id).subscribe({
      next: () => this.load(),
      error: (e: any) => this.showError(e?.error?.message ?? e?.error?.ErrorMessage ?? e?.message ?? 'Failed to delete item.')
    });
  }

  changeStatus(item: any, status: string) {
    if (!status || !item) return;

    // Resolve real ID (prioritize bookingId / non-zero values over 0)
    const rawId = (item.bookingId && item.bookingId !== 0) ? item.bookingId :
      (item.BookingId && item.BookingId !== 0) ? item.BookingId :
        (item.id && item.id !== 0 && item.id !== '0' && item.id !== '00000000-0000-0000-0000-000000000000') ? item.id :
          (item.Id && item.Id !== 0 && item.Id !== '0') ? item.Id :
            (item.bookingPublicId || item.idGuid || item.idGUID || item.publicId || item.id || item.Id);

    if (!rawId || rawId === 0 || rawId === '0') {
      this.showError('Unable to update status: Missing or invalid item ID.');
      return;
    }

    // WN_BookingStatuses: 3 Rejected, 5 Pending, 6 No Show, 33 Confirmed, 86 Cancelled
    const bookingStatusMap: Record<string, number> = {
      'pending': 5, '5': 5, '1': 5,
      'confirmed': 33, '33': 33, '2': 33,
      'rejected': 3, '3': 3,
      'noshow': 6, 'no show': 6, '6': 6,
      'cancelled': 86, '86': 86
    };
    const paymentStatusMap: Record<string, number> = {
      'pending': 1, '1': 1,
      'paid': 2, '2': 2,
      'failed': 3, '3': 3,
      'refunded': 4, '4': 4,
      'cancelled': 5, '5': 5
    };
    const contactStatusMap: Record<string, number> = {
      'new': 1, '1': 1,
      'inprogress': 2, 'in progress': 2, '2': 2,
      'resolved': 3, '3': 3,
      'closed': 4, '4': 4
    };
    const membershipStatusMap: Record<string, number> = {
      'active': 1, '1': 1,
      'inactive': 2, '2': 2,
      'suspended': 3, '3': 3,
      'expired': 4, '4': 4
    };

    const targetMap = this.entity === 'bookings' ? bookingStatusMap :
      this.entity === 'payments' ? paymentStatusMap :
        this.entity === 'contacts' ? contactStatusMap :
          this.entity === 'memberships' ? membershipStatusMap : bookingStatusMap;

    const sStr = String(status).trim().toLowerCase();
    const statusId = targetMap[sStr] ?? (isNaN(Number(status)) ? 1 : Number(status));

    const statusFn = this.config().statusFn;
    if (statusFn) {
      statusFn(rawId, statusId).subscribe({
        next: (res: any) => {
          if (res && (res.isSuccessful === false || res.isSuccess === false || res.success === false || res.hasError)) {
            const err = res.message || res.errorMessage || res.error || 'Server rejected status update';
            this.showError('Failed to update status: ' + err);
            return;
          }
          if (item) {
            item.bookingStatusLabel = status;
            item.bookingStatus = status;
            item.status = status;
            item.Status = status;
          }
          this.success.set('Status updated successfully.');
          setTimeout(() => this.success.set(''), 3000);
          this.load();
        },
        error: (err: any) => {
          const msg = err?.error?.message ?? err?.error?.ErrorMessage ?? err?.message ?? 'Server error';
          this.showError('Failed to update status: ' + msg);
        }
      });
    }
  }

  toggleActive(item: any) {
    const userId = item.id ?? item.publicId ?? item.idGuid ?? item.idGUID ?? item.userId;
    if (!userId) return;
    const isActive = item.isActive ?? (item.status == 1);
    const obs = isActive ? this.admin.deactivateUser(userId) : this.admin.activateUser(userId);
    obs.subscribe({
      next: () => this.load(),
      error: (e: any) => this.showError(e?.error?.message ?? e?.error?.ErrorMessage ?? e?.message ?? `Failed to ${isActive ? 'deactivate' : 'activate'} user.`)
    });
  }

  normalizeRole(roleValue: any): string {
    if (roleValue === null || roleValue === undefined) return 'general';
    const str = String(roleValue).trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    if (str === '1' || str === 'superadmin' || str === 'super_admin') return 'super_admin';
    if (str === '2' || str === 'admin' || str === 'administrator') return 'admin';
    if (str === '14' || str === 'general' || str === 'general_user') return 'general';
    if (str === '16' || str === 'salesexecutive' || str === 'sales_executive') return 'sales_executive';
    return str || 'general';
  }

  changeUserRole(item: any, role: string) {
    if (!role || !this.isSuperAdmin) return;
    const userId = item.id ?? item.publicId ?? item.idGuid ?? item.idGUID ?? item.userId;
    if (!userId) return;
    const normalizedRole = this.normalizeRole(role);
    const locationId = (normalizedRole === 'super_admin' || normalizedRole === 'general')
      ? null
      : (item.locationId ? Number(item.locationId) : null);

    if ((normalizedRole === 'admin' || normalizedRole === 'sales_executive') && !locationId) {
      this.toast.show('Please edit user to assign a Location when setting Admin or Sales Executive role.', 'error');
      return;
    }

    this.admin.updateUserRole(userId, normalizedRole, locationId).subscribe({
      next: () => {
        this.success.set(`Role updated to "${this.getRoleLabel(normalizedRole)}" successfully.`);
        setTimeout(() => this.success.set(''), 3000);
        this.load();
      },
      error: (err) => {
        const msg = err?.error?.message || err?.message || 'Failed to update role.';
        this.showError(msg);
      }
    });
  }

  getRoleLabel(roleValue: any): string {
    const r = this.normalizeRole(roleValue);
    const match = this.assignableRoles.find(opt => opt.v === r);
    return match ? match.l : String(roleValue || 'General User');
  }

  getRoleClass(roleValue: any): string {
    return this.normalizeRole(roleValue);
  }

  openBookingUser(item: any) { this.openUserModal(item.userEmail ?? item.userPublicId ?? item.userId); }
  openUserFromUsers(item: any) { this.openUserModal(item.idGuid); }

  private openUserModal(idOrEmail: any) {
    this.showUserModal.set(true);
    this.userDetailsLoading.set(true);
    this.userDetailsError.set('');
    this.selectedUser.set(null);
    this.userHistory.set(null);
    this.admin.getUserHistory(idOrEmail).subscribe({
      next: (histRes: any) => {
        this.userHistory.set(histRes?.data ?? histRes);
        this.admin.getUserById(String(idOrEmail)).subscribe({
          next: (res: any) => {
            const u = res?.data ?? res;
            this.selectedUser.set(u);
            this.userDisplayName.set([u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.name || u?.email || 'N/A');
            this.userDetailsLoading.set(false);
          },
          error: () => this.userDetailsLoading.set(false)
        });
      },
      error: () => {
        this.userDetailsError.set('Failed to load user history.');
        this.userDetailsLoading.set(false);
      }
    });
  }

  closeUserModal() { this.showUserModal.set(false); }

  openSpaceDetails(item: any) {
    this.showSpaceModal.set(true); this.spaceSummaryLoading.set(true);
    this.spaceSummaryError.set(''); this.spaceSummary.set(null);
    this.admin.getSpaceSummary(item.idGuid).subscribe({
      next: (res: any) => { this.spaceSummary.set(res?.data ?? res); this.spaceSummaryLoading.set(false); },
      error: () => { this.spaceSummaryLoading.set(false); this.spaceSummaryError.set('Failed to load space summary.'); }
    });
  }
  closeSpaceModal() { this.showSpaceModal.set(false); }

  openPricingPlanSummary(item: any) {
    this.showPlanModal.set(true); this.planSummaryLoading.set(true);
    this.planSummaryError.set(''); this.planSummary.set(null);
    this.admin.getPricingPlanSummary(item.idGuid).subscribe({
      next: (res: any) => { this.planSummary.set(res?.data ?? res); this.planSummaryLoading.set(false); },
      error: () => { this.planSummaryLoading.set(false); this.planSummaryError.set('Failed to load plan summary.'); }
    });
  }
  closePlanModal() { this.showPlanModal.set(false); }

  openPaymentSummary(item: any) {
    this.showPaymentModal.set(true); this.paymentSummaryLoading.set(true);
    this.paymentSummaryError.set(''); this.paymentSummary.set(null);
    const paymentId = item.idGuid ?? item.publicId ?? item.id; this.admin.getPaymentSummary(paymentId).subscribe({
      next: (res: any) => { this.paymentSummary.set(res?.data ?? res); this.paymentSummaryLoading.set(false); },
      error: () => { this.paymentSummaryLoading.set(false); this.paymentSummaryError.set('Failed to load payment summary.'); }
    });
  }
  closePaymentModal() { this.showPaymentModal.set(false); }

  approvePayment(item: any) {
    if (item.paymentStatus !== 'Pending') return;
    const itemId = item.idGuid ?? item.id;
    if (this.approvingPaymentId() === itemId) return;
    if (!confirm(`Approve cash payment of PKR ${item.amount ?? 0} for ${item.userEmail ?? 'this user'}?`)) return;
    this.approvingPaymentId.set(itemId);
    this.admin.approvePayment(itemId).subscribe({
      next: () => {
        this.success.set('Payment approved successfully.');
        setTimeout(() => this.success.set(''), 3000);
        this.approvingPaymentId.set(null);
        this.load();
      },
      error: (e: any) => {
        this.error.set(e?.error?.message ?? 'Failed to approve payment.');
        this.showError(this.error());
        this.approvingPaymentId.set(null);
      }
    });
  }

  openReassignModal(booking: any) {
    this.reassignBooking = booking;
    this.showReassignModal.set(true);
    this.reassignError.set('');
    this.selectedNewSpace = '';
    this.loadAvailableSpacesForReassign();
  }

  closeReassignModal() {
    this.requestDiscardableClose(this.isReassignFormDirty(), () => {
      this.showReassignModal.set(false);
      this.reassignBooking = null;
      this.availableSpacesForReassign.set([]);
      this.selectedNewSpace = '';
    });
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
        this.reassignError.set('Failed to load available spaces');
        this.reassignLoading.set(false);
      }
    });
  }

  submitReassignment() {
    if (!this.selectedNewSpace || !this.reassignBooking) {
      this.reassignError.set('Please select a space to reassign');
      return;
    }

    this.reassignLoading.set(true);
    const bookingId = this.reassignBooking.bookingPublicId ?? this.reassignBooking.idGuid;
    this.admin.reassignBooking(bookingId, Number(this.selectedNewSpace), 0).subscribe({
      next: () => {
        this.success.set('Booking reassigned successfully');
        setTimeout(() => this.success.set(''), 3000);
        this.closeReassignModal();
        this.load();
      },
      error: (err: any) => {
        this.reassignError.set(err?.error?.message || 'Failed to reassign booking');
        this.showError(this.reassignError());
        this.reassignLoading.set(false);
      }
    });
  }

  private initBookingCalendar() { this.bookingCalendarDate = new Date(); this.buildBookingCalendar(); }
  prevBookingMonth() { this.bookingCalendarDate.setMonth(this.bookingCalendarDate.getMonth() - 1); this.buildBookingCalendar(); }
  nextBookingMonth() { this.bookingCalendarDate.setMonth(this.bookingCalendarDate.getMonth() + 1); this.buildBookingCalendar(); }

  private buildBookingCalendar() {
    const d = this.bookingCalendarDate;
    this.bookingMonthTitle.set(d.toLocaleString('default', { month: 'long', year: 'numeric' }));
    const year = d.getFullYear(), month = d.getMonth() + 1;
    const first = new Date(year, month - 1, 1).getDay();
    const days = new Date(year, month, 0).getDate();
    const spaceId = this.formData['spaceId'];
    this.bookingMonthCells.set([]);
    const fill = (bookedDates: string[]) => {
      const cells: any[] = [];
      for (let i = 0; i < first; i++) cells.push({ placeholder: true });
      for (let d = 1; d <= days; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells.push({ day: d, date: dateStr, isBooked: bookedDates.includes(dateStr) });
      }
      this.bookingMonthCells.set(cells);
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

  isBookingPast(date: string): boolean { return !!date && date < localDateIso(); }

  loadFloorsForLocation(locationId: number) {
    this.floorOptions.set([]);
    if (!locationId) return;
    this.admin.getFloors(locationId).subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.floorOptions.set(items.map((f: any) => ({
          v: f.id ?? f.Id,
          l: f.name || f.floorName || f.Name || f.FloorName || (f.floorNumber != null ? `Floor ${f.floorNumber}` : `Floor #${f.id}`)
        })));
      },
      error: this.apiError('Failed to load floors.')
    });
  }

  toggleAmenity(id: number) {
    const idx = this.selectedAmenityIds.indexOf(id);
    if (idx === -1) this.selectedAmenityIds.push(id);
    else this.selectedAmenityIds.splice(idx, 1);
  }

  isAmenitySelected(id: number): boolean { return this.selectedAmenityIds.includes(id); }

  onFieldChange(key: string) {
    if (key === 'role' && this.entity === 'users') {
      const role = this.normalizeRole(this.formData['role']);
      if (role === 'super_admin' || role === 'general') {
        this.formData['locationId'] = null;
      } else if (role === 'admin' || role === 'sales_executive') {
        if (!this.isSuperAdmin && this.auth.user()?.locationId) {
          this.formData['locationId'] = this.auth.user()?.locationId;
        }
      }
    }
    if (key === 'spaceId' && this.entity === 'bookings') this.buildBookingCalendar();
    if (key === 'locationId' && this.entity === 'spaces') this.loadFloorsForLocation(this.formData['locationId']);
  }

  get isPrivateOfficeSelected(): boolean {
    if (this.entity === 'spacetypes') {
      return (this.formData['name'] || '').toLowerCase().includes('private');
    }
    const selected = this.spaceTypeOptions().find(t => String(t.v) === String(this.formData['spaceTypeId']));
    return selected ? selected.l.toLowerCase().includes('private') : false;
  }


  // - Duplicate Space Detection -
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
      this.success.set('No duplicate codes found.');
      setTimeout(() => this.success.set(''), 3000);
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
          { key: 'customerType', label: 'Type' },
          { key: 'fullName', label: 'Name' },
          { key: 'company', label: 'Company' },
          { key: 'email', label: 'Email' },
          { key: 'phoneNumber', label: 'Phone' },
          { key: 'isActive', label: 'Active', type: 'boolean' },
          { key: 'createdAt', label: 'Created', type: 'date' },
        ],
        fields: [
          { key: 'firstName', label: 'First Name', type: 'text', required: true },
          { key: 'lastName', label: 'Last Name', type: 'text' },
          { key: 'company', label: 'Company / Business Name', type: 'text', required: true },
          { key: 'email', label: 'Email', type: 'email', required: true },
          { key: 'phoneNumber', label: 'Phone Number', type: 'phone-split', required: true },
          { key: 'addressLine1', label: 'Address Line 1', type: 'text', required: true },
          { key: 'addressLine2', label: 'Address Line 2', type: 'text' },
          { key: 'cityId', label: 'City', type: 'select', options: this.cityOptions() },
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
          { key: 'locationName', label: 'Location' },
          { key: 'isActive', label: 'Active', type: 'boolean' },
          // { key: 'createdAt', label: 'Created', type: 'date' },
        ],
        fields: [
          { key: 'name', label: 'Full Name', type: 'text', required: true },
          { key: 'email', label: 'Email Address', type: 'email', required: true },
          { key: 'password', label: 'Password', type: 'password', required: !this.editItem },
          { key: 'role', label: 'Role', type: 'select', options: this.assignableRoles, required: true },
          { key: 'locationId', label: 'Location', type: 'user-location-select' },
          { key: 'phone', label: 'Phone Number', type: 'text' },
          { key: 'cnicOrPassport', label: 'CNIC / Passport', type: 'text' },
          { key: 'cityId', label: 'City', type: 'select', options: this.cityOptions() },
          { key: 'address', label: 'Address', type: 'text' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ],
        getFn: (p, l, s) => this.admin.getUsers(p, l, s),
        createFn: (d) => this.admin.createUser(d),
        updateFn: (id, d) => this.admin.updateUser(id, d),
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
          { key: 'branchId', label: 'Branch', type: 'select', options: this.branchOptions(), required: true },
          { key: 'cityId', label: 'City', type: 'select', options: this.cityOptions(), required: true },
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
          { key: 'accountReceivableId', label: 'Accounts Receivable (AccountsCOA)', type: 'select', options: this.accountOptions() },
          { key: 'rentAccountId', label: 'Rent Account (AccountsCOA)', type: 'select', options: this.accountOptions() },
          { key: 'servicesIncomeId', label: 'Services Income (AccountsCOA)', type: 'select', options: this.accountOptions() },
          { key: 'salesTaxId', label: 'Sales Tax (AccountsCOA)', type: 'select', options: this.accountOptions() },
          { key: 'securityReceivedId', label: 'Security Received / Deposit (AccountsCOA)', type: 'select', options: this.accountOptions() },
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
          { key: 'price', label: 'Price', type: 'space-prices' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'imageUrl', label: 'Image', type: 'image' },
        ],
        fields: [
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'code', label: 'Code', type: 'text' },
          { key: 'capacity', label: 'Capacity', type: 'number' },
          { key: 'locationId', label: 'Location', type: 'select', options: this.locationOptions() },
          { key: 'spaceTypeId', label: 'Space Type', type: 'select', options: this.spaceTypeOptions() },
          { key: 'pricePerHour', label: this.lbl('Space', 'pricePerHour'), type: 'number' },
          { key: 'pricePerDay', label: this.lbl('Space', 'pricePerDay'), type: 'number' },
          { key: 'floorId', label: 'Floor', type: 'floor-select' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'imageUrl', label: 'Image URL', type: 'text' },
          { key: 'amenities', label: 'Amenities', type: 'amenities-multicheck' },
          { key: 'rentAccountId', label: 'Rent Account', type: 'select', options: this.accountOptions() },
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
          { key: 'spaceId', label: 'Space', type: 'select', options: this.spaceOptions() },
          { key: 'startDateTime', label: 'Start Date & Time', type: 'datetime-local' },
          { key: 'endDateTime', label: 'End Date & Time', type: 'datetime-local' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ],
        getFn: (p, l, s) => {
          const locId = (!this.isSuperAdmin && this.auth.user()?.locationId) ? this.auth.user()!.locationId! : undefined;
          // Server-side paging + search (the API returns { data, total }).
          return this.admin.getBookings(p, l, s, locId);
        },
        updateFn: (id, d) => this.admin.updateBooking(id, d),
        statusFn: (id, statusId) => this.admin.updateBookingStatus(id, statusId),
        statusOptions: ['Pending', 'Confirmed', 'No Show', 'Rejected', 'Cancelled'],
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
          { key: 'bookingId', label: 'Booking #' },
          { key: 'userEmail', label: 'User / Customer' },
          { key: 'spaceName', label: 'Booked Space' },
          { key: 'amountType', label: 'Amount Type' },
          { key: 'amount', label: this.lbl('Payment', 'amount'), type: 'currency' },
          { key: 'paymentMethod', label: 'Method' },
          { key: 'challanNumber', label: 'Challan / Ref' },
          { key: 'paymentStatus', label: 'Status', type: 'status' },
          { key: 'paidAt', label: 'Date', type: 'date' },
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
        title: 'Contacts & Tour Inquiries',
        columns: [
          { key: 'fullName', label: 'Name' },
          { key: 'company', label: 'Company' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'subject', label: 'Subject / Type' },
          { key: 'message', label: 'Message / Feedback' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'createdAt', label: 'Date', type: 'date' },
        ],
        getFn: (p, l, s) => this.admin.getContacts(p, l, s),
        statusFn: (id, status) => this.admin.updateContactStatus(id, status),
        statusOptions: ['New', 'InProgress', 'Resolved'],
        deleteFn: (id) => this.admin.deleteContact(id),
      };

      case 'quotation-responses': return {
        title: 'Quotation Responses',
        columns: [
          { key: 'quotationNumber', label: 'Quotation #' },
          { key: 'version', label: 'Ver' },
          { key: 'fullName', label: 'Customer' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'responseType', label: 'Response', type: 'status' },
          { key: 'note', label: 'Note / Feedback' },
          { key: 'respondedDate', label: 'Date', type: 'date' },
        ],
        getFn: (p, l, s) => this.quotationSvc.getQuotationResponses(p, l, s),
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
        getFn: (p, l, s) => {
          const locId = (!this.isSuperAdmin && this.auth.user()?.locationId) ? this.auth.user()!.locationId! : undefined;
          return this.quotationSvc.getQuotations(p, l, s, locId);
        },
      };

      case 'invoices': return {
        title: 'Invoices & Billing',
        columns: [
          { key: 'invoiceNumber', label: 'Invoice #' },
          { key: 'customerName', label: 'Customer / User' },
          { key: 'spaceName', label: 'Space' },
          { key: 'billingPeriodDisplay', label: 'Rent Period' },
          { key: 'issuedOn', label: 'Issued On', type: 'date' },
          { key: 'dueOn', label: 'Due On', type: 'date' },
          { key: 'grandTotal', label: 'Total (PKR)', type: 'currency' },
          { key: 'paidTotal', label: 'Paid (PKR)', type: 'currency' },
          { key: 'balanceDue', label: 'Balance Due', type: 'currency' },
          { key: 'statusLabel', label: 'Status', type: 'invoice-status' },
        ],
        getFn: (p, l, s) => {
          const locId = (!this.isSuperAdmin && this.auth.user()?.locationId) ? this.auth.user()!.locationId! : undefined;
          return this.admin.getInvoices(p, l, s, undefined, locId);
        },
      };

      case 'agreements': return {
        title: 'Agreements',
        columns: [
          { key: 'quotationNumber', label: 'Quotation #' },
          { key: 'customerName', label: 'Customer / Signatory' },
          { key: 'customerEmail', label: 'Email' },
          { key: 'spaceName', label: 'Space' },
          { key: 'entityType', label: 'Type' },
          { key: 'feeAmount', label: 'Monthly Fee (PKR)', type: 'currency' },
          { key: 'securityDeposit', label: 'Security Deposit (PKR)', type: 'currency' },
          { key: 'contractStartDate', label: 'Start Date', type: 'date' },
          { key: 'contractEndDate', label: 'End Date', type: 'date' },
          { key: 'signedPdfUploadedAt', label: 'Signed Copy', type: 'date' },
          { key: 'status', label: 'Status', type: 'status' },
          { key: 'createdOn', label: 'Sent Date', type: 'date' },
        ],
        getFn: (p, l, s) => {
          return this.agreementSvc.getAgreements(p, l, s);
        },
        deleteFn: (id) => this.agreementSvc.deleteAgreement(id),
      };

      default: return { title: entity, columns: [], getFn: () => of({ data: [], total: 0 }) };
    }
  }

  generateQuotationMeetingSlots() {
    if (!this.quotationStartDate) { this.quotationMeetingSlots.set([]); return; }
    const cfg = this.spaceConfigItems().find((c: any) =>
      (c.spaceCategory || '').toLowerCase() === 'meeting'
    );
    const openH = parseInt((cfg?.openingTime || '08:00').split(':')[0], 10);
    const closeH = parseInt((cfg?.closingTime || '20:00').split(':')[0], 10);
    const slots: { label: string; start: string; end: string }[] = [];
    for (let h = openH; h < closeH; h++) {
      const start = `${String(h).padStart(2, '0')}:00`;
      const end = `${String(h + 1).padStart(2, '0')}:00`;
      slots.push({ label: `${start} - ${end}`, start, end });
    }
    this.quotationMeetingSlots.set(slots);
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
    this.showQuotationForm.set(true);
    this.quotationFormData = {};
    this.quotationFormError.set('');
    this.parentQuotationId = null;
    this.targetVersionNumber = 1;
    this.isCreatingNewVersion = false;
    this.selectedCustomer = null;
    this.customerSearchQuery = '';

    this.customerSearchResults.set([]);
    const userQuotLocId = this.auth.user()?.locationId;
    this.selectedQuotationLocationId = userQuotLocId ? String(userQuotLocId) : '';
    this.selectedQuotationSpaceTypeId = '';
    this.selectedQuotationCapacity = null;
    this.quotationSubtotal = 0;
    this.quotationSecurityDeposit = 0;
    this.quotationSecurityDepositMonthsOverride = null;
    this.quotationTotal = 0;
    this.quotationMonths = 12;
    this.quotationBillingPeriodMonths = 3;
    this.quotationSecurityDepositMonths = 2;
    this.quotationDiscountType = 'Percentage';
    this.quotationDiscountValue = 0;
    this.quotationDiscountPercentage = 0;
    this.quotationDiscountError.set('');
    this.quotationPerSeatBasePrice = 0;
    this.quotationMinPerSeatBasePrice = 0;
    this.quotationBasePriceError.set('');
    this.quotationOfferingTypeId = 1;
    this.quotationOfferingType = '24/7';
    this.quotationWithholdingTaxRate = 15;
    this.loadOfferingTypes();
    this.quotationFloorId = null;
    this.quotationFloorOptions.set([]);
    this.quotationStartDate = this.today;
    this.quotationValidUntil = localDateIso(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    this.quotationRemarks = '';
    this.quotationDiscountPercentage = 0;
    this.quotationMeetingSlots.set([]);
    this.quotationSelectedSlots = new Set();
    this.quotationMeetingRoomMode = 'slot';
    this.quotationMeetingDayEnd = '';
    this.onQuotationMonthPeriodChange();

    if (!this.spaceConfigItems().length) {
      this.admin.getSpaceConfig().subscribe({
        next: (res: any) => this.spaceConfigItems.set(res?.data ?? []),
        error: this.apiError('Failed to load space config.')
      });
    }

    this.loadCityOptions();

    this.admin.getLocations(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.locationOptions.set(items.map((l: any) => ({
          v: String(l.id != null ? l.id : (l.idGuid ?? l.idGUID ?? l.Id ?? '')),
          l: l.name || l.Name
        })));
        if (!this.selectedQuotationLocationId && this.locationOptions().length > 0) {
          const uLoc = this.auth.user()?.locationId;
          const match = uLoc ? this.locationOptions().find(o => String(o.v) === String(uLoc)) : null;
          this.selectedQuotationLocationId = match ? String(match.v) : String(this.locationOptions()[0].v);
        }
        if (this.selectedQuotationLocationId) {
          this.onQuotationLocationChange();
        }
      },
      error: this.apiError('Failed to load locations.')
    });

    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.populateSpaceTypeOptions(items);
      },
      error: this.apiError('Failed to load space types.')
    });

    this.admin.getSpaces(1, 1000, '').subscribe({
      next: (res: any) => {
        this.allSpaces.set(res?.data ?? []);
      },
      error: this.apiError('Failed to load spaces.')
    });
  }

  closeAdminQuotationForm() {
    this.requestDiscardableClose(this.isQuotationFormDirty(), () => {
      this.showQuotationForm.set(false);
      this.quotationFormData = {};
      this.selectedCustomer = null;
      this.customerSearchQuery = '';
      this.selectedQuotationSpaceTypeId = '';
      this.quotationDiscountValue = 0;
      this.quotationRemarks = '';
    });
  }

  onQuotationLocationChange() {
    this.quotationFormData.spaceId = '';
    this.quotationFloorId = null;
    this.quotationFloorOptions.set([]);
    this.quotationPerSeatBasePrice = 0;
    this.quotationMinPerSeatBasePrice = 0;
    this.quotationBasePriceError.set('');
    if (this.selectedQuotationLocationId) {
      const locInt = parseInt(String(this.selectedQuotationLocationId), 10);
      if (locInt) {
        this.admin.getFloors(locInt).subscribe({
          next: (res: any) => {
            const items = res?.data ?? (Array.isArray(res) ? res : []);
            this.quotationFloorOptions.set(items.map((f: any) => ({
              v: f.id ?? f.Id,
              l: f.name || f.floorName || f.Name || (f.floorNumber != null ? `Floor ${f.floorNumber}` : `Floor #${f.id}`),
              raw: f
            })));
            if (!this.isCreatingNewVersion && this.isLocationI8(this.selectedQuotationLocationId)) {
              const thirdFloor = this.findThirdFloorId(this.quotationFloorOptions());
              if (thirdFloor != null) {
                this.quotationFloorId = thirdFloor;
              }
            }
          },
          error: this.apiError('Failed to load floors.')
        });
      }
    }
    this.validateQuotationBasePrice();
    this.recalcQuotationAmount();
  }

  onQuotationSpaceTypeChange() {
    this.quotationFormData.spaceId = '';
    this.selectedQuotationCapacity = null;
    this.quotationMeetingSlots.set([]);
    this.quotationSelectedSlots = new Set();
    this.quotationMeetingRoomMode = 'slot';
    this.quotationMeetingDayEnd = '';
    this.quotationPerSeatBasePrice = 0;
    this.quotationMinPerSeatBasePrice = 0;
    this.quotationBasePriceError.set('');
    if (this.selectedQuotationSpaceTypeId === 'shared' || this.selectedQuotationSpaceTypeId === 'private') {
      this.quotationMonths = 12;
    }
    const isPrivate = this.isQuotationPrivateRoom;
    const isShared = this.isQuotationSharedSpace;
    this.quotationBillingPeriodMonths = (isPrivate || isShared) ? 3 : 1;
    this.quotationSecurityDepositMonths = isPrivate ? 2 : 0;
    this.validateQuotationBasePrice();
    this.recalcQuotationAmount();
  }

  onQuotationMeetingModeChange() {
    this.quotationMeetingSlots.set([]);
    this.quotationSelectedSlots = new Set();
    this.quotationStartDate = this.today;
    this.quotationMeetingDayEnd = '';
    this.recalcQuotationAmount();
  }

  onQuotationCapacityChange() {
    this.quotationFormData.spaceId = '';
    this.quotationPerSeatBasePrice = 0;
    this.quotationMinPerSeatBasePrice = 0;
    this.quotationBasePriceError.set('');
    this.validateQuotationBasePrice();
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
    this.allSpaces().forEach(s => {
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
    let spaces = this.allSpaces();

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
      const rawDate = s.bookedTill ?? s.BookedTill ?? s.bookedUntil ?? s.BookedUntil ?? s.endOn ?? s.EndOn;
      let bookedTillStr = '';
      if (isBooked && rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          const day = String(d.getDate()).padStart(2, '0');
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const month = months[d.getMonth()];
          const year = d.getFullYear();
          bookedTillStr = ' till ' + day + ' ' + month + ' ' + year;
        }
      }
      const tag = isBooked ? (' [Booked' + bookedTillStr + ']') : ' [Available]';
      return { v: s.id, l: `${s.name}${tag}` };
    });
  }

  onQuotationSpaceSelected() {
    const spaceId = this.quotationFormData.spaceId;
    if (spaceId) {
      const space = this.allSpaces().find(s => String(s.id) === String(spaceId) || String(s.idGuid) === String(spaceId));
      if (space) {
        this.quotationCapacity = Number(space.capacity || space.Capacity || 1);
        const { monthly } = this.getSpacePrice(space);
        const baseMonthly = monthly > 0 ? monthly : Number(space.price || space.Price || 35000);
        this.quotationPerSeatBasePrice = baseMonthly;
        this.quotationMinPerSeatBasePrice = baseMonthly;
        this.quotationBasePriceError.set('');
        const name = String(space.name || space.Name || '').toLowerCase();
        const { hourly, daily } = this.getSpacePrice(space);
        if (name.includes('meeting room 2') || (daily > 0 && hourly === 0)) {
          this.quotationMeetingRoomMode = 'day';
        } else if (name.includes('meeting room 1') || hourly > 0) {
          this.quotationMeetingRoomMode = 'slot';
        }
      }
    } else {
      this.quotationMinPerSeatBasePrice = 0;
      this.quotationPerSeatBasePrice = 0;
      this.quotationBasePriceError.set('');
    }
    this.validateQuotationBasePrice();
    this.recalcQuotationAmount();
  }

  recalcQuotationAmount() {
    this.quotationSubtotal = 0;
    this.quotationSecurityDeposit = 0;
    this.quotationTotal = 0;

    const spaceId = this.quotationFormData.spaceId;
    if (!spaceId) return;

    const space = this.allSpaces().find(s => String(s.id) === String(spaceId) || String(s.idGuid) === String(spaceId));
    if (!space) return;

    const { hourly, daily, monthly } = this.getSpacePrice(space);

    if (this.isQuotationMeetingRoom) {
      const spaceName = String(space.name || space.Name || '').toLowerCase();
      if (spaceName.includes('meeting room 2') || (daily > 0 && hourly === 0)) {
        this.quotationMeetingRoomMode = 'day';
        const dayRate = daily > 0 ? daily : (hourly > 0 ? hourly * 9 : monthly / 30);
        if (this.quotationStartDate && this.quotationMeetingDayEnd) {
          const start = new Date(this.quotationStartDate);
          const end = new Date(this.quotationMeetingDayEnd);
          const diffMs = end.getTime() - start.getTime();
          const diffDays = Math.max(1, Math.ceil(diffMs / 86_400_000));
          this.quotationSubtotal = parseFloat((dayRate * diffDays).toFixed(2));
        } else {
          this.quotationSubtotal = parseFloat(dayRate.toFixed(2));
        }
      } else {
        const rate = hourly > 0 ? hourly : (daily > 0 ? daily : monthly);
        if (this.quotationMeetingRoomMode === 'day' && this.quotationStartDate && this.quotationMeetingDayEnd) {
          const start = new Date(this.quotationStartDate);
          const end = new Date(this.quotationMeetingDayEnd);
          const diffMs = end.getTime() - start.getTime();
          const diffDays = Math.max(1, Math.ceil(diffMs / 86_400_000));
          this.quotationSubtotal = parseFloat((rate * 9 * diffDays).toFixed(2));
        } else {
          const hours = this.quotationSelectedSlots.size || 1;
          this.quotationSubtotal = parseFloat((rate * hours).toFixed(2));
        }
      }
      this.quotationSecurityDeposit = 0;
    } else {
      const roomMonthlyRent = this.quotationMonthlyBasePrice;
      this.quotationSubtotal = parseFloat((roomMonthlyRent * Number(this.quotationMonths || 1)).toFixed(2));
      this.quotationSecurityDeposit = this.effectiveQuotationSecurityDeposit;
    }

    const discVal = Number(this.quotationDiscountValue || 0);
    if (this.quotationDiscountType === 'Percentage') {
      this.quotationDiscountPercentage = Math.min(100, Math.max(0, discVal));
    } else {
      this.quotationDiscountPercentage = 0;
    }

    this.quotationTotal = this.quotationFirstInvoiceTotal;
  }


  submitAdminQuotation(sendEmail: boolean = false) {
    this.quotationFormSaving.set(true);
    this.quotationFormError.set('');
    this.quotationFormErrorField = '';

    if (!this.selectedCustomer) {
      this.quotationFormErrorField = 'customer';
      this.quotationFormError.set('Please select a customer.');
      this.showError(this.quotationFormError());
      this.scrollToTopAndHighlight('customer');
      this.quotationFormSaving.set(false);
      return;
    }
    if (!this.quotationFormData.spaceId) {
      this.quotationFormErrorField = 'space';
      this.quotationFormError.set('Please select a space.');
      this.showError(this.quotationFormError());
      this.scrollToTopAndHighlight('space');
      this.quotationFormSaving.set(false);
      return;
    }
    if (this.isQuotationMeetingRoom && this.quotationMeetingRoomMode === 'slot' && this.quotationSelectedSlots.size === 0) {
      this.quotationFormErrorField = 'slots';
      this.quotationFormError.set('Please select at least one time slot.');
      this.showError(this.quotationFormError());
      this.scrollToTopAndHighlight('slots');
      this.quotationFormSaving.set(false);
      return;
    }
    if (this.isQuotationMeetingRoom && this.quotationMeetingRoomMode === 'day' && (!this.quotationStartDate || !this.quotationMeetingDayEnd)) {
      this.quotationFormErrorField = 'startDate';
      this.quotationFormError.set('Please specify start and end date for the meeting room booking.');
      this.showError(this.quotationFormError());
      this.scrollToTopAndHighlight('startDate');
      this.quotationFormSaving.set(false);
      return;
    }
    this.validateQuotationDiscount();
    if (this.quotationDiscountError()) {
      this.quotationFormErrorField = 'discount';
      this.quotationFormError.set(this.quotationDiscountError());
      this.showError(this.quotationDiscountError());
      this.scrollToTopAndHighlight('discount');
      this.quotationFormSaving.set(false);
      return;
    }
    this.validateQuotationBasePrice();
    if (this.quotationBasePriceError()) {
      this.quotationFormErrorField = 'basePrice';
      this.quotationFormError.set(this.quotationBasePriceError());
      this.showError(this.quotationBasePriceError());
      this.scrollToTopAndHighlight('basePrice');
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

    const payload: any = {
      QuotationNumber: this.quotationFormData.quotationNumber || `WN-Q-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getTime()).slice(-5)}`,
      VersionNumber: this.targetVersionNumber || 1,
      Status: 'Draft',
      CustomerId: Number(u.customerId || u.id || 0),
      SpaceId: Number(this.quotationFormData.spaceId),
      OfferingTypeId: Number(this.quotationOfferingTypeId || 1),
      OfferingType: this.quotationOfferingType || '24/7',
      StartDateTime: startDT,
      EndDateTime: endDT,
      ValidUntil: localDateIso(new Date(this.quotationValidUntil)),
      SubtotalAmount: this.quotationSubtotal,
      DiscountPercentage: this.quotationDiscountType === 'Percentage' ? Number(this.quotationDiscountValue || 0) : 0,
      DiscountType: this.quotationDiscountType,
      DiscountValue: Number(this.quotationDiscountValue || 0),
      SecurityDepositOverride: this.effectiveQuotationSecurityDeposit,
      BillingPeriodMonths: Number(this.quotationBillingPeriodMonths || 3),
      billingPeriodMonths: Number(this.quotationBillingPeriodMonths || 3),
      SecurityDepositMonths: Number(this.quotationSecurityDepositMonths ?? 0),
      securityDepositMonths: Number(this.quotationSecurityDepositMonths ?? 0),
      FloorId: this.quotationFloorId ?? null,
      PerSeatBasePrice: Number(this.quotationPerSeatBasePrice || 0),
      Capacity: Number(this.quotationCapacity || 1),
      MonthlyBasePrice: Number(this.quotationMonthlyBasePrice || 0),
      MaxDiscountPercent: Number(this.quotationDynamicDiscountCap || 10),
      WithholdingTaxRate: Number(this.quotationWithholdingTaxRate ?? 15),
    };
    if (this.quotationRemarks) payload.Remarks = this.quotationRemarks;
    if (currentAdminId) payload.CreatedById = currentAdminId;

    const obs = (this.isCreatingNewVersion && this.parentQuotationId)
      ? this.quotationSvc.createQuotationVersion(this.parentQuotationId, payload)
      : this.quotationSvc.createQuotation(payload);

    obs.subscribe({
      next: (res: any) => {
        this.quotationFormSaving.set(false);
        this.showQuotationForm.set(false); // Close quotation form modal on save & quoted
        this.quotationSuccessMessage.set(this.isCreatingNewVersion ? "Version saved successfully!" : "Quotation saved successfully!");
        this.showSuccess(this.quotationSuccessMessage());
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
        const msg = err?.error?.errorMessage || err?.error?.ErrorMessage || err?.error?.message || err?.message || 'Failed to generate quotation.';
        this.quotationFormError.set(msg);
        this.quotationFormErrorField = 'space';
        this.showError(msg);
        this.scrollToTopAndHighlight('space');
      }
    });
  }

  createNextVersion(sourceVersion: any) {
    if (!sourceVersion) return;
    const qId = sourceVersion.quotationId || sourceVersion.id || sourceVersion.Id;
    const nextVer = (sourceVersion.versionNumber || sourceVersion.version || 1) + 1;

    // 1. Open quotation form modal
    this.openAdminQuotationForm();
    this.isCreatingNewVersion = true;
    this.parentQuotationId = qId;
    this.targetVersionNumber = nextVer;

    // 2. Prefill Customer Details (fully editable)
    const custName = sourceVersion.customerName || sourceVersion.CustomerName || sourceVersion.customer?.name || sourceVersion.customer?.fullName || '';
    const custEmail = sourceVersion.customerEmail || sourceVersion.CustomerEmail || sourceVersion.customer?.email || '';
    const custCode = sourceVersion.customerCode || sourceVersion.CustomerCode || sourceVersion.customer?.code || '';
    const custPhone = sourceVersion.customerPhone || sourceVersion.CustomerPhone || sourceVersion.customer?.phone || sourceVersion.customer?.phoneNumber || '';

    if (sourceVersion.customer && typeof sourceVersion.customer === 'object') {
      this.selectCustomer(sourceVersion.customer);
    } else if (sourceVersion.customerId) {
      this.admin.getCustomers(1, 1000, '').subscribe({
        next: (res: any) => {
          const list = res?.data ?? (Array.isArray(res) ? res : []);
          const found = list.find((c: any) => (c.id || c.idGuid) === sourceVersion.customerId || c.email === custEmail);
          if (found) {
            this.selectCustomer(found);
          } else if (custName || custEmail) {
            this.selectedCustomer = {
              id: sourceVersion.customerId,
              name: custName || 'Customer',
              fullName: custName || 'Customer',
              email: custEmail,
              code: custCode,
              phone: custPhone,
              phoneNumber: custPhone
            };
            this.customerSearchQuery = custName || custEmail || '';
          }
          this.cdr.markForCheck(); // plain fields changed in a callback (zoneless)
        },
        error: this.apiError('Failed to load customers.')
      });
    } else if (custName || custEmail) {
      this.selectedCustomer = {
        name: custName || 'Customer',
        fullName: custName || 'Customer',
        email: custEmail,
        code: custCode,
        phone: custPhone,
        phoneNumber: custPhone
      };
      this.customerSearchQuery = custName || custEmail || '';
    }

    // 3. Prefill Space & Location Details (fully editable)
    const prefillSpaceInfo = () => {
      const space = this.allSpaces().find((s: any) => String(s.id) === String(sourceVersion.spaceId) || String(s.idGuid) === String(sourceVersion.spaceId));
      if (space) {
        this.selectedQuotationLocationId = space.locationId || space.location?.id || sourceVersion.locationId || '';
        this.onQuotationLocationChange();

        const cat = (space.spaceTypeName || space.spaceCategory || '').toLowerCase();
        if (cat.includes('shared') || cat.includes('co-working')) {
          this.selectedQuotationSpaceTypeId = 'shared';
        } else if (cat.includes('private')) {
          this.selectedQuotationSpaceTypeId = 'private';
        } else if (cat.includes('meeting') || cat.includes('conference')) {
          this.selectedQuotationSpaceTypeId = 'meeting';
        }

        this.selectedQuotationCapacity = space.capacity || sourceVersion.capacity || null;
        this.quotationFloorId = space.floorId || sourceVersion.floorId || null;
        this.quotationFormData.spaceId = space.id || sourceVersion.spaceId;
        this.quotationCapacity = Number(space.capacity || space.Capacity || sourceVersion.capacity || 1);
        const { monthly } = this.getSpacePrice(space);
        const baseMonthly = monthly > 0 ? monthly : Number(space.price || space.Price || 35000);
        this.quotationMinPerSeatBasePrice = baseMonthly;
        this.quotationPerSeatBasePrice = Number(sourceVersion.perSeatBasePrice ?? sourceVersion.PerSeatBasePrice ?? baseMonthly);
      } else {
        if (sourceVersion.locationId) {
          this.selectedQuotationLocationId = sourceVersion.locationId;
          this.onQuotationLocationChange();
        }
        if (sourceVersion.spaceTypeId) this.selectedQuotationSpaceTypeId = sourceVersion.spaceTypeId;
        if (sourceVersion.capacity) this.selectedQuotationCapacity = sourceVersion.capacity;
        if (sourceVersion.floorId) this.quotationFloorId = sourceVersion.floorId;
        if (sourceVersion.spaceId) this.quotationFormData.spaceId = sourceVersion.spaceId;
        if (sourceVersion.perSeatBasePrice != null || sourceVersion.PerSeatBasePrice != null) {
          const p = Number(sourceVersion.perSeatBasePrice ?? sourceVersion.PerSeatBasePrice);
          this.quotationMinPerSeatBasePrice = p;
          this.quotationPerSeatBasePrice = p;
        }
      }
      this.validateQuotationBasePrice();
      this.recalcQuotationAmount();
    };

    if (!this.allSpaces().length) {
      this.admin.getSpaces(1, 1000, '').subscribe({
        next: (res: any) => {
          this.allSpaces.set(res?.data ?? []);
          prefillSpaceInfo();
        },
        error: this.apiError('Failed to load spaces.')
      });
    } else {
      prefillSpaceInfo();
    }

    // 4. Prefill Commercial Terms & Version Info
    this.quotationFormData.quotationNumber = sourceVersion.quotationNumber || `Q-2026-001`;
    this.quotationMonths = sourceVersion.contractPeriodMonths || sourceVersion.months || 12;
    this.quotationBillingPeriodMonths = sourceVersion.billingPeriodMonths || 3;
    this.quotationSecurityDepositMonths = sourceVersion.securityDepositMonths || 2;
    this.quotationSecurityDepositMonthsOverride = sourceVersion.securityDepositMonthsOverride ?? null;
    this.quotationDiscountType = sourceVersion.discountType || 'Percentage';
    this.quotationDiscountValue = sourceVersion.discountValue || sourceVersion.discountPercentage || 0;
    const srcOt = sourceVersion.offeringTypeDescription || sourceVersion.OfferingTypeDescription || sourceVersion.offeringType || sourceVersion.OfferingType || sourceVersion.operatingHours;
    const srcOtId = sourceVersion.offeringTypeId || sourceVersion.OfferingTypeId;
    this.quotationOfferingType = this.resolveOfferingTypeDescription(srcOt, srcOtId);
    const matched = this.offeringTypes().find(o => o.description === this.quotationOfferingType);
    this.quotationOfferingTypeId = matched?.id || Number(srcOtId || 1);
    this.loadOfferingTypes();

    const declineNote = sourceVersion.customerNote || sourceVersion.note || sourceVersion.responseNote;
    if (declineNote) {
      this.quotationRemarks = `Revision v${nextVer} (Customer requested: "${declineNote}")`;
    } else {
      this.quotationRemarks = sourceVersion.remarks || `Revision v${nextVer}`;
    }

    this.recalcQuotationAmount();
  }


  sendQuotationVersionToCustomer(item: any) {
    const qId = item.quotationId || item.id || item.Id;
    const vId = item.versionId || item.versionNumber || item.version || 1;

    if (!confirm(`Are you sure you want to Send Version ${vId} of Quotation ${item.quotationNumber} to the customer?`)) return;

    this.quotationSvc.sendQuotationVersion(qId, vId).subscribe({
      next: () => {
        this.success.set(`Quotation Version ${vId} sent to customer. Status updated to Sent.`);
        this.showSuccess(this.success());
        setTimeout(() => this.success.set(''), 4000);
        this.load();
      },
      error: (err: any) => {
        this.showError(err?.error?.message || err?.message || 'Failed to send quotation.');
      }
    });
  }

  previewQuotation(item: any) {
    this.selectedQuotation.set(null);
    this.quotationVersions.set([]);
    this.showQuotationPreviewModal.set(true);
    this.quotationEmailSent.set('');

    const id = item.id || item.quotationId || item.Id;
    if (!id) {
      this.selectedQuotation.set(item);
      return;
    }

    this.quotationSvc.getQuotationById(id).subscribe({
      next: (res: any) => {
        const q = res?.data ?? res;
        this.selectedQuotation.set(q);
      },
      error: () => {
        this.selectedQuotation.set(item);
      }
    });

    // Load full version history for the quotation
    this.quotationSvc.getQuotationVersions(id).subscribe({
      next: (res: any) => {
        const versions = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        this.quotationVersions.set(versions);
      },
      error: () => {
        this.quotationVersions.set([item]);
      }
    });
  }

  closeQuotationPreviewModal() {
    this.showQuotationPreviewModal.set(false);
    this.selectedQuotation.set(null);
    this.quotationVersions.set([]);
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
    const filename = `Quotation-${q?.quotationNumber || 'WN'}-v${q?.versionNumber || 1}.pdf`;
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

  sendChallanEmail() {
    const c = this.challanData();
    if (!c) return;
    const targetEmail = c.customerEmail || c.userEmail || '';
    if (!targetEmail) {
      this.showError('No customer email address available for this challan.');
      return;
    }
    this.sendingChallanEmail.set(true);
    this.challanEmailSent.set('Sending Challan Email...');

    this.bookingService.sendChallanEmail(c.bookingId || c.id, targetEmail).subscribe({
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
  }

  isQuotationAccepted(item: any): boolean {
    if (!item) return false;
    const st = (item.status || item.Status || '').toString().trim().toLowerCase();
    return st === 'accepted' || st === 'signed' || st === 'agreementsigned' || st === 'active' || st === 'sent' || st === 'agreementsent' || item.isAccepted === true || item.IsAccepted === true;
  }

  isQuotationSigned(item: any): boolean {
    if (!item) return false;
    const st = (item.status || item.Status || '').toString().trim().toLowerCase();
    return st === 'signed' || st === 'agreementsigned';
  }

  convertQuotationToBooking(item: any) {
    if (!item) return;
    this.openConversionPreviewModal(item);
  }


  // Booking Details Modal
  readonly showBookingDetailsModal = signal(false);
  selectedBookingDetails = signal<any>(null);
  bookingBillingSummaryData = signal<any>(null);


  openBookingDetailsModal(item: any) {
    if (!item) return;
    this.selectedBookingDetails.set(null);
    this.bookingBillingSummaryData.set(null);
    this.showBookingDetailsModal.set(true);

    // 1. Resolve actual Booking ID
    let realBookingId = item.bookingId || item.BookingId || item.booking?.id || item.Booking?.Id;

    if (!realBookingId && this.entity === 'bookings') {
      realBookingId = item.id || item.Id;
    }

    const fetchBookingAndSummary = (bId: number) => {
      this.bookingService.getBookingDetails(bId).subscribe({
        next: (res: any) => {
          const raw = res?.data ?? res ?? {};
          const c = raw.contract || raw.Contract || {};

          const normalized = {
            ...item,
            ...raw,
            bookingId: raw.bookingId || raw.BookingId || raw.id || raw.Id || bId,
            customerName: raw.customerName || raw.CustomerName || raw.userName || raw.UserName || raw.userEmail || item.customerName || 'Customer',
            spaceName: raw.spaceName || raw.SpaceName || c.spaceName || c.SpaceName || item.spaceName || 'Workspace',
            spaceNumber: raw.spaceNumber || raw.SpaceNumber || raw.spaceCode || raw.SpaceCode || c.spaceNumber || c.SpaceNumber || item.spaceCode || 'N/A',
            bookingStatus: raw.bookingStatus || raw.BookingStatus || raw.status || raw.Status || 'Confirmed',
            billingPeriodMonths: raw.billingPeriodMonths || raw.BillingPeriodMonths || c.billingPeriodMonths || 1,
            billingPeriod: raw.billingPeriod || raw.BillingPeriod || c.billingPeriod || 'Monthly',
            contractStartDate: raw.contractStartDate || raw.ContractStartDate || c.contractStartDate || c.ContractStartDate || raw.startOn || raw.startDateTime,
            contractEndDate: raw.contractEndDate || raw.ContractEndDate || c.contractEndDate || c.ContractEndDate || raw.endOn || raw.endDateTime,
            contractDuration: raw.numberOfMonths || raw.NumberOfMonths || c.numberOfMonths || c.NumberOfMonths || raw.contractDuration || 1,
            monthlyRent: raw.monthlyRent ?? raw.MonthlyRent ?? c.monthlyRent ?? c.MonthlyRent ?? raw.pricePerMonth ?? raw.PricePerMonth ?? 0,
            currentCycleAmount: raw.currentCycleAmount ?? raw.CurrentCycleAmount ?? c.currentCycleAmount ?? c.CurrentCycleAmount ?? raw.cycleAmount ?? 0,
            totalContractAmount: raw.totalContractAmount ?? raw.TotalContractAmount ?? c.totalContractAmount ?? c.TotalContractAmount ?? raw.totalAmount ?? raw.TotalAmount ?? 0,
            securityDeposit: raw.securityDeposit ?? raw.SecurityDeposit ?? c.securityDeposit ?? c.SecurityDeposit ?? 0,
            balanceLeft: raw.balanceLeft ?? raw.BalanceLeft ?? c.balanceLeft ?? c.BalanceLeft ?? raw.balanceAmount ?? raw.BalanceAmount ?? 0,
            nextBillingDate: raw.nextBillingDate || raw.NextBillingDate || raw.nextBillDueDate || raw.NextBillDueDate || c.nextBillingDate || c.NextBillingDate
          };

          this.selectedBookingDetails.set(normalized);
        },
        error: () => {
          this.selectedBookingDetails.set(this.buildFallbackBookingDetails(item));
        }
      });

      this.admin.getBookingBillingSummary(bId).subscribe({
        next: (res: any) => {
          const s = res?.data ?? res ?? {};
          const summaryData: any = {
            securityDepositRequired: s.securityDepositRequired ?? s.SecurityDepositRequired ?? s.requiredAmount ?? s.RequiredAmount ?? 0,
            securityDepositInvoiced: s.securityDepositInvoiced ?? s.SecurityDepositInvoiced ?? s.invoicedAmount ?? s.InvoicedAmount ?? 0,
            securityDepositPaid: s.securityDepositPaid ?? s.SecurityDepositPaid ?? s.paidAmount ?? s.PaidAmount ?? 0,
            securityDepositOutstanding: s.securityDepositOutstanding ?? s.SecurityDepositOutstanding ?? s.outstandingAmount ?? s.OutstandingAmount ?? 0,
            securityDepositCharged: s.securityDepositCharged ?? s.SecurityDepositCharged ?? s.isCharged ?? s.IsCharged ?? false
          };
          this.bookingBillingSummaryData.set(summaryData);
        },
        error: () => {
          this.bookingBillingSummaryData.set({
            securityDepositRequired: 0,
            securityDepositInvoiced: 0,
            securityDepositPaid: 0,
            securityDepositOutstanding: 0,
            securityDepositCharged: false
          });
        }
      });
    };

    if (realBookingId) {
      fetchBookingAndSummary(realBookingId);
    } else if (this.entity === 'invoices' && item.id) {
      // Query full invoice details to extract real booking ID
      this.admin.getInvoiceDetails(item.id).subscribe({
        next: (res: any) => {
          const invDetails = res?.data ?? res ?? {};
          const extractedBookingId = invDetails.bookingId || invDetails.BookingId || invDetails.booking?.id || invDetails.Booking?.Id;
          if (extractedBookingId) {
            fetchBookingAndSummary(extractedBookingId);
          } else {
            this.selectedBookingDetails.set(this.buildFallbackBookingDetails(item, invDetails));
          }
        },
        error: () => {
          this.selectedBookingDetails.set(this.buildFallbackBookingDetails(item));
        }
      });
    } else {
      this.selectedBookingDetails.set(this.buildFallbackBookingDetails(item));
    }
  }

  private buildFallbackBookingDetails(item: any, invDetails?: any): any {
    const src = invDetails || item;
    return {
      id: src.bookingId || src.BookingId || src.id || src.Id || item.id,
      bookingId: src.bookingId || src.BookingId || src.id || src.Id || item.id,
      customerName: src.customerName || src.CustomerName || src.userName || src.userEmail || item.customerName || 'Customer',
      spaceName: src.spaceName || src.SpaceName || item.spaceName || 'Workspace',
      spaceNumber: src.spaceNumber || src.SpaceNumber || src.spaceCode || src.SpaceCode || item.spaceNumber || item.spaceCode || 'N/A',
      bookingStatus: src.bookingStatus || src.BookingStatus || src.statusLabel || src.status || 'Confirmed',
      billingPeriodMonths: src.billingPeriodMonths || src.BillingPeriodMonths || 1,
      billingPeriod: src.billingPeriod || src.BillingPeriod || 'Monthly',
      contractStartDate: src.contractStartDate || src.ContractStartDate || src.createdOn || src.createdAt || src.issuedOn || item.issuedOn,
      contractEndDate: src.contractEndDate || src.ContractEndDate || src.dueDate || item.dueDate,
      monthlyRent: src.monthlyRent ?? src.MonthlyRent ?? src.totalAmount ?? src.TotalAmount ?? item.totalAmount ?? 0,
      currentCycleAmount: src.currentCycleAmount ?? src.CurrentCycleAmount ?? src.totalAmount ?? src.TotalAmount ?? item.totalAmount ?? 0,
      totalContractAmount: src.totalContractAmount ?? src.TotalContractAmount ?? src.totalAmount ?? src.TotalAmount ?? item.totalAmount ?? 0,
      securityDeposit: src.securityDeposit ?? src.SecurityDeposit ?? 0,
      balanceLeft: src.balanceAmount ?? src.BalanceAmount ?? src.balanceLeft ?? src.BalanceLeft ?? 0,
      nextBillingDate: src.nextBillingDate || src.NextBillingDate || src.dueDate || item.dueDate
    };
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
    const bookingId = booking.bookingId || booking.BookingId || booking.booking?.id || (this.entity === 'bookings' ? (booking.id || booking.Id) : null);
    if (bookingId) {
      this.bookingService.getChallan(bookingId).subscribe({
        next: (res: any) => {
          const c = res?.data ?? res ?? {};
          const startIso = c.startOn || booking.startOn || booking.startDateTime;
          const endIso = c.endOn || booking.endOn || booking.endDateTime;

          const challan: any = {
            challanNumber: c.challanNumber || booking.challanNumber || `WN-BK-${bookingId}`,
            validity: c.validUntil || new Date(new Date().setDate(new Date().getDate() + 5)).toISOString(),
            customerName: c.customerName || booking.customerName || booking.userName || 'Customer',
            customerEmail: c.customerEmail || booking.customerEmail || booking.userEmail || '',
            customerCode: c.customerCode || booking.customerCode || '',
            spaceName: c.spaceName || booking.spaceName || 'Workspace',
            spaceTypeName: c.spaceTypeName || booking.spaceTypeName,
            locationName: c.locationName || booking.locationName,
            contractStartDateTime: c.contractStartDate || startIso,
            contractEndDateTime: c.contractEndDate || endIso,
            billingPeriodStart: startIso,
            billingPeriodEnd: c.nextBillDueDate || endIso,
            startDateTime: startIso,
            endDateTime: endIso,
            totalContractAmount: c.totalContractAmount ?? c.contract?.totalContractAmount ?? 0,
            nextBillDueDate: c.nextBillDueDate ?? c.nextBillingDate ?? c.validUntil,
            balanceLeft: c.balanceLeft ?? c.contract?.balanceLeft ?? 0,
            notes: c.challanNotes || booking.notes,
            bookingDetails: (c.details || []).map((d: any) => ({
              feeType: d.chargeTypeLabel || d.chargeTypeCode || d.description,
              description: d.description || d.chargeTypeLabel,
              amount: d.lineTotal,
              accountName: d.accountName
            })),
            discountPercentage: c.discountPercentage ?? booking.discountPercentage ?? 0,
            totalAmount: c.totalPayable ?? 0,
            bookingId: bookingId,
            createdAt: c.issuedOn || new Date().toISOString()
          };

          this.challanData.set(challan);
          this.showChallanModal.set(true);
        },
        error: () => {
          this.showError('Failed to load challan details.');
        }
      });
    }
  }
  // Invoice Details View
  // Create Custom Invoice Modal State
  sendingInitialInvoiceId = signal<number | null>(null);
  sentInitialInvoices = new Set<number>();

  readonly showCreateCustomInvoiceModal = signal(false);
  customInvoiceSelectedMonths = 3;
  customInvoiceMonthlyRate = 0;
  customInvoiceCurrentItem: any = null;
  customInvoiceIsNextInvoice = false;
  customInvoiceMonthOptions = [
    { v: 1, l: "Next 1 Month" },
    { v: 2, l: "Next 2 Months" },
    { v: 3, l: "Next 3 Months" },
    { v: 4, l: "Next 4 Months" },
    { v: 5, l: "Next 5 Months" },
    { v: 6, l: "Next 6 Months" },
    { v: 7, l: "Next 7 Months" },
    { v: 8, l: "Next 8 Months" },
    { v: 9, l: "Next 9 Months" },
    { v: 10, l: "Next 10 Months" },
    { v: 11, l: "Next 11 Months" },
    { v: 12, l: "Next 12 Months" }
  ];
  submittingCustomInvoice = signal<boolean>(false);
  customInvoiceUsers = signal<any[]>([]);
  customInvoiceFormData = {
    bookingId: 0,
    userId: 0,
    issuedOn: localDateIso(),
    dueOn: localDateIso(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)),
    currencyCode: 'PKR',
    notes: ''
  };
  customInvoiceLines: Array<{ description: string; quantity: number; unitPrice: number; discountAmount: number; taxRate: number }> = [
    { description: 'Workspace Rent / Custom Fee', quantity: 1, unitPrice: 0, discountAmount: 0, taxRate: 0.016 }
  ];

  // Initial Invoice Preview Modal State
  readonly showInitialInvoicePreviewModal = signal(false);
  selectedInitialInvoiceItem = signal<any>(null);
  initialInvoiceRecipientEmail = signal<string>('');

  sendInitialInvoice(item: any) {
    if (!item) return;
    const bookingId = item?.bookingId ?? item?.BookingId ?? item?.id ?? item?.Id;
    if (!bookingId) {
      this.showError('Booking ID is missing.');
      return;
    }
    this.selectedInitialInvoiceItem.set(item);
    // Only the invoice opened right after a signed agreement is dated on that agreement; any other is dated today.
    this.initialInvoiceIssuedOn.set(item.issuedOn ?? null);
    // Show the server's own figures (proration, discount, tax, deposit) â€” not a browser-side estimate.
    this.loadInitialInvoicePreview(Number(bookingId), item.issuedOn ?? null);
    const targetEmail = item.customerEmail || item.userEmail || item.email || '';
    this.initialInvoiceRecipientEmail.set(targetEmail);
    this.showInitialInvoicePreviewModal.set(true);
  }

  /** Server-calculated first invoice (see previewInitialInvoice); null while loading or if unavailable. */
  // No local estimate is ever shown: only the server's figures, or a loading / error state.
  initialInvoicePreview = signal<any | null>(null);
  initialInvoicePreviewLoading = signal(false);
  initialInvoicePreviewError = signal('');
  loadInitialInvoicePreview(bookingId: number, issuedOn: string | null) {
    this.initialInvoicePreview.set(null);
    this.initialInvoicePreviewError.set('');
    this.initialInvoicePreviewLoading.set(true);
    this.admin.previewInitialInvoice(bookingId, issuedOn).subscribe({
      next: (res: any) => {
        this.initialInvoicePreviewLoading.set(false);
        if (res?.data) this.initialInvoicePreview.set(res.data);
        else this.initialInvoicePreviewError.set(res?.message || 'The invoice could not be calculated.');
      },
      error: (err: any) => {
        this.initialInvoicePreviewLoading.set(false);
        this.initialInvoicePreviewError.set(err?.error?.message || 'The invoice could not be calculated.');
      }
    });
  }

  confirmSendInitialInvoice() {
    // Double-click guard: a send is already in flight.
    if (this.sendingInitialInvoiceId() !== null) return;
    const item = this.selectedInitialInvoiceItem();
    if (!item || !this.initialInvoicePreview()) return;
    const bookingId = item?.bookingId ?? item?.BookingId ?? item?.id ?? item?.Id;
    if (!bookingId) return;

    this.sendingInitialInvoiceId.set(bookingId);

    this.admin.sendInitialInvoice(bookingId, this.initialInvoiceIssuedOn()).subscribe({
      next: (res: any) => {
        this.sendingInitialInvoiceId.set(null);
        this.initialInvoiceIssuedOn.set(null);
        this.showInitialInvoicePreviewModal.set(false);
        if (item) item.initialInvoiceSent = true;
        this.sentInitialInvoices.add(bookingId);
        this.showSuccess(res?.message || 'Initial payment invoice generated and emailed successfully to customer!');
        this.load();
      },
      error: (err: any) => {
        this.sendingInitialInvoiceId.set(null);
        this.showError(err?.error?.message || err?.message || 'Failed to send initial payment invoice.');
      }
    });
  }

  buildCustomInvoiceLinesFromItem(item: any, isNextInvoice: boolean = false, selectedMonths?: number): Array<{ description: string; quantity: number; unitPrice: number; discountAmount: number; taxRate: number }> {
    if (!item) {
      const m = selectedMonths || this.customInvoiceSelectedMonths || 1;
      const rate = this.customInvoiceMonthlyRate || 0;
      return [{ description: `Workspace Rent / Custom Fee (${m} Month(s))`, quantity: 1, unitPrice: rate * m, discountAmount: 0, taxRate: 0.016 }];
    }

    const bookingId = item.bookingId ?? item.BookingId ?? item.id ?? item.Id;
    const spaceLabel = item.spaceName || item.SpaceName || item.spaceTitle || (item.invoiceNumber || item.InvoiceNumber ? `Invoice ${item.invoiceNumber || item.InvoiceNumber}` : "Workspace");

    const totalContract = item.totalContractAmount ?? item.TotalContractAmount ?? item.totalAmount ?? item.subTotal ?? item.subtotalAmount ?? 0;
    const contractMonths = item.durationMonths || item.contractMonths || item.months || 10;
    const cycleMonths = selectedMonths || this.customInvoiceSelectedMonths || item.billingPeriodMonths || item.advanceMonths || item.billingCycleMonths || 3;
    const secMonths = item.securityDepositMonths || item.depositMonths || 2;

    let monthlyRate = this.customInvoiceMonthlyRate;
    if (!monthlyRate || monthlyRate <= 0) {
      monthlyRate = item?.monthlyRent || item?.MonthlyRent || item?.pricePerMonth || item?.monthlyRate || item?.rentPerMonth || 0;
      if (monthlyRate <= 0) {
        const cycleAmount = item?.billingRentAmount ?? item?.currentCycleAmount ?? item?.advanceRent ?? item?.price ?? 0;
        if (cycleAmount > 0 && (item?.billingPeriodMonths || 3) > 0) {
          monthlyRate = cycleAmount / (item?.billingPeriodMonths || 3);
        }
      }
      if (monthlyRate < 0) monthlyRate = 0;
    }

    const calculatedRent = monthlyRate * cycleMonths;
    const securityDeposit = item.effectiveSecurityDeposit ?? item.securityDeposit ?? item.depositAmount ?? (monthlyRate > 0 && secMonths > 0 ? (monthlyRate * secMonths) : 0);
    const discount = item.bookingDiscountAmount ?? item.discountAmount ?? 0;

    const isAlreadySent = isNextInvoice || item.initialInvoiceSent || (bookingId && this.sentInitialInvoices.has(bookingId));

    if (isAlreadySent) {
      const rentLabel = `Workspace Room Rent (${cycleMonths} Month(s) - ${spaceLabel})`;
      return [
        {
          description: rentLabel,
          quantity: 1,
          unitPrice: calculatedRent,
          discountAmount: 0,
          taxRate: 0.016
        }
      ];
    }

    if (calculatedRent > 0 || securityDeposit > 0) {
      const resultLines = [];
      if (calculatedRent > 0) {
        const rentLabel = `1st Advance Rent (${cycleMonths} Month(s) - ${spaceLabel})`;
        resultLines.push({
          description: rentLabel,
          quantity: 1,
          unitPrice: calculatedRent,
          discountAmount: discount,
          taxRate: 0.016
        });
      }

      if (securityDeposit > 0) {
        const secLabel = `Security Deposit (${secMonths} Month(s) Refundable - ${spaceLabel})`;
        resultLines.push({
          description: secLabel,
          quantity: 1,
          unitPrice: securityDeposit,
          discountAmount: 0,
          taxRate: 0
        });
      }
      return resultLines;
    }

    const rawLines = item.lines || item.Lines || item.bookingDetails || item.items || item.details || [];
    if (rawLines.length > 0) {
      return rawLines.filter((l: any) => {
        const feeType = (l.feeType || l.chargeTypeLabel || l.description || "").toLowerCase();
        return !feeType.includes("tax") && !feeType.includes("pst") && !feeType.includes("vat");
      }).map((l: any) => {
        const feeType = (l.feeType || l.chargeTypeLabel || l.description || "").toLowerCase();
        const isDepositLine = feeType.includes("deposit") || feeType.includes("security");

        return {
          description: l.description || l.feeType || l.chargeTypeLabel || "Workspace Service",
          quantity: l.quantity || l.qty || 1,
          unitPrice: l.unitPrice || l.amount || l.lineTotal || 0,
          discountAmount: l.discountAmount || 0,
          taxRate: isDepositLine ? 0 : (l.taxRate ?? 0.016)
        };
      });
    }

    return [
      {
        description: `Workspace Room Rent (${cycleMonths} Month(s) - ${spaceLabel})`,
        quantity: 1,
        unitPrice: calculatedRent,
        discountAmount: 0,
        taxRate: 0.016
      }
    ];
  }

  openCreateCustomInvoiceModal(item?: any, isNextInvoice: boolean = false) {
    this.customInvoiceCurrentItem = item;
    this.customInvoiceIsNextInvoice = isNextInvoice;

    let configuredMonths = item?.billingPeriodMonths || item?.advanceMonths || item?.billingCycleMonths || item?.cycleMonths || 3;
    if (!configuredMonths || configuredMonths <= 0) configuredMonths = 3;
    this.customInvoiceSelectedMonths = configuredMonths;

    const extractRateFromItem = (obj: any, months: number): number => {
      if (!obj) return 0;
      let rate = obj?.monthlyRent || obj?.MonthlyRent || obj?.pricePerMonth || obj?.monthlyRate || obj?.rentPerMonth || obj?.roomPrice || obj?.seatPrice || 0;

      const lines = obj?.lines || obj?.Lines || obj?.bookingDetails || obj?.items || obj?.details || [];
      if (rate <= 0 && lines.length > 0) {
        const rentLine = lines.find((l: any) => {
          const desc = (l.description || l.feeType || l.chargeTypeLabel || "").toLowerCase();
          return desc.includes("rent") || desc.includes("room") || desc.includes("office") || desc.includes("workspace");
        });
        if (rentLine && (rentLine.unitPrice || rentLine.amount)) {
          const lineAmt = rentLine.unitPrice || rentLine.amount || 0;
          rate = lineAmt > 0 && months > 0 ? (lineAmt / months) : lineAmt;
        } else {
          const totalLineAmt = lines.reduce((acc: number, l: any) => {
            const desc = (l.description || l.feeType || "").toLowerCase();
            if (desc.includes("deposit") || desc.includes("security") || desc.includes("tax")) return acc;
            return acc + (l.unitPrice || l.amount || 0);
          }, 0);
          if (totalLineAmt > 0) rate = months > 0 ? (totalLineAmt / months) : totalLineAmt;
        }
      }

      if (rate <= 0) {
        const cycleAmount = obj?.billingRentAmount ?? obj?.currentCycleAmount ?? obj?.advanceRent ?? 0;
        if (cycleAmount > 0 && months > 0) {
          rate = cycleAmount / months;
        }
      }

      if (rate <= 0) {
        const totalAmt = obj?.totalContractAmount ?? obj?.TotalContractAmount ?? obj?.subTotal ?? obj?.SubTotal ?? obj?.grandTotal ?? obj?.GrandTotal ?? obj?.totalAmount ?? 0;
        const durMonths = obj?.durationMonths || obj?.contractMonths || obj?.months || 0;
        if (totalAmt > 0 && durMonths > 0) {
          rate = totalAmt / durMonths;
        } else if (totalAmt > 0 && months > 0) {
          rate = totalAmt / months;
        } else if (totalAmt > 0) {
          rate = totalAmt;
        }
      }

      return Math.max(0, Math.round(rate * 100) / 100);
    };

    let monthlyRate = extractRateFromItem(item, configuredMonths);
    this.customInvoiceMonthlyRate = monthlyRate;

    const isInvoiceItem = !!(item?.invoiceNumber || item?.InvoiceNumber || item?.invoiceTypeId || item?.InvoiceTypeId);
    const invoiceId = isInvoiceItem ? (item?.id || item?.Id || 0) : 0;
    const bookingId = item?.bookingId || item?.BookingId || (!isInvoiceItem ? (item?.id || item?.Id || 0) : 0);
    const targetUserId = item ? (item.userId || item.UserId || item.customerId || item.CustomerId || item.user?.id || item.User?.Id || 0) : 0;
    const issueDateStr = item?.issuedOn || item?.IssuedOn || item?.createdDate || item?.CreatedDate || item?.createdOn;
    const dueDateStr = item?.dueOn || item?.DueOn || item?.dueDate || item?.DueDate;

    this.customInvoiceFormData = {
      bookingId: bookingId || 0,
      userId: targetUserId,
      issuedOn: issueDateStr ? localDateIso(new Date(issueDateStr)) : localDateIso(),
      dueOn: dueDateStr ? localDateIso(new Date(dueDateStr)) : localDateIso(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)),
      currencyCode: item?.currencyCode || item?.CurrencyCode || "PKR",
      notes: item?.notes || item?.Notes || (item ? `Invoice for ${item.spaceName || item.SpaceName || item.invoiceNumber || item.InvoiceNumber || ("Booking #" + (item.id || item.Id))}` : "")
    };

    this.customInvoiceLines = this.buildCustomInvoiceLinesFromItem(item, isNextInvoice, configuredMonths);

    const updateModalData = (dataObj: any) => {
      if (!dataObj) return;
      const rate = extractRateFromItem(dataObj, this.customInvoiceSelectedMonths);
      if (rate > 0) {
        this.customInvoiceMonthlyRate = rate;
      }
      const dbBillingMonths = dataObj.billingPeriodMonths || dataObj.BillingPeriodMonths || dataObj.advanceMonths || 0;
      if (dbBillingMonths > 0) {
        this.customInvoiceSelectedMonths = dbBillingMonths;
      }
      const mergedItem = { ...this.customInvoiceCurrentItem, ...dataObj };
      if (!mergedItem.spaceName && dataObj.SpaceName) mergedItem.spaceName = dataObj.SpaceName;
      this.customInvoiceCurrentItem = mergedItem;
      this.customInvoiceLines = this.buildCustomInvoiceLinesFromItem(
        mergedItem,
        isNextInvoice,
        this.customInvoiceSelectedMonths
      );
      this.cdr.markForCheck(); // runs from subscribe callbacks; these are plain fields (zoneless)
    };

    if (invoiceId > 0) {
      this.admin.getInvoiceDetails(invoiceId).subscribe({
        next: (invRes: any) => {
          const invData = invRes?.data || invRes;
          updateModalData(invData);
          const realBookingId = invData?.bookingId || invData?.BookingId || 0;
          if (realBookingId > 0) {
            this.customInvoiceFormData.bookingId = realBookingId;
            this.admin.getBookingBillingSummary(realBookingId).subscribe({
              next: (bRes: any) => updateModalData(bRes?.data || bRes),
              error: this.apiError('Failed to load booking billing summary.')
            });
          }
        },
        error: () => {
          if (bookingId > 0) {
            this.admin.getBookingBillingSummary(bookingId).subscribe({
              next: (bRes: any) => updateModalData(bRes?.data || bRes),
              error: this.apiError('Failed to load booking billing summary.')
            });
          }
        }
      });
    } else if (bookingId > 0) {
      this.admin.getBookingBillingSummary(bookingId).subscribe({
        next: (bRes: any) => updateModalData(bRes?.data || bRes),
        error: this.apiError('Failed to load booking billing summary.')
      });
    }

    this.admin.getUsers(1, 100).subscribe({
      next: (res: any) => {
        const users = res?.data || res || [];
        this.customInvoiceUsers.set(users);
        if (targetUserId) {
          const matched = users.find((u: any) => (u.id || u.Id) === targetUserId);
          if (matched) {
            this.customInvoiceFormData.userId = matched.id || matched.Id;
          } else if (users.length > 0 && !this.customInvoiceFormData.userId) {
            this.customInvoiceFormData.userId = users[0].id || users[0].Id;
          }
        } else if (users.length > 0 && !this.customInvoiceFormData.userId) {
          this.customInvoiceFormData.userId = users[0].id || users[0].Id;
        }
      },
      error: this.apiError('Failed to load users.')
    });
    this.showCreateCustomInvoiceModal.set(true);
  }

  closeCreateCustomInvoiceModal() {
    this.requestDiscardableClose(this.isCustomInvoiceFormDirty(), () => {
      this.showCreateCustomInvoiceModal.set(false);
      this.customInvoiceFormData = {
        bookingId: 0,
        userId: 0,
        issuedOn: localDateIso(),
        dueOn: localDateIso(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)),
        currencyCode: 'PKR',
        notes: ''
      };
      this.customInvoiceLines = [];
    });
  }

  closeQuickUploadModal() {
    this.showQuickUploadModal.set(false);
    this.quickUploadAgreementId = null;
  }

  onCustomInvoiceMonthsChange() {
    const selectedMonths = Number(this.customInvoiceSelectedMonths) || 1;
    if (this.customInvoiceCurrentItem) {
      this.customInvoiceLines = this.buildCustomInvoiceLinesFromItem(
        this.customInvoiceCurrentItem,
        this.customInvoiceIsNextInvoice,
        selectedMonths
      );
    } else {
      const rate = this.customInvoiceMonthlyRate || 0;
      if (this.customInvoiceLines && this.customInvoiceLines.length > 0) {
        const firstLine = this.customInvoiceLines[0];
        firstLine.quantity = 1;
        firstLine.unitPrice = rate * selectedMonths;
        firstLine.description = `Workspace Rent / Custom Fee (${selectedMonths} Month(s))`;
      }
    }
  }

  addCustomInvoiceLine() {
    this.customInvoiceLines.push({
      description: '',
      quantity: 1,
      unitPrice: 0,
      discountAmount: 0,
      taxRate: 0.016
    });
  }

  removeCustomInvoiceLine(index: number) {
    if (this.customInvoiceLines.length > 1) {
      this.customInvoiceLines.splice(index, 1);
    }
  }

  get customInvoiceSubtotal(): number {
    return this.customInvoiceLines.reduce((acc, l) => acc + ((l.quantity || 1) * (l.unitPrice || 0)), 0);
  }

  get customInvoiceTaxTotal(): number {
    return this.customInvoiceLines.reduce((acc, l) => {
      const net = ((l.quantity || 1) * (l.unitPrice || 0)) - (l.discountAmount || 0);
      return acc + (net * (l.taxRate || 0));
    }, 0);
  }

  get customInvoiceGrandTotal(): number {
    return this.customInvoiceSubtotal + this.customInvoiceTaxTotal;
  }

  submitCustomInvoice(sendEmail: boolean = false) {
    if (!this.customInvoiceFormData.userId || this.customInvoiceFormData.userId <= 0) {
      this.showError('Please select a customer.');
      return;
    }
    if (!this.customInvoiceLines || this.customInvoiceLines.length === 0) {
      this.showError('Please add at least one line item.');
      return;
    }

    this.submittingCustomInvoice.set(true);
    const payload = {
      bookingId: Number(this.customInvoiceFormData.bookingId || 0),
      userId: Number(this.customInvoiceFormData.userId),
      issuedOn: this.customInvoiceFormData.issuedOn,
      dueOn: this.customInvoiceFormData.dueOn,
      currencyCode: this.customInvoiceFormData.currencyCode,
      notes: this.customInvoiceFormData.notes,
      lines: this.customInvoiceLines,
      sendEmail: sendEmail
    };

    this.admin.createCustomInvoice(payload).subscribe({
      next: (res: any) => {
        this.submittingCustomInvoice.set(false);
        this.showCreateCustomInvoiceModal.set(false);
        if (payload.bookingId > 0) {
          this.sentInitialInvoices.add(payload.bookingId);
        }
        this.load();
        const msg = sendEmail ? 'Invoice created and sent successfully to customer via email!' : 'Invoice created successfully!';
        this.showSuccess(res?.message || msg);
      },
      error: (err: any) => {
        this.submittingCustomInvoice.set(false);
        this.showError(err?.error?.message || 'Failed to process invoice.');
      }
    });
  }

  sendingInvoiceEmailId = signal<number | null>(null);
  sendInvoiceEmail(invoice: any) {
    const id = invoice?.id || invoice?.Id;
    if (!id) return;
    this.sendingInvoiceEmailId.set(id);
    this.admin.sendInvoiceEmail(id).subscribe({
      next: (res: any) => {
        this.sendingInvoiceEmailId.set(null);
        this.showSuccess(res?.message || 'Invoice email sent successfully!');
      },
      error: (err: any) => {
        this.sendingInvoiceEmailId.set(null);
        this.showError(err?.error?.message || 'Failed to send invoice email.');
      }
    });
  }

  downloadStatementPdf(invoice: any) {
    const invoiceId = invoice?.id || invoice?.Id;
    if (!invoiceId) return;
    this.admin.getStatementInvoicePdfBlob(invoiceId).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Statement-Invoice-${invoice.invoiceNumber || invoice.InvoiceNumber || invoiceId}.pdf`;
        a.click();
        setTimeout(() => window.URL.revokeObjectURL(url), 2000);
      },
      error: (err) => console.error('Error downloading statement PDF:', err)
    });
  }

  openInvoiceDetails(invoice: any) {
    if (!invoice) return;
    const invId = invoice.id ?? invoice.Id ?? invoice.invoiceId ?? invoice.InvoiceId;
    if (!invId) {
      this.selectedInvoiceDetails.set(invoice);
      this.showInvoiceDetailsModal.set(true);
      return;
    }
    this.admin.getInvoiceDetails(invId).subscribe({
      next: (res: any) => {
        const data = res?.data ?? res;
        this.selectedInvoiceDetails.set({ ...invoice, ...data });
        this.showInvoiceDetailsModal.set(true);
      },
      error: () => {
        // Fallback display for client UI
        this.selectedInvoiceDetails.set(invoice);
        this.showInvoiceDetailsModal.set(true);
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
    this.showRecordPaymentModal.set(true);
  }

  submitRecordPayment() {
    if (!this.recordPaymentFormData.paidAmount || this.recordPaymentFormData.paidAmount <= 0) {
      this.showError('Please enter a valid payment amount.');
      return;
    }
    this.recordPaymentSaving.set(true);
    this.admin.recordInvoicePayment(this.recordPaymentFormData.invoiceId, this.recordPaymentFormData).subscribe({
      next: () => {
        this.recordPaymentSaving.set(false);
        this.showRecordPaymentModal.set(false);
        this.showInvoiceDetailsModal.set(false);
        this.success.set('Payment recorded successfully! Associated periods marked as Prepaid.');
        this.showSuccess(this.success());
        setTimeout(() => this.success.set(''), 4000);
        this.load();
      },
      error: (err: any) => {
        this.recordPaymentSaving.set(false);
        this.showError(err?.error?.message || err?.message || 'Failed to record payment.');
      }
    });
  }

  // Missing Template Helpers and Methods

  getSpaceDisplayPrice(item: any): { price: number; unit: string; display: string } {
    if (!item) return { price: 0, unit: 'Month', display: '-' };

    const name = String(item.name || item.Name || '').toLowerCase().trim();
    const spaceType = String(item.spaceTypeName || item.spaceCategory || item.spaceType || '').toLowerCase();
    const pMonth = Number(item.pricePerMonth ?? item.PricePerMonth ?? 0);
    const pDay = Number(item.pricePerDay ?? item.PricePerDay ?? item.seatPrice ?? item.SeatPrice ?? 0);
    const pHour = Number(item.pricePerHour ?? item.PricePerHour ?? 0);
    const cap = Number(item.capacity ?? item.Capacity ?? item.spaceCapacity ?? item.SpaceCapacity ?? 1);
    const capacityVal = cap > 0 ? cap : 1;

    // Explicit rule for Shared Spaces
    const isShared = this.isSharedSpace(item) ||
      name.includes('shared') || name.includes('coworking') || name.includes('desk') ||
      spaceType.includes('shared') || spaceType.includes('coworking') || spaceType.includes('desk');

    if (isShared && !name.includes('meeting') && !spaceType.includes('meeting')) {
      const price = Number(pMonth || item?.seatPrice || item?.SeatPrice || item?.pricePerSeat || item?.PricePerSeat || (pDay > 0 ? pDay : (item?.price ? Number(item.price) : 30000)));
      return { price, unit: 'Month', display: price > 0 ? `PKR ${price.toLocaleString('en-US')} / Month` : '-' };
    }

    // Explicit rule for Private Rooms / Private Offices / Offices / Room spaces
    const isPrivate = this.isPrivateRoom(item) ||
      name.includes('private') || name.includes('office') || name.includes('room') ||
      spaceType.includes('private') || spaceType.includes('office') || spaceType.includes('room');

    if (isPrivate && !name.includes('meeting') && !spaceType.includes('meeting')) {
      const perSeatPrice = Number(item.seatPrice ?? item.SeatPrice ?? item.pricePerSeat ?? item.PricePerSeat ?? (pDay > 0 ? pDay : (pMonth > 0 ? pMonth : (item?.price ? Number(item.price) : 35000))));
      const price = perSeatPrice * capacityVal;
      return { price, unit: 'Month', display: price > 0 ? `PKR ${price.toLocaleString('en-US')} / Month` : '-' };
    }

    // Explicit rules for Meeting Room 1 (Hourly) and Meeting Room 2 (Daily)
    if (name.includes('meeting room 1')) {
      const price = Number(pHour || item?.price || pDay || 0);
      return { price, unit: 'Hour', display: price > 0 ? `PKR ${price.toLocaleString('en-US')} / Hour` : '-' };
    }

    if (name.includes('meeting room 2')) {
      const price = Number(pDay || item?.price || 0);
      return { price, unit: 'Day', display: price > 0 ? `PKR ${price.toLocaleString('en-US')} / Day` : '-' };
    }

    // Check explicitly configured rate units on space item
    if (pHour > 0 && pMonth === 0 && pDay === 0) {
      return { price: pHour, unit: 'Hour', display: `PKR ${pHour.toLocaleString('en-US')} / Hour` };
    }
    if (pDay > 0 && pMonth === 0 && pHour === 0) {
      return { price: pDay, unit: 'Day', display: `PKR ${pDay.toLocaleString('en-US')} / Day` };
    }
    if (pMonth > 0 && pDay === 0 && pHour === 0) {
      return { price: pMonth, unit: 'Month', display: `PKR ${pMonth.toLocaleString('en-US')} / Month` };
    }

    if (spaceType.includes('meeting') || spaceType.includes('conference')) {
      const price = Number(pHour || item?.price || pDay || 0);
      const u = (pDay > 0 && pHour === 0) ? 'Day' : 'Hour';
      return { price, unit: u, display: price > 0 ? `PKR ${price.toLocaleString('en-US')} / ${u}` : '-' };
    } else if (spaceType.includes('private') || spaceType.includes('office') || spaceType.includes('shared') || spaceType.includes('desk') || spaceType.includes('coworking')) {
      const perSeatPrice = Number(item.seatPrice ?? item.SeatPrice ?? item.pricePerSeat ?? item.PricePerSeat ?? (pMonth || pDay || item?.price || 0));
      const price = perSeatPrice * capacityVal;
      return { price, unit: 'Month', display: price > 0 ? `PKR ${price.toLocaleString('en-US')} / Month` : '-' };
    } else {
      const price = Number(pMonth || pDay || pHour || item?.price || 0);
      const unit = pMonth > 0 ? 'Month' : (pDay > 0 ? 'Day' : (pHour > 0 ? 'Hour' : 'Month'));
      return { price, unit, display: price > 0 ? `PKR ${price.toLocaleString('en-US')} / ${unit}` : '-' };
    }
  }

  onPriceValueOrUnitChange() {
    this.priceError.set('');
    const val = this.formData['priceValue'] !== null && this.formData['priceValue'] !== undefined && this.formData['priceValue'] !== ''
      ? Number(this.formData['priceValue'])
      : null;
    const unit = (this.formData['priceUnit'] || 'month').toString().trim().toLowerCase();
    const unitLabel = unit === 'month' ? 'Per Month' : (unit === 'day' ? 'Per Day' : 'Per Hour');

    this.formData['price'] = val;
    this.formData['priceType'] = unitLabel;

    if (unit === 'hour') {
      this.formData['pricePerHour'] = val;
      this.formData['pricePerDay'] = null;
      this.formData['pricePerMonth'] = null;
    } else if (unit === 'day') {
      this.formData['pricePerDay'] = val;
      this.formData['pricePerHour'] = null;
      this.formData['pricePerMonth'] = null;
    } else {
      this.formData['pricePerMonth'] = val;
      this.formData['pricePerHour'] = null;
      this.formData['pricePerDay'] = null;
    }
  }

  override_save_spaces(d: any): boolean {
    this.priceError.set('');
    const val = d.priceValue !== null && d.priceValue !== undefined && d.priceValue !== '' ? Number(d.priceValue) : null;
    const unit = (d.priceUnit || 'month').toString().trim().toLowerCase();

    if (val === null || isNaN(val)) {
      this.error.set('Price is required.');
      this.priceError.set('Price is required.');
      this.saving.set(false);
      return false;
    }
    if (val <= 0) {
      this.error.set('Price must be greater than 0.');
      this.priceError.set('Price must be greater than 0.');
      this.saving.set(false);
      return false;
    }
    if (!['month', 'day', 'hour'].includes(unit)) {
      this.error.set('Price Type is required and must be Per Month, Per Day, or Per Hour.');
      this.saving.set(false);
      return false;
    }

    this.onPriceValueOrUnitChange();
    if (d.locationId) d.locationId = Number(d.locationId);
    if (d.spaceTypeId) d.spaceTypeId = Number(d.spaceTypeId);
    if (d.floorId) d.floorId = Number(d.floorId);
    if (d.capacity) d.capacity = Number(d.capacity);

    return true;
  }



  getChallanContractMonths(c: any): number {
    if (!c) return 1;
    if (c.contractPeriodMonths != null && Number(c.contractPeriodMonths) > 0) return Number(c.contractPeriodMonths);
    if (c.ContractPeriodMonths != null && Number(c.ContractPeriodMonths) > 0) return Number(c.ContractPeriodMonths);
    if (c.contract?.numberOfMonths != null && Number(c.contract.numberOfMonths) > 0) return Number(c.contract.numberOfMonths);
    if (c.Contract?.NumberOfMonths != null && Number(c.Contract.NumberOfMonths) > 0) return Number(c.Contract.NumberOfMonths);
    if (c.numberOfMonths != null && Number(c.numberOfMonths) > 0) return Number(c.numberOfMonths);
    if (c.NumberOfMonths != null && Number(c.NumberOfMonths) > 0) return Number(c.NumberOfMonths);
    if (c.durationMonths != null && Number(c.durationMonths) > 0) return Number(c.durationMonths);
    if (c.DurationMonths != null && Number(c.DurationMonths) > 0) return Number(c.DurationMonths);
    if (c.months != null && Number(c.months) > 0) return Number(c.months);
    if (c.Months != null && Number(c.Months) > 0) return Number(c.Months);

    const start = c.startDateTime || c.StartDateTime || c.startOn || c.StartOn || c.contractStartDate || c.ContractStartDate || c.contract?.contractStartDate;
    const end = c.endDateTime || c.EndDateTime || c.endOn || c.EndOn || c.contractEndDate || c.ContractEndDate || c.contract?.contractEndDate;
    if (start && end) {
      const s = new Date(start);
      const e = new Date(end);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        const diffMonths = ((e.getFullYear() - s.getFullYear()) * 12) + (e.getMonth() - s.getMonth());
        if (diffMonths > 0) return diffMonths;
        const diffDays = Math.ceil((e.getTime() - s.getTime()) / 86400000);
        const calculated = Math.max(1, Math.round(diffDays / 30));
        if (calculated > 0) return calculated;
      }
    }

    const details = c.details || c.Details || c.items || c.Items || c.lineItems || c.LineItems || [];
    const rentLine = Array.isArray(details) ? details.find((d: any) => {
      const ft = String(d.feeType || d.FeeType || '').toLowerCase();
      return ft === 'roomrent' || ft === 'rent';
    }) : null;
    if (rentLine && Number(rentLine.quantity || rentLine.Quantity) > 0) {
      return Number(rentLine.quantity || rentLine.Quantity);
    }

    return Number(c.billingPeriodMonths ?? c.BillingPeriodMonths ?? 1);
  }

  getChallanBillingMonths(c: any): number {
    if (!c) return 3;
    return Number(c.billingPeriodMonths ?? c.BillingPeriodMonths ?? 3);
  }

  getChallanSecurityMonths(c: any): number {
    if (!c) return 0;
    const details = c.details || c.Details || c.items || c.Items || c.lineItems || c.LineItems || [];
    const secLine = Array.isArray(details) ? details.find((d: any) => {
      const ft = String(d.feeType || d.FeeType || '').toLowerCase();
      const desc = String(d.description || d.Description || '').toLowerCase();
      return ft === 'securitydeposit' || desc.includes('security deposit');
    }) : null;
    if (secLine && Number(secLine.quantity || secLine.Quantity) !== undefined && !isNaN(Number(secLine.quantity || secLine.Quantity))) {
      return Number(secLine.quantity || secLine.Quantity);
    }
    if (secLine && (secLine.description || secLine.Description)) {
      const match = String(secLine.description || secLine.Description).match(/(\d+)\s*Month/i);
      if (match && match[1]) return Number(match[1]);
    }
    const secM = c.securityDepositMonths ?? c.SecurityDepositMonths ?? c.securityDepositMonthsOverride ?? c.SecurityDepositMonthsOverride;
    if (secM !== undefined && secM !== null) {
      return Number(secM);
    }
    return this.isPrivateRoom(c) ? 2 : 0;
  }

  getChallanMonthlyRent(c: any): number {
    if (!c || this.isMeetingRoom(c)) return 0;
    const dbMonthly = c.monthlyRent ?? c.MonthlyRent ?? c.roomPrice ?? c.RoomPrice;
    if (dbMonthly !== undefined && dbMonthly !== null && Number(dbMonthly) > 0) {
      return Number(dbMonthly);
    }
    const months = this.getChallanContractMonths(c);
    const dbSubtotal = c.subtotalAmount ?? c.SubtotalAmount ?? c.totalContractAmount ?? c.TotalContractAmount;
    if (dbSubtotal !== undefined && dbSubtotal !== null && Number(dbSubtotal) > 0 && months > 0) {
      return Number(dbSubtotal) / months;
    }
    const seatPrice = Number(c.seatPrice ?? c.SeatPrice ?? 0);
    let capacity = Number(c.capacity ?? c.Capacity ?? c.spaceCapacity ?? c.SpaceCapacity ?? 0);
    if (!capacity && c.spaceName) {
      const match = String(c.spaceName).match(/\((\d+)\)/);
      if (match && match[1]) capacity = Number(match[1]);
    }
    const typeName = String(c.spaceTypeName || c.SpaceTypeName || '').toLowerCase();
    const isPrivate = typeName.includes('private') || typeName.includes('office') || typeName.includes('room');

    if (isPrivate && capacity > 0 && seatPrice > 0) {
      return seatPrice * capacity;
    }
    if (seatPrice > 0) return seatPrice;
    return 0;
  }

  getChallanTotalContract(c: any): number {
    if (!c) return 0;
    if (this.isMeetingRoom(c)) {
      return Number(c.subtotalAmount ?? c.SubtotalAmount ?? c.totalAmount ?? c.TotalAmount ?? 0);
    }
    const dbTotal = c.totalContractAmount ?? c.TotalContractAmount ?? c.subtotalAmount ?? c.SubtotalAmount;
    if (dbTotal !== undefined && dbTotal !== null && Number(dbTotal) > 0 && Number(dbTotal) !== Number(c.totalAmount) && Number(dbTotal) !== Number(c.totalPayable)) {
      return Number(dbTotal);
    }
    const months = this.getChallanContractMonths(c);
    const monthlyRent = this.getChallanMonthlyRent(c);
    return monthlyRent * months;
  }

  getChallanFirstCycleRent(c: any): number {
    if (!c) return 0;
    if (this.isMeetingRoom(c)) {
      return Number(c.subtotalAmount ?? c.SubtotalAmount ?? c.totalAmount ?? c.TotalAmount ?? 0);
    }
    const dbCycle = c.currentCycleAmount ?? c.CurrentCycleAmount ?? c.firstCycleRent ?? c.FirstCycleRent;
    if (dbCycle !== undefined && dbCycle !== null && Number(dbCycle) > 0 && Number(dbCycle) < Number(this.getChallanTotalContract(c))) {
      return Number(dbCycle);
    }
    const bpm = this.getChallanBillingMonths(c);
    const monthlyRent = this.getChallanMonthlyRent(c);
    return monthlyRent * bpm;
  }

  getChallanSecurityDeposit(c: any): number {
    if (!c || !this.isPrivateRoom(c)) return 0;
    const secOverride = c.securityDepositOverride ?? c.SecurityDepositOverride;
    if (secOverride !== undefined && secOverride !== null) {
      return Number(secOverride);
    }
    const dbDeposit = c.securityDeposit ?? c.SecurityDeposit;
    if (dbDeposit !== undefined && dbDeposit !== null) {
      return Number(dbDeposit);
    }
    const secMonths = this.getChallanSecurityMonths(c);
    if (secMonths === 0) return 0;
    const monthlyRent = this.getChallanMonthlyRent(c);
    const baseDeposit = monthlyRent * secMonths;
    const discAmount = Number(c.discountAmount ?? c.DiscountAmount ?? 0);
    const subtotal = Number(c.subtotalAmount ?? c.SubtotalAmount ?? 0);
    const discPct = Number(c.discountPercentage ?? c.DiscountPercentage ?? (subtotal > 0 && discAmount > 0 ? (discAmount / subtotal) * 100 : 0));
    if (discPct > 0) {
      return Math.max(0, parseFloat((baseDeposit * (1 - discPct / 100)).toFixed(2)));
    }
    return baseDeposit;
  }

  getChallanSupportCharges(c: any): number {
    if (!c || this.isMeetingRoom(c)) return 0;
    const rate = Number(c.perSeatSupportRate ?? c.PerSeatSupportRate ?? 2000);
    let cap = Number(c.capacity ?? c.Capacity ?? c.spaceCapacity ?? c.SpaceCapacity ?? 0);
    if (!cap && c.spaceName) {
      const match = String(c.spaceName).match(/\((\d+)\)/);
      if (match && match[1]) cap = Number(match[1]);
    }
    const capacity = cap > 0 ? cap : 1;
    const billingM = this.getChallanBillingMonths(c);
    const billingMonths = billingM > 0 ? billingM : 3;
    return rate * capacity * billingMonths;
  }

  getChallanTaxAmount(c: any): number {
    if (!c) return 0;
    if (this.isMeetingRoom(c)) {
      const cycleRent = this.getChallanFirstCycleRent(c);
      return Math.round(cycleRent * 0.16 * 100) / 100;
    }
    const supportServices = this.getChallanSupportCharges(c);
    const taxRate = Number(c.appliedTaxPercentage ?? c.AppliedTaxPercentage ?? 16);
    return Math.round(supportServices * (taxRate / 100) * 100) / 100;
  }

  getChallanContractTaxAmount(c: any): number {
    if (!c || this.isMeetingRoom(c)) return 0;
    const rate = Number(c.perSeatSupportRate ?? c.PerSeatSupportRate ?? 2000);
    let cap = Number(c.capacity ?? c.Capacity ?? c.spaceCapacity ?? c.SpaceCapacity ?? 0);
    if (!cap && c.spaceName) {
      const match = String(c.spaceName).match(/\((\d+)\)/);
      if (match && match[1]) cap = Number(match[1]);
    }
    const capacity = cap > 0 ? cap : 1;
    const contractMonths = this.getChallanContractMonths(c);
    const totalMonths = contractMonths > 0 ? contractMonths : 12;
    const taxRate = Number(c.appliedTaxPercentage ?? c.AppliedTaxPercentage ?? 16);
    const totalSupport = rate * capacity * totalMonths;
    return Math.round(totalSupport * (taxRate / 100) * 100) / 100;
  }

  getChallanFirstCycleDiscount(c: any): number {
    if (!c) return 0;
    const cycleRent = this.getChallanFirstCycleRent(c);
    const discPct = Number(c.discountPercentage ?? c.DiscountPercentage ?? 0);
    if (discPct > 0) {
      return Math.round(cycleRent * (discPct / 100) * 100) / 100;
    }
    const totalDisc = Number(c.discountAmount ?? c.DiscountAmount ?? 0);
    if (totalDisc > 0) {
      return Math.min(cycleRent, totalDisc);
    }
    const discVal = Number(c.discountValue ?? c.DiscountValue ?? 0);
    if (discVal > 0) {
      return Math.min(cycleRent, discVal);
    }
    return 0;
  }


  getChallanInitialPayable(c: any): number {
    if (!c) return 0;
    const cycleRent = this.getChallanFirstCycleRent(c);
    const deposit = this.getChallanSecurityDeposit(c);
    const tax = this.getChallanTaxAmount(c);
    const discount = this.getChallanFirstCycleDiscount(c);
    return Math.max(0, cycleRent + deposit + tax - discount);
  }

  getQuotationContractMonths(q: any): number {
    if (!q) return 1;
    if (q.contractPeriodMonths != null && Number(q.contractPeriodMonths) > 0) return Number(q.contractPeriodMonths);
    if (q.ContractPeriodMonths != null && Number(q.ContractPeriodMonths) > 0) return Number(q.ContractPeriodMonths);
    if (q.contract?.numberOfMonths != null && Number(q.contract.numberOfMonths) > 0) return Number(q.contract.numberOfMonths);
    if (q.Contract?.NumberOfMonths != null && Number(q.Contract.NumberOfMonths) > 0) return Number(q.Contract.NumberOfMonths);
    if (q.numberOfMonths != null && Number(q.numberOfMonths) > 0) return Number(q.numberOfMonths);
    if (q.NumberOfMonths != null && Number(q.NumberOfMonths) > 0) return Number(q.NumberOfMonths);
    if (q.durationMonths != null && Number(q.durationMonths) > 0) return Number(q.durationMonths);
    if (q.DurationMonths != null && Number(q.DurationMonths) > 0) return Number(q.DurationMonths);
    if (q.months != null && Number(q.months) > 0) return Number(q.months);
    if (q.Months != null && Number(q.Months) > 0) return Number(q.Months);

    const start = q.startDateTime || q.StartDateTime || q.startOn || q.StartOn || q.contractStartDate || q.ContractStartDate || q.contract?.contractStartDate;
    const end = q.endDateTime || q.EndDateTime || q.endOn || q.EndOn || q.contractEndDate || q.ContractEndDate || q.contract?.contractEndDate;
    if (start && end) {
      const s = new Date(start);
      const e = new Date(end);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        const diffMonths = ((e.getFullYear() - s.getFullYear()) * 12) + (e.getMonth() - s.getMonth());
        if (diffMonths > 0) return diffMonths;
        const diffDays = Math.ceil((e.getTime() - s.getTime()) / 86400000);
        const calculated = Math.max(1, Math.round(diffDays / 30));
        if (calculated > 0) return calculated;
      }
    }

    const details = q.details || q.Details || [];
    const rentLine = Array.isArray(details) ? details.find((d: any) => {
      const ft = String(d.feeType || d.FeeType || '').toLowerCase();
      return ft === 'roomrent' || ft === 'rent';
    }) : null;
    if (rentLine && Number(rentLine.quantity || rentLine.Quantity) > 0) {
      return Number(rentLine.quantity || rentLine.Quantity);
    }

    return Number(q.billingPeriodMonths ?? q.BillingPeriodMonths ?? 1);
  }

  getQuotationBillingMonths(q: any): number {
    if (!q) return 3;
    return Number(q.billingPeriodMonths ?? q.BillingPeriodMonths ?? 3);
  }

  getQuotationSecurityMonths(q: any): number {
    if (!q) return 0;
    const details = q.details || q.Details || [];
    const secLine = Array.isArray(details) ? details.find((d: any) => {
      const ft = String(d.feeType || d.FeeType || '').toLowerCase();
      const desc = String(d.description || d.Description || '').toLowerCase();
      return ft === 'securitydeposit' || desc.includes('security deposit');
    }) : null;
    if (secLine && Number(secLine.quantity || secLine.Quantity) !== undefined && !isNaN(Number(secLine.quantity || secLine.Quantity))) {
      return Number(secLine.quantity || secLine.Quantity);
    }
    if (secLine && (secLine.description || secLine.Description)) {
      const match = String(secLine.description || secLine.Description).match(/(\d+)\s*Month/i);
      if (match && match[1]) return Number(match[1]);
    }
    const secM = q.securityDepositMonths ?? q.SecurityDepositMonths ?? q.securityDepositMonthsOverride ?? q.SecurityDepositMonthsOverride;
    if (secM !== undefined && secM !== null) {
      return Number(secM);
    }
    return this.isPrivateRoom(q) ? 2 : 0;
  }

  getQuotationMonthlyRent(q: any): number {
    if (!q || this.isMeetingRoom(q)) return 0;
    const dbMonthly = q.monthlyRent ?? q.MonthlyRent ?? q.roomPrice ?? q.RoomPrice;
    if (dbMonthly !== undefined && dbMonthly !== null && Number(dbMonthly) > 0) {
      return Number(dbMonthly);
    }
    const months = this.getQuotationContractMonths(q);
    const dbSubtotal = q.subtotalAmount ?? q.SubtotalAmount ?? q.totalContractAmount ?? q.TotalContractAmount;
    if (dbSubtotal !== undefined && dbSubtotal !== null && Number(dbSubtotal) > 0 && months > 0) {
      return Number(dbSubtotal) / months;
    }
    const seatPrice = Number(q.seatPrice ?? q.SeatPrice ?? 0);
    let capacity = Number(q.capacity ?? q.Capacity ?? q.spaceCapacity ?? q.SpaceCapacity ?? 0);
    if (!capacity && q.spaceName) {
      const match = String(q.spaceName).match(/\((\d+)\)/);
      if (match && match[1]) capacity = Number(match[1]);
    }
    const typeName = String(q.spaceTypeName || q.SpaceTypeName || '').toLowerCase();
    const isPrivate = typeName.includes('private') || typeName.includes('office') || typeName.includes('room');

    if (isPrivate && capacity > 0 && seatPrice > 0) {
      return seatPrice * capacity;
    }
    if (seatPrice > 0) return seatPrice;
    return 0;
  }

  getQuotationTotalContract(q: any): number {
    if (!q) return 0;
    if (this.isMeetingRoom(q)) {
      return Number(q.subtotalAmount ?? q.SubtotalAmount ?? q.totalAmount ?? q.TotalAmount ?? 0);
    }
    const months = this.getQuotationContractMonths(q);
    const monthlyRent = this.getQuotationMonthlyRent(q);
    return monthlyRent * months;
  }

  getQuotationFirstCycleRent(q: any): number {
    if (!q) return 0;
    if (this.isMeetingRoom(q)) {
      return Number(q.subtotalAmount ?? q.SubtotalAmount ?? q.totalAmount ?? q.TotalAmount ?? 0);
    }
    const bpm = this.getQuotationBillingMonths(q);
    const monthlyRent = this.getQuotationMonthlyRent(q);
    return monthlyRent * bpm;
  }

  getQuotationSecurityDeposit(q: any): number {
    if (!q || !this.isPrivateRoom(q)) return 0;
    const secOverride = q.securityDepositOverride ?? q.SecurityDepositOverride;
    if (secOverride !== undefined && secOverride !== null) {
      return Number(secOverride);
    }
    const dbDeposit = q.securityDeposit ?? q.SecurityDeposit;
    if (dbDeposit !== undefined && dbDeposit !== null) {
      return Number(dbDeposit);
    }
    const secMonths = this.getQuotationSecurityMonths(q);
    if (secMonths === 0) return 0;
    const monthlyRent = this.getQuotationMonthlyRent(q);
    const baseDeposit = monthlyRent * secMonths;
    const discType = q.discountType ?? q.DiscountType;
    const discVal = Number(q.discountValue ?? q.DiscountValue ?? 0);
    if ((discType === 'Amount' || discType === 'Fixed') && discVal > 0 && monthlyRent > 0) {
      const pct = Math.min(100, Math.max(0, (discVal / monthlyRent) * 100));
      return Math.max(0, parseFloat((baseDeposit * (1 - pct / 100)).toFixed(2)));
    }
    const discPct = this.getQuotationDiscountPercentage(q);
    if (discPct > 0) {
      return Math.max(0, parseFloat((baseDeposit * (1 - discPct / 100)).toFixed(2)));
    }
    return baseDeposit;
  }

  getQuotationSupportCharges(q: any): number {
    if (!q || this.isMeetingRoom(q)) return 0;
    let capacity = Number(q.capacity ?? q.Capacity ?? q.spaceCapacity ?? q.SpaceCapacity ?? 0);
    if (!capacity && q.spaceName) {
      const match = String(q.spaceName).match(/\((\d+)\)/);
      if (match && match[1]) capacity = Number(match[1]);
    }
    if (!capacity || capacity <= 0) capacity = 1;
    const bpm = this.getQuotationBillingMonths(q);
    const perSeatSupportRate = Number(q.perSeatSupportRate ?? q.PerSeatSupportRate ?? 2000);
    return perSeatSupportRate * capacity * bpm;
  }

  getQuotationTaxAmount(q: any): number {
    if (!q) return 0;
    if (this.isMeetingRoom(q)) {
      const base = Number(q.subtotalAmount ?? q.SubtotalAmount ?? q.totalAmount ?? q.TotalAmount ?? 0);
      return Math.round(base * 0.16 * 100) / 100;
    }
    const supportServices = this.getQuotationSupportCharges(q);
    const taxPct = Number(q.appliedTaxPercentage ?? q.AppliedTaxPercentage ?? 16);
    return Math.round(supportServices * (taxPct / 100) * 100) / 100;
  }

  getQuotationContractTaxAmount(q: any): number {
    if (!q || this.isMeetingRoom(q)) return 0;
    let capacity = Number(q.capacity ?? q.Capacity ?? q.spaceCapacity ?? q.SpaceCapacity ?? 0);
    if (!capacity && q.spaceName) {
      const match = String(q.spaceName).match(/\((\d+)\)/);
      if (match && match[1]) capacity = Number(match[1]);
    }
    if (!capacity || capacity <= 0) capacity = 1;
    const contractMonths = this.getQuotationContractMonths(q);
    const perSeatSupportRate = Number(q.perSeatSupportRate ?? q.PerSeatSupportRate ?? 2000);
    const totalSupport = perSeatSupportRate * capacity * contractMonths;
    const taxPct = Number(q.appliedTaxPercentage ?? q.AppliedTaxPercentage ?? 16);
    return Math.round(totalSupport * (taxPct / 100) * 100) / 100;
  }

  getQuotationDiscountAmount(q: any): number {
    if (!q) return 0;
    const discType = q.discountType ?? q.DiscountType;
    const discVal = Number(q.discountValue ?? q.DiscountValue ?? 0);
    const bpm = this.getQuotationBillingMonths(q);
    if ((discType === 'Amount' || discType === 'Fixed') && discVal > 0) {
      if (this.isMeetingRoom(q)) return discVal;
      return discVal * bpm;
    }
    const pct = q.discountPercentage ?? q.DiscountPercentage;
    if (pct != null && Number(pct) > 0) {
      const cycleRent = this.getQuotationFirstCycleRent(q);
      return Math.round(cycleRent * (Number(pct) / 100) * 100) / 100;
    }
    return Number(q.discountAmount ?? q.DiscountAmount ?? 0);
  }

  getQuotationDiscountPercentage(q: any): number {
    if (!q) return 0;
    const pct = q.discountPercentage ?? q.DiscountPercentage;
    if (pct != null && Number(pct) > 0) return Number(pct);
    const discType = q.discountType ?? q.DiscountType;
    const discVal = Number(q.discountValue ?? q.DiscountValue ?? 0);
    const monthlyRent = this.getQuotationMonthlyRent(q);
    if ((discType === 'Amount' || discType === 'Fixed') && discVal > 0 && monthlyRent > 0) {
      return parseFloat(((discVal / monthlyRent) * 100).toFixed(2));
    }
    const disc = this.getQuotationDiscountAmount(q);
    const cycleRent = this.getQuotationFirstCycleRent(q);
    if (disc > 0 && cycleRent > 0) {
      return parseFloat(((disc / cycleRent) * 100).toFixed(2));
    }
    return 0;
  }

  getQuotationInitialPayable(q: any): number {
    if (!q) return 0;
    const cycleRent = this.getQuotationFirstCycleRent(q);
    const deposit = this.getQuotationSecurityDeposit(q);
    const tax = this.getQuotationTaxAmount(q);
    const discount = this.getQuotationDiscountAmount(q);
    return Math.max(0, parseFloat(((cycleRent - discount) + deposit + tax).toFixed(2)));
  }

  getQuotationNetTotal(q: any): number {
    return this.getQuotationInitialPayable(q);
  }

  readonly showConversionPreviewModal = signal(false);
  selectedConversionQuotation = signal<any>(null);
  conversionSubmitting = signal(false);

  openConversionPreviewModal(q: any) {
    this.selectedConversionQuotation.set(q);
    this.showConversionPreviewModal.set(true);
  }

  closeConversionPreviewModal() {
    this.showConversionPreviewModal.set(false);
    this.selectedConversionQuotation.set(null);
  }

  executeConversion(q: any) {
    if (!q || (!q.id && !q.Id)) return;
    const qId = q.id || q.Id;
    this.conversionSubmitting.set(true);
    this.quotationSvc.convertToBooking(qId).subscribe({
      next: (res: any) => {
        this.conversionSubmitting.set(false);
        this.closeConversionPreviewModal();
        this.success.set('Quotation successfully converted to booking!');
        setTimeout(() => this.success.set(''), 4000);

        const bookingData = res?.data ?? res ?? {};
        const bId = bookingData.bookingId || bookingData.BookingId || bookingData.id || bookingData.Id;
        const bookingItem = {
          id: bId,
          bookingId: bId,
          customerEmail: q.customerEmail || q.userEmail || bookingData.customerEmail,
          customerName: q.customerName || q.userName || bookingData.customerName,
          spaceName: q.spaceName || q.spaceCode || bookingData.spaceName || 'Workspace',
          totalAmount: q.totalAmount || q.totalContractAmount || bookingData.totalAmount || 0,
          ...bookingData
        };

        // Navigate cleanly to Bookings page and reload bookings list
        this.router.navigate(['/admin/bookings']).then(() => {
          this.entity = 'bookings';
          this.config.set(this.buildConfig('bookings'));
          this.page.set(1);
          this.searchQuery = '';
          this.load(() => {
            if (bId) {
              setTimeout(() => {
                this.sendInitialInvoice(bookingItem);
              }, 400);
            }
          });
        });
      },
      error: (err: any) => {
        this.conversionSubmitting.set(false);
        this.showError(err?.error?.message || err?.message || 'Failed to convert quotation.');
      }
    });
  }

  getSpaceType(item: any): string {
    if (!item) return 'MeetingRoom';
    if (item.spaceType) return item.spaceType;
    const name = String(item.name || item.Name || item.title || item.Title || item.spaceTypeName || item.SpaceTypeName || item.spaceCategory || item.SpaceCategory || '').toLowerCase();
    if (name.includes('meeting') || name.includes('conference')) return 'MeetingRoom';
    if (name.includes('shared') || name.includes('coworking') || name.includes('desk')) return 'SharedSpace';
    if (name.includes('private') || name.includes('office') || name.includes('room')) return 'PrivateRoom';
    if ((item.billingPeriodMonths <= 0 || !item.billingPeriodMonths) && (!item.totalContractAmount || item.totalContractAmount <= 0)) return 'MeetingRoom';
    return 'SharedSpace';
  }

  isMeetingRoom(item: any): boolean {
    return this.getSpaceType(item) === 'MeetingRoom';
  }

  isSharedSpace(item: any): boolean {
    return this.getSpaceType(item) === 'SharedSpace';
  }

  isPrivateRoom(item: any): boolean {
    return this.getSpaceType(item) === 'PrivateRoom';
  }

  readonly showSendAgreementModal = signal(false);
  sendAgreementTab: 'Individual' | 'Company' = 'Individual';
  readonly sendAgreementError = signal('');
  sendAgreementSaving = signal(false);
  sendAgreementData: any = {
    customerFullName: '',
    customerCnic: '',
    customerPhone: '',
    customerAddress: '',
    companyName: '',
    companyNtn: '',
    companySecpRegNo: '',
    contractStartDate: '',
    contractEndDate: '',
    billingPeriod: 'Monthly',
    operatingHours: '24/7',
    monthlyFee: 0,
    securityDeposit: 0,
    refundDays: 30
  };
  selectedAgreementItem: any = null;

  openSendAgreement(item?: any) {
    this.selectedAgreementItem = item || null;
    this.sendAgreementError.set('');
    this.loadOfferingTypes();

    const compName = item?.companyName || item?.company || item?.organizationName || item?.CompanyName || item?.OrganizationName || '';
    this.sendAgreementTab = compName ? 'Company' : 'Individual';

    const now = new Date();
    const startStr = this.today;
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);
    const endStr = localDateIso(end);

    const rawCustName = item?.customerFullName || item?.customerName || item?.CustomerName || item?.fullName || item?.FullName || item?.userName || item?.UserName || item?.name || item?.Name || '';
    const customerName = this.sanitizeCustomerFullName(rawCustName);
    const customerEmail = item?.customerEmail || item?.CustomerEmail || item?.userEmail || item?.UserEmail || item?.email || item?.Email || item?.overrideEmail || '';
    const customerPhone = item?.customerPhone || item?.CustomerPhone || item?.phoneNumber || item?.PhoneNumber || item?.phone || item?.Phone || item?.contactNo || '';
    const customerAddress = item?.customerAddress || item?.CustomerAddress || item?.addressLine1 || item?.AddressLine1 || item?.address || item?.Address || '';
    const customerCnic = item?.customerCnic || item?.CustomerCnic || item?.cnicOrPassport || item?.CnicOrPassport || item?.cnic || item?.Cnic || item?.cnicPassport || item?.CnicPassport || item?.nic || item?.Nic || item?.sntnNtnNic || '';
    const companyNtn = item?.companyNtn || item?.CompanyNtn || item?.ntn || item?.Ntn || item?.ntnNo || '';
    const companySecp = item?.companySecpRegNo || item?.CompanySecpRegNo || item?.secpRegNo || item?.SecpRegNo || item?.secpRegistrationNo || item?.SecpRegistrationNo || '';

    let startVal = startStr;
    let endVal = endStr;
    const rawStart = item?.startDate || item?.startDateTime || item?.contractStartDate || item?.StartDate || item?.StartDateTime || item?.ContractStartDate;
    if (rawStart) {
      const d = new Date(rawStart);
      if (!isNaN(d.getTime())) startVal = localDateIso(d);
    }
    const rawEnd = item?.endDate || item?.endDateTime || item?.contractEndDate || item?.EndDate || item?.EndDateTime || item?.ContractEndDate;
    if (rawEnd) {
      const d = new Date(rawEnd);
      if (!isNaN(d.getTime())) endVal = localDateIso(d);
    }

    const bpm = Number(item?.billingPeriodMonths ?? item?.BillingPeriodMonths ?? (item?.billingPeriod === 'Bi-Monthly' ? 2 : (item?.billingPeriod === 'Quarterly' ? 3 : (item?.billingPeriod === 'Bi-Annual' ? 6 : (item?.billingPeriod === 'Annual' ? 12 : 1)))));
    let billingPeriod = 'Monthly';
    if (bpm === 2) billingPeriod = 'Bi-Monthly';
    else if (bpm === 3) billingPeriod = 'Quarterly';
    else if (bpm === 6) billingPeriod = 'Bi-Annual';
    else if (bpm === 12) billingPeriod = 'Annual';
    else if (item?.billingPeriod || item?.billingFrequency) {
      billingPeriod = item?.billingPeriod || item?.billingFrequency;
    }

    const rawOt = item?.offeringTypeDescription || item?.OfferingTypeDescription || item?.offeringType || item?.OfferingType || item?.offeringTypeName || item?.OfferingTypeName || item?.quotationOfferingType || item?.operatingHours || item?.OperatingHours;
    const rawOtId = item?.offeringTypeId || item?.OfferingTypeId;
    const opHours = this.resolveOfferingTypeDescription(rawOt, rawOtId);

    const baseMonthlyFee = item ? (this.getQuotationMonthlyRent(item) || Number(item.monthlyRent ?? item.MonthlyRent ?? item.monthlyFee ?? item.MonthlyFee ?? item.price ?? item.Price ?? 0)) : 0;
    const itemDiscPct = item ? this.getQuotationDiscountPercentage(item) : 0;
    const itemDiscAmt = item ? this.getQuotationDiscountAmount(item) : 0;
    const itemContractM = item ? this.getQuotationContractMonths(item) : 12;
    let discountedMonthlyFee = baseMonthlyFee;
    if (itemDiscPct > 0) {
      discountedMonthlyFee = baseMonthlyFee * (1 - itemDiscPct / 100);
    } else if (itemDiscAmt > 0 && itemContractM > 0) {
      discountedMonthlyFee = Math.max(0, baseMonthlyFee - (itemDiscAmt / itemContractM));
    }
    const monthlyFee = parseFloat((discountedMonthlyFee * bpm).toFixed(2));
    const secDeposit = item ? (this.getQuotationSecurityDeposit(item) || Number(item.securityDeposit ?? item.SecurityDeposit ?? item.securityDepositOverride ?? item.SecurityDepositOverride ?? 0)) : 0;

    this.sendAgreementData = {
      quotationId: item?.quotationId || item?.id || item?.Id || null,
      customerFullName: customerName,
      customerCnic: customerCnic,
      customerPhone: customerPhone,
      customerAddress: customerAddress,
      companyName: compName,
      companyNtn: companyNtn,
      companySecpRegNo: companySecp,
      contractStartDate: startVal,
      contractEndDate: endVal,
      billingPeriod: billingPeriod,
      operatingHours: opHours,
      monthlyFee: monthlyFee,
      securityDeposit: secDeposit,
      refundDays: item?.refundDays || 30,
      overrideEmail: customerEmail,
      spaceName: item?.spaceName || item?.SpaceName || '',
      spaceTypeName: item?.spaceTypeName || item?.SpaceTypeName || '',
      locationName: item?.locationName || item?.LocationName || '',
      quotationNumber: item?.quotationNumber || item?.QuotationNumber || ''
    };

    const applyCustomerData = (c: any) => {
      if (!c) return;
      const cnicVal = c.cnicOrPassport || c.CnicOrPassport || c.cnic || c.Cnic || c.customerCnic || c.CustomerCnic || c.cnicPassport || c.CnicPassport || c.nic || c.Nic || c.sntnNtnNic || '';
      if (!this.sendAgreementData.customerCnic && cnicVal) {
        this.sendAgreementData.customerCnic = cnicVal;
      }
      if (!this.sendAgreementData.customerFullName) {
        let cName = c.fullName || '';
        if (!cName) {
          const cf = (c.firstName || '').trim();
          const cl = (c.lastName || '').trim();
          cName = (cf && cl && cf.toLowerCase().endsWith(cl.toLowerCase())) ? cf : [cf, cl].filter(Boolean).join(' ').trim();
        }
        this.sendAgreementData.customerFullName = this.sanitizeCustomerFullName(cName || c.name || c.Name || '');
      }
      if (!this.sendAgreementData.customerPhone && (c.phoneNumber || c.phone || c.PhoneNumber || c.Phone || c.contactNo)) {
        this.sendAgreementData.customerPhone = c.phoneNumber || c.phone || c.PhoneNumber || c.Phone || c.contactNo;
      }
      if (!this.sendAgreementData.customerAddress && (c.addressLine1 || c.address || c.AddressLine1 || c.Address)) {
        this.sendAgreementData.customerAddress = c.addressLine1 || c.address || c.AddressLine1 || c.Address;
      }
      if (!this.sendAgreementData.companyName && (c.company || c.companyName || c.organizationName || c.Company || c.CompanyName)) {
        this.sendAgreementData.companyName = c.company || c.companyName || c.organizationName || c.Company || c.CompanyName;
        this.sendAgreementTab = 'Company';
      }
      if (!this.sendAgreementData.companyNtn && (c.ntn || c.companyNtn || c.Ntn || c.CompanyNtn || c.ntnNo)) {
        this.sendAgreementData.companyNtn = c.ntn || c.companyNtn || c.Ntn || c.CompanyNtn || c.ntnNo;
      }
      if (!this.sendAgreementData.companySecpRegNo && (c.secpRegistrationNo || c.secpRegNo || c.SecpRegistrationNo || c.SecpRegNo)) {
        this.sendAgreementData.companySecpRegNo = c.secpRegistrationNo || c.secpRegNo || c.SecpRegistrationNo || c.SecpRegNo;
      }
      if (!this.sendAgreementData.overrideEmail && (c.email || c.userEmail || c.Email || c.UserEmail)) {
        this.sendAgreementData.overrideEmail = c.email || c.userEmail || c.Email || c.UserEmail;
      }
      // Called from subscribe callbacks; sendAgreementData is a plain object (zoneless needs a nudge).
      this.cdr.markForCheck();
    };

    const custId = item?.customerId || item?.CustomerId || item?.userId || item?.UserId;
    if (custId) {
      this.admin.getCustomerById(custId).subscribe({
        next: (cRes: any) => {
          const c = cRes?.data ?? cRes;
          applyCustomerData(c);
        },
        error: this.apiError('Failed to load customer details.')
      });
    }

    const qId = item?.quotationId || item?.id || item?.Id;
    if (qId) {
      this.quotationSvc.getQuotationById(qId).subscribe({
        next: (qRes: any) => {
          const q = qRes?.data ?? qRes;
          if (q) {
            const qCnic = q.customerCnic || q.CustomerCnic || q.cnicOrPassport || q.CnicOrPassport || q.cnic || q.Cnic || q.cnicPassport || q.nic || '';
            if (!this.sendAgreementData.customerCnic && qCnic) {
              this.sendAgreementData.customerCnic = qCnic;
            }
            if (!this.sendAgreementData.customerFullName && (q.customerName || q.customerFullName || q.CustomerName)) {
              this.sendAgreementData.customerFullName = this.sanitizeCustomerFullName(q.customerName || q.customerFullName || q.CustomerName);
            } else if (this.sendAgreementData.customerFullName) {
              this.sendAgreementData.customerFullName = this.sanitizeCustomerFullName(this.sendAgreementData.customerFullName);
            }
            if (!this.sendAgreementData.overrideEmail && (q.customerEmail || q.userEmail || q.email || q.CustomerEmail)) {
              this.sendAgreementData.overrideEmail = q.customerEmail || q.userEmail || q.email || q.CustomerEmail;
            }
            if (!this.sendAgreementData.customerPhone && (q.customerPhone || q.phone || q.phoneNumber || q.CustomerPhone)) {
              this.sendAgreementData.customerPhone = q.customerPhone || q.phone || q.phoneNumber || q.CustomerPhone;
            }
            if (!this.sendAgreementData.customerAddress && (q.customerAddress || q.address || q.CustomerAddress)) {
              this.sendAgreementData.customerAddress = q.customerAddress || q.address || q.CustomerAddress;
            }
            if (!this.sendAgreementData.companyName && (q.companyName || q.company || q.CompanyName)) {
              this.sendAgreementData.companyName = q.companyName || q.company || q.CompanyName;
              this.sendAgreementTab = 'Company';
            }
            if (!this.sendAgreementData.companyNtn && (q.companyNtn || q.ntn || q.CompanyNtn)) {
              this.sendAgreementData.companyNtn = q.companyNtn || q.ntn || q.CompanyNtn;
            }
            if (!this.sendAgreementData.quotationNumber && (q.quotationNumber || q.QuotationNumber)) {
              this.sendAgreementData.quotationNumber = q.quotationNumber || q.QuotationNumber;
            }
            if (!this.sendAgreementData.spaceName && (q.spaceName || q.spaceCode || q.SpaceName)) {
              this.sendAgreementData.spaceName = q.spaceName || q.spaceCode || q.SpaceName;
              this.sendAgreementData.spaceTypeName = q.spaceTypeName || q.SpaceTypeName || '';
              this.sendAgreementData.locationName = q.locationName || q.LocationName || '';
            }
            const qBpm = Number(q.billingPeriodMonths ?? q.BillingPeriodMonths ?? 1);
            this.sendAgreementData.billingPeriod = qBpm === 2 ? 'Bi-Monthly' : (qBpm === 3 ? 'Quarterly' : (qBpm === 6 ? 'Bi-Annual' : (qBpm === 12 ? 'Annual' : 'Monthly')));

            const qBaseMonthly = this.getQuotationMonthlyRent(q) || Number(q.monthlyRent ?? q.MonthlyRent ?? 0);
            const discType = q.discountType ?? q.DiscountType;
            const discVal = Number(q.discountValue ?? q.DiscountValue ?? 0);
            let qDiscountedMonthly = qBaseMonthly;
            if ((discType === 'Amount' || discType === 'Fixed') && discVal > 0) {
              qDiscountedMonthly = Math.max(0, qBaseMonthly - discVal);
            } else {
              const qDiscPct = Number(q.discountPercentage ?? q.DiscountPercentage ?? 0);
              if (qDiscPct > 0) {
                qDiscountedMonthly = Math.max(0, qBaseMonthly * (1 - qDiscPct / 100));
              }
            }
            const qTaxAmount = this.getQuotationTaxAmount(q) || 0;
            const qCycleNetRent = parseFloat((qDiscountedMonthly * qBpm).toFixed(2));
            this.sendAgreementData.monthlyFee = parseFloat((qCycleNetRent + qTaxAmount).toFixed(2));
            this.sendAgreementData.securityDeposit = this.getQuotationSecurityDeposit(q) || Number(q.securityDeposit ?? q.SecurityDeposit ?? 0);

            if (q.startDateTime || q.startDate || q.StartDateTime || q.StartDate) {
              const d = new Date(q.startDateTime || q.startDate || q.StartDateTime || q.StartDate);
              if (!isNaN(d.getTime())) this.sendAgreementData.contractStartDate = localDateIso(d);
            }
            if (q.endDateTime || q.endDate || q.EndDateTime || q.EndDate) {
              const d = new Date(q.endDateTime || q.endDate || q.EndDateTime || q.EndDate);
              if (!isNaN(d.getTime())) this.sendAgreementData.contractEndDate = localDateIso(d);
            }
            const qOpHours = q.offeringTypeDescription || q.OfferingTypeDescription || q.offeringType || q.OfferingType || q.offeringTypeName || q.OfferingTypeName || q.quotationOfferingType || q.operatingHours || q.OperatingHours;
            const qOtId = q.offeringTypeId || q.OfferingTypeId;
            if (qOpHours || qOtId) {
              this.sendAgreementData.operatingHours = this.resolveOfferingTypeDescription(qOpHours, qOtId);
            }

            const qCustId = q.customerId || q.CustomerId || q.userId || q.UserId;
            if (qCustId && !this.sendAgreementData.customerCnic) {
              this.admin.getCustomerById(qCustId).subscribe({
                next: (qcRes: any) => {
                  const qc = qcRes?.data ?? qcRes;
                  applyCustomerData(qc);
                },
                error: this.apiError('Failed to load customer details.')
              });
            }
          }

          const emailToSearch = this.sendAgreementData.overrideEmail || customerEmail;
          if (!this.sendAgreementData.customerCnic && emailToSearch) {
            this.admin.searchCustomers(emailToSearch).subscribe({
              next: (sRes: any) => {
                const list = sRes?.data ?? (Array.isArray(sRes) ? sRes : []);
                const match = list.find((m: any) => String(m.email || m.userEmail || m.customerEmail || '').toLowerCase() === emailToSearch.toLowerCase()) || list[0];
                if (match) {
                  applyCustomerData(match);
                }
              },
              error: this.apiError('Failed to search customers.')
            });
          }
          this.cdr.markForCheck();
        },
        error: this.apiError('Failed to load quotation details.')
      });
    } else {
      const emailToSearch = this.sendAgreementData.overrideEmail || customerEmail;
      if (!this.sendAgreementData.customerCnic && emailToSearch) {
        this.admin.searchCustomers(emailToSearch).subscribe({
          next: (sRes: any) => {
            const list = sRes?.data ?? (Array.isArray(sRes) ? sRes : []);
            const match = list.find((m: any) => String(m.email || m.userEmail || m.customerEmail || '').toLowerCase() === emailToSearch.toLowerCase()) || list[0];
            if (match) {
              applyCustomerData(match);
            }
          },
          error: this.apiError('Failed to search customers.')
        });
      }
    }

    this.showSendAgreementModal.set(true);
  }

  closeSendAgreementModal() {
    this.requestDiscardableClose(this.isSendAgreementFormDirty(), () => {
      this.showSendAgreementModal.set(false);
      this.selectedAgreementItem = null;
    });
  }

  submitSendAgreement() {
    this.sendAgreementSaving.set(true);
    this.sendAgreementError.set('');
    const qId = Number(this.selectedAgreementItem?.quotationId || this.selectedAgreementItem?.id || this.sendAgreementData.quotationId || 0);
    const payload: any = {
      QuotationId: qId,
      quotationId: qId,
      EntityType: this.sendAgreementTab,
      entityType: this.sendAgreementTab,
      FullName: this.sendAgreementData.customerFullName,
      fullName: this.sendAgreementData.customerFullName,
      Cnic: this.sendAgreementData.customerCnic,
      cnic: this.sendAgreementData.customerCnic,
      PhoneNumber: this.sendAgreementData.customerPhone,
      phoneNumber: this.sendAgreementData.customerPhone,
      Address: this.sendAgreementData.customerAddress,
      address: this.sendAgreementData.customerAddress,
      CompanyName: this.sendAgreementData.companyName,
      companyName: this.sendAgreementData.companyName,
      Ntn: this.sendAgreementData.companyNtn,
      ntn: this.sendAgreementData.companyNtn,
      SecpRegistrationNo: this.sendAgreementData.companySecpRegNo,
      secpRegistrationNo: this.sendAgreementData.companySecpRegNo,
      RefundDays: Number(this.sendAgreementData.refundDays || 30),
      refundDays: Number(this.sendAgreementData.refundDays || 30),
      FeeAmount: Number(this.sendAgreementData.monthlyFee || 0),
      feeAmount: Number(this.sendAgreementData.monthlyFee || 0),
      SecurityDeposit: Number(this.sendAgreementData.securityDeposit || 0),
      securityDeposit: Number(this.sendAgreementData.securityDeposit || 0),
      ContractStartDate: this.sendAgreementData.contractStartDate ? new Date(this.sendAgreementData.contractStartDate).toISOString() : null,
      contractStartDate: this.sendAgreementData.contractStartDate,
      ContractEndDate: this.sendAgreementData.contractEndDate ? new Date(this.sendAgreementData.contractEndDate).toISOString() : null,
      contractEndDate: this.sendAgreementData.contractEndDate,
      OperatingHours: this.sendAgreementData.operatingHours || '24/7',
      operatingHours: this.sendAgreementData.operatingHours || '24/7',
      BillingFrequency: this.sendAgreementData.billingPeriod || 'Monthly',
      billingFrequency: this.sendAgreementData.billingPeriod || 'Monthly',
      OverrideEmail: this.sendAgreementData.overrideEmail || this.selectedAgreementItem?.customerEmail || this.selectedAgreementItem?.userEmail || null,
      overrideEmail: this.sendAgreementData.overrideEmail || this.selectedAgreementItem?.customerEmail || this.selectedAgreementItem?.userEmail || null
    };
    const obs = this.agreementSvc ? this.agreementSvc.sendAgreement(payload) : this.admin.sendAgreement(payload);
    obs.subscribe({
      next: () => {
        this.sendAgreementSaving.set(false);
        this.showSendAgreementModal.set(false);
        this.showSuccess('Agreement generated and sent to customer successfully!');
        this.load();
      },
      error: (err: any) => {
        this.sendAgreementSaving.set(false);
        this.sendAgreementError.set(err?.error?.message || err?.message || 'Failed to send agreement.');
        this.showError(this.sendAgreementError());
      }
    });
  }

  downloadAgreementPdf(agreementId: any) {
    if (!agreementId) return;
    const obs = this.agreementSvc ? this.agreementSvc.getAgreementPdf(Number(agreementId)) : this.admin.downloadAgreementPdf(agreementId);
    obs.subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Agreement-${agreementId}.pdf`;
        a.click();
        setTimeout(() => window.URL.revokeObjectURL(url), 2000);
      },
      error: () => this.showError('Failed to download agreement PDF.')
    });
  }

  // ---------- Signed agreement received (one step: scan + date -> booking -> first invoice) ----------
  signAgreementItem = signal<any | null>(null);
  signFile = signal<File | null>(null);
  signDate = signal<string>('');
  signNote = signal<string>('');
  signingAgreement = signal(false);
  /** Date for the next initial invoice (the signed agreement's date); null = today. */
  initialInvoiceIssuedOn = signal<string | null>(null);

  todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  signMinDate(ag: any): string {
    const sent = ag?.sentDate || ag?.SentDate;
    return sent ? String(sent).slice(0, 10) : '';
  }
  signChallanAlreadyExpired(): boolean {
    const d = this.signDate();
    if (!d) return false;
    const days = (new Date(this.todayIso()).getTime() - new Date(d).getTime()) / 86400000;
    return days > 7;
  }
  /** The customer already uploaded the signed copy from their portal (admin is verifying it). */
  customerCopyOnFile(ag: any): boolean {
    return !!(ag?.signedPdfUploadedAt || ag?.SignedPdfUploadedAt);
  }
  openSignAgreement(item: any) {
    this.signAgreementItem.set(item);
    this.signFile.set(null);
    // Pre-fill the date the customer gave when they uploaded; otherwise today.
    const proposed = item?.signedDate || item?.SignedDate;
    this.signDate.set(proposed ? String(proposed).slice(0, 10) : this.todayIso());
    this.signNote.set('');
  }
  closeSignAgreement() {
    if (!this.signingAgreement()) this.signAgreementItem.set(null);
  }
  onSignFileChosen(event: any) {
    const f: File | undefined = event?.target?.files?.[0];
    if (f && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      this.showError('Only PDF files are allowed.');
      this.signFile.set(null);
      return;
    }
    if (f && f.size > 10 * 1024 * 1024) {
      this.showError('File size exceeds the 10MB limit.');
      this.signFile.set(null);
      return;
    }
    this.signFile.set(f ?? null);
  }
  submitSignAgreement() {
    const ag = this.signAgreementItem();
    const file = this.signFile();
    const date = this.signDate();
    if (!ag || !date || this.signingAgreement()) return;
    if (!file && !this.customerCopyOnFile(ag)) return;
    const id = Number(ag.id || ag.agreementId);
    this.signingAgreement.set(true);
    this.agreementSvc.signAgreement(id, file, date, this.signNote().trim() || undefined).subscribe({
      next: (res: any) => {
        this.signingAgreement.set(false);
        this.signAgreementItem.set(null);
        this.showSuccess(res?.message || 'Signed agreement saved and booking created.');
        const bookingId = res?.data?.bookingId ?? res?.data?.BookingId;
        this.load();
        if (bookingId) {
          // Next step: first invoice, dated on the agreement. Load the full booking first so the
          // invoice window shows the customer, space and amounts (as when opened from Bookings).
          const fallbackEmail = ag.customerEmail || ag.CustomerEmail || ag.email || res?.data?.customerEmail || '';
          this.admin.getBookingRow(Number(bookingId)).subscribe({
            next: (rowRes: any) => {
              const row = rowRes?.data ?? rowRes ?? {};
              this.sendInitialInvoice({
                ...row,
                bookingId,
                issuedOn: date,
                customerEmail: row.customerEmail || row.CustomerEmail || row.userEmail || row.UserEmail || fallbackEmail
              });
            },
            error: () => this.sendInitialInvoice({ bookingId, issuedOn: date, customerEmail: fallbackEmail })
          });
        }
      },
      error: (err: any) => {
        this.signingAgreement.set(false);
        this.showError(err?.error?.message || 'Could not save the signed agreement.');
      }
    });
  }

  markAgreementSigned(agreementId: any) {
    if (!agreementId) return;
    const obs = this.agreementSvc ? this.agreementSvc.markAgreementSigned(Number(agreementId)) : this.admin.markAgreementSigned(agreementId);
    obs.subscribe({
      next: () => {
        this.showSuccess('Agreement marked as signed!');
        this.load();
      },
      error: (err: any) => this.showError(err?.error?.message || 'Failed to mark agreement signed.')
    });
  }

  readonly showAgreementDetailsModal = signal(false);
  selectedAgreementDetails = signal<any>(null);
  uploadingSignedAgreementId = signal<number | null>(null);

  openAgreementDetailsModal(item: any) {
    this.selectedAgreementDetails.set(item);
    this.showAgreementDetailsModal.set(true);
  }

  onSignedAgreementFileSelected(agreementId: any, event: any) {
    const input = event.target as HTMLInputElement;
    if (!input || !input.files || input.files.length === 0) return;
    const file = input.files[0];

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      this.showError('Only PDF files (.pdf) are allowed.');
      input.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      this.showError('File size exceeds the 10MB limit.');
      input.value = '';
      return;
    }

    const id = Number(agreementId);
    this.uploadingSignedAgreementId.set(id);

    this.agreementSvc.uploadSignedAgreement(id, file).subscribe({
      next: (res: any) => {
        this.uploadingSignedAgreementId.set(null);
        this.showSuccess(res?.message || 'Signed agreement uploaded successfully!');
        input.value = '';

        const cur = this.selectedAgreementDetails();
        if (cur && (cur.id === id || cur.agreementId === id)) {
          this.selectedAgreementDetails.set({
            ...cur,
            signedPdfUploadedAt: res?.data?.signedPdfUploadedAt || new Date().toISOString(),
            SignedPdfUploadedAt: res?.data?.signedPdfUploadedAt || new Date().toISOString()
          });
        }

        this.load();
      },
      error: (err: any) => {
        this.uploadingSignedAgreementId.set(null);
        input.value = '';
        const errMsg = err?.error?.message || err?.message || 'Failed to upload signed agreement.';
        this.showError(errMsg);
      }
    });
  }

  downloadSignedAgreementPdf(agreementId: any) {
    if (!agreementId) return;
    const id = Number(agreementId);
    this.agreementSvc.getSignedAgreementPdf(id).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `signed-lease-${id}.pdf`;
        a.target = '_blank';
        a.click();
        setTimeout(() => window.URL.revokeObjectURL(url), 2000);
      },
      error: (err: any) => {
        const errMsg = err?.error?.message || 'Failed to download signed agreement PDF.';
        this.showError(errMsg);
      }
    });
  }

  getSignedAgreementDownloadUrl(agreementId: any): string {
    if (!agreementId) return '#';
    return this.agreementSvc.getSignedPdfDownloadUrl(Number(agreementId));
  }

  triggerSignedUpload(agreementId: any) {
    const el = document.getElementById('upload-signed-' + agreementId) as HTMLInputElement;
    if (el) el.click();
  }

  deleteSignedAgreementPdf(agreementId: any) {
    if (!agreementId) return;
    if (!confirm('Are you sure you want to delete this uploaded signed copy?')) return;
    const id = Number(agreementId);
    this.agreementSvc.deleteSignedPdf(id).subscribe({
      next: () => {
        this.showSuccess('Signed agreement copy deleted successfully.');
        const cur = this.selectedAgreementDetails();
        if (cur && (cur.id === id || cur.agreementId === id)) {
          this.selectedAgreementDetails.set({
            ...cur,
            signedPdfUploadedAt: null,
            SignedPdfUploadedAt: null,
            signedPdfPath: null,
            SignedPdfPath: null
          });
        }
        this.load();
      },
      error: (err: any) => {
        const errMsg = err?.error?.message || err?.message || 'Failed to delete signed copy.';
        this.showError(errMsg);
      }
    });
  }

  readonly showQuickUploadModal = signal(false);
  quickUploadAgreementId: number | null = null;

  openQuickUploadModal(item?: any) {
    this.quickUploadAgreementId = item ? (item.id || item.agreementId) : (this.filtered.length > 0 ? (this.filtered[0].id || this.filtered[0].agreementId) : null);
    this.showQuickUploadModal.set(true);
  }

}





