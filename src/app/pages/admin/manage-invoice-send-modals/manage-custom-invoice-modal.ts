import { Component, EventEmitter, Input, Output, Signal, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Next invoice / Review & send invoice popup of the Manage page (Manage.showCreateCustomInvoiceModal). Markup
 *  moved from manage.html; the form data and lines (Manage's own object and array, edited in place), the
 *  totals, the line / period actions, the discard-confirm close and submitting stay in Manage. */
@Component({
  selector: 'app-manage-custom-invoice-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-custom-invoice-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-custom-invoice-modal.css']
})
export class ManageCustomInvoiceModal {
  @Input() customInvoiceIsNextInvoice = false;
  @Input({ required: true }) customInvoiceFormData!: any;
  @Input({ required: true }) customInvoiceUsers!: Signal<any[]>;
  /** Manage.customInvoiceSelectedMonths, two-way. */
  readonly customInvoiceSelectedMonths = model<number>(3);
  @Input({ required: true }) customInvoiceMonthOptions!: { v: number; l: string }[];
  @Input({ required: true }) customInvoiceLines!: Array<{ description: string; quantity: number; unitPrice: number; discountAmount: number; taxRate: number }>;
  /** Manage.customInvoiceSubtotal / customInvoiceTaxTotal / customInvoiceGrandTotal (getters, read by Manage's bindings). */
  @Input({ required: true }) customInvoiceSubtotal!: number;
  @Input({ required: true }) customInvoiceTaxTotal!: number;
  @Input({ required: true }) customInvoiceGrandTotal!: number;
  @Input({ required: true }) submittingCustomInvoice!: Signal<boolean>;
  /** Manage.closeCreateCustomInvoiceModal. */
  @Output() closeCreateCustomInvoiceModal = new EventEmitter<void>();
  /** Manage.onCustomInvoiceMonthsChange. */
  @Output() onCustomInvoiceMonthsChange = new EventEmitter<void>();
  /** Manage.addCustomInvoiceLine. */
  @Output() addCustomInvoiceLine = new EventEmitter<void>();
  /** Manage.removeCustomInvoiceLine. */
  @Output() removeCustomInvoiceLine = new EventEmitter<number>();
  /** Manage.submitCustomInvoice. */
  @Output() submitCustomInvoice = new EventEmitter<boolean>();
}
