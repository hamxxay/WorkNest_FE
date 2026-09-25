import { Component, signal, OnInit, computed, inject } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { QuotationService } from '../../../services/quotation.service';
import { AuthService } from '../../../services/auth.service';
import { Location, AnnouncementItem, CreateAnnouncementRequest } from '../../../models/admin.model';

export type TagFilterType = 'booked' | 'vacant' | 'quoted' | 'expiring';

export interface SpaceOperationItem {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  spaceTypeId: number;
  spaceTypeName: string;
  locationId?: number | null;
  locationName?: string | null;
  status: 'Booked' | 'Quoted' | 'Available' | 'Expired';
  bookingId?: number | null;
  customerName?: string | null;
  companyName?: string | null;
  bookingStart?: string | Date | null;
  bookingEnd?: string | Date | null;
  bookingStatus?: string | null;
  shiftType?: '24_7' | 'morning' | 'evening' | string;
  quotationId?: number | null;
  quotationNumber?: string | null;
  quotationCustomerName?: string | null;
  quotationDate?: string | Date | null;
  quotationExpiryDate?: string | Date | null;
  quotationAmount?: number | null;
  quotationStatus?: string | null;
  daysRemainingNum?: number | null;
  remainingTimeFormatted?: string;
  isExpiringSoon?: boolean;
  attendantsCount?: number;
  isOverCapacity?: boolean;
  excessAttendants?: number;
  isPrivateSpace?: boolean;
}

export interface SpaceTypeBookedDetail {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  locationName?: string;
  customerName: string;
  companyName?: string;
  occupiedShifts: string[];
  openShifts: string[];
  bookingId?: number | null;
  bookingStart?: string | Date | null;
  bookingEnd?: string | Date | null;
  bookingStatus?: string;
}

export interface SpaceTypeVacantDetail {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  locationName?: string;
  nextBookingDate?: string | Date | null;
  nextBookingCustomer?: string | null;
}

export interface SpaceTypeQuotedDetail {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  locationName?: string;
  customerName: string;
  companyName?: string;
  quotationId?: number;
  quotationNumber: string;
  quotationStatus: string;
  quotationDate: string | Date;
  quotationExpiryDate?: string | Date | null;
  quotationAmount?: number | null;
  isAlsoBooked: boolean;
}

export interface SpaceTypeExpiringDetail {
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  capacity: number;
  locationName?: string;
  customerName: string;
  companyName?: string;
  bookingId?: number;
  bookingStart: string | Date;
  bookingEnd: string | Date;
  daysRemaining: number;
  remainingTimeFormatted: string;
  bookingStatus: string;
}

