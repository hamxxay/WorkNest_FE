// ============================================================
// Card Payment Service
// ============================================================
// SECURITY MODEL:
//   Raw card data is NEVER stored, logged, or sent anywhere
//   except your own backend over HTTPS. Your backend is the
//   only party that calls the bank API. This keeps the frontend
//   fully out of PCI-DSS scope.
//
// HOW TO SWAP IN A REAL BANK API:
//   1. Replace the endpoint in initiateCardPayment() below with
//      whatever your backend exposes (e.g. POST /payment/card).
//   2. Your backend receives the payload, calls the bank SDK/API
//      (e.g. HBL PayConnect, UBL Payments, Stripe, etc.), and
//      returns a unified response matching CardPaymentResponse.
//   3. If the bank uses a redirect/3DS flow, your backend returns
//      a { redirectUrl } and you call window.location.href on it.
//      The bank redirects back to /payment-result?... when done.
//   4. Update CardPaymentRequest fields to match what your backend
//      expects (some banks need billingAddress, some need token).
//   5. Never add the bank's secret key or merchant credentials
//      here — those live only in backend environment variables.
// ============================================================

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CardPaymentRequest {
  bookingId: number;
  // Card fields — transmitted over HTTPS to YOUR backend only.
  // Backend tokenises or forwards to bank. Never stored on client.
  cardHolderName: string;
  cardNumber: string;       // digits only, no spaces
  expiryMonth: string;      // MM
  expiryYear: string;       // YY
  cvv: string;
  // Idempotency key — generated per attempt, prevents double-charge
  // if the user retries or the network drops mid-request.
  idempotencyKey: string;
}

export interface CardPaymentResponse {
  isSuccessful: boolean;
  message: string;
  transactionRef?: string;
  // BANK SWAP POINT: if the bank requires 3DS/OTP redirect,
  // your backend returns redirectUrl and the frontend navigates to it.
  redirectUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class CardPaymentService {

  // ── BANK SWAP POINT ─────────────────────────────────────────
  // Today this hits your own backend's dummy endpoint.
  // When your bank provides credentials, your backend developer
  // updates the server-side handler behind this same URL.
  // You change NOTHING in this file.
  // ────────────────────────────────────────────────────────────
  private readonly endpoint = `${environment.apiUrl}/payment/card`;

  constructor(private http: HttpClient) {}

  initiateCardPayment(payload: CardPaymentRequest): Observable<CardPaymentResponse> {
    // Idempotency-Key header: if the same key is sent twice
    // (e.g. network retry), the backend/bank returns the cached
    // result instead of charging the card again.
    const headers = new HttpHeaders({
      'Idempotency-Key': payload.idempotencyKey,
      // X-Requested-With prevents simple CSRF from non-browser clients
      'X-Requested-With': 'XMLHttpRequest',
    });

    // Strip spaces/dashes from card number before sending
    const sanitised: CardPaymentRequest = {
      ...payload,
      cardNumber: payload.cardNumber.replace(/\D/g, ''),
      cvv: payload.cvv.trim(),
    };

    return this.http.post<CardPaymentResponse>(this.endpoint, sanitised, { headers });
  }
}
