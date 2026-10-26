import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManagePaymentSummaryModal } from '../manage-payment-summary-modal/manage-payment-summary-modal';
import { ManageInitialInvoicePreviewModal } from '../manage-invoice-send-modals/manage-initial-invoice-preview-modal';
import { ManageBookingChallanModal } from '../manage-booking-challan-modal/manage-booking-challan-modal';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/payments: the Manage list for entity 'payments' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-payments-page',
  imports: [CommonModule, FormsModule, DatePipe, ManagePaymentSummaryModal, ManageInitialInvoicePreviewModal,
    ManageBookingChallanModal],
  templateUrl: './payments-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage-base/manage-list.css']
})
export class PaymentsPage extends ManageBase {}
