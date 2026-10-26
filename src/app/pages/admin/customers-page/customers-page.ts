import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/customers: the Manage list for entity 'customers' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-customers-page',
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './customers-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage/manage.css']
})
export class CustomersPage extends ManageBase {}
