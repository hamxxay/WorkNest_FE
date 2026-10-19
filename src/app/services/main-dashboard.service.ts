import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DashError, DashErrorWording, DashParams, arr, describeDashboardError, getDashboardData, num, numOrNull, obj, str, strOrNull
} from './dashboard-api';

// ============================================================
// Main admin dashboard (/admin/dashboard): the space type cards, the lists behind their tags and the Space Operations &
// Inventory table, counted by the API for every space, booking and quotation (database update DASH_01_main_dashboard)
// instead of from the first 1,000 rows in the browser. Same roles and location rules as GET api/dashboard/overview.
// Every response is normalised here; every failure becomes a worded DashError (never an empty list).
// ============================================================

export type MainTag = 'booked' | 'vacant' | 'quoted' | 'expiring';
export type MainStatus = 'Booked' | 'Quoted' | 'Available';
export type MainSortField = 'urgency' | 'spaceCode' | 'customer' | 'bookingStart' | 'bookingEnd' | 'remainingTime' | 'status';

export interface MainSpaceTypeCard {
  spaceTypeId: number;
  spaceTypeName: string;
  locationId: number | null;
  locationName: string | null;
  totalSpaces: number;
  bookedCount: number;
  vacantCount: number;
  quotedCount: number;
  expiringCount: number;
}

export interface MainSummary {
  expiringDays: number;
  totalSpaces: number;
  cards: MainSpaceTypeCard[];
  generatedAt: string | null;
}

/** A row of a card tag list; each tag fills the fields it shows. Times are business time without a zone. */
export interface MainDetailRow {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  locationName: string | null;
  bookingId: number | null;
  bookingStart: string | null;
  bookingEnd: string | null;
  bookingStatus: string | null;
  customerName: string | null;
  companyName: string | null;
  has247: boolean;
  hasMorning: boolean;
  hasEvening: boolean;
  nextBookingDate: string | null;
  nextBookingCustomer: string | null;
  quotationId: number | null;
  quotationNumber: string | null;
  quotationStatus: string | null;
  quotationDate: string | null;
  quotationExpiryDate: string | null;
  quotationAmount: number | null;
  isAlsoBooked: boolean;
  daysRemaining: number | null;
}

export interface MainDetails { tag: MainTag; spaceTypeId: number; total: number; page: number; pageSize: number; items: MainDetailRow[]; }

export interface MainInventoryQuery {
  /** The dashboard's location filter; empty = every location the user may see. */
  locationIds: number[];
  /** The table's own Location filter; null = all. */
  location: number | null;
  search: string;
  customer: string;
  /** Space type name; null = all. */
  spaceType: string | null;
  status: MainStatus | null;
  privateOnly: boolean;
  expiringDays: number;
  sortBy: MainSortField;
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface MainInventoryRow {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  spaceTypeId: number;
  spaceTypeName: string;
  locationId: number | null;
  locationName: string | null;
  status: MainStatus;
  bookingId: number | null;
  customerName: string | null;
  companyName: string | null;
  bookingStart: string | null;
  bookingEnd: string | null;
  bookingStatus: string | null;
  shiftType: string | null;
  quotationId: number | null;
  quotationNumber: string | null;
  quotationCustomerName: string | null;
  quotationDate: string | null;
  quotationExpiryDate: string | null;
  quotationAmount: number | null;
  quotationStatus: string | null;
  daysRemaining: number;
  isExpiringSoon: boolean;
  isPrivateSpace: boolean;
}

export interface MainInventoryPage { total: number; page: number; pageSize: number; items: MainInventoryRow[]; }

const WORDING: DashErrorWording = {
  name: 'dashboard',
  // Shown under the title "Database update needed" (503 before DASH_01 has run).
  dbMessage: 'Run DASH_01_main_dashboard_TEST.sql on the database (DASH_01_main_dashboard_LIVE.sql on the live one), then refresh this page.'
};

const bool = (v: unknown): boolean => v === true || v === 1 || String(v).toLowerCase() === 'true';
const status = (v: unknown): MainStatus => (v === 'Booked' || v === 'Quoted' ? v : 'Available');

@Injectable({ providedIn: 'root' })
export class MainDashboardService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** Wording for a failed request: 503 before DASH_01 names the script to run. */
  static describeError(err: unknown): DashError {
    return describeDashboardError(err, WORDING);
  }

  /** GET api/dashboard/main-summary: one card per space type. */
  getSummary(locationIds: number[], expiringDays: number): Observable<MainSummary> {
    return this.get('main-summary', { locationIds: locationIds.join(',') || null, expiringDays }).pipe(map(raw => {
      const d = obj(raw) ?? {};
      const cards = arr(d.cards, (c: any): MainSpaceTypeCard => ({
        spaceTypeId: num(c.spaceTypeId), spaceTypeName: str(c.spaceTypeName) || 'Other',
        locationId: numOrNull(c.locationId), locationName: strOrNull(c.locationName),
        totalSpaces: num(c.totalSpaces), bookedCount: num(c.bookedCount), vacantCount: num(c.vacantCount),
        quotedCount: num(c.quotedCount), expiringCount: num(c.expiringCount)
      }));
      return {
        expiringDays: num(d.expiringDays) || expiringDays,
        totalSpaces: Math.max(num(d.totalSpaces), cards.reduce((a, c) => a + c.totalSpaces, 0)),
        cards, generatedAt: strOrNull(d.generatedAt)
      };
    }));
  }

