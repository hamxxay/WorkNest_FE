import { Component, EventEmitter, Input, Output, Signal, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WhtInvoiceFields } from '../../../components/wht-invoice-fields/wht-invoice-fields';

/** Create / Edit Booking popup of the Manage page (Manage.showBookingForm). Markup moved from manage.html; every
 *  piece of form state (the fields, bookingFormData, the customer search, the meeting-room slots), the getters,
 *  the pricing, the edit prefill (openAdminBookingForm), the discard-confirm close (closeAdminBookingForm /
 *  requestDiscardableClose / isBookingFormDirty), quick customer creation and saving stay in Manage. The WHT
 *  fields (app-wht-invoice-fields) are bound two-way to Manage.bookingSendWht / bookingWhtRate. */
@Component({
  selector: 'app-manage-booking-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, WhtInvoiceFields],
  templateUrl: './manage-booking-form-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-booking-form-modal.css']
})
export class ManageBookingFormModal {
  /** Manage.editingBookingId: set by Manage.openAdminBookingForm (edit) before the form opens. */
  @Input({ required: true }) editingBookingId!: number | null;
  @Input({ required: true }) bookingFormErrorField!: string;
  @Input({ required: true }) selectedCustomer!: any;
  /** Manage's own form object (edited in place by the template's ngModel bindings; Manage.recalcAmount
   *  replaces it, and the binding hands the new object over). */
  @Input({ required: true }) bookingFormData!: any;
  @Input({ required: true }) bookingMinPerSeatBasePrice!: number;
  @Input({ required: true }) bookingSubtotal!: number;
  @Input({ required: true }) meetingRoomBookingMode!: 'day' | 'slot';
  /** Manage's own Set (toggled in place by Manage.toggleAdminSlot, replaced by generateAdminMeetingSlots). */
  @Input({ required: true }) adminSelectedSlots!: Set<string>;
  @Input({ required: true }) bookingWhtTouched!: boolean;
  @Input({ required: true }) bookingFormError!: Signal<string>;
  @Input({ required: true }) bookingFormSaving!: Signal<boolean>;
  @Input({ required: true }) customerSearchResults!: Signal<any[]>;
  @Input({ required: true }) cityOptions!: Signal<{ v: any; l: string }[]>;
  @Input({ required: true }) locationOptions!: Signal<{ v: any; l: string }[]>;
  @Input({ required: true }) filteredSpaceOptions!: Signal<{ v: any; l: string }[]>;
  @Input({ required: true }) availableAdminCapacities!: Signal<number[]>;
  @Input({ required: true }) bookingBasePriceError!: Signal<string>;
  @Input({ required: true }) bookingFloorOptions!: Signal<{ v: any; l: string }[]>;
  @Input({ required: true }) adminMeetingSlots!: Signal<{ label: string; start: string; end: string; isLocked?: boolean }[]>;
  @Input({ required: true }) bookingDiscountError!: Signal<string>;
  /** Manage's option lists (BILLING_PERIOD_OPTIONS, Manage.securityDepositMonthOptions) and the shared phone / CNIC
   *  rules (utils/phone, utils/cnic). */
  @Input({ required: true }) billingPeriodOptions!: { v: number; l: string }[];
  @Input({ required: true }) securityDepositMonthOptions!: readonly { v: number; l: string }[];
  @Input({ required: true }) phoneMaxLength!: number;
  @Input({ required: true }) cnicMaxLength!: number;
  @Input({ required: true }) phoneError!: (value: string | null | undefined, required?: boolean) => string | null;
  @Input({ required: true }) cnicError!: (value: string | null | undefined, required?: boolean) => string | null;

