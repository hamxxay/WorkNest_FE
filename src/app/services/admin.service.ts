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

// Reusable API response wrapper
export interface ApiResponse<T> {
  isSuccessful: boolean;
  data?: T;
  message?: string;
  total?: number;
}

// Entity models returned by admin endpoints
export interface User { id: string; email: string; firstName?: string; lastName?: string; roles?: string[]; isActive?: boolean; createdAt?: string; }
export interface Location { id: number; name: string; address: string; city: string; openingTime?: string; closingTime?: string; isActive?: boolean; }
export interface SpaceType { id: number; name: string; capacity?: number; hourlyAllowed?: boolean; isActive?: boolean; }
export interface Space { id: number; name: string; locationName?: string; spaceTypeName?: string; code?: string; pricePerHour?: number; pricePerDay?: number; status?: string; }
export interface Booking { id: number; userEmail?: string; spaceName?: string; startDateTime?: string; endDateTime?: string; totalAmount?: number; bookingStatus?: string; }
export interface PricingPlan { id: number; name: string; price?: number; billingCycle?: string; includesHours?: number; isActive?: boolean; }
export interface Membership { id: number; userEmail?: string; planName?: string; startDate?: string; endDate?: string; status?: string; }
export interface Payment { id: number; userEmail?: string; amount?: number; paymentMethod?: string; paymentStatus?: string; paidAt?: string; }
export interface Contact { id: number; fullName?: string; email?: string; phone?: string; message?: string; status?: string; createdAt?: string; }
export interface GalleryImage { id: number; title?: string; imageUrl?: string; sortOrder?: number; isActive?: boolean; createdAt?: string; }

// Injectable service provided at the root level (singleton)
@Injectable({ providedIn: 'root' })
export class AdminService {
  // Base API URL
  private api = environment.apiUrl;
  
  constructor(private http: HttpClient) {}

  // ============= DASHBOARD =============
  
  /**
   * Get dashboard statistics and overview data.
   *
   * NOTE: The API now exposes a lightweight summary endpoint that returns
   * counts for each major entity rather than returning the full lists.
   * This helps avoid unnecessary bandwidth and client-side counting.
   */
  getDashboardStats(): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api}/dashboard/summary`);
  }

  /**
   * Retrieve a limited list of recent bookings. The server applies the
   * limit and sorts by most recent first.
   */
  getRecentBookings(limit: number = 5): Observable<ApiResponse<Booking[]>> {
    return this.http.get<ApiResponse<Booking[]>>(`${this.api}/booking/recent?limit=${limit}`);
  }

  /**
   * Retrieve a limited list of recent contact messages. The server applies
   * the limit and sorts by most recent first.
   */
  getRecentContacts(limit: number = 5): Observable<ApiResponse<Contact[]>> {
    return this.http.get<ApiResponse<Contact[]>>(`${this.api}/contact/recent?limit=${limit}`);
  }

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
    return this.http.get<ApiResponse<Location[]>>(`${this.api}/location/all${qs}`);
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
    return this.http.get<ApiResponse<SpaceType[]>>(`${this.api}/spacetype/all${qs}`);
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
  
  /** Create a new space (desk, office, etc.) */
  createSpace(data: Partial<Space>): Observable<ApiResponse<Space>> { return this.http.post<ApiResponse<Space>>(`${this.api}/space`, data); }
  
  /** Update space details */
  updateSpace(id: number, data: Partial<Space>): Observable<ApiResponse<Space>> { return this.http.put<ApiResponse<Space>>(`${this.api}/space/${id}`, data); }
  
  /** Delete a space */
  deleteSpace(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/space/${id}`); }

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

  // ============= PRICING PLAN MANAGEMENT =============
  
  /** Retrieve pricing plans with optional paging/search. */
  getPricingPlans(page?: number, limit?: number, search?: string): Observable<ApiResponse<PricingPlan[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<PricingPlan[]>>(`${this.api}/pricingplan/all${qs}`);
  }
  
  /** Create a new pricing plan */
  createPricingPlan(data: Partial<PricingPlan>): Observable<ApiResponse<PricingPlan>> { return this.http.post<ApiResponse<PricingPlan>>(`${this.api}/pricingplan`, data); }
  updatePricingPlan(id: number, data: Partial<PricingPlan>): Observable<ApiResponse<PricingPlan>> { return this.http.put<ApiResponse<PricingPlan>>(`${this.api}/pricingplan/${id}`, data); }
  deletePricingPlan(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/pricingplan/${id}`); }

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

  // Contact Messages
  getContacts(page?: number, limit?: number, search?: string): Observable<ApiResponse<Contact[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Contact[]>>(`${this.api}/contact${qs}`);
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
    return this.http.get<ApiResponse<GalleryImage[]>>(`${this.api}/gallery/all${qs}`);
  }
  createGalleryImage(data: Partial<GalleryImage>): Observable<ApiResponse<GalleryImage>> { return this.http.post<ApiResponse<GalleryImage>>(`${this.api}/gallery`, data); }
  updateGalleryImage(id: number, data: Partial<GalleryImage>): Observable<ApiResponse<GalleryImage>> { return this.http.put<ApiResponse<GalleryImage>>(`${this.api}/gallery/${id}`, data); }
  deleteGalleryImage(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/gallery/${id}`); }
}
