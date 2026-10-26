import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/locations: the Manage list for entity 'locations' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-locations-page',
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './locations-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage-base/manage-list.css']
})
export class LocationsPage extends ManageBase {}
