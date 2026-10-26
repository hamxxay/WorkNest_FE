import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Create Customer popup of the Manage page (Manage.showQuickCreateCustomer), opened over the booking / quotation
 *  form. Markup moved from manage.html; the form (quickCustomerForm is Manage's own object, edited in place),
 *  the inquiry prefill, the discard-confirm close, saving and the auto-select into the form that opened it stay
 *  in Manage. */
@Component({
  selector: 'app-manage-quick-customer-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-quick-customer-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-quick-customer-modal.css']
})
export class ManageQuickCustomerModal {
  @Input({ required: true }) quickCustomerError!: Signal<string>;
  @Input({ required: true }) quickCustomerForm!: any;
  @Input({ required: true }) countryCodeOptions!: { v: string; l: string }[];
  @Input({ required: true }) cityOptions!: Signal<{ v: any; l: string }[]>;
  @Input({ required: true }) quickCustomerSaving!: Signal<boolean>;
  /** Manage.requestCloseQuickCreateCustomer. */
  @Output() requestCloseQuickCreateCustomer = new EventEmitter<void>();
  /** Manage.submitQuickCreateCustomer. */
  @Output() submitQuickCreateCustomer = new EventEmitter<void>();
  /** Manage.onQuickPhoneInput. */
  @Output() onQuickPhoneInput = new EventEmitter<any>();
}
