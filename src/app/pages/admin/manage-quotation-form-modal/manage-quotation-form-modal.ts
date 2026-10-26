import { Component, EventEmitter, Input, Output, Signal, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Create Quotation popup of the Manage page (Manage.showQuotationForm). Markup moved from manage.html; every
 *  piece of form state (the fields, quotationFormData, the customer search), the getters, the pricing, the
 *  inquiry prefill / next-version opening, the discard-confirm close (requestDiscardableClose /
 *  isQuotationFormDirty), quick customer creation and saving stay in Manage. */
@Component({
  selector: 'app-manage-quotation-form-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-quotation-form-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-quotation-form-modal.css']
})
export class ManageQuotationFormModal {
  @Input({ required: true }) quotationFormErrorField!: string;
  @Input({ required: true }) selectedCustomer!: any;
  /** Manage's own form object (edited in place by the template's ngModel bindings). */
  @Input({ required: true }) quotationFormData!: any;
  @Input({ required: true }) quotationMinPerSeatBasePrice!: number;
  @Input({ required: true }) quotationCapacity!: number;
  /** Manage's own Set (toggled in place by Manage.toggleQuotationSlot). */
  @Input({ required: true }) quotationSelectedSlots!: Set<string>;
  @Input({ required: true }) quotationEndDateDisplay!: string;
  @Input({ required: true }) quotationSubtotal!: number;
  @Input({ required: true }) quotationSuccessMessage!: Signal<string>;
  @Input({ required: true }) quotationFormError!: Signal<string>;
  @Input({ required: true }) customerSearchResults!: Signal<any[]>;
  @Input({ required: true }) locationOptions!: Signal<{ v: any; l: string }[]>;
  @Input({ required: true }) quotationBasePriceError!: Signal<string>;
  @Input({ required: true }) quotationFloorOptions!: Signal<{ v: any; l: string }[]>;
  @Input({ required: true }) quotationMeetingSlots!: Signal<{ label: string; start: string; end: string }[]>;
  @Input({ required: true }) quotationDiscountError!: Signal<string>;
  @Input({ required: true }) quotationFormSaving!: Signal<boolean>;
  /** Manage's option lists (BILLING_PERIOD_OPTIONS, Manage.securityDepositMonthOptions). */
  @Input({ required: true }) billingPeriodOptions!: { v: number; l: string }[];
  @Input({ required: true }) securityDepositMonthOptions!: readonly { v: number; l: string }[];

