import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Space Details popup of the Manage page (Manage.showSpaceModal). Markup moved from manage.html; Manage loads the data. */
@Component({
  selector: 'app-manage-space-details-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './manage-space-details-modal.html',
  styleUrl: './manage-space-details-modal.css'
})
export class ManageSpaceDetailsModal {
  @Input({ required: true }) spaceSummaryLoading!: Signal<boolean>;
  @Input({ required: true }) spaceSummaryError!: Signal<string>;
  @Input({ required: true }) spaceSummary!: Signal<any>;
  @Output() closeSpaceModal = new EventEmitter<void>();
}