export interface SpaceTypeCardData {
  spaceTypeId: number;
  spaceTypeName: string;
  totalSpaces: number;
  bookedCount: number;
  vacantCount: number;
  quotedCount: number;
  expiringCount: number;
  bookedDetails: SpaceTypeBookedDetail[];
  vacantDetails: SpaceTypeVacantDetail[];
  quotedDetails: SpaceTypeQuotedDetail[];
  expiringDetails: SpaceTypeExpiringDetail[];
}

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, FormsModule, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard implements OnInit {
  private admin = inject(AdminService);
  private quotationService = inject(QuotationService);
  private router = inject(Router);
  protected auth = inject(AuthService);

  protected readonly Math = Math;

  get isSuperAdmin(): boolean {
    return this.auth.hasRole('super_admin');
  }

  get userLocationId(): number | null {
    return this.auth.user()?.locationId ?? null;
  }

  loading = signal(true);

  // Redesigned Space Types Breakdown Cards with shift-aware details
  spaceTypeCards = signal<SpaceTypeCardData[]>([]);

  // Active Dropdown state: { spaceTypeId, tag } or null
  activeDropdown = signal<{ spaceTypeId: number; tag: TagFilterType } | null>(null);

  // Locations list signal
  locationsList = signal<Location[]>([]);

  // Main Spaces Operational List
  allSpaces = signal<SpaceOperationItem[]>([]);

  // Space Types dropdown options
  spaceTypeOptions = signal<string[]>([]);

  // Filter Signals for Inventory Table
  searchSpace = signal('');
  searchCustomer = signal('');
  selectedSpaceType = signal('ALL');
  selectedLocation = signal('ALL');
  selectedStatus = signal('ALL');
  privateSpacesOnlyFilter = signal(false);
  expiringThreshold = signal(30); // Default 30 days threshold

  // Sorting Signals
  sortBy = signal<'urgency' | 'spaceCode' | 'customer' | 'bookingStart' | 'bookingEnd' | 'remainingTime' | 'status'>('urgency');
  sortOrder = signal<'asc' | 'desc'>('asc');

  // Pagination Signals
  page = signal(1);
  pageSize = signal(10);
  pageSizeOptions = [10, 25, 50, 100];

  totalSpacesCount = computed(() => this.allSpaces().length);

  // ============= ANNOUNCEMENTS & ALERTS STATE SIGNALS =============
  announcementsList = signal<AnnouncementItem[]>([]);
  announcementsLoading = signal<boolean>(false);
  announcementCreating = signal<boolean>(false);
  selectedAnnouncement = signal<AnnouncementItem | null>(null);
  showAnnouncementModal = signal<boolean>(false);
  showAnnouncementDetailModal = signal<boolean>(false);

  // Computed Announcement KPIs
  announcementsTotalBroadcasts = computed(() => this.announcementsList().length);
  announcementsTotalDelivered = computed(() => this.announcementsList().reduce((acc, a) => acc + (a.sentCount || 0) + (a.readCount || 0), 0));
  announcementsTotalRead = computed(() => this.announcementsList().reduce((acc, a) => acc + (a.readCount || 0), 0));
  announcementsTotalFailed = computed(() => this.announcementsList().reduce((acc, a) => acc + (a.failedCount || 0), 0));
  announcementsTotalPending = computed(() => this.announcementsList().reduce((acc, a) => acc + (a.pendingCount || 0), 0));

  // Form State Signals
  announcementTitle = signal<string>('');
  announcementBody = signal<string>('');
  announcementFormType = signal<'Announcement' | 'Alert'>('Announcement');
  announcementTargetScope = signal<'All' | 'Location' | 'Space' | 'CustomList'>('All');
  announcementLocationId = signal<number | null>(null);
  announcementSpaceId = signal<number | null>(null);
  announcementCustomUsersText = signal<string>('');
  announcementScheduleMode = signal<'now' | 'later'>('now');
  announcementScheduledDate = signal<string>('');
  announcementFormError = signal<string>('');
  announcementFormSuccess = signal<string>('');

  ngOnInit() {
    this.loadDashboardData();
    this.loadAnnouncements();
  }

  loadDashboardData() {
    this.loading.set(true);
    this.loadFallbackData();
  }

  /**
   * Helper to normalize ShiftType strings from backend
   */
  normalizeShift(rawShift?: string | null): '24_7' | 'morning' | 'evening' {
    if (!rawShift) return '24_7';
    const s = String(rawShift).toLowerCase().trim();
    if (s.includes('morning') || s.includes('6am') || s === '2') return 'morning';
    if (s.includes('evening') || s.includes('night') || s.includes('6pm') || s === '3') return 'evening';
    return '24_7';
  }

  private loadFallbackData() {
    const safe = (obs: any) => obs.toPromise().catch(() => null);

    Promise.all([
      safe(this.admin.getSpaces(1, 1000)),
      safe(this.admin.getBookings(1, 1000)),
      safe(this.quotationService.getQuotations(1, 1000)),
      safe(this.admin.getCustomers(1, 1000)),
      safe(this.admin.getSpaceTypes(1, 100)),
      safe(this.admin.getLocations(1, 1000))
    ]).then(([spacesRes, bookingsRes, quotationsRes, customersRes, typesRes, locationsRes]) => {
      const extract = (res: any) => {
        if (!res) return [];
        if (Array.isArray(res)) return res;
        if (Array.isArray(res?.data)) return res.data;
        if (Array.isArray(res?.items)) return res.items;
        if (Array.isArray(res?.data?.items)) return res.data.items;
        return [];
      };

      let rawSpaces = extract(spacesRes);
      let rawBookings = extract(bookingsRes);
      let rawQuotations = extract(quotationsRes);
      const rawCustomers = extract(customersRes);
      const rawTypes = extract(typesRes);
      let rawLocations: Location[] = extract(locationsRes);

      const boundLocId = (!this.isSuperAdmin && this.userLocationId) ? this.userLocationId : null;
      if (boundLocId) {
        this.selectedLocation.set(String(boundLocId));
        rawSpaces = rawSpaces.filter((s: any) => {
          const loc = s.locationId ?? s.LocationId;
          return loc != null && Number(loc) === boundLocId;
        });
        const spaceIds = new Set(rawSpaces.map((s: any) => s.id ?? s.spaceId ?? s.SpaceId));
        rawBookings = rawBookings.filter((b: any) => {
          const loc = b.locationId ?? b.LocationId;
          if (loc != null && Number(loc) === boundLocId) return true;
          const sId = b.spaceId ?? b.SpaceId;
          return sId != null && spaceIds.has(sId);
        });
        rawQuotations = rawQuotations.filter((q: any) => {
          const loc = q.locationId ?? q.LocationId;
          if (loc != null && Number(loc) === boundLocId) return true;
          const sId = q.spaceId ?? q.SpaceId;
          return sId != null && spaceIds.has(sId);
        });
        const filteredLocs = rawLocations.filter((l: any) => Number(l.id) === boundLocId);
        rawLocations = filteredLocs.length ? filteredLocs : rawLocations;
      }

      this.locationsList.set(rawLocations);

      const typeMap = new Map<number, string>();
      const typeNamesSet = new Set<string>();
      rawTypes.forEach((t: any) => {
        const id = t.id || t.Id;
        const name = t.name || t.Name || t.description || 'Other';
        if (id) typeMap.set(id, name);
        typeNamesSet.add(name);
      });
      this.spaceTypeOptions.set(Array.from(typeNamesSet));

      const now = new Date();
      const thresholdDays = this.expiringThreshold();

      // Group active bookings per spaceId
      const spaceActiveBookingsMap = new Map<number, any[]>();
      // Group future bookings per spaceId (for next scheduled booking)
      const spaceFutureBookingsMap = new Map<number, any[]>();

      rawBookings.forEach((b: any) => {
        const isDeleted = b.isDeleted || b.IsDeleted || false;
        const statusId = b.bookingStatusId ?? b.BookingStatusId ?? b.statusId ?? b.StatusId;
        const statusStr = String(b.bookingStatusLabel || b.bookingStatus || b.status || '').toLowerCase();
        const isCancelledOrDone = statusStr.includes('cancel') || statusStr.includes('reject') || statusStr.includes('complete');
        
        const startDateStr = b.startOn || b.StartOn || b.startDateTime || b.StartDateTime;
        const startDate = startDateStr ? new Date(startDateStr) : null;
        const endDateStr = b.endOn || b.EndOn || b.endDateTime || b.EndDateTime;
        const endDate = endDateStr ? new Date(endDateStr) : null;

        const sId = b.spaceId || b.SpaceId;
        if (!sId || isDeleted || isCancelledOrDone) return;

        const isActiveBooking = (!statusId || statusId === 1 || statusId === 2) && endDate && endDate >= now && (!startDate || startDate <= now);
        const isFutureBooking = (!statusId || statusId === 1 || statusId === 2) && startDate && startDate > now;

        if (isActiveBooking) {
          if (!spaceActiveBookingsMap.has(sId)) {
            spaceActiveBookingsMap.set(sId, []);
          }
          spaceActiveBookingsMap.get(sId)!.push(b);
        } else if (isFutureBooking) {
          if (!spaceFutureBookingsMap.has(sId)) {
            spaceFutureBookingsMap.set(sId, []);
          }
          spaceFutureBookingsMap.get(sId)!.push(b);
        }
      });

      // Active quotations map per spaceId (latest active quotation)
      const spaceQuotationMap = new Map<number, any>();

      rawQuotations.forEach((q: any) => {
        const statusStr = String(q.status || q.Status || '').toLowerCase();
        const isActiveFlag = q.isActive ?? q.IsActive ?? true;
        const isConvertedOrDead = statusStr === 'converted' || statusStr === 'expired' || statusStr === 'cancelled' || statusStr === 'rejected';
        const validUntilStr = q.validUntil || q.ValidUntil;
        const validUntil = validUntilStr ? new Date(validUntilStr) : null;

        const isActiveQuotation = isActiveFlag && !isConvertedOrDead && (!validUntil || validUntil >= now);

        if (isActiveQuotation && q.spaceId) {
          const existingQ = spaceQuotationMap.get(q.spaceId);
          if (!existingQ || new Date(existingQ.createdDate || 0) < new Date(q.createdDate || 0)) {
            spaceQuotationMap.set(q.spaceId, q);
          }
        }
      });

      // Customer helper
      const resolveCustomer = (customerId: any, customerEmail: string | null, userId: any, fallbackName: string | null) => {
        const custEmailLower = (customerEmail || '').toLowerCase();
        const custObj = rawCustomers.find((c: any) =>
          (c.id || c.Id) === customerId ||
          (c.userId || c.UserId) === userId ||
          (custEmailLower && (c.email || c.Email || '').toLowerCase() === custEmailLower)
        );

        const fullName = custObj
          ? ([custObj.firstName || custObj.FirstName, custObj.lastName || custObj.LastName].filter(Boolean).join(' ').trim() || custObj.name || custObj.Name)
          : null;

        const compName = custObj
          ? (custObj.companyName || custObj.CompanyName || custObj.company || custObj.Company || custObj.customerCompany || custObj.companyTitle)
          : null;

        return {
          name: fullName || fallbackName || 'Customer',
          company: compName || null
        };
      };

      // Construct SpaceOperationItem for each space (for Inventory Table)
      const processedSpaces: SpaceOperationItem[] = rawSpaces.map((s: any, idx: number) => {
        const sId = s.id || s.Id;
        const sCode = s.code || s.Code || `Space-${sId}`;
        const sName = s.name || s.Name || `Space ${sId}`;
        const sCap = s.capacity || s.Capacity || 1;
        const typeId = s.spaceTypeIdInt || s.SpaceTypeIdInt || s.spaceTypeId || s.SpaceTypeId || 0;
        const typeName = typeMap.get(typeId) || s.spaceTypeName || s.SpaceTypeName || 'Other';

        let locId = s.locationId || s.LocationId || null;
        let locName = s.locationName || s.LocationName || s.branchName || s.BranchName;
        if (!locName && locId && rawLocations.length > 0) {
          const matchLoc = rawLocations.find((l: any) => l.id === locId);
          if (matchLoc) locName = matchLoc.name;
        }
        if (!locName) {
          const defaultLocs = ['Gulberg Executive Center', 'DHA Tech Hub', 'Blue Area Commercial Plaza'];
          locName = defaultLocs[idx % defaultLocs.length];
        }

        const activeBookings = spaceActiveBookingsMap.get(sId) || [];
        const primaryBooking = activeBookings[0] || null;
        const activeQuotation = spaceQuotationMap.get(sId);

        let spaceStatus: 'Booked' | 'Quoted' | 'Available' | 'Expired' = 'Available';
        let bStart: any = null;
        let bEnd: any = null;
        let bCustName: string | null = null;
        let bCompName: string | null = null;
        let bStatusStr: string | null = null;
        let bId: number | null = null;
        let bShift: string | undefined = undefined;
        let rawAttendantsCount = 0;

        let qId: number | null = null;
        let qNum: string | null = null;
        let qCustName: string | null = null;
        let qDate: any = null;
        let qExpiry: any = null;
        let qAmt: number | null = null;
        let qStatusStr: string | null = null;

        if (primaryBooking) {
          spaceStatus = 'Booked';
          bId = primaryBooking.id || primaryBooking.Id;
          bStart = primaryBooking.startOn || primaryBooking.StartOn || primaryBooking.startDateTime;
          bEnd = primaryBooking.endOn || primaryBooking.EndOn || primaryBooking.endDateTime;
          bStatusStr = primaryBooking.bookingStatusLabel || primaryBooking.bookingStatus || primaryBooking.status || 'Confirmed';
          bShift = primaryBooking.shiftType || primaryBooking.ShiftType || primaryBooking.offeringType || '24_7';

          const resolvedCust = resolveCustomer(
            primaryBooking.customerId,
            primaryBooking.userEmail || primaryBooking.customerEmail,
            primaryBooking.userId,
            primaryBooking.customerName
          );
          bCustName = resolvedCust.name;
          bCompName = resolvedCust.company;

          rawAttendantsCount = primaryBooking.attendantsCount ?? primaryBooking.occupantsCount ?? (primaryBooking.attendants ? primaryBooking.attendants.length : 0);
        } else if (activeQuotation) {
          spaceStatus = 'Quoted';
          qId = activeQuotation.id || activeQuotation.Id;
          qNum = activeQuotation.quotationNumber || activeQuotation.QuotationNumber || `#Q-${qId}`;
          qDate = activeQuotation.quotationDate || activeQuotation.QuotationDate;
          qExpiry = activeQuotation.validUntil || activeQuotation.ValidUntil;
          qAmt = Number(activeQuotation.totalAmount || activeQuotation.TotalAmount || 0);
          qStatusStr = activeQuotation.status || activeQuotation.Status || 'Pending';

          const resolvedCust = resolveCustomer(
            activeQuotation.customerId,
            activeQuotation.customerEmail || activeQuotation.userEmail,
            null,
            activeQuotation.customerName
          );
          qCustName = resolvedCust.name;
        }

        const timeInfo = this.formatTimeRemaining(bEnd);
        const isExpiring = spaceStatus === 'Booked' && timeInfo.days > 0 && timeInfo.days <= thresholdDays;

        const lowerType = typeName.toLowerCase();
        const isPrivate = lowerType.includes('private') || lowerType.includes('office') || lowerType.includes('suite') || lowerType.includes('room') || sCap > 1;
        const isOverCap = spaceStatus === 'Booked' && rawAttendantsCount > sCap;
        const excessAtt = isOverCap ? (rawAttendantsCount - sCap) : 0;

        return {
          spaceId: sId,
          spaceCode: sCode,
          spaceName: sName,
          capacity: sCap,
          spaceTypeId: typeId,
          spaceTypeName: typeName,
          locationId: locId,
          locationName: locName,
          status: spaceStatus,
          bookingId: bId,
          customerName: bCustName,
          companyName: bCompName,
          bookingStart: bStart,
          bookingEnd: bEnd,
          bookingStatus: bStatusStr,
          shiftType: bShift,
          quotationId: qId,
          quotationNumber: qNum,
          quotationCustomerName: qCustName,
          quotationDate: qDate,
          quotationExpiryDate: qExpiry,
          quotationAmount: qAmt,
          quotationStatus: qStatusStr,
          daysRemainingNum: timeInfo.days,
          remainingTimeFormatted: timeInfo.text,
          isExpiringSoon: isExpiring,
          attendantsCount: rawAttendantsCount,
          isOverCapacity: isOverCap,
          excessAttendants: excessAtt,
          isPrivateSpace: isPrivate
        };
      });

      this.allSpaces.set(processedSpaces);

      // =========================================================================
      // BUILD REDESIGNED SPACE TYPE CAPACITY & OCCUPANCY CARDS
      // =========================================================================
      const cardsMap = new Map<number, SpaceTypeCardData>();

      // Initialize entry for all known space types from database
      rawTypes.forEach((t: any) => {
        const id = Number(t.id || t.Id);
        const name = String(t.name || t.Name || t.description || 'Other');
        if (id && !cardsMap.has(id)) {
          cardsMap.set(id, {
            spaceTypeId: id,
            spaceTypeName: name,
            totalSpaces: 0,
            bookedCount: 0,
            vacantCount: 0,
            quotedCount: 0,
            expiringCount: 0,
            bookedDetails: [],
            vacantDetails: [],
            quotedDetails: [],
            expiringDetails: []
          });
        }
      });

      // Aggregate each space into its space type card
      processedSpaces.forEach(sp => {
        let card = cardsMap.get(sp.spaceTypeId);
        if (!card) {
          card = {
            spaceTypeId: sp.spaceTypeId,
            spaceTypeName: sp.spaceTypeName,
            totalSpaces: 0,
            bookedCount: 0,
            vacantCount: 0,
            quotedCount: 0,
            expiringCount: 0,
            bookedDetails: [],
            vacantDetails: [],
            quotedDetails: [],
            expiringDetails: []
          };
          cardsMap.set(sp.spaceTypeId, card);
        }

        card.totalSpaces++;

        const activeBookings = spaceActiveBookingsMap.get(sp.spaceId) || [];
        const isBooked = activeBookings.length > 0;

        // 1. BOOKED SPACES
        if (isBooked) {
          card.bookedCount++;

          const has24_7 = activeBookings.some(b => this.normalizeShift(b.shiftType || b.ShiftType || b.offeringType) === '24_7');
          const hasMorning = activeBookings.some(b => this.normalizeShift(b.shiftType || b.ShiftType || b.offeringType) === 'morning');
          const hasEvening = activeBookings.some(b => this.normalizeShift(b.shiftType || b.ShiftType || b.offeringType) === 'evening');

          const occupiedShifts: string[] = [];
          const openShifts: string[] = [];

          if (has24_7) {
            occupiedShifts.push('24/7 (Full Day)');
            openShifts.push('None (Fully Occupied)');
          } else {
            if (hasMorning) occupiedShifts.push('Morning (6am-6pm)');
            else openShifts.push('Morning (6am-6pm)');

            if (hasEvening) occupiedShifts.push('Evening (6pm-6am)');
            else openShifts.push('Evening (6pm-6am)');

            if (openShifts.length === 0) {
              openShifts.push('None (Fully Occupied)');
            }
          }

          const primaryB = activeBookings[0];
          const resolvedCust = resolveCustomer(
            primaryB.customerId,
            primaryB.userEmail || primaryB.customerEmail,
            primaryB.userId,
            primaryB.customerName
          );

          card.bookedDetails.push({
            spaceId: sp.spaceId,
            spaceCode: sp.spaceCode,
            spaceName: sp.spaceName,
            capacity: sp.capacity,
            locationName: sp.locationName || undefined,
            customerName: resolvedCust.name,
            companyName: resolvedCust.company || undefined,
            occupiedShifts,
            openShifts,
            bookingId: primaryB.id || primaryB.Id,
            bookingStart: primaryB.startOn || primaryB.StartOn || primaryB.startDateTime,
            bookingEnd: primaryB.endOn || primaryB.EndOn || primaryB.endDateTime,
            bookingStatus: primaryB.bookingStatusLabel || primaryB.bookingStatus || 'Confirmed'
          });

          // Check if any active booking on this space is Expiring Soon
          activeBookings.forEach(b => {
            const endDate = b.endOn || b.EndOn || b.endDateTime;
            const timeInfo = this.formatTimeRemaining(endDate);
            if (timeInfo.days > 0 && timeInfo.days <= thresholdDays) {
              card.expiringCount++;
              card.expiringDetails.push({
                spaceId: sp.spaceId,
                spaceCode: sp.spaceCode,
                spaceName: sp.spaceName,
                capacity: sp.capacity,
                locationName: sp.locationName || undefined,
                customerName: resolvedCust.name,
                companyName: resolvedCust.company || undefined,
                bookingId: b.id || b.Id,
                bookingStart: b.startOn || b.StartOn || b.startDateTime,
                bookingEnd: endDate,
                daysRemaining: timeInfo.days,
                remainingTimeFormatted: timeInfo.text,
                bookingStatus: b.bookingStatusLabel || b.bookingStatus || 'Confirmed'
              });
            }
          });
        } else {
          // 2. VACANT SPACES (zero active bookings on any shift)
          card.vacantCount++;

          const futureBookings = spaceFutureBookingsMap.get(sp.spaceId) || [];
          let nextDate: any = null;
          let nextCust: string | null = null;

          if (futureBookings.length > 0) {
            futureBookings.sort((a, b) => new Date(a.startOn || a.startDateTime || 0).getTime() - new Date(b.startOn || b.startDateTime || 0).getTime());
            const fb = futureBookings[0];
            nextDate = fb.startOn || fb.StartOn || fb.startDateTime;
            const resolvedCust = resolveCustomer(fb.customerId, fb.userEmail || fb.customerEmail, fb.userId, fb.customerName);
            nextCust = resolvedCust.name;
          }

          card.vacantDetails.push({
            spaceId: sp.spaceId,
            spaceCode: sp.spaceCode,
            spaceName: sp.spaceName,
            capacity: sp.capacity,
            locationName: sp.locationName || undefined,
            nextBookingDate: nextDate,
            nextBookingCustomer: nextCust
          });
        }

        // 3. QUOTED SPACES (Active unconverted quotation - can coexist with Booked status)
        const qObj = spaceQuotationMap.get(sp.spaceId);
        if (qObj) {
          card.quotedCount++;
          const resolvedCust = resolveCustomer(
            qObj.customerId,
            qObj.customerEmail || qObj.userEmail,
            null,
            qObj.customerName
          );

          card.quotedDetails.push({
            spaceId: sp.spaceId,
            spaceCode: sp.spaceCode,
            spaceName: sp.spaceName,
            capacity: sp.capacity,
            locationName: sp.locationName || undefined,
            customerName: resolvedCust.name,
            companyName: resolvedCust.company || undefined,
            quotationId: qObj.id || qObj.Id,
            quotationNumber: qObj.quotationNumber || qObj.QuotationNumber || `#Q-${qObj.id}`,
            quotationStatus: qObj.status || qObj.Status || 'Pending',
            quotationDate: qObj.quotationDate || qObj.QuotationDate || qObj.createdDate,
            quotationExpiryDate: qObj.validUntil || qObj.ValidUntil,
            quotationAmount: Number(qObj.totalAmount || qObj.TotalAmount || 0),
            isAlsoBooked: isBooked
          });
        }
      });

      // Filter out types with 0 total spaces if not active, or keep cards sorted
      const cardList = Array.from(cardsMap.values())
        .filter(c => c.totalSpaces > 0 || c.spaceTypeName !== 'Other')
        .sort((a, b) => b.totalSpaces - a.totalSpaces);

      this.spaceTypeCards.set(cardList);
      this.loading.set(false);
    });
  }

  // =========================================================================
  // CARD & DROPDOWN INTERACTION HANDLERS
  // =========================================================================

  toggleTagDropdown(event: Event, spaceTypeId: number, tag: TagFilterType) {
    event.stopPropagation(); // Prevents triggering card-level filter
    const cur = this.activeDropdown();
    if (cur && cur.spaceTypeId === spaceTypeId && cur.tag === tag) {
      this.activeDropdown.set(null);
    } else {
      this.activeDropdown.set({ spaceTypeId, tag });
    }
  }

  closeDropdown(event?: Event) {
    if (event) event.stopPropagation();
    this.activeDropdown.set(null);
  }

  selectCardSpaceType(spaceTypeName: string) {
    if (this.selectedSpaceType() === spaceTypeName) {
      this.selectedSpaceType.set('ALL');
    } else {
      this.selectedSpaceType.set(spaceTypeName);
    }
    this.onFilterChange();
  }

  // Dynamic Time Remaining Formatter
  formatTimeRemaining(endDateInput: any): { text: string; days: number; isExpired: boolean } {
    if (!endDateInput) return { text: '—', days: 99999, isExpired: false };
    const endDate = new Date(endDateInput);
    if (isNaN(endDate.getTime())) return { text: '—', days: 99999, isExpired: false };

    const now = new Date();
    const diffTime = endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      return { text: 'Expired', days: diffDays, isExpired: true };
    }

    if (diffDays >= 30) {
      const months = Math.floor(diffDays / 30);
      const remDays = diffDays % 30;
      if (remDays === 0) {
        return { text: `${months} month${months > 1 ? 's' : ''} remaining`, days: diffDays, isExpired: false };
      }
      return { text: `${months} month${months > 1 ? 's' : ''} ${remDays} day${remDays > 1 ? 's' : ''} remaining`, days: diffDays, isExpired: false };
    } else {
      return { text: `${diffDays} day${diffDays > 1 ? 's' : ''} remaining`, days: diffDays, isExpired: false };
    }
  }

  // =========================================================================
  // FILTERED SPACES COMPUTED SIGNAL (FOR INVENTORY TABLE)
  // =========================================================================
  filteredSpaces = computed(() => {
    let list = [...this.allSpaces()];
    const sSpace = this.searchSpace().toLowerCase().trim();
    const sCust = this.searchCustomer().toLowerCase().trim();
    const sType = this.selectedSpaceType();
    const sLoc = this.selectedLocation();
    const sStatus = this.selectedStatus();
    const sPrivOnly = this.privateSpacesOnlyFilter();

    if (sSpace) {
      list = list.filter(item => 
        item.spaceCode.toLowerCase().includes(sSpace) || 
        item.spaceName.toLowerCase().includes(sSpace)
      );
    }

    if (sCust) {
      list = list.filter(item => {
        const cName = (item.customerName || item.quotationCustomerName || '').toLowerCase();
        const compName = (item.companyName || '').toLowerCase();
        return cName.includes(sCust) || compName.includes(sCust);
      });
    }

    if (sType !== 'ALL') {
      list = list.filter(item => item.spaceTypeName === sType);
    }

    if (sLoc !== 'ALL') {
      list = list.filter(item => item.locationName === sLoc || String(item.locationId) === sLoc);
    }

    if (sStatus !== 'ALL') {
      list = list.filter(item => item.status === sStatus);
    }

    if (sPrivOnly) {
      list = list.filter(item => item.isPrivateSpace);
    }

    // Apply Sorting
    const sortField = this.sortBy();
    const isAsc = this.sortOrder() === 'asc';

    list.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      if (sortField === 'urgency') {
        const getPriority = (item: SpaceOperationItem) => {
          if (item.status === 'Booked' && item.isExpiringSoon) return 1;
          if (item.status === 'Booked') return 2;
          if (item.status === 'Quoted') return 3;
          return 4;
        };
        const prioA = getPriority(a);
        const prioB = getPriority(b);
        if (prioA !== prioB) return prioA - prioB;

        if (prioA === 1) return (a.daysRemainingNum || 0) - (b.daysRemainingNum || 0);
        return a.spaceCode.localeCompare(b.spaceCode, undefined, { numeric: true });
      }

      switch (sortField) {
        case 'spaceCode':
          return isAsc 
            ? a.spaceCode.localeCompare(b.spaceCode, undefined, { numeric: true })
            : b.spaceCode.localeCompare(a.spaceCode, undefined, { numeric: true });
        case 'customer':
          valA = (a.customerName || a.quotationCustomerName || '—').toLowerCase();
          valB = (b.customerName || b.quotationCustomerName || '—').toLowerCase();
          break;
        case 'bookingStart':
          valA = a.bookingStart ? new Date(a.bookingStart).getTime() : 0;
          valB = b.bookingStart ? new Date(b.bookingStart).getTime() : 0;
          break;
        case 'bookingEnd':
          valA = a.bookingEnd ? new Date(a.bookingEnd).getTime() : 0;
          valB = b.bookingEnd ? new Date(b.bookingEnd).getTime() : 0;
          break;
        case 'remainingTime':
          valA = a.daysRemainingNum ?? 99999;
          valB = b.daysRemainingNum ?? 99999;
          break;
        case 'status':
          valA = a.status;
          valB = b.status;
          break;
      }

      if (valA < valB) return isAsc ? -1 : 1;
      if (valA > valB) return isAsc ? 1 : -1;
      return 0;
    });

    return list;
  });

  // Pagination Computations
  totalPages = computed(() => Math.max(1, Math.ceil(this.filteredSpaces().length / this.pageSize())));
  canPrev = computed(() => this.page() > 1);
  canNext = computed(() => this.page() < this.totalPages());

  paginatedSpaces = computed(() => {
    const list = this.filteredSpaces();
    const p = this.page();
    const size = this.pageSize();
    const start = (p - 1) * size;
    return list.slice(start, start + size);
  });

  // Filter & Page Handlers
  onFilterChange() {
    this.page.set(1);
  }

  setThreshold(days: number) {
    this.expiringThreshold.set(days);
    this.onFilterChange();
    this.loadDashboardData();
    this.loadAnnouncements();
  }

  toggleSort(field: 'urgency' | 'spaceCode' | 'customer' | 'bookingStart' | 'bookingEnd' | 'remainingTime' | 'status') {
    if (this.sortBy() === field) {
      this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortBy.set(field);
      this.sortOrder.set('asc');
    }
    this.page.set(1);
  }

  prevPage() {
    if (this.canPrev()) this.page.set(this.page() - 1);
  }

  nextPage() {
    if (this.canNext()) this.page.set(this.page() + 1);
  }

  setPageSize(size: number) {
    this.pageSize.set(size);
    this.page.set(1);
  }

  // Navigation Links
  viewSpaceDetails(space: { spaceCode?: string; spaceId?: number }) {
    this.router.navigate(['/admin/spaces'], { queryParams: { search: space.spaceCode || String(space.spaceId) } });
  }

  viewBookingDetails(bookingId?: number | null, spaceCode?: string) {
    if (bookingId) {
      this.router.navigate(['/admin/bookings'], { queryParams: { search: String(bookingId) } });
    } else if (spaceCode) {
      this.router.navigate(['/admin/bookings'], { queryParams: { search: spaceCode } });
    } else {
      this.router.navigate(['/admin/bookings']);
    }
  }

  viewQuotationDetails(quotationId?: number | null, quotationNumber?: string) {
    if (quotationNumber) {
      this.router.navigate(['/admin/quotations'], { queryParams: { search: quotationNumber } });
    } else if (quotationId) {
      this.router.navigate(['/admin/quotations'], { queryParams: { search: String(quotationId) } });
    } else {
      this.router.navigate(['/admin/quotations']);
    }
  }

  // ============= ANNOUNCEMENTS & ALERTS METHODS =============

  loadAnnouncements() {
    this.announcementsLoading.set(true);
    this.admin.getAnnouncements(1, 50).subscribe({
      next: (res: any) => {
        this.announcementsLoading.set(false);
        const list = res.data?.items || (Array.isArray(res.data) ? res.data : []);
        this.announcementsList.set(list);
      },
      error: () => {
        this.announcementsLoading.set(false);
      }
    });
  }

  openCreateAnnouncementModal() {
    this.announcementTitle.set('');
    this.announcementBody.set('');
    this.announcementFormType.set('Announcement');
    this.announcementTargetScope.set('All');
    this.announcementLocationId.set(null);
    this.announcementSpaceId.set(null);
    this.announcementCustomUsersText.set('');
    this.announcementScheduleMode.set('now');
    this.announcementScheduledDate.set('');
    this.announcementFormError.set('');
    this.announcementFormSuccess.set('');
    this.showAnnouncementModal.set(true);
  }

  closeCreateAnnouncementModal() {
    this.showAnnouncementModal.set(false);
  }

  submitAnnouncement() {
    const title = this.announcementTitle().trim();
    const body = this.announcementBody().trim();
    const type = this.announcementFormType();
    const scope = this.announcementTargetScope();

    if (!title) {
      this.announcementFormError.set('Please enter an announcement title.');
      return;
    }
    if (!body) {
      this.announcementFormError.set('Please enter a message body.');
      return;
    }

    let customIds: number[] | undefined;
    if (scope === 'CustomList') {
      const parts = this.announcementCustomUsersText()
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0 && !isNaN(Number(p)))
        .map(p => Number(p));
      if (parts.length === 0) {
        this.announcementFormError.set('Please enter at least one valid numeric User ID.');
        return;
      }
      customIds = parts;
    }

    if (scope === 'Location' && !this.announcementLocationId()) {
      this.announcementFormError.set('Please select a target Location.');
      return;
    }

    if (scope === 'Space' && !this.announcementSpaceId()) {
      this.announcementFormError.set('Please select a target Space.');
      return;
    }

    let scheduledAt: string | null = null;
    if (this.announcementScheduleMode() === 'later' && this.announcementScheduledDate()) {
      scheduledAt = new Date(this.announcementScheduledDate()).toISOString();
    }

    const payload: CreateAnnouncementRequest = {
      title,
      body,
      type,
      targetScope: scope,
      locationId: scope === 'Location' ? this.announcementLocationId() : null,
      spaceId: scope === 'Space' ? this.announcementSpaceId() : null,
      customUserIds: customIds,
      scheduledAt
    };

    this.announcementCreating.set(true);
    this.announcementFormError.set('');
    this.announcementFormSuccess.set('');

    this.admin.createAnnouncement(payload).subscribe({
      next: () => {
        this.announcementCreating.set(false);
        this.announcementFormSuccess.set('Announcement broadcasted and recipients queued successfully!');
        setTimeout(() => {
          this.closeCreateAnnouncementModal();
          this.loadAnnouncements();
        }, 1200);
      },
      error: (err) => {
        this.announcementCreating.set(false);
        this.announcementFormError.set(err.error?.message || 'Failed to dispatch announcement.');
      }
    });
  }

  viewAnnouncementDetail(item: AnnouncementItem) {
    this.selectedAnnouncement.set(item);
    this.showAnnouncementDetailModal.set(true);
    // Fetch full detail with recipient rows
    this.admin.getAnnouncementById(item.id).subscribe({
      next: (res) => {
        if (res.data) {
          this.selectedAnnouncement.set(res.data);
        }
      }
    });
  }

  closeAnnouncementDetailModal() {
    this.showAnnouncementDetailModal.set(false);
    this.selectedAnnouncement.set(null);
  }
}
