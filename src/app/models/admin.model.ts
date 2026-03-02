// ============================================================
// Shared Admin Models
// ============================================================
// This file contains all entity interfaces and response wrappers
// used across the admin service and management components.
// By centralizing these definitions, we reduce schema drift risk
// and ensure consistency across the application.

/**
 * Generic API response wrapper for all admin endpoints.
 * All successful and failed responses follow this structure.
 */
export interface ApiResponse<T> {
  isSuccessful: boolean;
  data?: T;
  message?: string;
  total?: number;
}

/**
 * User entity - represents an application user with roles and status.
 */
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  isActive?: boolean;
  createdAt?: string;
}

/**
 * Location entity - represents a workspace location.
 */
export interface Location {
  id: number;
  name: string;
  address: string;
  city: string;
  openingTime?: string;
  closingTime?: string;
  isActive?: boolean;
}

/**
 * SpaceType entity - represents a type of space (e.g., Private Office, Desk).
 */
export interface SpaceType {
  id: number;
  name: string;
  capacity?: number;
  hourlyAllowed?: boolean;
  isActive?: boolean;
}

/**
 * Space entity - represents an individual workspace/desk.
 * Includes both display names (from list views) and numeric IDs (for updates).
 */
export interface Space {
  id: number;
  name: string;
  locationName?: string;
  spaceTypeName?: string;
  code?: string;
  pricePerHour?: number;
  pricePerDay?: number;
  status?: string;
  locationId?: number;
  spaceTypeId?: number;
  description?: string;
  floor?: string;
  imageUrl?: string;
  amenities?: string;
}

/**
 * Booking entity - represents a user's booking of a space.
 */
export interface Booking {
  id: number;
  userEmail?: string;
  spaceName?: string;
  startDateTime?: string;
  endDateTime?: string;
  totalAmount?: number;
  bookingStatus?: string;
}

/**
 * PricingPlan entity - represents a subscription pricing tier.
 */
export interface PricingPlan {
  id: number;
  name: string;
  price?: number;
  billingCycle?: string;
  includesHours?: number;
  isActive?: boolean;
}

/**
 * Membership entity - represents a user's active subscription.
 */
export interface Membership {
  id: number;
  userEmail?: string;
  planName?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}

/**
 * Payment entity - represents a transaction record.
 */
export interface Payment {
  id: number;
  userEmail?: string;
  amount?: number;
  paymentMethod?: string;
  paymentStatus?: string;
  paidAt?: string;
}

/**
 * Contact entity - represents a contact form submission or message.
 */
export interface Contact {
  id: number;
  fullName?: string;
  email?: string;
  phone?: string;
  message?: string;
  status?: string;
  createdAt?: string;
}

/**
 * GalleryImage entity - represents an image in the gallery.
 */
export interface GalleryImage {
  id: number;
  title?: string;
  imageUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
  createdAt?: string;
}
