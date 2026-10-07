import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WhtRateOption, WhtRateService } from '../../services/wht-rate.service';

/**
 * "Generate Withholding Tax (WHT) invoice" checkbox + WHT rate dropdown, shared by Create Quotation and
 * Create Booking. The dropdown lists dbo.WN_WHTaxRate (Description + rate). The value bound to [(rate)] is the
 * chosen row's Id (what WN_Bookings.WHTRate / WN_Quotations.WithholdingTaxRate store); the invoice looks the
 * percentage up from WN_WHTaxRate. It is cleared when unticked.
 */
@Component({
  selector: 'app-wht-invoice-fields',
  imports: [FormsModule],
  templateUrl: './wht-invoice-fields.html',
  styleUrl: './wht-invoice-fields.css'
})
export class WhtInvoiceFields implements OnInit {
  @Input() enabled = false;
  @Output() enabledChange = new EventEmitter<boolean>();
  /** The WN_WHTaxRate Id (older records may still hold a percentage, shown as "Current rate"). */
  @Input() rate: number | null = null;
  @Output() rateChange = new EventEmitter<number | null>();
  /** Unique prefix so the quotation and booking forms don't share element ids/names. */
  @Input() idPrefix = 'wht';
  /** Set by the parent after a submit attempt, so the message shows only once the user tried to save. */
  @Input() showErrors = false;

  options: WhtRateOption[] = [];
  loaded = false;
  /** Ids the API accepts (active WN_WHTaxRate rows); empty until the list has loaded. */
  private static validIds: number[] = [];

  constructor(private whtRates: WhtRateService) {}

  ngOnInit(): void {
    this.whtRates.getAll().subscribe(list => {
      this.options = list.filter(o => o.id !== null);
      WhtInvoiceFields.validIds = this.options.map(o => Number(o.id));
      this.loaded = true;
    });
  }

  /** '' when valid; otherwise the message to show. */
  static validate(enabled: boolean, rateId: number | null | undefined): string {
    if (!enabled) return '';
    if (rateId === null || rateId === undefined || String(rateId).trim() === '') return 'Select a WHT rate.';
    if (WhtInvoiceFields.validIds.length && !WhtInvoiceFields.validIds.includes(Number(rateId)))
      return 'Select a WHT rate from the list.';
    return '';
  }

  get error(): string {
    return WhtInvoiceFields.validate(this.enabled, this.rate);
  }

  /** The chosen option, when the bound value is one of the listed Ids. */
  get selectedOption(): WhtRateOption | null {
    return this.options.find(o => Number(o.id) === Number(this.rate)) ?? null;
  }

  /** A value already on the form that is not a listed Id (an older record that stored the percentage). */
  get legacyRate(): number | null {
    if (this.rate === null || this.rate === undefined || !this.loaded) return null;
    return this.selectedOption ? null : Number(this.rate);
  }

  onToggle(checked: boolean): void {
    this.enabled = checked;
    this.enabledChange.emit(checked);
    if (!checked) {
      this.rate = null;
      this.rateChange.emit(null);
    }
  }

  onSelect(value: number | string | null): void {
    if (value === 'legacy') return;
    this.rate = value === null || value === '' ? null : Number(value);
    this.rateChange.emit(this.rate);
  }
}
