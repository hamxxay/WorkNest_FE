// ============================================================
// 1Bill Voucher Service
// ============================================================
// 1Bill (onebill.com.pk) is a Pakistani payment aggregator that
// lets customers pay bills at any bank branch, ATM, mobile app
// (EasyPaisa, JazzCash, HBL, MCB, etc.) using a voucher number.
//
// FLOW:
//   1. Frontend calls generateVoucher() → hits YOUR backend.
//   2. Your backend calls the 1Bill API with merchant credentials
//      and returns a voucher number + expiry to the frontend.
//   3. User pays the voucher at any supported channel.
//   4. 1Bill sends a webhook to your backend confirming payment.
//   5. Your backend marks the booking as Confirmed.
//   Frontend never needs to poll — the webhook handles it.
//
// HOW TO SWAP IN THE REAL 1BILL API:
//   ─────────────────────────────────────────────────────────
//   On YOUR BACKEND (not here):
//   1. Sign up at https://onebill.com.pk and get:
//        - Consumer Number prefix (assigned by 1Bill)
//        - Merchant credentials / API key
//   2. Call 1Bill's bill-generation endpoint:
//        POST https://api.onebill.com.pk/api/generate-bill
//        Headers: { Authorization: 'Bearer <merchant_token>' }
//        Body:    { consumerNumber, amount, dueDate, description }
//   3. 1Bill returns { billNumber, consumerNumber, dueDate, amount }
//   4. Map that to OneBillVoucherResponse and return it to the FE.
//   5. Register a webhook URL with 1Bill for payment confirmation.
//        POST https://api.onebill.com.pk/api/register-webhook
//        Body: { url: 'https://yourbackend.com/webhooks/1bill' }
//   6. In your webhook handler, verify the HMAC signature 1Bill
//      sends in the X-1Bill-Signature header before trusting it.
//
//   On THIS FILE:
//   - Change NOTHING. The endpoint already points to your backend.
//   - If 1Bill adds new fields to the response, extend the
//     OneBillVoucherResponse interface below.
//   ─────────────────────────────────────────────────────────
// ============================================================

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface OneBillVoucherRequest {
  bookingId:     number;
  amount:        number;
  // Idempotency key prevents generating two vouchers for the
  // same booking if the user clicks the button twice.
  idempotencyKey: string;
}

export interface OneBillVoucherResponse {
  isSuccessful:   boolean;
  message:        string;
  // The 14-digit consumer/bill number the user pays with
  voucherNumber:  string;
  // ISO date string — voucher expires at midnight on this date
  expiryDate:     string;
  amount:         number;
  // Human-readable instructions for the user
  paymentChannels?: string[];
}

@Injectable({ providedIn: 'root' })
export class OneBillService {

  // ── SWAP POINT ───────────────────────────────────────────
  // Your backend proxies to the real 1Bill API.
  // You never change this URL — only your backend changes.
  // ────────────────────────────────────────────────────────
  private readonly endpoint = `${environment.apiUrl}/payment/voucher/generate`;

  constructor(private http: HttpClient) {}

  generateVoucher(payload: OneBillVoucherRequest): Observable<OneBillVoucherResponse> {
    const headers = new HttpHeaders({
      'Idempotency-Key':  payload.idempotencyKey,
      'X-Requested-With': 'XMLHttpRequest',
    });

    return this.http.post<OneBillVoucherResponse>(this.endpoint, payload, { headers });
  }
}
