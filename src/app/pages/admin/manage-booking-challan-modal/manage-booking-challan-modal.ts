import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Booking Confirmation & Payment Challan popup of the Manage page (Manage.showChallanModal), the printable
 *  challan (#admin-receipt-printable). Markup moved from manage.html; the challan data, the pricing queries
 *  (pricing utils delegates), closing, sending the initial invoice, the email, the PDF download and printing
 *  (Manage.printReceipt: window.print()) stay in Manage. */
@Component({
  selector: 'app-manage-booking-challan-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-booking-challan-modal.html',
  styleUrl: './manage-booking-challan-modal.css'
})
export class ManageBookingChallanModal {
  /** The challan (Manage.challanData()). */
  @Input({ required: true }) c!: any;
  /** Manage.formatChallanDisplay (through Manage.formatChallanDisplayFn). */
  @Input({ required: true }) formatChallanDisplay!: (c: any) => string;
  /** Manage's pricing queries (through Manage.getChallan*Fn / isMeetingRoomFn). */
  @Input({ required: true }) isMeetingRoom!: (item: any) => boolean;
  @Input({ required: true }) getChallanInitialPayable!: (c: any) => number;
  @Input({ required: true }) getChallanMonthlyRent!: (c: any) => number;
  @Input({ required: true }) getChallanSecurityDeposit!: (c: any) => number;
  @Input({ required: true }) getChallanBillingMonths!: (c: any) => number;
  @Input({ required: true }) getChallanFirstCycleRent!: (c: any) => number;
  @Input({ required: true }) getChallanSecurityMonths!: (c: any) => number;
  @Input({ required: true }) getChallanTaxAmount!: (c: any) => number;
  @Input({ required: true }) getChallanFirstCycleDiscount!: (c: any) => number;
  @Input({ required: true }) sendingInitialInvoiceId!: Signal<number | null>;
  @Input({ required: true }) sendingChallanEmail!: Signal<boolean>;
  @Input({ required: true }) challanEmailSent!: Signal<string>;
  /** Manage: showChallanModal.set(false). */
  @Output() closeChallan = new EventEmitter<void>();
  /** Manage.sendInitialInvoice. */
  @Output() sendInitialInvoice = new EventEmitter<any>();
  /** Manage.sendChallanEmail. */
  @Output() sendChallanEmail = new EventEmitter<void>();
  /** Manage.downloadChallan. */
  @Output() downloadChallan = new EventEmitter<void>();
  /** Manage.printReceipt (window.print(), run synchronously inside this click as before). */
  @Output() printReceipt = new EventEmitter<void>();
}
