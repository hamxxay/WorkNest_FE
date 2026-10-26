import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/** User Details popup of the Manage page (Manage.showUserModal). Markup moved from manage.html; Manage loads the data. */
@Component({
  selector: 'app-manage-user-details-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './manage-user-details-modal.html',
  styleUrl: './manage-user-details-modal.css'
})
export class ManageUserDetailsModal {
  @Input({ required: true }) userDetailsLoading!: Signal<boolean>;
  @Input({ required: true }) userDetailsError!: Signal<string>;
  @Input({ required: true }) selectedUser!: Signal<any>;
  @Input({ required: true }) userDisplayName!: Signal<string>;
  @Input({ required: true }) userHistory!: Signal<any>;
  @Input({ required: true }) amountLabels!: Record<string, string>;
  @Output() closeUserModal = new EventEmitter<void>();
}
