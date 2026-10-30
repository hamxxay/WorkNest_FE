import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Invoice Details popup of the Manage page (Manage.showInvoiceDetailsModal). Markup moved from manage.html; the
 *  actions (send email, PDF, revert approval, record payment) stay in Manage. */
@Component({
  selector: 'app-manage-invoice-details-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './manage-invoice-details-modal.html',
  styleUrl: './manage-invoice-details-modal.css'
})
export class ManageInvoiceDetailsModal {
  @Input({ required: true }) inv!: any;
  /** Manage.getCellValue(inv, { key: 'spaceName', label: 'Space' }). */
  @Input() spaceCellValue: any;
  /** Manage.canRevertInvoiceApproval(inv). */
  @Input() canRevertInvoiceApproval = false;
  /** Manage.canEditInvoiceIssueDate(inv). */
  @Input() canEditIssueDate = false;
  @Input({ required: true }) sendingInvoiceEmailId!: Signal<number | null>;
  @Output() closeInvoiceDetails = new EventEmitter<void>();
  @Output() sendInvoiceEmail = new EventEmitter<any>();
  @Output() downloadStatementPdf = new EventEmitter<any>();
  @Output() openRevertApproval = new EventEmitter<any>();
  @Output() openEditIssueDate = new EventEmitter<any>();
  @Output() openRecordPaymentModal = new EventEmitter<any>();
}
