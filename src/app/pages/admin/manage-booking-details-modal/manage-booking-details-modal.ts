import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { isPrivateRoom, isSharedSpace, storedDeposit } from '../manage-base/utils/manage-pricing.utils';

/** Booking Details popup of the Manage page (Manage.showBookingDetailsModal). Markup moved from manage.html; Manage
 *  loads the booking and its billing summary and keeps the actions (challan, recurring invoice, edit). */
@Component({
  selector: 'app-manage-booking-details-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './manage-booking-details-modal.html',
  styleUrl: './manage-booking-details-modal.css'
})
export class ManageBookingDetailsModal {
  @Input({ required: true }) booking!: any;
  @Input({ required: true }) bookingBillingSummaryData!: Signal<any>;
  @Input({ required: true }) generatingRecurringInvoiceId!: Signal<number | null>;
  @Output() closeBookingDetails = new EventEmitter<void>();
  @Output() viewBillingChallan = new EventEmitter<any>();
  @Output() generateRecurringInvoice = new EventEmitter<any>();
  @Output() openAdminBookingForm = new EventEmitter<any>();

  /** Booking details: the deposit as stored; 0 with stored months > 0 on a private office (older rows) = months x rent
   *  x (1 - discount %). */
  bookingDetailsDeposit(b: any): number {
    if (!b) return 0;
    const months = Number(b.securityDepositMonths ?? b.SecurityDepositMonths ?? 0);
    const rent = Number(b.monthlyRent ?? b.MonthlyRent ?? b.contract?.monthlyRent ?? 0);
    const pct = Number(b.discountPercentage ?? b.DiscountPercentage ?? 0);
    return storedDeposit(isPrivateRoom(b) || isSharedSpace(b), b.securityDeposit ?? b.SecurityDeposit ?? b.contract?.securityDeposit,
      months, rent, pct);
  }
}
