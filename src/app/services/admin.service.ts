// ============================================================
// Admin Service
// ============================================================
// This service provides comprehensive API endpoints for admin operations.
// It handles CRUD operations for all entities:
// - Users (manage, activate, deactivate)
// - Locations (workspace locations)
// - Space Types (office types like Private Office, Desk, etc.)
// - Spaces (individual workspaces)
// - Bookings (manage user bookings)
// - Pricing Plans (subscription tiers)
// - Memberships, Payments, Contacts, Gallery
//
// All endpoints require admin authentication (checked by adminGuard).

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiResponse, User, Location, SpaceType, Space, Booking, PricingPlan, Membership, Payment, Contact, GalleryImage } from '../models/admin.model';

// Injectable service provided at the root level (singleton)
@Injectable({ providedIn: 'root' })
export class AdminService {
  // Base API URL
  private api = environment.apiUrl;
  
  constructor(private http: HttpClient) {}

  // ============= USER MANAGEMENT =============
  
  /**
   * Get users with optional pagination and search filtering.
   * Backend should honor page, limit and search query parameters.
   */
  getUsers(page?: number, limit?: number, search?: string): Observable<ApiResponse<User[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<User[]>>(`${this.api}/user${qs}`);
  }
  
  /** Get a specific user by ID */
  getUserById(id: string): Observable<ApiResponse<User>> { return this.http.get<ApiResponse<User>>(`${this.api}/user/${id}`); }

  /** Get full booking/payment history for a user */
  getUserHistory(id: string): Observable<ApiResponse<any>> { return this.http.get<ApiResponse<any>>(`${this.api}/user/${id}/history`); }
  
  /** Create a new user */
  createUser(data: Partial<User>): Observable<ApiResponse<User>> { return this.http.post<ApiResponse<User>>(`${this.api}/user`, data); }
  
  /** Update an existing user */
  updateUser(id: string, data: Partial<User>): Observable<ApiResponse<User>> { return this.http.put<ApiResponse<User>>(`${this.api}/user/${id}`, data); }
  