  // Manage's two-way fields. The template reads and writes them as plain values (unchanged text).
  /** Manage.customerSearchQuery, two-way. */
  readonly customerSearchQueryModel = model<string>('');
  get customerSearchQuery(): string { return this.customerSearchQueryModel(); }
  set customerSearchQuery(value: string) { this.customerSearchQueryModel.set(value); }
  /** Manage.selectedLocationId, two-way. */
  readonly selectedLocationIdModel = model<string>('');
  get selectedLocationId(): string { return this.selectedLocationIdModel(); }
  set selectedLocationId(value: string) { this.selectedLocationIdModel.set(value); }
  /** Manage.selectedSpaceTypeId, two-way. */
  readonly selectedSpaceTypeIdModel = model<string>('');
  get selectedSpaceTypeId(): string { return this.selectedSpaceTypeIdModel(); }
  set selectedSpaceTypeId(value: string) { this.selectedSpaceTypeIdModel.set(value); }
  /** Manage.selectedAdminCapacity, two-way. */
  readonly selectedAdminCapacityModel = model<number | string | null>(null);
  get selectedAdminCapacity(): number | string | null { return this.selectedAdminCapacityModel(); }
  set selectedAdminCapacity(value: number | string | null) { this.selectedAdminCapacityModel.set(value); }
  /** Manage.bookingPerSeatBasePrice, two-way. */
  readonly bookingPerSeatBasePriceModel = model<number>(0);
  get bookingPerSeatBasePrice(): number { return this.bookingPerSeatBasePriceModel(); }
  set bookingPerSeatBasePrice(value: number) { this.bookingPerSeatBasePriceModel.set(value); }
  /** Manage.bookingFloorId, two-way. */
  readonly bookingFloorIdModel = model<number | null>(null);
  get bookingFloorId(): number | null { return this.bookingFloorIdModel(); }
  set bookingFloorId(value: number | null) { this.bookingFloorIdModel.set(value); }
  /** Manage.adminMeetingDate, two-way. */
  readonly adminMeetingDateModel = model<string>('');
  get adminMeetingDate(): string { return this.adminMeetingDateModel(); }
  set adminMeetingDate(value: string) { this.adminMeetingDateModel.set(value); }
  /** Manage.adminStartDate, two-way. */
  readonly adminStartDateModel = model<string>('');
  get adminStartDate(): string { return this.adminStartDateModel(); }
  set adminStartDate(value: string) { this.adminStartDateModel.set(value); }
  /** Manage.adminMeetingDayEnd, two-way. */
  readonly adminMeetingDayEndModel = model<string>('');
  get adminMeetingDayEnd(): string { return this.adminMeetingDayEndModel(); }
  set adminMeetingDayEnd(value: string) { this.adminMeetingDayEndModel.set(value); }
  /** Manage.adminMonths, two-way. */
  readonly adminMonthsModel = model<number>(1);
  get adminMonths(): number { return this.adminMonthsModel(); }
  set adminMonths(value: number) { this.adminMonthsModel.set(value); }
  /** Manage.bookingDiscountType, two-way. */
  readonly bookingDiscountTypeModel = model<string>('Percentage');
  get bookingDiscountType(): string { return this.bookingDiscountTypeModel(); }
  set bookingDiscountType(value: string) { this.bookingDiscountTypeModel.set(value); }
  /** Manage.bookingDiscountValue, two-way. */
  readonly bookingDiscountValueModel = model<number>(0);
  get bookingDiscountValue(): number { return this.bookingDiscountValueModel(); }
  set bookingDiscountValue(value: number) { this.bookingDiscountValueModel.set(value); }
  /** Manage.bookingBillingPeriodMonths, two-way. */
  readonly bookingBillingPeriodMonthsModel = model<number>(3);
  get bookingBillingPeriodMonths(): number { return this.bookingBillingPeriodMonthsModel(); }
  set bookingBillingPeriodMonths(value: number) { this.bookingBillingPeriodMonthsModel.set(value); }
  /** Manage.bookingSecurityDepositMonths, two-way. */
  readonly bookingSecurityDepositMonthsModel = model<number>(2);
  get bookingSecurityDepositMonths(): number { return this.bookingSecurityDepositMonthsModel(); }
  set bookingSecurityDepositMonths(value: number) { this.bookingSecurityDepositMonthsModel.set(value); }
  /** Manage.bookingSendWht, two-way. */
  readonly bookingSendWhtModel = model<boolean>(false);
  get bookingSendWht(): boolean { return this.bookingSendWhtModel(); }
  set bookingSendWht(value: boolean) { this.bookingSendWhtModel.set(value); }
  /** Manage.bookingWhtRate, two-way. */
  readonly bookingWhtRateModel = model<number | null>(null);
  get bookingWhtRate(): number | null { return this.bookingWhtRateModel(); }
  set bookingWhtRate(value: number | null) { this.bookingWhtRateModel.set(value); }
  /** Manage.bookingOfferingTypeId, two-way, but NOT kept here: the getter always reads Manage's bound value and
   *  the setter only hands the new value to Manage. Manage.onBookingOfferingTypeChange writes it back
   *  (this.bookingOfferingTypeId = Number(this.bookingOfferingTypeId)) in the same change event;
   *  a local copy (model()) could then keep showing a stale value. */
  @Input({ required: true }) bookingOfferingTypeIdModel!: number;
  @Output() bookingOfferingTypeIdModelChange = new EventEmitter<number>();
  get bookingOfferingTypeId(): number { return this.bookingOfferingTypeIdModel; }
  set bookingOfferingTypeId(value: number) { this.bookingOfferingTypeIdModelChange.emit(value); }

