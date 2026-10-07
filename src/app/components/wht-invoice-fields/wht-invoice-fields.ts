import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WhtRateOption, WhtRateService } from '../../services/wht-rate.service';

/**
 * "Generate Withholding Tax (WHT) invoice" checkbox + WHT rate dropdown, shared by Create Quotation and
 * Create Booking. The dropdown lists dbo.WN_WHTaxRate (Description shown); picking one applies its rate.
 * The rate is cleared when unticked. Same rule as the API validators and the DB CHECK: rate required, 0.01-99.99.
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
  @Input() rate: number | null = null;
  @Output() rateChange = new EventEmitter<number | null>();
  /** Unique prefix so the quotation and booking forms don't share element ids/names. */
  @Input() idPrefix = 'wht';
  /** Set by the parent after a submit attempt, so the message shows only once the user tried to save. */
  @Input() showErrors = false;

  options: WhtRateOption[] = [];
  loaded = false;
  /** Index of the chosen option (descriptions can share a rate, so the rate alone can't identify it). */
  selected: number | null = null;

  constructor(private whtRates: WhtRateService) {}

  ngOnInit(): void {
    this.whtRates.getAll().subscribe(list => {
      this.options = list;
      this.loaded = true;
      this.syncSelection();
    });
  }

  /** '' when valid; otherwise the message to show. */
  static validate(enabled: boolean, rate: number | null | undefined): string {
    if (!enabled) return '';
    if (rate === null || rate === undefined || String(rate).trim() === '') return 'Select a WHT rate.';
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0.01 || value > 99.99) return 'Select a WHT rate between 0.01 and 99.99.';
    return '';
  }

  get error(): string {
    return WhtInvoiceFields.validate(this.enabled, this.rate);
  }

  /** A rate already on the form that is not in the list (e.g. set before the list existed) stays selectable. */
  get legacyRate(): number | null {
    if (this.rate === null || this.rate === undefined) return null;
    return this.options.some(o => Number(o.rate) === Number(this.rate)) ? null : Number(this.rate);
  }

  private syncSelection(): void {
    if (this.selected !== null && this.options[this.selected] && Number(this.options[this.selected].rate) === Number(this.rate)) return;
    const i = this.rate === null || this.rate === undefined ? -1 : this.options.findIndex(o => Number(o.rate) === Number(this.rate));
    this.selected = i >= 0 ? i : null;
  }

  onToggle(checked: boolean): void {
    this.enabled = checked;
    this.enabledChange.emit(checked);
    if (!checked) {
      this.rate = null;
      this.selected = null;
      this.rateChange.emit(null);
    }
  }

  onSelect(value: number | string | null): void {
    if (value === 'legacy') return;   // keep the existing rate
    const i = value === null || value === '' ? -1 : Number(value);
    this.selected = i >= 0 ? i : null;
    this.rate = i >= 0 && this.options[i] ? Number(this.options[i].rate) : null;
    this.rateChange.emit(this.rate);
  }
}
