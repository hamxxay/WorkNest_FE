import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * "Generate Withholding Tax (WHT) invoice" checkbox + "WHT Rate (%)" field, shared by Create Quotation and
 * Create Booking. The rate box only shows when ticked and is cleared when unticked. Same rule as the API
 * validators and the DB CHECK: rate required, 0.01-99.99.
 */
@Component({
  selector: 'app-wht-invoice-fields',
  imports: [FormsModule],
  templateUrl: './wht-invoice-fields.html',
  styleUrl: './wht-invoice-fields.css'
})
export class WhtInvoiceFields {
  @Input() enabled = false;
  @Output() enabledChange = new EventEmitter<boolean>();
  @Input() rate: number | null = null;
  @Output() rateChange = new EventEmitter<number | null>();
  /** Unique prefix so the quotation and booking forms don't share element ids/names. */
  @Input() idPrefix = 'wht';
  /** Set by the parent after a submit attempt, so the message shows only once the user tried to save. */
  @Input() showErrors = false;

  /** '' when valid; otherwise the message to show. */
  static validate(enabled: boolean, rate: number | null | undefined): string {
    if (!enabled) return '';
    if (rate === null || rate === undefined || String(rate).trim() === '') return 'WHT rate is required.';
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0.01 || value > 99.99) return 'Enter a WHT rate between 0.01 and 99.99.';
    return '';
  }

  get error(): string {
    return WhtInvoiceFields.validate(this.enabled, this.rate);
  }

  onToggle(checked: boolean): void {
    this.enabled = checked;
    this.enabledChange.emit(checked);
    if (!checked) {
      this.rate = null;
      this.rateChange.emit(null);
    }
  }

  onRate(value: number | string | null): void {
    this.rate = value === '' || value === null ? null : Number(value);
    this.rateChange.emit(this.rate);
  }
}
