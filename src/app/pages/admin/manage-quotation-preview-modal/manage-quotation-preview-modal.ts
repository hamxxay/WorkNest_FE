import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Quotation preview popup of the Manage page (Manage.showQuotationPreviewModal), with the version history
 *  (Manage.quotationVersions) and the printable quotation (#quotation-printable). Markup moved from manage.html;
 *  the pricing queries are Manage's (pricing utils delegates) and closing, the PDF downloads, the email, sending,
 *  the next version, the agreement and the conversion stay in Manage. */
@Component({
  selector: 'app-manage-quotation-preview-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-quotation-preview-modal.html',
  styleUrl: './manage-quotation-preview-modal.css'
})
export class ManageQuotationPreviewModal {
  /** The quotation (Manage.selectedQuotation()). */
  @Input({ required: true }) q!: any;
  @Input({ required: true }) sendingQuotationEmail!: Signal<boolean>;
  @Input({ required: true }) sendingQuotationId!: Signal<number | null>;
  /** Manage.isQuotationAccepted (through Manage.isQuotationAcceptedFn). */
  @Input({ required: true }) isQuotationAccepted!: (item: any) => boolean;
  @Input({ required: true }) quotationEmailSent!: Signal<string>;
  @Input({ required: true }) quotationVersions!: Signal<any[]>;
  /** Manage's pricing queries (through Manage.getQuotation*Fn / isMeetingRoomFn). */
  @Input({ required: true }) getQuotationContractMonths!: (q: any) => number;
  @Input({ required: true }) isMeetingRoom!: (item: any) => boolean;
  @Input({ required: true }) getQuotationInitialPayable!: (q: any) => number;
  @Input({ required: true }) getQuotationMonthlyRent!: (q: any) => number;
  @Input({ required: true }) getQuotationSecurityDeposit!: (q: any) => number;
  @Input({ required: true }) getQuotationBillingMonths!: (q: any) => number;
  @Input({ required: true }) getQuotationFirstCycleRent!: (q: any) => number;
  @Input({ required: true }) getQuotationDiscountAmount!: (q: any) => number;
  @Input({ required: true }) getQuotationDiscountPercentage!: (q: any) => number;
  @Input({ required: true }) getQuotationTaxAmount!: (q: any) => number;
  @Input({ required: true }) getQuotationSupportCharges!: (q: any) => number;
  @Input({ required: true }) getQuotationSecurityMonths!: (q: any) => number;
  /** Manage.closeQuotationPreviewModal. */
  @Output() closeQuotationPreviewModal = new EventEmitter<void>();
  /** Manage.downloadQuotationPdf (no argument from the toolbar button: Manage gets undefined, its optional
   *  versionItem, so it downloads Manage.selectedQuotation() as before). */
  @Output() downloadQuotationPdf = new EventEmitter<any>();
  /** Manage.sendQuotationEmailNow. */
  @Output() sendQuotationEmailNow = new EventEmitter<void>();
  /** Manage.sendQuotationVersionToCustomer. */
  @Output() sendQuotationVersionToCustomer = new EventEmitter<any>();
  /** Manage.createNextVersion. */
  @Output() createNextVersion = new EventEmitter<any>();
  /** Manage.openSendAgreement. */
  @Output() openSendAgreement = new EventEmitter<any>();
  /** Manage.convertQuotationToBooking. */
  @Output() convertQuotationToBooking = new EventEmitter<any>();
}