  /** Delete a user */
  deleteUser(id: string): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/user/${id}`); }
  
  /** Activate a user account */
  activateUser(id: string): Observable<ApiResponse<any>> { return this.http.patch<ApiResponse<any>>(`${this.api}/user/${id}/activate`, {}); }
  
  /** Deactivate a user account */
  deactivateUser(id: string): Observable<ApiResponse<any>> { return this.http.patch<ApiResponse<any>>(`${this.api}/user/${id}/deactivate`, {}); }

  /** Update user role */
  updateUserRole(id: string, role: string): Observable<ApiResponse<any>> { return this.http.patch<ApiResponse<any>>(`${this.api}/user/${id}/role`, { role }); }

  // ============= LOCATION MANAGEMENT =============
  
  /**
   * List locations with pagination/search support.
   */
  getLocations(page?: number, limit?: number, search?: string): Observable<ApiResponse<Location[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Location[]>>(`${this.api}/location${qs}`);
  }
  
  /** Create a new location */
  createLocation(data: Partial<Location>): Observable<ApiResponse<Location>> { return this.http.post<ApiResponse<Location>>(`${this.api}/location`, data); }
  
  /** Update location details */
  updateLocation(id: number, data: Partial<Location>): Observable<ApiResponse<Location>> { return this.http.put<ApiResponse<Location>>(`${this.api}/location/${id}`, data); }
  
  /** Delete a location */
  deleteLocation(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/location/${id}`); }

  // ============= SPACE TYPE MANAGEMENT =============
  
  /** List space types with optional paging/search. */
  getSpaceTypes(page?: number, limit?: number, search?: string): Observable<ApiResponse<SpaceType[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<SpaceType[]>>(`${this.api}/spacetype${qs}`);
  }
  
  /** Create a new space type */
  createSpaceType(data: Partial<SpaceType>): Observable<ApiResponse<SpaceType>> { return this.http.post<ApiResponse<SpaceType>>(`${this.api}/spacetype`, data); }
  
  /** Update space type */
  updateSpaceType(id: number, data: Partial<SpaceType>): Observable<ApiResponse<SpaceType>> { return this.http.put<ApiResponse<SpaceType>>(`${this.api}/spacetype/${id}`, data); }
  
  /** Delete space type */
  deleteSpaceType(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/spacetype/${id}`); }

  // ============= SPACE MANAGEMENT =============
  
  /** Retrieve spaces with pagination/search. */
  getSpaces(page?: number, limit?: number, search?: string): Observable<ApiResponse<Space[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Space[]>>(`${this.api}/space${qs}`);
  }

  /** Get a specific space by ID (full details with relation IDs) */
  getSpaceById(id: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api}/space/${id}`);
  }
  
  /** Create a new space (desk, office, etc.) */
  createSpace(data: Partial<Space>): Observable<ApiResponse<Space>> { return this.http.post<ApiResponse<Space>>(`${this.api}/space`, data); }
  
  /** Update space details */
  updateSpace(id: number, data: Partial<Space>): Observable<ApiResponse<Space>> { return this.http.put<ApiResponse<Space>>(`${this.api}/space/${id}`, data); }
  
  /** Delete a space */
  deleteSpace(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/space/${id}`); }

  /** Get space reservation summary */
  getSpaceSummary(id: number): Observable<ApiResponse<any>> { return this.http.get<ApiResponse<any>>(`${this.api}/space/${id}/summary`); }

  // ============= BOOKING MANAGEMENT =============
  
  /**
   * List bookings; allows paging/search as well, even if not used in UI yet.
   */
  getBookings(page?: number, limit?: number, search?: string): Observable<ApiResponse<Booking[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Booking[]>>(`${this.api}/booking${qs}`);
  }
  
  /** Update booking status (e.g., Confirmed, Cancelled) */
  updateBookingStatus(id: number, status: string): Observable<ApiResponse<any>> { return this.http.patch<ApiResponse<any>>(`${this.api}/booking/${id}/status?status=${encodeURIComponent(status)}`, {}); }

  /** Update booking details */
  updateBooking(id: number, data: Partial<Booking>): Observable<ApiResponse<any>> { return this.http.put<ApiResponse<any>>(`${this.api}/booking/${id}`, data); }

  /** Reassign booking to different space */
  reassignBooking(bookingId: number, newSpaceId: number): Observable<ApiResponse<any>> {
    return this.http.patch<ApiResponse<any>>(`${this.api}/booking/${bookingId}/reassign`, { spaceId: newSpaceId });
  }

  /** Get available spaces for reassignment */
  getAvailableSpacesForReassignment(spaceType: string, startDateTime: string, endDateTime: string, excludeBookingId?: number): Observable<ApiResponse<any>> {
    const params = new URLSearchParams({ spaceType, startDateTime, endDateTime });
    if (excludeBookingId) params.set('excludeBookingId', String(excludeBookingId));
    return this.http.get<ApiResponse<any>>(`${this.api}/booking/available-spaces?${params.toString()}`);
  }

  /** Get booking calendar availability for a space */
  getBookingCalendar(spaceId: number, year: number, month: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api}/booking/calendar?spaceId=${spaceId}&year=${year}&month=${month}`);
  }

  // ============= PRICING PLAN MANAGEMENT =============
  
  /** Retrieve pricing plans with optional paging/search. */
  getPricingPlans(page?: number, limit?: number, search?: string): Observable<ApiResponse<PricingPlan[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<PricingPlan[]>>(`${this.api}/pricingplan${qs}`);
  }
  
  /** Create a new pricing plan */
  createPricingPlan(data: Partial<PricingPlan>): Observable<ApiResponse<PricingPlan>> { return this.http.post<ApiResponse<PricingPlan>>(`${this.api}/pricingplan`, data); }
  updatePricingPlan(id: number, data: Partial<PricingPlan>): Observable<ApiResponse<PricingPlan>> { return this.http.put<ApiResponse<PricingPlan>>(`${this.api}/pricingplan/${id}`, data); }
  deletePricingPlan(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/pricingplan/${id}`); }

  /** Get pricing plan subscriber/revenue summary */
  getPricingPlanSummary(id: number): Observable<ApiResponse<any>> { return this.http.get<ApiResponse<any>>(`${this.api}/pricingplan/${id}/summary`); }

  // Plan Features
  getPlanFeatures(planId: number): Observable<ApiResponse<any>> { return this.http.get<ApiResponse<any>>(`${this.api}/planfeature/by-plan/${planId}`); }
  createPlanFeature(data: any): Observable<ApiResponse<any>> { return this.http.post<ApiResponse<any>>(`${this.api}/planfeature`, data); }
  updatePlanFeature(id: number, data: any): Observable<ApiResponse<any>> { return this.http.put<ApiResponse<any>>(`${this.api}/planfeature/${id}`, data); }
  deletePlanFeature(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/planfeature/${id}`); }

  // Memberships
  getMemberships(page?: number, limit?: number, search?: string): Observable<ApiResponse<Membership[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Membership[]>>(`${this.api}/membership${qs}`);
  }
  createMembership(data: Partial<Membership>): Observable<ApiResponse<Membership>> { return this.http.post<ApiResponse<Membership>>(`${this.api}/membership`, data); }
  updateMembershipStatus(id: number, status: string): Observable<ApiResponse<any>> { return this.http.patch<ApiResponse<any>>(`${this.api}/membership/${id}/status?status=${encodeURIComponent(status)}`, {}); }
  deleteMembership(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/membership/${id}`); }

  /** Get membership payment/history summary */
  getMembershipSummary(id: number): Observable<ApiResponse<any>> { return this.http.get<ApiResponse<any>>(`${this.api}/membership/${id}/summary`); }

  // Payments
  getPayments(page?: number, limit?: number, search?: string): Observable<ApiResponse<Payment[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Payment[]>>(`${this.api}/payment${qs}`);
  }
  createPayment(data: Partial<Payment>): Observable<ApiResponse<Payment>> { return this.http.post<ApiResponse<Payment>>(`${this.api}/payment`, data); }
  updatePaymentStatus(id: number, status: string, transactionRef?: string): Observable<ApiResponse<any>> {
    let url = `${this.api}/payment/${id}/status?status=${encodeURIComponent(status)}`;
    if (transactionRef) url += `&transactionRef=${encodeURIComponent(transactionRef)}`;
    return this.http.patch<any>(url, {});
  }
  deletePayment(id: number): Observable<any> { return this.http.delete<any>(`${this.api}/payment/${id}`); }

  /** Get payment detail with linked booking/membership and user stats */
  getPaymentSummary(id: number): Observable<ApiResponse<any>> { return this.http.get<ApiResponse<any>>(`${this.api}/payment/${id}/summary`); }

  // Contact Messages
  getContacts(page?: number, limit?: number, search?: string): Observable<ApiResponse<Contact[]>> {
    return this.http.get<ApiResponse<Contact[]>>(`${this.api}/contact`);
  }
  updateContactStatus(id: number, status: string): Observable<ApiResponse<any>> { return this.http.patch<ApiResponse<any>>(`${this.api}/contact/${id}/status?status=${encodeURIComponent(status)}`, {}); }
  deleteContact(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/contact/${id}`); }

  // Gallery
  getGalleryAll(page?: number, limit?: number, search?: string): Observable<ApiResponse<GalleryImage[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<GalleryImage[]>>(`${this.api}/gallery${qs}`);
  }
  createGalleryImage(data: Partial<GalleryImage>): Observable<ApiResponse<GalleryImage>> { return this.http.post<ApiResponse<GalleryImage>>(`${this.api}/gallery`, data); }
  updateGalleryImage(id: number, data: Partial<GalleryImage>): Observable<ApiResponse<GalleryImage>> { return this.http.put<ApiResponse<GalleryImage>>(`${this.api}/gallery/${id}`, data); }
  deleteGalleryImage(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/gallery/${id}`); }
}
