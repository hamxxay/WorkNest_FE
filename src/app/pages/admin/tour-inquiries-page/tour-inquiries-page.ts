import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageAddInquiryModal } from '../manage-inquiry-modals/manage-add-inquiry-modal';
import { ManageContactTypeModal } from '../manage-inquiry-modals/manage-contact-type-modal';
import { ManageItemBranchModal } from '../manage-inquiry-modals/manage-item-branch-modal';
import { ManageContactFeedbackModal } from '../manage-inquiry-modals/manage-contact-feedback-modal';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/contacts: the Manage list for entity 'contacts' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-tour-inquiries-page',
  imports: [CommonModule, FormsModule, DatePipe, ManageAddInquiryModal, ManageContactTypeModal,
    ManageItemBranchModal, ManageContactFeedbackModal],
  templateUrl: './tour-inquiries-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage-base/manage-list.css']
})
export class TourInquiriesPage extends ManageBase {}
