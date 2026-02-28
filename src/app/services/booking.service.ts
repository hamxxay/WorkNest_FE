// ============================================================
// Booking Service
// ============================================================
// This service handles all booking-related API calls.
// It manages operations for creating, retrieving, and canceling bookings.
// All booking operations require authentication (token).

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Injectable service provided at the root level (singleton)
@Injectable({
  providedIn: 'root'
})
export class BookingService {
  // Base API URL for booking endpoints
  private apiUrl = `${environment.apiUrl}/booking`;

  constructor(private http: HttpClient) {}

  /**
   * Retrieve all bookings for the current logged-in user
   * @returns Observable of array of user's bookings
   */
  getMyBookings(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/my`);
  }

  /**
   * Create a new booking
   * @param booking - Booking object containing space ID, dates, and other details
   * @returns Observable of created booking confirmation
   */
  create(booking: any): Observable<any> {
    return this.http.post<any>(this.apiUrl, booking);
  }

  /**
   * Cancel an existing booking
   * @param id - Booking ID to cancel
   * @returns Observable of cancellation response
   */
  cancel(id: number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/cancel`, {});
  }
}
