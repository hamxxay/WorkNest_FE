import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageAgreementSendModal } from '../manage-agreement-send-modal/manage-agreement-send-modal';
import { ManageAgreementSignModal } from '../manage-agreement-sign-modal/manage-agreement-sign-modal';
import { ManageAgreementDetailsModal } from '../manage-agreement-details-modal/manage-agreement-details-modal';
import { ManageInitialInvoicePreviewModal } from '../manage-invoice-send-modals/manage-initial-invoice-preview-modal';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/agreements: the Manage list for entity 'agreements' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-agreements-page',
  imports: [CommonModule, FormsModule, DatePipe, ManageAgreementSendModal, ManageAgreementSignModal,
    ManageAgreementDetailsModal, ManageInitialInvoicePreviewModal],
  templateUrl: './agreements-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage-base/manage-list.css']
})
export class AgreementsPage extends ManageBase {}
