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
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiResponse, User, Location, SpaceType, Space, Booking, PricingPlan, Membership, Payment, Contact, GalleryImage } from '../models/admin.model';

// Injectable service provided at the root level (singleton)
@Injectable({ providedIn: 'root' })
export class AdminService {
  // Base API URL
  private api = environment.apiUrl;
  
  constructor(private http: HttpClient) {}

  // ============= USER MANAGEMENT =============

  /** Get paginated list of users */
  getUsers(page?: number, limit?: number, search?: string): Observable<ApiResponse<User[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<User[]>>(`${this.api}/user${qs}`);
  }
  
  /** Get user details by ID */
  getUserById(id: string): Observable<ApiResponse<User>> { return this.http.get<ApiResponse<User>>(`${this.api}/user/${id}`); }

  /** Get complete user activity history (bookings + payments + stats) */
  getUserHistory(id: string): Observable<ApiResponse<any>> { return this.http.get<ApiResponse<any>>(`${this.api}/user/${id}/history`); }

  /** Update user details (for superadmin editing user details) */
  updateUser(id: string, data: Partial<User>): Observable<ApiResponse<User>> {
    return this.http.put<ApiResponse<User>>(`${this.api}/user/${id}`, data);
  }

  /** Activate a deactivated user */
  activateUser(id: string): Observable<ApiResponse<void>> {
    return this.http.patch<ApiResponse<void>>(`${this.api}/user/${id}/activate`, {});
  }

  /** Deactivate an active user */
  deactivateUser(id: string): Observable<ApiResponse<void>> {
    return this.http.patch<ApiResponse<void>>(`${this.api}/user/${id}/deactivate`, {});
  }

  /** Update a user's role (SuperAdmin only) */
  updateUserRole(userId: string, role: string, locationId?: number | null): Observable<ApiResponse<any>> {
    const payload: any = { role };
    if (locationId !== undefined && locationId !== null) payload.locationId = locationId;
    return this.http.patch<ApiResponse<any>>(`${this.api}/user/${userId}/role`, payload);
  }

  /** Create user (SuperAdmin only) */
  createUser(data: any): Observable<ApiResponse<User>> {
    return this.http.post<ApiResponse<User>>(`${this.api}/user`, data);
  }

