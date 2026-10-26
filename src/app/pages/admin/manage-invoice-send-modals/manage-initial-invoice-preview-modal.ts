import { Component, EventEmitter, Input, Output, Signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WhtRateOption } from '../../../services/wht-rate.service';

/** Initial payment invoice preview popup of the Manage page (Manage.showInitialInvoicePreviewModal). Markup moved
 *  from manage.html; the preview state signals, the WHT choice, reloading the server preview and sending stay
 *  in Manage. */
@Component({
  selector: 'app-manage-initial-invoice-preview-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-initial-invoice-preview-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-initial-invoice-preview-modal.css']
})
export class ManageInitialInvoicePreviewModal {
  /** The booking (Manage.selectedInitialInvoiceItem()). */
  @Input({ required: true }) item!: any;
  @Input({ required: true }) initialInvoicePreview!: Signal<any | null>;
  @Input({ required: true }) initialInvoiceIssuedOn!: Signal<string | null>;
  @Input({ required: true }) initialInvoiceRecipientEmail!: WritableSignal<string>;
  @Input({ required: true }) initialInvoiceType!: Signal<'standard' | 'wht'>;
  @Input({ required: true }) sendingInitialInvoiceId!: Signal<number | null>;
  @Input({ required: true }) initialInvoiceWhTaxId!: Signal<number | null>;
  @Input({ required: true }) initialInvoiceWhtRates!: Signal<WhtRateOption[]>;
  /** Manage.initialInvoiceNeedsWhtRate (through Manage.initialInvoiceNeedsWhtRateFn). */
  @Input({ required: true }) initialInvoiceNeedsWhtRate!: () => boolean;
  @Input({ required: true }) initialInvoicePreviewLoading!: Signal<boolean>;
  @Input({ required: true }) initialInvoicePreviewError!: Signal<string>;
  /** Manage: showInitialInvoicePreviewModal.set(false). */
  @Output() closeInitialInvoicePreview = new EventEmitter<void>();
  /** Manage.onInitialInvoiceTypeChange. */
  @Output() onInitialInvoiceTypeChange = new EventEmitter<'standard' | 'wht'>();
  /** Manage.onInitialInvoiceWhtRateChange. */
  @Output() onInitialInvoiceWhtRateChange = new EventEmitter<number | null>();
  @Output() initialInvoicePreviewLoad = new EventEmitter<{ bookingId: number; issuedOn: string | null }>();
  /** Manage.confirmSendInitialInvoice. */
  @Output() confirmSendInitialInvoice = new EventEmitter<void>();

  /** The template's Try again call, handed to Manage.loadInitialInvoicePreview. */
  loadInitialInvoicePreview(bookingId: number, issuedOn: string | null) { this.initialInvoicePreviewLoad.emit({ bookingId, issuedOn }); }
}