  // Manage's getters, read lazily through Manage's *Fn arrows (same text in the template, same timing).
  /** Manage.locationLocked (through Manage.locationLockedFn). */
  @Input({ required: true }) locationLockedFn!: () => boolean;
  get locationLocked(): boolean { return this.locationLockedFn(); }
  /** Manage.isAdminMeetingRoom (through Manage.isAdminMeetingRoomFn). */
  @Input({ required: true }) isAdminMeetingRoomFn!: () => boolean;
  get isAdminMeetingRoom(): boolean { return this.isAdminMeetingRoomFn(); }
  /** Manage.isAdminPrivateRoom (through Manage.isAdminPrivateRoomFn). */
  @Input({ required: true }) isAdminPrivateRoomFn!: () => boolean;
  get isAdminPrivateRoom(): boolean { return this.isAdminPrivateRoomFn(); }
  /** Manage.isAdminSharedSpace (through Manage.isAdminSharedSpaceFn). */
  @Input({ required: true }) isAdminSharedSpaceFn!: () => boolean;
  get isAdminSharedSpace(): boolean { return this.isAdminSharedSpaceFn(); }
  /** Manage.adminEndDateDisplay (through Manage.adminEndDateDisplayFn). */
  @Input({ required: true }) adminEndDateDisplayFn!: () => string;
  get adminEndDateDisplay(): string { return this.adminEndDateDisplayFn(); }
  /** Manage.bookingDynamicDiscountCap (through Manage.bookingDynamicDiscountCapFn). */
  @Input({ required: true }) bookingDynamicDiscountCapFn!: () => number;
  get bookingDynamicDiscountCap(): number { return this.bookingDynamicDiscountCapFn(); }
  /** Manage.bookingMaxAllowedDiscountFixed (through Manage.bookingMaxAllowedDiscountFixedFn). */
  @Input({ required: true }) bookingMaxAllowedDiscountFixedFn!: () => number;
  get bookingMaxAllowedDiscountFixed(): number { return this.bookingMaxAllowedDiscountFixedFn(); }
  /** Manage.bookingDepositMonths (through Manage.bookingDepositMonthsFn). */
  @Input({ required: true }) bookingDepositMonthsFn!: () => number;
  get bookingDepositMonths(): number { return this.bookingDepositMonthsFn(); }
  /** Manage.effectiveSecurityDeposit (through Manage.effectiveSecurityDepositFn). */
  @Input({ required: true }) effectiveSecurityDepositFn!: () => number;
  get effectiveSecurityDeposit(): number { return this.effectiveSecurityDepositFn(); }
  /** Manage.bookingMonthlyRent (through Manage.bookingMonthlyRentFn). */
  @Input({ required: true }) bookingMonthlyRentFn!: () => number;
  get bookingMonthlyRent(): number { return this.bookingMonthlyRentFn(); }
  /** Manage.bookingBillingAmount (through Manage.bookingBillingAmountFn). */
  @Input({ required: true }) bookingBillingAmountFn!: () => number;
  get bookingBillingAmount(): number { return this.bookingBillingAmountFn(); }
  /** Manage.bookingTaxAmount (through Manage.bookingTaxAmountFn). */
  @Input({ required: true }) bookingTaxAmountFn!: () => number;
  get bookingTaxAmount(): number { return this.bookingTaxAmountFn(); }
  /** Manage.bookingFirstInvoiceDiscount (through Manage.bookingFirstInvoiceDiscountFn). */
  @Input({ required: true }) bookingFirstInvoiceDiscountFn!: () => number;
  get bookingFirstInvoiceDiscount(): number { return this.bookingFirstInvoiceDiscountFn(); }
  /** Manage.bookingFirstInvoiceTotal (through Manage.bookingFirstInvoiceTotalFn). */
  @Input({ required: true }) bookingFirstInvoiceTotalFn!: () => number;
  get bookingFirstInvoiceTotal(): number { return this.bookingFirstInvoiceTotalFn(); }