  /** GET api/dashboard/main-summary/details: one tag of a card, one page. */
  getDetails(locationIds: number[], spaceTypeId: number, tag: MainTag, expiringDays: number, page: number, pageSize: number): Observable<MainDetails> {
    return this.get('main-summary/details', {
      locationIds: locationIds.join(',') || null, spaceTypeId, tag, expiringDays, page, pageSize
    }).pipe(map(raw => {
      const d = obj(raw) ?? {};
      const items = arr(d.items, (r: any): MainDetailRow => ({
        spaceId: num(r.spaceId), spaceCode: str(r.spaceCode) || `Space-${num(r.spaceId)}`, spaceName: str(r.spaceName),
        capacity: num(r.capacity) || 1, locationName: strOrNull(r.locationName),
        bookingId: numOrNull(r.bookingId), bookingStart: strOrNull(r.bookingStart), bookingEnd: strOrNull(r.bookingEnd),
        bookingStatus: strOrNull(r.bookingStatus), customerName: strOrNull(r.customerName), companyName: strOrNull(r.companyName),
        has247: bool(r.has247), hasMorning: bool(r.hasMorning), hasEvening: bool(r.hasEvening),
        nextBookingDate: strOrNull(r.nextBookingDate), nextBookingCustomer: strOrNull(r.nextBookingCustomer),
        quotationId: numOrNull(r.quotationId), quotationNumber: strOrNull(r.quotationNumber), quotationStatus: strOrNull(r.quotationStatus),
        quotationDate: strOrNull(r.quotationDate), quotationExpiryDate: strOrNull(r.quotationExpiryDate),
        quotationAmount: numOrNull(r.quotationAmount), isAlsoBooked: bool(r.isAlsoBooked), daysRemaining: numOrNull(r.daysRemaining)
      }));
      return {
        tag, spaceTypeId, total: Math.max(num(d.total), items.length), page: num(d.page) || page,
        pageSize: num(d.pageSize) || pageSize, items
      };
    }));
  }

  /** GET api/dashboard/inventory: one page of the Space Operations & Inventory table. */
  getInventory(q: MainInventoryQuery): Observable<MainInventoryPage> {
    return this.get('inventory', {
      locationIds: q.locationIds.join(',') || null, location: q.location, search: q.search.trim(), customer: q.customer.trim(),
      spaceType: q.spaceType, status: q.status, privateOnly: q.privateOnly || null, expiringDays: q.expiringDays,
      sortBy: q.sortBy, sortDir: q.sortDir, page: q.page, pageSize: q.pageSize
    }).pipe(map(raw => {
      const d = obj(raw) ?? {};
      const items = arr(d.items, (r: any): MainInventoryRow => ({
        spaceId: num(r.spaceId), spaceCode: str(r.spaceCode) || `Space-${num(r.spaceId)}`, spaceName: str(r.spaceName),
        capacity: num(r.capacity) || 1, spaceTypeId: num(r.spaceTypeId), spaceTypeName: str(r.spaceTypeName) || 'Other',
        locationId: numOrNull(r.locationId), locationName: strOrNull(r.locationName), status: status(r.status),
        bookingId: numOrNull(r.bookingId), customerName: strOrNull(r.customerName), companyName: strOrNull(r.companyName),
        bookingStart: strOrNull(r.bookingStart), bookingEnd: strOrNull(r.bookingEnd), bookingStatus: strOrNull(r.bookingStatus),
        shiftType: strOrNull(r.shiftType), quotationId: numOrNull(r.quotationId), quotationNumber: strOrNull(r.quotationNumber),
        quotationCustomerName: strOrNull(r.quotationCustomerName), quotationDate: strOrNull(r.quotationDate),
        quotationExpiryDate: strOrNull(r.quotationExpiryDate), quotationAmount: numOrNull(r.quotationAmount),
        quotationStatus: strOrNull(r.quotationStatus), daysRemaining: numOrNull(r.daysRemaining) ?? 99999,
        isExpiringSoon: bool(r.isExpiringSoon), isPrivateSpace: bool(r.isPrivateSpace)
      }));
      return { total: Math.max(num(d.total), items.length), page: num(d.page) || q.page, pageSize: num(d.pageSize) || q.pageSize, items };
    }));
  }

  private get(path: string, params: DashParams): Observable<any> {
    return getDashboardData(this.http, `${this.api}/dashboard/${path}`, params, err => MainDashboardService.describeError(err));
  }
}
