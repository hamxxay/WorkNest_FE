import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Confirm Booking Conversion popup of the Manage page (Manage.showConversionPreviewModal). Markup moved from
 *  manage.html; the pricing queries are Manage's (pricing utils delegates) and closing and the conversion
 *  itself (Manage.executeConversion) stay in Manage. */
@Component({
  selector: 'app-manage-quotation-conversion-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-quotation-conversion-modal.html',
  styleUrl: './manage-quotation-conversion-modal.css'
})
export class ManageQuotationConversionModal {
  /** The quotation (Manage.selectedConversionQuotation()). */
  @Input({ required: true }) q!: any;
  /** Manage's pricing queries (through Manage.getQuotation*Fn / isMeetingRoomFn). */
  @Input({ required: true }) getQuotationContractMonths!: (q: any) => number;
  @Input({ required: true }) isMeetingRoom!: (item: any) => boolean;
  @Input({ required: true }) getQuotationBillingMonths!: (q: any) => number;
  @Input({ required: true }) getQuotationFirstCycleRent!: (q: any) => number;
  @Input({ required: true }) getQuotationDiscountAmount!: (q: any) => number;
  @Input({ required: true }) getQuotationTaxAmount!: (q: any) => number;
  @Input({ required: true }) getQuotationSecurityDeposit!: (q: any) => number;
  @Input({ required: true }) getQuotationInitialPayable!: (q: any) => number;
  @Input({ required: true }) conversionSubmitting!: Signal<boolean>;
  /** Manage.closeConversionPreviewModal. */
  @Output() closeConversionPreviewModal = new EventEmitter<void>();
  /** Manage.executeConversion. */
  @Output() executeConversion = new EventEmitter<any>();
}