  // Manage's two-way fields. The template reads and writes them as plain values (unchanged text).
  /** Manage.customerSearchQuery, two-way. */
  readonly customerSearchQueryModel = model<string>('');
  get customerSearchQuery(): string { return this.customerSearchQueryModel(); }
  set customerSearchQuery(value: string) { this.customerSearchQueryModel.set(value); }
  /** Manage.selectedQuotationLocationId, two-way. */
  readonly selectedQuotationLocationIdModel = model<string>('');
  get selectedQuotationLocationId(): string { return this.selectedQuotationLocationIdModel(); }
  set selectedQuotationLocationId(value: string) { this.selectedQuotationLocationIdModel.set(value); }
  /** Manage.quotationOfferingTypeId, two-way. */
  readonly quotationOfferingTypeIdModel = model<number>(1);
  get quotationOfferingTypeId(): number { return this.quotationOfferingTypeIdModel(); }
  set quotationOfferingTypeId(value: number) { this.quotationOfferingTypeIdModel.set(value); }
  /** Manage.selectedQuotationSpaceTypeId, two-way. */
  readonly selectedQuotationSpaceTypeIdModel = model<string>('');
  get selectedQuotationSpaceTypeId(): string { return this.selectedQuotationSpaceTypeIdModel(); }
  set selectedQuotationSpaceTypeId(value: string) { this.selectedQuotationSpaceTypeIdModel.set(value); }
  /** Manage.selectedQuotationCapacity, two-way. */
  readonly selectedQuotationCapacityModel = model<number | string | null>(null);
  get selectedQuotationCapacity(): number | string | null { return this.selectedQuotationCapacityModel(); }
  set selectedQuotationCapacity(value: number | string | null) { this.selectedQuotationCapacityModel.set(value); }
  /** Manage.quotationPerSeatBasePrice, two-way. */
  readonly quotationPerSeatBasePriceModel = model<number>(0);
  get quotationPerSeatBasePrice(): number { return this.quotationPerSeatBasePriceModel(); }
  set quotationPerSeatBasePrice(value: number) { this.quotationPerSeatBasePriceModel.set(value); }
  /** Manage.quotationFloorId, two-way. */
  readonly quotationFloorIdModel = model<number | null>(null);
  get quotationFloorId(): number | null { return this.quotationFloorIdModel(); }
  set quotationFloorId(value: number | null) { this.quotationFloorIdModel.set(value); }
  /** Manage.quotationStartDate, two-way. */
  readonly quotationStartDateModel = model<string>('');
  get quotationStartDate(): string { return this.quotationStartDateModel(); }
  set quotationStartDate(value: string) { this.quotationStartDateModel.set(value); }
  /** Manage.quotationMeetingDayEnd, two-way. */
  readonly quotationMeetingDayEndModel = model<string>('');
  get quotationMeetingDayEnd(): string { return this.quotationMeetingDayEndModel(); }
  set quotationMeetingDayEnd(value: string) { this.quotationMeetingDayEndModel.set(value); }
  /** Manage.quotationMonths, two-way. */
  readonly quotationMonthsModel = model<number>(12);
  get quotationMonths(): number { return this.quotationMonthsModel(); }
  set quotationMonths(value: number) { this.quotationMonthsModel.set(value); }
  /** Manage.quotationDiscountType, two-way. */
  readonly quotationDiscountTypeModel = model<string>('Percentage');
  get quotationDiscountType(): string { return this.quotationDiscountTypeModel(); }
  set quotationDiscountType(value: string) { this.quotationDiscountTypeModel.set(value); }
  /** Manage.quotationDiscountValue, two-way. */
  readonly quotationDiscountValueModel = model<number>(0);
  get quotationDiscountValue(): number { return this.quotationDiscountValueModel(); }
  set quotationDiscountValue(value: number) { this.quotationDiscountValueModel.set(value); }
  /** Manage.quotationBillingPeriodMonths, two-way. */
  readonly quotationBillingPeriodMonthsModel = model<number>(3);
  get quotationBillingPeriodMonths(): number { return this.quotationBillingPeriodMonthsModel(); }
  set quotationBillingPeriodMonths(value: number) { this.quotationBillingPeriodMonthsModel.set(value); }
  /** Manage.quotationSecurityDepositMonths, two-way. */
  readonly quotationSecurityDepositMonthsModel = model<number>(2);
  get quotationSecurityDepositMonths(): number { return this.quotationSecurityDepositMonthsModel(); }
  set quotationSecurityDepositMonths(value: number) { this.quotationSecurityDepositMonthsModel.set(value); }
  /** Manage.quotationValidUntil, two-way. */
  readonly quotationValidUntilModel = model<string>('');
  get quotationValidUntil(): string { return this.quotationValidUntilModel(); }
  set quotationValidUntil(value: string) { this.quotationValidUntilModel.set(value); }
  /** Manage.quotationRemarks, two-way. */
  readonly quotationRemarksModel = model<string>('');
  get quotationRemarks(): string { return this.quotationRemarksModel(); }
  set quotationRemarks(value: string) { this.quotationRemarksModel.set(value); }
  /** Manage.quotationMeetingRoomMode, two-way, but NOT kept here: the getter always reads Manage's bound value and
   *  the setter only hands the new value to Manage. Manage.recalcQuotationAmount may put 'day' straight back in the
   *  same click (day-only meeting rooms); a local copy (model()) would then keep showing 'slot'. */
  @Input({ required: true }) quotationMeetingRoomModeModel!: 'day' | 'slot';
  @Output() quotationMeetingRoomModeModelChange = new EventEmitter<'day' | 'slot'>();
  get quotationMeetingRoomMode(): 'day' | 'slot' { return this.quotationMeetingRoomModeModel; }
  set quotationMeetingRoomMode(value: 'day' | 'slot') { this.quotationMeetingRoomModeModelChange.emit(value); }

