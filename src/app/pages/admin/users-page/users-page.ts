import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/users: the Manage list for entity 'users' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-users-page',
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './users-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage-base/manage-list.css']
})
export class UsersPage extends ManageBase {}
