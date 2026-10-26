import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageSpaceDetailsModal } from '../manage-space-details-modal/manage-space-details-modal';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/spaces: the Manage list for entity 'spaces' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-spaces-page',
  imports: [CommonModule, FormsModule, DatePipe, ManageSpaceDetailsModal],
  templateUrl: './spaces-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage/manage.css']
})
export class SpacesPage extends ManageBase {}