  // Manage's getters, read lazily through Manage's *Fn arrows (same text in the template, same timing).
  /** Manage.locationLocked (through Manage.locationLockedFn). */
  @Input({ required: true }) locationLockedFn!: () => boolean;
  get locationLocked(): boolean { return this.locationLockedFn(); }
  /** Manage.quotationDynamicDiscountCap (through Manage.quotationDynamicDiscountCapFn). */
  @Input({ required: true }) quotationDynamicDiscountCapFn!: () => number;
  get quotationDynamicDiscountCap(): number { return this.quotationDynamicDiscountCapFn(); }
  /** Manage.quotationFloorPerSeat (through Manage.quotationFloorPerSeatFn). */
  @Input({ required: true }) quotationFloorPerSeatFn!: () => number;
  get quotationFloorPerSeat(): number { return this.quotationFloorPerSeatFn(); }
  /** Manage.quotationMaxAllowedDiscountFixed (through Manage.quotationMaxAllowedDiscountFixedFn). */
  @Input({ required: true }) quotationMaxAllowedDiscountFixedFn!: () => number;
  get quotationMaxAllowedDiscountFixed(): number { return this.quotationMaxAllowedDiscountFixedFn(); }
  /** Manage.quotationBillingAmount (through Manage.quotationBillingAmountFn). */
  @Input({ required: true }) quotationBillingAmountFn!: () => number;
  get quotationBillingAmount(): number { return this.quotationBillingAmountFn(); }
  /** Manage.quotationDepositMonths (through Manage.quotationDepositMonthsFn). */
  @Input({ required: true }) quotationDepositMonthsFn!: () => number;
  get quotationDepositMonths(): number { return this.quotationDepositMonthsFn(); }
  /** Manage.effectiveQuotationSecurityDeposit (through Manage.effectiveQuotationSecurityDepositFn). */
  @Input({ required: true }) effectiveQuotationSecurityDepositFn!: () => number;
  get effectiveQuotationSecurityDeposit(): number { return this.effectiveQuotationSecurityDepositFn(); }
  /** Manage.quotationTaxAmount (through Manage.quotationTaxAmountFn). */
  @Input({ required: true }) quotationTaxAmountFn!: () => number;
  get quotationTaxAmount(): number { return this.quotationTaxAmountFn(); }
  /** Manage.quotationFirstInvoiceDiscount (through Manage.quotationFirstInvoiceDiscountFn). */
  @Input({ required: true }) quotationFirstInvoiceDiscountFn!: () => number;
  get quotationFirstInvoiceDiscount(): number { return this.quotationFirstInvoiceDiscountFn(); }
  /** Manage.quotationFirstInvoiceTotal (through Manage.quotationFirstInvoiceTotalFn). */
  @Input({ required: true }) quotationFirstInvoiceTotalFn!: () => number;
  get quotationFirstInvoiceTotal(): number { return this.quotationFirstInvoiceTotalFn(); }
  /** Manage.isQuotationPrivateRoom (through Manage.isQuotationPrivateRoomFn). */
  @Input({ required: true }) isQuotationPrivateRoomFn!: () => boolean;
  get isQuotationPrivateRoom(): boolean { return this.isQuotationPrivateRoomFn(); }
  /** Manage.isQuotationSharedSpace (through Manage.isQuotationSharedSpaceFn). */
  @Input({ required: true }) isQuotationSharedSpaceFn!: () => boolean;
  get isQuotationSharedSpace(): boolean { return this.isQuotationSharedSpaceFn(); }
  /** Manage.isQuotationMeetingRoom (through Manage.isQuotationMeetingRoomFn). */
  @Input({ required: true }) isQuotationMeetingRoomFn!: () => boolean;
  get isQuotationMeetingRoom(): boolean { return this.isQuotationMeetingRoomFn(); }
  /** Manage.availableQuotationCapacities (through Manage.availableQuotationCapacitiesFn). */
  @Input({ required: true }) availableQuotationCapacitiesFn!: () => number[];
  get availableQuotationCapacities(): number[] { return this.availableQuotationCapacitiesFn(); }
  /** Manage.filteredQuotationSpaceOptions (through Manage.filteredQuotationSpaceOptionsFn). */
  @Input({ required: true }) filteredQuotationSpaceOptionsFn!: () => { v: any; l: string }[];
  get filteredQuotationSpaceOptions(): { v: any; l: string }[] { return this.filteredQuotationSpaceOptionsFn(); }