  /** Delete user (SuperAdmin only) */
  deleteUser(id: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.api}/user/${id}`);
  }

  // ============= LOCATION MANAGEMENT =============

  /** Get paginated list of locations */
  getLocations(page?: number, limit?: number, search?: string): Observable<ApiResponse<Location[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Location[]>>(`${this.api}/location${qs}`);
  }

  /** Create location */
  createLocation(data: Partial<Location>): Observable<ApiResponse<Location>> {
    return this.http.post<ApiResponse<Location>>(`${this.api}/location`, data);
  }

  /** Update location */
  updateLocation(id: number, data: Partial<Location>): Observable<ApiResponse<Location>> {
    return this.http.put<ApiResponse<Location>>(`${this.api}/location/${id}`, data);
  }

  /** Delete location */
  deleteLocation(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.api}/location/${id}`);
  }

  // ============= SPACE TYPE MANAGEMENT =============

  /** Get paginated list of space types */
  getSpaceTypes(page?: number, limit?: number, search?: string): Observable<ApiResponse<SpaceType[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<SpaceType[]>>(`${this.api}/spacetype${qs}`);
  }

  /** Create space type */
  createSpaceType(data: Partial<SpaceType>): Observable<ApiResponse<SpaceType>> {
    return this.http.post<ApiResponse<SpaceType>>(`${this.api}/spacetype`, data);
  }

  /** Update space type */
  updateSpaceType(id: number, data: Partial<SpaceType>): Observable<ApiResponse<SpaceType>> {
    return this.http.put<ApiResponse<SpaceType>>(`${this.api}/spacetype/${id}`, data);
  }

  /** Delete space type */
  deleteSpaceType(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.api}/spacetype/${id}`);
  }

  // ============= SPACE MANAGEMENT =============

  /** Get paginated list of spaces */
  getSpaces(page?: number, limit?: number, search?: string): Observable<ApiResponse<Space[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Space[]>>(`${this.api}/space${qs}`);
  }

  /** Get vacant spaces list */
  getVacantSpaces(branchId?: number): Observable<ApiResponse<any[]>> {
    const qs = branchId ? `?branchId=${branchId}` : '';
    return this.http.get<ApiResponse<any[]>>(`${this.api}/space/vacant${qs}`);
  }

  /** Get space by ID */
  getSpaceById(id: string): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api}/space/${id}`);
  }

  /** Create space */
  createSpace(data: Partial<Space>): Observable<ApiResponse<Space>> {
    return this.http.post<ApiResponse<Space>>(`${this.api}/space`, data);
  }

  /** Update space */
  updateSpace(id: number, data: Partial<Space>): Observable<ApiResponse<Space>> {
    return this.http.put<ApiResponse<Space>>(`${this.api}/space/${id}`, data);
  }

  /** Delete space */
  deleteSpace(id: number | string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.api}/space/${id}`);
  }

  /** Get detailed summary for a specific space */
  getSpaceSummary(id: number): Observable<ApiResponse<any>> { return this.http.get<ApiResponse<any>>(`${this.api}/space/${id}/summary`); }

  // ============= BOOKING MANAGEMENT =============

  /** Get paginated list of bookings */
  getBookings(page?: number, limit?: number, search?: string, locationId?: number): Observable<ApiResponse<Booking[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    if (locationId != null && locationId > 0) params.set('locationId', String(locationId));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Booking[]>>(`${this.api}/booking${qs}`);
  }
  
  /** Update booking status (e.g., Confirmed, Cancelled) */
  updateBookingStatus(id: any, statusId: any): Observable<ApiResponse<any>> {
    const numStatusId = typeof statusId === 'number' ? statusId : (Number(statusId) || statusId);
    return this.http.patch<ApiResponse<any>>(`${this.api}/booking/${id}/status`, {
      statusId: numStatusId,
      status: statusId,
      bookingStatus: statusId
    });
  }

  /** Update booking details */
  updateBooking(id: any, data: Partial<Booking>): Observable<ApiResponse<any>> { return this.http.put<ApiResponse<any>>(`${this.api}/booking/${id}`, data); }

  /** Reassign booking to different space */
  reassignBooking(bookingId: number, newSpaceId: number, newPricingId: number = 0): Observable<ApiResponse<any>> {
    return this.http.patch<ApiResponse<any>>(`${this.api}/booking/${bookingId}/reassign`, { newSpaceId, newPricingId });
  }

  /** Get available spaces for reassignment */
  getAvailableSpacesForReassignment(spaceTypeId: number, startOn: string, endOn: string, excludeBookingId?: number): Observable<ApiResponse<any>> {
    const params = new URLSearchParams({ spaceTypeId: String(spaceTypeId), startOn, endOn });
    if (excludeBookingId) params.set('excludeBookingId', String(excludeBookingId));
    return this.http.get<ApiResponse<any>>(`${this.api}/booking/available-spaces-reassignment?${params.toString()}`);
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
  updateMembershipStatus(id: number, statusId: number): Observable<ApiResponse<any>> { return this.http.patch<ApiResponse<any>>(`${this.api}/membership/${id}/status`, { statusId }); }
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
  updatePaymentStatus(id: number, statusId: number): Observable<ApiResponse<any>> {
    return this.http.patch<any>(`${this.api}/payment/${id}/status`, { statusId });
  }
  approvePayment(id: number): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/payment/${id}/approve`, {});
  }

  deletePayment(id: number): Observable<any> { return this.http.delete<any>(`${this.api}/payment/${id}`); }

  /** Get payment detail with linked booking/membership and user stats */
  getPaymentSummary(id: number): Observable<ApiResponse<any>> { return this.http.get<ApiResponse<any>>(`${this.api}/payment/${id}/summary`); }

  // ============= INVOICE MANAGEMENT =============

  /** Get paginated list of invoices with optional type filter (1: Regular, 3: Security Deposit) */
  getInvoices(page?: number, limit?: number, search?: string, typeId?: number, locationId?: number): Observable<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    if (typeId != null && typeId > 0) params.set('typeId', String(typeId));
    if (locationId != null && locationId > 0) params.set('locationId', String(locationId));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<any[]>>(`${this.api}/invoice${qs}`);
  }

  /** Get detailed invoice by ID with line items and prepaid periods */
  getStatementInvoicePdfBlob(invoiceId: number): Observable<Blob> {
    return this.http.get(`${this.api}/invoice/${invoiceId}/statement-pdf`, { responseType: 'blob' });
  }

  getInvoiceDetails(id: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api}/invoice/${id}`);
  }

  /** Record manual or offline payment for an invoice */
  /** Create custom manual invoice */
  createCustomInvoice(data: any): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/invoice`, data);
  }

  sendInvoiceEmail(invoiceId: number): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/invoice/${invoiceId}/send-email`, {});
  }

  sendInitialInvoice(bookingId: number): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/booking/${bookingId}/send-initial-invoice`, {});
  }

  recordInvoicePayment(invoiceId: number, data: { paidAmount: number; paymentMethod: string; transactionRef?: string; notes?: string }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/invoice/${invoiceId}/record-payment`, data);
  }

  /** Get booking billing and security deposit summary */
  getBookingBillingSummary(bookingId: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api}/booking/${bookingId}/billing-summary`);
  }

  /** Get unbilled/remaining billing periods for a booking */
  getRemainingBillingPeriods(bookingId: number): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.api}/booking/${bookingId}/remaining-billing-periods`);
  }

  /** Get billing periods for a booking (shows invoiced, paid, and upcoming periods) */
  getBillingPeriods(bookingId: number): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.api}/booking/${bookingId}/billing-periods`);
  }


  // Contact Messages
  getContacts(page?: number, limit?: number, search?: string): Observable<ApiResponse<Contact[]>> {
      const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<Contact[]>>(`${this.api}/contact${qs}`);
  }
  updateContactStatus(id: number, statusId: number): Observable<ApiResponse<any>> { return this.http.patch<ApiResponse<any>>(`${this.api}/contact/${id}/status`, { statusId }); }
  deleteContact(id: number): Observable<ApiResponse<any>> { return this.http.delete<ApiResponse<any>>(`${this.api}/contact/${id}`); }

  // Floors
  getFloors(locationId?: number): Observable<ApiResponse<any[]>> {
    const qs = locationId ? `?locationId=${locationId}` : '';
    return this.http.get<ApiResponse<any[]>>(`${this.api}/floor${qs}`);
  }
  createFloor(data: { locationId: number; floorName: string }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/floor`, data);
  }

  // Billing Periods
  getBillingPeriodsList(): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.api}/billing-periods`);
  }

  // Space Configuration
  getSpaceConfig(): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.api}/space-config`);
  }
  updateSpaceConfig(category: string, data: { totalSpaces: number; defaultCapacities?: string; openingTime?: string; closingTime?: string; securityDeposit?: number | null; price?: number | null; billingPeriodId?: number | null }): Observable<ApiResponse<any>> {
    return this.http.put<ApiResponse<any>>(`${this.api}/space-config/${category}`, data);
  }
  generateSpaceInventory(data: { spaceCategory: string; spaceTypeId: string; locationId: string; codePrefix?: string; price?: number; billingPeriodId?: number; amenities?: string | null }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/space-config/generate-inventory`, data);
  }

  // Cities
  getCities(): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.api}/city`);
  }

  // Branches
  getBranches(): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.api}/branch`);
  }

  // Customers
  getCustomers(page?: number, limit?: number, search?: string): Observable<ApiResponse<any[]>> {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.http.get<ApiResponse<any[]>>(`${this.api}/customer${qs}`);
  }
  searchCustomers(query: string): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.api}/customer/search?q=${encodeURIComponent(query)}`);
  }
  createCustomer(data: any): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/customer`, data);
  }
  updateCustomer(id: string, data: any): Observable<ApiResponse<any>> {
    return this.http.put<ApiResponse<any>>(`${this.api}/customer/${id}`, data);
  }
  deleteCustomer(id: string): Observable<ApiResponse<any>> {
    return this.http.delete<ApiResponse<any>>(`${this.api}/customer/${id}`);
  }
  getCustomerById(id: string | number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api}/customer/${id}`);
  }

  // Admin create booking with customer details
  createAdminBooking(data: any): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/booking/create-admin`, data);
  }

  // Challan Validity
  searchChallan(query: string): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api}/challan/search?q=${encodeURIComponent(query)}`);
  }
  extendChallanValidity(data: { bookingId: number; newExpiryDate: string; remarks?: string }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/challan/extend-validity`, data);
  }

  // Space Config V2 (multi-location)
  getSpaceConfigsV2(companyId?: number, branchId?: number, locationId?: number): Observable<ApiResponse<any[]>> {
    const p = new URLSearchParams();
    if (companyId  != null) p.set('companyId',  String(companyId));
    if (branchId   != null) p.set('branchId',   String(branchId));
    if (locationId != null) p.set('locationId', String(locationId));
    const qs = p.toString() ? `?${p.toString()}` : '';
    return this.http.get<ApiResponse<any[]>>(`${this.api}/space-config/v2${qs}`);
  }
  createSpaceConfigV2(data: any): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/space-config/v2`, data);
  }
  updateSpaceConfigV2(id: number, data: any): Observable<ApiResponse<any>> {
    return this.http.put<ApiResponse<any>>(`${this.api}/space-config/v2/${id}`, data);
  }
  deleteSpaceConfigV2(id: number): Observable<ApiResponse<any>> {
    return this.http.delete<ApiResponse<any>>(`${this.api}/space-config/v2/${id}`);
  }
  generateSpacesFromConfig(configId: number): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/space-config/v2/${configId}/generate`, {});
  }
  getSpaceStatusForConfig(configId: number): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.api}/space-config/v2/${configId}/spaces`);
  }
  deleteSpacesFromConfig(configId: number, spaceGuids?: string): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/space-config/v2/delete-spaces`, { configId, spaceGuids: spaceGuids ?? null });
  }

  // Amenities
  getAmenities(): Observable<ApiResponse<any[]>> {
    return this.http.get<ApiResponse<any[]>>(`${this.api}/amenity`);
  }
  createAmenity(data: { name: string }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/amenity`, data);
  }

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

  // Dashboard Space Status Operational Center
  getDashboardSpaceStatus(expiringDays: number = 30): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api}/dashboard/space-status?expiringDays=${expiringDays}`);
  }

  // ============= ATTENDANTS & ACCESS CONTROL =============
  addAttendant(data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/attendants`, data);
  }
  updateAttendant(personId: number, data: any): Observable<any> {
    return this.http.put<any>(`${this.api}/attendants/${personId}`, data);
  }
  getCustomerAttendants(customerId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/customers/${customerId}/attendants`);
  }
  getCustomerActiveSpaces(customerId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/customers/${customerId}/active-spaces`);
  }
  getBookingAttendants(bookingDetailId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/bookings/${bookingDetailId}/attendants`);
  }
  checkAttendantCapacity(bookingDetailId: number): Observable<any> {
    return this.http.get<any>(`${this.api}/bookings/${bookingDetailId}/capacity-check`);
  }
  assignAttendantToBooking(bookingDetailId: number, data: any): Observable<any> {
    return this.http.post<any>(`${this.api}/bookings/${bookingDetailId}/attendants`, data);
  }
  removeAttendantFromBooking(bookingDetailId: number, personId: number): Observable<any> {
    return this.http.delete<any>(`${this.api}/bookings/${bookingDetailId}/attendants/${personId}`);
  }
  toggleAccessStatus(data: any): Observable<any> {
    return this.http.patch<any>(`${this.api}/access-status`, data);
  }
  getHikvisionExport(): Observable<any[]> {
    return this.http.get<any[]>(`${this.api}/access-status/export`);
  }
  sendAgreement(data: any): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/agreements/send`, data);
  }
  downloadAgreementPdf(id: any): Observable<Blob> {
    return this.http.get(`${this.api}/agreements/${id}/pdf`, { responseType: 'blob' });
  }
  markAgreementSigned(id: any): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api}/agreements/${id}/mark-signed`, {});
  }
}