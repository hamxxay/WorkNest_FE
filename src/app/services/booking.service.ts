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

  getById(id: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  /**
   * Get available spaces by type with auto-assignment logic
   * @param spaceType - Type of space (e.g., 'Private Office', 'Shared Space', 'Meeting Room')
   * @param startDateTime - Booking start date/time
   * @param endDateTime - Booking end date/time
   * @returns Observable with available spaces and assignment info
   */
  getAvailableSpaces(spaceType: string, startDateTime: string, endDateTime: string): Observable<any> {
    const params = new URLSearchParams({ spaceType, startDateTime, endDateTime });
    return this.http.get<any>(`${this.apiUrl}/available-spaces?${params.toString()}`);
  }

  getSmartAvailableSpaces(spaceCategory: string, startDateTime: string, endDateTime: string, capacity?: number): Observable<any> {
    const p = new URLSearchParams({ spaceCategory, startDateTime, endDateTime });
    if (capacity) p.set('capacity', String(capacity));
    return this.http.get<any>(`${this.apiUrl}/smart/available?${p.toString()}`);
  }

  createSmart(booking: {
    spaceCategory: string;
    startDateTime: string;
    endDateTime: string;
    capacity?: number;
    notes?: string;
    totalAmount?: number;
    paymentMethod?: string;
    accountId?: number;
  }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/smart`, booking);
  }

  getAccountsCoa(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl.replace('/booking', '')}/account-coa`);
  }

  getSpaceConfig(): Observable<any> {
    return this.http.get<any>(`${environment.apiUrl}/space-config`);
  }

  /**
   * Create a new booking with auto-assigned space
   * @param booking - Booking object containing space type, dates, and other details
   * @returns Observable of created booking with assigned space
   */
  create(booking: any): Observable<any> {
    return this.http.post<any>(this.apiUrl, booking);
  }

  /**
   * Reassign booking to a different space (admin only)
   * @param bookingId - Booking ID
   * @param newSpaceId - New space ID to assign
   * @returns Observable of updated booking
   */
  reassignSpace(bookingId: number, newSpaceId: number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${bookingId}/reassign`, { spaceId: newSpaceId });
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
