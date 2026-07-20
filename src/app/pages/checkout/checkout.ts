import { Component, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { BookingService } from '../../services/booking.service';
import { CardPaymentService } from '../../services/card-payment.service';
import { OneBillService, OneBillVoucherResponse } from '../../services/one-bill.service';
import { PayFastService } from '../../services/payfast.service';
import { AuthService } from '../../services/auth.service';

type PaymentTab = 'card' | 'voucher' | 'counter' | 'payfast';

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

  // ── Card ───────────────────────────────────────────────────
  cardHolderName = '';
  cardNumber     = '';
  expiryMonth    = '';
  expiryYear     = '';
  cvv            = '';
  showCvv        = false;

  cardNumberDisplay = computed(() => this.cardNumber || '•••• •••• •••• ••••');
  cardHolderDisplay = computed(() => this.cardHolderName.toUpperCase() || 'FULL NAME');
  expiryDisplay     = computed(() => {
    const m = this.expiryMonth.padStart(2, '0');
    return m ? `${m}/${this.expiryYear || 'YY'}` : 'MM/YY';
  });
  cardBrand = computed(() => {
    const n = this.cardNumber.replace(/\s/g, '');
    if (/^4/.test(n))      return 'visa';
    if (/^5[1-5]/.test(n)) return 'mastercard';
    if (/^3[47]/.test(n))  return 'amex';
    return 'generic';
  });

  // ── 1Bill Voucher ──────────────────────────────────────────
  voucher = signal<OneBillVoucherResponse | null>(null);

  // Default channels shown before the real API responds
  readonly defaultChannels = [
    'Any bank branch (over the counter)',
    'ATM (Bill Payment)',
    'Internet Banking',
    'EasyPaisa / JazzCash',
    'HBL Mobile / MCB Mobile',
  ];

  constructor(
    private route:          ActivatedRoute,
    private router:         Router,
    private bookingService: BookingService,
    private cardService:    CardPaymentService,
    private oneBillService: OneBillService,
    private payfastService: PayFastService,
    private authService:    AuthService,
  ) {}

  ngOnInit() {
    const navState = this.router.getCurrentNavigation()?.extras?.state ?? history.state;
    if (navState?.pendingBooking) {
      this.pending.set(navState.pendingBooking);
      this.loading.set(false);
    } else {
      this.loading.set(false);
      this.error.set('No booking details found. Please start from the booking page.');
    }
  }

  pending = signal<any>(null);

  // ── Breakdown helpers ───────────────────────────────────────
  isPrivateBooking = computed(() => this.pending()?.spaceCategory === 'Private');

  durationLabel = computed(() => {
    const p = this.pending();
    if (!p) return '';
    const start = new Date(p.startDateTime);
    const end   = new Date(p.endDateTime);
    if (this.isPrivateBooking()) {
      const months = (p.months ?? Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30))) || 1;
      return `${months} month${months !== 1 ? 's' : ''}`;
    }
    const hours = Math.ceil((end.getTime() - start.getTime()) / 3_600_000);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  });

  monthlyRent = computed(() => {
    const p = this.pending();
    if (!p) return 0;
    const months = (p.months ?? Math.round(
      (new Date(p.endDateTime).getTime() - new Date(p.startDateTime).getTime()) / (1000 * 60 * 60 * 24 * 30)
    )) || 1;
    return (p.rentAmount ?? p.totalAmount ?? 0) / months;
  });

  baseAmount    = computed(() => { const p = this.pending(); return p ? (p.baseAmount ?? p.totalAmount ?? 0) : 0; });
  discountAmount = computed(() => { const p = this.pending(); return p ? (p.discountAmount ?? 0) : 0; });

  // ── Create booking then act on payment method ───────────────────
  private createBookingWith(paymentMethod: string, onSuccess: (bookingId: number, assignedSpace?: any) => void) {
    if (!this.pending()) return;
    this.submitting.set(true);
    this.error.set('');

    // Use different payload based on whether it's auto-assignment or specific space booking
    const p = this.pending();
    const bookingData = p.autoAssign ? {
      spaceType: p.spaceType,
      startDateTime: p.startDateTime,
      endDateTime: p.endDateTime,
      totalAmount: parseFloat(Number(p.totalAmount).toFixed(2)),
      notes: p.notes || paymentMethod
    } : p.smartBooking ? {
      spaceCategory: p.spaceCategory,
      startDateTime: p.startDateTime,
      endDateTime: p.endDateTime,
      totalAmount: parseFloat(Number(p.totalAmount).toFixed(2)),
      capacity: p.capacity ?? undefined,
      notes: p.notes || paymentMethod,
      paymentMethod,
    } : {
      spaceId: p.spaceId,
      startDateTime: p.startDateTime,
      endDateTime: p.endDateTime,
      totalAmount: parseFloat(Number(p.totalAmount).toFixed(2)),
      notes: paymentMethod
    };

    const createCall = p.smartBooking
      ? this.bookingService.createSmart({
          spaceCategory: p.spaceCategory ?? '',
          startDateTime: p.startDateTime,
          endDateTime:   p.endDateTime,
          totalAmount:   parseFloat(Number(p.totalAmount).toFixed(2)),
          capacity:      p.capacity ?? undefined,
          notes:         p.notes || paymentMethod,
          paymentMethod,
          accountId:     p.accountId ?? undefined,
        })
      : this.bookingService.create(bookingData);

    createCall.subscribe({
      next: (res) => {
        if (res.isSuccessful || res.success) {
          const bookingId = res.data?.id ?? (typeof res.data?.bookingId === 'number' ? res.data.bookingId : null) ?? res.id;
          const assignedSpace = res.data?.assignedSpaceName
            ? { name: res.data.assignedSpaceName, code: res.data.assignedSpace ?? '' }
            : res.data?.assignedSpace ?? null;
          this.booking.set({ ...this.pending(), id: bookingId, assignedSpace });
          onSuccess(bookingId, assignedSpace);
        } else {
          this.submitting.set(false);
          this.error.set(res.message || res.error || 'Booking failed.');
        }
      },
      error: (err: any) => {
        this.submitting.set(false);
        const errorMsg = err?.error?.message || err?.error?.error || 'Failed to create booking. Please try again.';
        this.error.set(errorMsg);
      }
    });
  }

  // ── Card input handlers ────────────────────────────────────
  onCardNumberInput(event: Event) {
    const input  = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 16);
    this.cardNumber = digits.replace(/(.{4})/g, '$1 ').trim();
    input.value = this.cardNumber;
  }

  onExpiryInput(event: Event) {
    const input  = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    this.expiryMonth = digits.slice(0, 2);
    this.expiryYear  = digits.slice(2, 4);
    input.value = digits.length > 2 ? `${this.expiryMonth}/${this.expiryYear}` : this.expiryMonth;
  }

  onCvvInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.cvv    = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = this.cvv;
  }

  // ── Card validation ────────────────────────────────────────
  private validateCard(): string | null {
    if (!this.cardHolderName.trim()) return 'Card holder name is required.';
    const digits = this.cardNumber.replace(/\s/g, '');
    if (digits.length < 13 || digits.length > 19) return 'Enter a valid card number.';
    if (!this.luhnCheck(digits))                  return 'Card number is invalid.';
    const month = Number(this.expiryMonth);
    const year  = Number('20' + this.expiryYear);
    if (!this.expiryMonth || !this.expiryYear || month < 1 || month > 12)
      return 'Enter a valid expiry date.';
    const now = new Date();
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1))
      return 'This card has expired.';
    if (this.cvv.length < 3) return 'Enter a valid CVV.';
    return null;
  }

  private luhnCheck(num: string): boolean {
    let sum = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let n = parseInt(num[i], 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  // ── Card submit ────────────────────────────────────────────
  submitCard() {
    const err = this.validateCard();
    if (err) { this.error.set(err); return; }

    this.createBookingWith('Card', (bookingId, assignedSpace) => {
      const idempotencyKey = `${bookingId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.cardService.initiateCardPayment({
        bookingId,
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
          if (res.redirectUrl) { window.location.href = res.redirectUrl; return; }
          this.router.navigate(['/payment-result'], {
            queryParams: {
              status:    res.isSuccessful ? 'success' : 'failed',
              bookingId,
              amount:    this.pending()?.totalAmount,
              ref:       res.transactionRef ?? '',
              method:    'Card',
              assignedSpace: assignedSpace ? JSON.stringify(assignedSpace) : ''
            }
          });
        },
        error: (err: any) => {
          this.clearCardFields();
          this.submitting.set(false);
          this.error.set(err?.error?.message || 'Card payment failed. Please try again.');
        }
      });
    });
  }

  private clearCardFields() {
    this.cardHolderName = '';
    this.cardNumber     = '';
    this.expiryMonth    = '';
    this.expiryYear     = '';
    this.cvv            = '';
    this.showCvv        = false;
  }

  // ── 1Bill voucher ──────────────────────────────────────────
  generateVoucher() {
    if (this.voucher()) return;
    this.createBookingWith('Voucher', (bookingId, assignedSpace) => {
      const idempotencyKey = `vchr-${bookingId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.oneBillService.generateVoucher({
        bookingId,
        amount: this.pending()?.totalAmount,
        idempotencyKey,
      }).subscribe({
        next: (res) => {
          this.submitting.set(false);
          if (res.isSuccessful) {
            this.voucher.set(res);
            // Store assigned space info for later display
            if (assignedSpace) {
              this.voucher.update(v => ({ ...v!, assignedSpace }));
            }
          } else {
            this.error.set(res.message || 'Failed to generate voucher.');
          }
        },
        error: (err: any) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message || 'Failed to generate voucher. Please try again.');
        }
      });
    });
  }

  copyVoucherNumber() {
    const v = this.voucher();
    if (!v?.voucherNumber) return;
    navigator.clipboard.writeText(v.voucherNumber).catch(() => {});
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  copied = signal(false);
  counterDone = signal(false);

  printVoucher() {
    window.print();
  }

  // ── Pay at Counter ─────────────────────────────────────────
  submitCounter() {
    this.createBookingWith('Payment via Cash on Counter', (bookingId, assignedSpace) => {
      this.submitting.set(false);
      this.counterDone.set(true);
      // Store assigned space for display
      if (assignedSpace) {
        this.booking.update(b => ({ ...b!, assignedSpace }));
      }
    });
  }

  payfastSubmitting = signal(false);

  submitPayFast() {
    if (!this.pending()) return;
    this.payfastSubmitting.set(true);
    this.error.set('');

    const user = this.authService.user();
    this.createBookingWith('PayFast', (bookingId, assignedSpace) => {
      this.payfastService.initiatePayment({
        bookingId,
        customerName:  user?.displayName  || user?.email?.split('@')[0] || 'Customer',
        customerEmail: user?.email        || '',
      }).subscribe({
        next: (res) => {
          this.payfastSubmitting.set(false);
          if (res.isSuccessful && res.data) {
            // Store assigned space info before redirecting
            if (assignedSpace) {
              sessionStorage.setItem(`assignedSpace_${bookingId}`, JSON.stringify(assignedSpace));
            }
            this.payfastService.redirectToPayFast(res.data);
          } else {
            this.error.set(res.message || 'PayFast initiation failed.');
          }
        },
        error: (err: any) => {
          this.payfastSubmitting.set(false);
          this.error.set(err?.error?.detail || 'PayFast initiation failed. Please try again.');
        }
      });
    });
  }

  get voucherChannels(): string[] {
    return this.voucher()?.paymentChannels?.length
      ? this.voucher()!.paymentChannels!
      : this.defaultChannels;
  }
}
