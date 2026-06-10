import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PayFastInitiateRequest {
  bookingId:     number;
  customerName:  string;
  customerEmail: string;
}

export interface PayFastInitiateResponse {
  isSuccessful: boolean;
  message:      string;
  data?: {
    payment_url: string;
    merchant_id: string;
    order_id:    string;
    amount:      string;
    currency:    string;
    description: string;
    customer_email: string;
    customer_name:  string;
    return_url:  string;
    notify_url:  string;
    booking_id:  string;
    signature:   string;
  };
}

@Injectable({ providedIn: 'root' })
export class PayFastService {
  private readonly endpoint = `${environment.apiUrl}/payment/payfast/initiate`;

  constructor(private http: HttpClient) {}

  /** Calls backend to get a signed PayFast payload, then redirects to the sandbox. */
  initiatePayment(payload: PayFastInitiateRequest): Observable<PayFastInitiateResponse> {
    return this.http.post<PayFastInitiateResponse>(this.endpoint, payload);
  }

  /** Submits a hidden form to the PayFast sandbox URL with the signed params. */
  redirectToPayFast(data: PayFastInitiateResponse['data']): void {
    if (!data) return;
    const { payment_url, ...params } = data;

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = payment_url;

    Object.entries(params).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type  = 'hidden';
      input.name  = key;
      input.value = String(value);
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
  }
}
