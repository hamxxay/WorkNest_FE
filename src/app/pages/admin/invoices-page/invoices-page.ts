import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageBookingDetailsModal } from '../manage-booking-details-modal/manage-booking-details-modal';
import { ManageInvoiceDetailsModal } from '../manage-invoice-details-modal/manage-invoice-details-modal';
import { ManageRecordPaymentModal } from '../manage-record-payment-modal/manage-record-payment-modal';
import { ManageRevertApprovalModal } from '../manage-revert-approval-modal/manage-revert-approval-modal';
import { ManageEditIssueDateModal } from '../manage-edit-issue-date-modal/manage-edit-issue-date-modal';
import { ManageInitialInvoicePreviewModal } from '../manage-invoice-send-modals/manage-initial-invoice-preview-modal';
import { ManageCustomInvoiceModal } from '../manage-invoice-send-modals/manage-custom-invoice-modal';
import { ManageQuickCustomerModal } from '../manage-quick-customer-modal/manage-quick-customer-modal';
import { ManageBookingChallanModal } from '../manage-booking-challan-modal/manage-booking-challan-modal';
import { ManageBookingFormModal } from '../manage-booking-form-modal/manage-booking-form-modal';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/invoices: the Manage list for entity 'invoices' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-invoices-page',
  imports: [CommonModule, FormsModule, DatePipe, ManageBookingDetailsModal, ManageInvoiceDetailsModal,
    ManageRecordPaymentModal, ManageRevertApprovalModal, ManageEditIssueDateModal, ManageInitialInvoicePreviewModal, ManageCustomInvoiceModal,
    ManageQuickCustomerModal, ManageBookingChallanModal, ManageBookingFormModal],
  templateUrl: './invoices-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage-base/manage-list.css']
})
export class InvoicesPage extends ManageBase {}
