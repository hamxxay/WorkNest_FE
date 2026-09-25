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
  company?: string;
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
  cityName?: string;
  cityId?: number;
  branchId?: number;
  branchName?: string;
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
  accountReceivableId?: number | null;
  rentAccountId?: number | null;
  servicesIncomeId?: number | null;
  salesTaxId?: number | null;
  securityReceivedId?: number | null;
  accountReceivableName?: string | null;
  rentAccountName?: string | null;
  servicesIncomeName?: string | null;
  salesTaxName?: string | null;
  securityReceivedName?: string | null;
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
  capacity?: number;
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

export interface ChallanField {
  label: string;
  value: string;
  key?: string;
  isHeader?: boolean;
}

/**
 * Booking entity - represents a user's booking of a space.
 * BillingPeriodMonths: how often invoices are generated (1, 2, 3, or 6 months).
 * NextBillingDate: when the next billing cycle starts / next invoice is due.
 */
export interface Booking {
  id: number;
  userEmail?: string;
  customerName?: string;
  customerCompany?: string;
  spaceName?: string;
  spaceId?: number;
  spaceType?: string;
  billingType?: string;
  fields?: ChallanField[];
  startDateTime?: string;
  endDateTime?: string;
  totalAmount?: number;
  monthlyRent?: number;
  bookingStatus?: string;
  /** Billing cycle frequency in months (1 | 2 | 3 | 6) */
  billingPeriodMonths?: number;
  securityDepositMonths?: number;
  securityDepositRequired?: number;
  securityDepositInvoiced?: number;
  securityDepositPaid?: number;
  securityDepositOutstanding?: number;
  /** Shift Type: '24_7' | 'morning' | 'evening' */
  shiftType?: '24_7' | 'morning' | 'evening' | string;
  offeringType?: string;
  /** Start of the current active billing period */
  billingPeriodStart?: string;
  /** End of the current active billing period */
  billingPeriodEnd?: string;
  /** Date when the next billing cycle starts (and next invoice should be generated) */
  nextBillingDate?: string;
}

/**
 * BillingPeriod entity - represents a single billing cycle for a booking.
 * Used to track which periods have been invoiced and which are pending.
 */
export interface BillingPeriod {
  id?: number;
  invoiceId?: number;
  bookingId?: number;
  /** Display label for the period, e.g. "Jan-Mar 2027" */
  periodLabel: string;
  periodStartDate?: string;
  periodEndDate?: string;
  monthlyRentAmount?: number;
  status: 'Pending' | 'Invoiced' | 'Paid' | 'Unbilled';
}

/**
 * Invoice line item entity.
 */
export interface InvoiceLineItem {
  id?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * Invoice entity - represents a regular or security deposit invoice.
 * invoiceTypeId: 1 = Regular (recurring rent), 3 = Security Deposit
 */
export interface Invoice {
  id: number;
  invoiceNumber: string;
  bookingId?: number;
  customerId?: string;
  customerName?: string;
  customerCompany?: string;
  customerEmail?: string;
  spaceName?: string;
  /** 1 = Regular (recurring rent), 3 = Security Deposit */
  invoiceTypeId: number;
  invoiceTypeName?: 'Regular' | 'Security Deposit' | string;
  invoiceDate?: string;
  dueDate?: string;
  subtotal?: number;
  discountAmount?: number;
  discountPercentage?: number;
  taxAmount?: number;
  taxPercentage?: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount?: number;
  balance?: number;
  status: 'Pending' | 'Paid' | 'Partially Paid' | 'Overdue' | 'Cancelled' | string;
  /** Number of months this invoice covers */
  billingPeriodMonths?: number;
  /** Start of the billing period this invoice covers */
  billingPeriodStart?: string;
  /** End of the billing period this invoice covers */
  billingPeriodEnd?: string;
  securityDepositMonths?: number;
  securityDepositAmount?: number;
  notes?: string;
  billingPeriods?: BillingPeriod[];
  lineItems?: InvoiceLineItem[];
  createdAt?: string;
}

/**
 * Booking Billing Summary - aggregates contract rent, paid amounts,
 * security deposit status, and billing period tracking.
 */
export interface BookingBillingSummary {
  bookingId: number;
  /** Total rent over the entire contract period */
  totalContractRent: number;
  rentInvoiced: number;
  rentPaid: number;
  remainingRent: number;
  securityDepositRequired: number;
  securityDepositInvoiced: number;
  securityDepositPaid: number;
  securityDepositOutstanding: number;
  /** Whether security deposit has already been charged (never charge again) */
  securityDepositCharged: boolean;
  /** Billing periods that have been invoiced */
  invoicedPeriods: BillingPeriod[];
  /** Billing periods within the contract that have not yet been invoiced */
  unbilledPeriods: { periodLabel: string; periodStartDate: string; periodEndDate: string }[];
  /** Next scheduled billing date */
  nextBillingDate?: string;
  /** Current billing period start */
  currentBillingPeriodStart?: string;
  /** Current billing period end */
  currentBillingPeriodEnd?: string;
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
  approvedAt?: string;
  approvedByAdminId?: string;
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

/**
 * Announcement entity - represents an admin-broadcasted announcement or critical alert.
 */
export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  type: 'Announcement' | 'Alert';
  targetScope: 'All' | 'Location' | 'Space' | 'CustomList';
  locationId?: number | null;
  locationName?: string | null;
  spaceId?: number | null;
  spaceName?: string | null;
  scheduledAt?: string | null;
  sentAt?: string | null;
  status: 'Draft' | 'Queued' | 'Sending' | 'Sent' | 'Failed';
  createdBy: number;
  createdByName?: string | null;
  createdAt: string;
  totalRecipients: number;
  totalUsers: number;
  sentCount: number;
  failedCount: number;
  readCount: number;
  pendingCount: number;
  pushSentCount: number;
  emailSentCount: number;
  recipients?: AnnouncementRecipient[];
}

export interface AnnouncementRecipient {
  id: number;
  announcementId: string;
  userId: number;
  userName?: string | null;
  userEmail?: string | null;
  channel: 'Push' | 'Email';
  status: 'Pending' | 'Sent' | 'Failed' | 'Read';
  retryCount: number;
  sentAt?: string | null;
}

export interface CreateAnnouncementRequest {
  title: string;
  body: string;
  type: 'Announcement' | 'Alert';
  targetScope: 'All' | 'Location' | 'Space' | 'CustomList';
  locationId?: number | null;
  spaceId?: number | null;
  customUserIds?: number[];
  scheduledAt?: string | null;
}

