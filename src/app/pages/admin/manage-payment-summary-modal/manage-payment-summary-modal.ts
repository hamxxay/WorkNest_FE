import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Payment Summary popup of the Manage page (Manage.showPaymentModal). Markup moved from manage.html; Manage loads the data. */
@Component({
  selector: 'app-manage-payment-summary-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './manage-payment-summary-modal.html',
  styleUrl: './manage-payment-summary-modal.css'
})
export class ManagePaymentSummaryModal {
  @Input({ required: true }) paymentSummaryLoading!: Signal<boolean>;
  @Input({ required: true }) paymentSummaryError!: Signal<string>;
  @Input({ required: true }) paymentSummary!: Signal<any>;
  @Input({ required: true }) amountLabels!: Record<string, string>;
  @Output() closePaymentModal = new EventEmitter<void>();
}
