import { Component, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { BookingService } from '../../services/booking.service';
import { PaymentService } from '../../services/payment.service';
import { CardPaymentService } from '../../services/card-payment.service';

type PaymentTab = 'card' | 'bank' | 'wallet';

@Component({
  selector: 'app-checkout',
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './checkout.html',
  styleUrl: './checkout.css'
})
export class Checkout implements OnInit {
  booking    = signal<any | null>(null);
  loading    = signal(true);
  submitting = signal(false);
  error      = signal('');

  activeTab = signal<PaymentTab>('card');

  // ── Bank / Wallet ──────────────────────────────────────────
  readonly bankDetails = {
    bankName:      'Meezan Bank',
    accountTitle:  'WorkNest Pvt Ltd',
    accountNumber: '0123456789012345',
    iban:          'PK36MEZN0001234567890123',
    branch:        'I-8 Markaz, Islamabad',
  };

  readonly walletMethods = [
    { value: 'EasyPaisa', label: 'EasyPaisa', number: '0300-0000000' },
    { value: 'JazzCash',  label: 'JazzCash',  number: '0300-1111111' },
  ];

  selectedWallet  = 'EasyPaisa';
  transactionRef  = '';

  // ── Card ───────────────────────────────────────────────────
  // These fields live only in memory for the duration of the
  // form. They are never written to localStorage, sessionStorage,
  // or any log. They are cleared immediately after submission.
  cardHolderName  = '';
  cardNumber      = '';       // display value with spaces
  expiryMonth     = '';
  expiryYear      = '';
  cvv             = '';
  showCvv         = false;

  // Derived display helpers
  cardNumberDisplay = computed(() => this.cardNumber || '•••• •••• •••• ••••');
  cardHolderDisplay = computed(() => this.cardHolderName.toUpperCase() || 'FULL NAME');
  expiryDisplay     = computed(() => {
    const m = this.expiryMonth.padStart(2, '0');
    const y = this.expiryYear || 'YY';
    return m ? `${m}/${y}` : 'MM/YY';
  });
  cardBrand = computed(() => {
    const n = this.cardNumber.replace(/\s/g, '');
    if (/^4/.test(n))          return 'visa';
    if (/^5[1-5]/.test(n))     return 'mastercard';
    if (/^3[47]/.test(n))      return 'amex';
    return 'generic';
  });

  constructor(
    private route:          ActivatedRoute,
    private router:         Router,
    private bookingService: BookingService,
    private paymentService: PaymentService,
    private cardService:    CardPaymentService,
  ) {}

  ngOnInit() {
    // Booking is already validated by checkoutGuard — just load details
    const id = Number(this.route.snapshot.paramMap.get('bookingId'));
    this.bookingService.getById(id).subscribe({
      next: (res: any) => {
        this.booking.set(res?.data ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Failed to load booking details.');
      }
    });
  }

  // ── Card number formatting ─────────────────────────────────
  onCardNumberInput(event: Event) {
    const input = event.target as HTMLInputElement;
    // Keep only digits, group into blocks of 4
    const digits = input.value.replace(/\D/g, '').slice(0, 16);
    this.cardNumber = digits.replace(/(.{4})/g, '$1 ').trim();
    input.value = this.cardNumber;
  }

  onExpiryInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    this.expiryMonth = digits.slice(0, 2);
    this.expiryYear  = digits.slice(2, 4);
    input.value = digits.length > 2 ? `${this.expiryMonth}/${this.expiryYear}` : this.expiryMonth;
  }

  onCvvInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.cvv = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = this.cvv;
  }

  get walletNumber(): string {
    return this.walletMethods.find(w => w.value === this.selectedWallet)?.number ?? '';
  }

  // ── Validation ─────────────────────────────────────────────
  private validateCard(): string | null {
    if (!this.cardHolderName.trim())          return 'Card holder name is required.';
    const digits = this.cardNumber.replace(/\s/g, '');
    if (digits.length < 13 || digits.length > 19) return 'Enter a valid card number.';
    if (!this.luhnCheck(digits))              return 'Card number is invalid.';
    const month = Number(this.expiryMonth);
    const year  = Number('20' + this.expiryYear);
    if (!this.expiryMonth || !this.expiryYear || month < 1 || month > 12)
                                              return 'Enter a valid expiry date.';
    const now = new Date();
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
                                              return 'This card has expired.';
    if (this.cvv.length < 3)                  return 'Enter a valid CVV.';
    return null;
  }

  // Luhn algorithm — catches most mistyped card numbers client-side
  // (real validation still happens server-side / at the bank)
  private luhnCheck(num: string): boolean {
    let sum = 0;
    let alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let n = parseInt(num[i], 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  // ── Submission ─────────────────────────────────────────────
  submitCard() {
    const validationError = this.validateCard();
    if (validationError) { this.error.set(validationError); return; }

    const b = this.booking();
    if (!b) return;

    this.submitting.set(true);
    this.error.set('');

    // Idempotency key: unique per payment attempt.
    // If the request is retried (network drop), the backend
    // returns the same result without charging twice.
    const idempotencyKey = `${b.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    this.cardService.initiateCardPayment({
      bookingId:      b.id,
      cardHolderName: this.cardHolderName.trim(),
      cardNumber:     this.cardNumber.replace(/\s/g, ''),
      expiryMonth:    this.expiryMonth,
      expiryYear:     this.expiryYear,
      cvv:            this.cvv,
      idempotencyKey,
    }).subscribe({
      next: (res) => {
        this.clearCardFields();
        this.submitting.set(false);

        // BANK SWAP POINT: if bank returns a 3DS redirect URL,
        // navigate the user there. The bank will redirect back
        // to /payment-result?status=...&bookingId=...
        if (res.redirectUrl) {
          window.location.href = res.redirectUrl;
          return;
        }

        this.router.navigate(['/payment-result'], {
          queryParams: {
            status:    res.isSuccessful ? 'success' : 'failed',
            bookingId: b.id,
            amount:    b.totalAmount,
            ref:       res.transactionRef ?? '',
            method:    'Card',
          }
        });
      },
      error: (err: any) => {
        this.clearCardFields();
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'Card payment failed. Please try again.');
      }
    });
  }

  submitManual() {
    if (!this.transactionRef.trim()) {
      this.error.set('Please enter your transaction reference number.');
      return;
    }
    const b = this.booking();
    if (!b) return;

    this.submitting.set(true);
    this.error.set('');

    this.paymentService.createPayment({
      bookingId:     b.id,
      amount:        b.totalAmount,
      paymentMethod: this.activeTab() === 'wallet' ? this.selectedWallet : 'BankTransfer',
      transactionRef: this.transactionRef.trim(),
    }).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.router.navigate(['/payment-result'], {
          queryParams: {
            status:    res?.isSuccessful ? 'success' : 'failed',
            bookingId: b.id,
            amount:    b.totalAmount,
            ref:       this.transactionRef.trim(),
            method:    this.activeTab() === 'wallet' ? this.selectedWallet : 'BankTransfer',
          }
        });
      },
      error: (err: any) => {
        this.submitting.set(false);
        this.router.navigate(['/payment-result'], {
          queryParams: {
            status:    'failed',
            bookingId: b.id,
            message:   err?.error?.message || 'Payment submission failed.',
          }
        });
      }
    });
  }

  // Wipe card data from memory immediately after use —
  // never let it linger in component state
  private clearCardFields() {
    this.cardHolderName = '';
    this.cardNumber     = '';
    this.expiryMonth    = '';
    this.expiryYear     = '';
    this.cvv            = '';
    this.showCvv        = false;
  }
}