  // Manage's methods the template calls (through Manage's *Fn arrows).
  /** Manage.filteredQuotationOfferingTypes (through Manage.filteredQuotationOfferingTypesFn). */
  @Input({ required: true }) filteredQuotationOfferingTypes!: () => { id: number; description: string; discountCap: number; locationId?: number | null }[];
  /** Manage.spaceTypeOptionsAt (through Manage.spaceTypeOptionsAtFn). */
  @Input({ required: true }) spaceTypeOptionsAt!: (location: unknown) => readonly { v: any; l: string }[];
  /** Manage.spaceTypeHintAt (through Manage.spaceTypeHintAtFn). */
  @Input({ required: true }) spaceTypeHintAt!: (location: unknown, optionCount: number) => string;
  /** Manage.isQuotationSlotSelected (through Manage.isQuotationSlotSelectedFn). */
  @Input({ required: true }) isQuotationSlotSelected!: (slot: { start: string }) => boolean;

  /** Manage.closeAdminQuotationForm. */
  @Output() closeAdminQuotationForm = new EventEmitter<void>();
  /** Manage.submitAdminQuotation. */
  @Output() submitAdminQuotation = new EventEmitter<boolean>();
  /** Manage.onCustomerSearch. */
  @Output() onCustomerSearch = new EventEmitter<void>();
  /** Manage.openCreateCustomerFromBooking. */
  @Output() openCreateCustomerFromBooking = new EventEmitter<void>();
  /** Manage.selectCustomer. */
  @Output() selectCustomer = new EventEmitter<any>();
  /** Manage.onQuotationLocationChange. */
  @Output() onQuotationLocationChange = new EventEmitter<void>();
  /** Manage.onQuotationOfferingTypeChange. */
  @Output() onQuotationOfferingTypeChange = new EventEmitter<void>();
  /** Manage.validateQuotationDiscount. */
  @Output() validateQuotationDiscount = new EventEmitter<void>();
  /** Manage.onQuotationSpaceTypeChange. */
  @Output() onQuotationSpaceTypeChange = new EventEmitter<void>();
  /** Manage.onQuotationCapacityChange. */
  @Output() onQuotationCapacityChange = new EventEmitter<void>();
  /** Manage.onQuotationSpaceSelected. */
  @Output() onQuotationSpaceSelected = new EventEmitter<void>();
  /** Manage.onQuotationBasePriceChange. */
  @Output() onQuotationBasePriceChange = new EventEmitter<void>();
  /** Manage.onQuotationMeetingModeChange. */
  @Output() onQuotationMeetingModeChange = new EventEmitter<void>();
  /** Manage.generateQuotationMeetingSlots. */
  @Output() generateQuotationMeetingSlots = new EventEmitter<void>();
  /** Manage.toggleQuotationSlot. */
  @Output() toggleQuotationSlot = new EventEmitter<{ start: string; end: string }>();
  /** Manage.recalcQuotationAmount. */
  @Output() recalcQuotationAmount = new EventEmitter<void>();
  /** Manage.onQuotationMonthPeriodChange. */
  @Output() onQuotationMonthPeriodChange = new EventEmitter<void>();
  /** Manage.onDiscountTypeChange. */
  @Output() onDiscountTypeChange = new EventEmitter<void>();
  /** Manage.onQuotationDiscountChange. */
  @Output() onQuotationDiscountChange = new EventEmitter<void>();
}
