import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageSpaceDetailsModal } from '../manage-space-details-modal/manage-space-details-modal';
import { ManagePaymentSummaryModal } from '../manage-payment-summary-modal/manage-payment-summary-modal';
import { ManageUserDetailsModal } from '../manage-user-details-modal/manage-user-details-modal';
import { ManageBookingDetailsModal } from '../manage-booking-details-modal/manage-booking-details-modal';
import { ManageInvoiceDetailsModal } from '../manage-invoice-details-modal/manage-invoice-details-modal';
import { ManageComplaintModal } from '../manage-complaint-modal/manage-complaint-modal';
import { ManageRecordPaymentModal } from '../manage-record-payment-modal/manage-record-payment-modal';
import { ManageRevertApprovalModal } from '../manage-revert-approval-modal/manage-revert-approval-modal';
import { ManageReassignBookingModal } from '../manage-reassign-booking-modal/manage-reassign-booking-modal';
import { ManageAddInquiryModal } from '../manage-inquiry-modals/manage-add-inquiry-modal';
import { ManageContactTypeModal } from '../manage-inquiry-modals/manage-contact-type-modal';
import { ManageItemBranchModal } from '../manage-inquiry-modals/manage-item-branch-modal';
import { ManageContactFeedbackModal } from '../manage-inquiry-modals/manage-contact-feedback-modal';
import { ManageAgreementSendModal } from '../manage-agreement-send-modal/manage-agreement-send-modal';
import { ManageAgreementSignModal } from '../manage-agreement-sign-modal/manage-agreement-sign-modal';
import { ManageAgreementDetailsModal } from '../manage-agreement-details-modal/manage-agreement-details-modal';
import { ManageInitialInvoicePreviewModal } from '../manage-invoice-send-modals/manage-initial-invoice-preview-modal';
import { ManageCustomInvoiceModal } from '../manage-invoice-send-modals/manage-custom-invoice-modal';
import { ManageQuotationConversionModal } from '../manage-quotation-conversion-modal/manage-quotation-conversion-modal';
import { ManageQuickCustomerModal } from '../manage-quick-customer-modal/manage-quick-customer-modal';
import { ManageQuotationPreviewModal } from '../manage-quotation-preview-modal/manage-quotation-preview-modal';
import { ManageBookingChallanModal } from '../manage-booking-challan-modal/manage-booking-challan-modal';
import { ManageQuotationFormModal } from '../manage-quotation-form-modal/manage-quotation-form-modal';
import { ManageBookingFormModal } from '../manage-booking-form-modal/manage-booking-form-modal';
import { ManageBase } from '../manage-base/manage-base';

@Component({
  selector: 'app-manage',
  imports: [CommonModule, FormsModule, DatePipe, ManageSpaceDetailsModal, ManagePaymentSummaryModal,
    ManageUserDetailsModal, ManageBookingDetailsModal, ManageInvoiceDetailsModal, ManageComplaintModal,
    ManageRecordPaymentModal, ManageRevertApprovalModal, ManageReassignBookingModal, ManageAddInquiryModal,
    ManageContactTypeModal, ManageItemBranchModal, ManageContactFeedbackModal, ManageAgreementSendModal,
    ManageAgreementSignModal, ManageAgreementDetailsModal, ManageInitialInvoicePreviewModal, ManageCustomInvoiceModal,
    ManageQuotationConversionModal, ManageQuickCustomerModal, ManageQuotationPreviewModal, ManageBookingChallanModal,
    ManageQuotationFormModal, ManageBookingFormModal],
  templateUrl: './manage.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', './manage.css']
})
export class Manage extends ManageBase {}
