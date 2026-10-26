import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageAgreementSendModal } from '../manage-agreement-send-modal/manage-agreement-send-modal';
import { ManageInitialInvoicePreviewModal } from '../manage-invoice-send-modals/manage-initial-invoice-preview-modal';
import { ManageQuotationConversionModal } from '../manage-quotation-conversion-modal/manage-quotation-conversion-modal';
import { ManageQuickCustomerModal } from '../manage-quick-customer-modal/manage-quick-customer-modal';
import { ManageQuotationPreviewModal } from '../manage-quotation-preview-modal/manage-quotation-preview-modal';
import { ManageQuotationFormModal } from '../manage-quotation-form-modal/manage-quotation-form-modal';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/quotation-responses: the Manage list for entity 'quotation-responses' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-quotation-responses-page',
  imports: [CommonModule, FormsModule, DatePipe, ManageAgreementSendModal, ManageInitialInvoicePreviewModal,
    ManageQuotationConversionModal, ManageQuickCustomerModal, ManageQuotationPreviewModal, ManageQuotationFormModal],
  templateUrl: './quotation-responses-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage/manage.css']
})
export class QuotationResponsesPage extends ManageBase {}
