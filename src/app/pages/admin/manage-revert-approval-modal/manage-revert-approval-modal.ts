import { Component, EventEmitter, Input, Output, Signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Revert Invoice Approval popup of the Manage page (Manage.revertApprovalInvoice). Markup moved from manage.html;
 *  the state signals, opening, closing and the revert itself (incl. refreshing the open Invoice Details) stay in Manage. */
@Component({
  selector: 'app-manage-revert-approval-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-revert-approval-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-revert-approval-modal.css']
})
export class ManageRevertApprovalModal {
  /** The invoice being reverted (Manage.revertApprovalInvoice()). */
  @Input({ required: true }) rinv!: any;
  /** Manage.getCellValue (through Manage.getCellValueFn). */
  @Input({ required: true }) getCellValue!: (item: any, col: { key: string; label: string }) => any;
  @Input({ required: true }) revertApprovalReason!: WritableSignal<string>;
  @Input({ required: true }) revertApprovalSaving!: Signal<boolean>;
  @Input({ required: true }) revertApprovalError!: Signal<string>;
  /** Manage.closeRevertApproval. */
  @Output() closeRevertApproval = new EventEmitter<void>();
  /** Manage.submitRevertApproval. */
  @Output() submitRevertApproval = new EventEmitter<void>();
}
