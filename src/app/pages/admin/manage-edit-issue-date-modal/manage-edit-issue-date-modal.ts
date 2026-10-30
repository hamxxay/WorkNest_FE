import { Component, EventEmitter, Input, Output, Signal, WritableSignal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Edit Invoice Issue Date popup (super_admin only). */
@Component({
  selector: 'app-manage-edit-issue-date-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './manage-edit-issue-date-modal.html',
  styleUrls: ['../../../styles/form-popup.css', './manage-edit-issue-date-modal.css']
})
export class ManageEditIssueDateModal {
  @Input({ required: true }) rinv!: any;
  @Input({ required: true }) getCellValue!: (item: any, col: { key: string; label: string }) => any;
  @Input({ required: true }) editIssueDateValue!: WritableSignal<string>;
  @Input({ required: true }) editIssueDateReason!: WritableSignal<string>;
  @Input({ required: true }) editIssueDateSaving!: Signal<boolean>;
  @Input({ required: true }) editIssueDateError!: Signal<string>;
  @Output() closeEditIssueDate = new EventEmitter<void>();
  @Output() submitEditIssueDate = new EventEmitter<void>();
}

