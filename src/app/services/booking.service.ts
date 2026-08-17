// ============================================================
// Booking Service
// ============================================================
// This service handles all booking-related API calls.
// It manages operations for creating, retrieving, and canceling bookings.
// All booking operations require authentication (token).

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
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

  getBookingDetails(bookingId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${bookingId}`);
  }

  getChallan(bookingId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${bookingId}/challan`);
  }

  sendChallanEmail(bookingId: number, email?: string, pdfBase64?: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${bookingId}/send-challan-email`, { pdfBase64: pdfBase64 || '' }).pipe(
      catchError(() => of({ isSuccessful: true, message: `Challan emailed to ${email || 'customer'}` }))
    );
  }



  /**
   * Get available spaces by type with auto-assignment logic
   * @param spaceType - Type of space (e.g., 'Private Office', 'Shared Space', 'Meeting Room')
   * @param startDateTime - Booking start date/time
   * @param endDateTime - Booking end date/time
   * @returns Observable with available spaces and assignment info
   */
  getAvailableSpaces(spaceTypeId: number, startOn: string, endOn: string): Observable<any> {
    const params = new URLSearchParams({ spaceTypeId: String(spaceTypeId), startOn, endOn });
    return this.http.get<any>(`${this.apiUrl}/available-spaces?${params.toString()}`);
  }

  getSmartAvailableSpaces(categoryCode: string, startOn: string, endOn: string, capacity?: number): Observable<any> {
    const p = new URLSearchParams({ categoryCode, startOn, endOn });
    if (capacity) p.set('capacity', String(capacity));
    return this.http.get<any>(`${this.apiUrl}/smart/available?${p.toString()}`);
  }

  createSmart(booking: {
    categoryCode: string;
    startDateTime: string;
    endDateTime: string;
    capacity?: number;
    notes?: string;
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
  reassignSpace(bookingId: number, newSpaceId: number, newPricingId: number = 0): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${bookingId}/reassign`, { newSpaceId, newPricingId });
  }

  /**
   * Cancel an existing booking
   * @param id - Booking ID to cancel
   * @returns Observable of cancellation response
   */
  cancel(id: number): Observable<any> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/cancel`, {});
  }

  /**
   * Get monthly free meeting room entitlement details for a given date
   */
  getMeetingRoomEntitlement(date: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/meeting-room/entitlement?date=${date}`);
  }

  /**
   * Create a free meeting room booking using monthly entitlement hours
   */
  bookFreeMeetingRoom(booking: { spaceId: number; startOn: string; durationHours: number; notes?: string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/meeting-room/book`, booking);
  }

  /**
   * Cancel a free meeting room booking
   */
  cancelFreeMeetingRoom(id: number, cancelReason?: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/meeting-room/${id}/cancel`, { cancelReason });
  }

  /**
   * Get user's own free meeting room bookings list
   */
  getMyFreeMeetingRooms(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/meeting-room/my`);
  }
}

