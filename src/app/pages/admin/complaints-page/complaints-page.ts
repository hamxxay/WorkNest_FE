import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageComplaintModal } from '../manage-complaint-modal/manage-complaint-modal';
import { ManageItemBranchModal } from '../manage-inquiry-modals/manage-item-branch-modal';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/complaints: the Manage list for entity 'complaints' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-complaints-page',
  imports: [CommonModule, FormsModule, DatePipe, ManageComplaintModal, ManageItemBranchModal],
  templateUrl: './complaints-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage-base/manage-list.css']
})
export class ComplaintsPage extends ManageBase {}
