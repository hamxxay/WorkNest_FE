import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Record Payment popup of the Manage page (Manage.showRecordPaymentModal). Markup moved from manage.html;
 *  the form data (recordPaymentFormData is Manage's own object, edited in place), opening and saving stay in Manage. */
@Component({
  selector: 'app-manage-record-payment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-record-payment-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-record-payment-modal.css']
})
export class ManageRecordPaymentModal {
  @Input({ required: true }) recordPaymentFormData!: any;
  @Input({ required: true }) recordPaymentSaving!: Signal<boolean>;
  /** Manage: showRecordPaymentModal.set(false). */
  @Output() closeRecordPayment = new EventEmitter<void>();
  /** Manage.submitRecordPayment. */
  @Output() submitRecordPayment = new EventEmitter<void>();
}