  // Manage's methods the template calls (through Manage's *Fn arrows).
  /** Manage.filteredBookingOfferingTypes (through Manage.filteredBookingOfferingTypesFn). */
  @Input({ required: true }) filteredBookingOfferingTypes!: () => { id: number; description: string; discountCap: number; locationId?: number | null }[];
  /** Manage.isCustomerFieldEmpty (through Manage.isCustomerFieldEmptyFn). */
  @Input({ required: true }) isCustomerFieldEmpty!: (field: string) => boolean;
  /** Manage.isAdminSlotSelected (through Manage.isAdminSlotSelectedFn). */
  @Input({ required: true }) isAdminSlotSelected!: (slot: { start: string; isLocked?: boolean }) => boolean;
  /** Manage.spaceTypeOptionsAt (through Manage.spaceTypeOptionsAtFn). */
  @Input({ required: true }) spaceTypeOptionsAt!: (location: unknown) => readonly { v: any; l: string }[];
  /** Manage.spaceTypeHintAt (through Manage.spaceTypeHintAtFn). */
  @Input({ required: true }) spaceTypeHintAt!: (location: unknown, optionCount: number) => string;

  /** Manage.closeAdminBookingForm. */
  @Output() closeAdminBookingForm = new EventEmitter<void>();
  /** Manage.submitAdminBooking. */
  @Output() submitAdminBooking = new EventEmitter<void>();
  /** Manage.onCustomerSearch. */
  @Output() onCustomerSearch = new EventEmitter<void>();
  /** Manage.openCreateCustomerFromBooking. */
  @Output() openCreateCustomerFromBooking = new EventEmitter<void>();
  /** Manage.selectCustomer. */
  @Output() selectCustomer = new EventEmitter<any>();
  /** Manage.onBookingLocationChange. */
  @Output() onBookingLocationChange = new EventEmitter<void>();
  /** Manage.onBookingOfferingTypeChange. */
  @Output() onBookingOfferingTypeChange = new EventEmitter<void>();
  /** Manage.validateBookingDiscount. */
  @Output() validateBookingDiscount = new EventEmitter<void>();
  /** Manage.onSpaceTypeChange. */
  @Output() onSpaceTypeChange = new EventEmitter<void>();
  /** Manage.onAdminCapacityChange. */
  @Output() onAdminCapacityChange = new EventEmitter<void>();
  /** Manage.onBookingSpaceSelected. */
  @Output() onBookingSpaceSelected = new EventEmitter<void>();
  /** Manage.onBookingBasePriceChange. */
  @Output() onBookingBasePriceChange = new EventEmitter<void>();
  /** Manage.generateAdminMeetingSlots. */
  @Output() generateAdminMeetingSlots = new EventEmitter<void>();
  /** Manage.toggleAdminSlot. */
  @Output() toggleAdminSlot = new EventEmitter<{ start: string; end: string; isLocked?: boolean }>();
  /** Manage.onAdminMeetingDayChange. */
  @Output() onAdminMeetingDayChange = new EventEmitter<void>();
  /** Manage.onAdminMonthPeriodChange. */
  @Output() onAdminMonthPeriodChange = new EventEmitter<void>();
  /** Manage.onBookingDiscountTypeChange. */
  @Output() onBookingDiscountTypeChange = new EventEmitter<void>();
  /** Manage.onBookingDiscountChange. */
  @Output() onBookingDiscountChange = new EventEmitter<void>();
  /** Manage.recalcAmount. */
  @Output() recalcAmount = new EventEmitter<void>();
  @Output() phoneFieldInput = new EventEmitter<{ event: Event; target: any; key: string }>();
  @Output() cnicFieldInput = new EventEmitter<{ event: Event; target: any; key: string }>();

  /** The template's calls, handed to Manage's onPhoneFieldInput / onCnicFieldInput (target is Manage's own
   *  bookingFormData, so Manage writes the cleaned value into it as before). */
  onPhoneFieldInput(event: Event, target: any, key: string) { this.phoneFieldInput.emit({ event, target, key }); }
  onCnicFieldInput(event: Event, target: any, key: string) { this.cnicFieldInput.emit({ event, target, key }); }
}
