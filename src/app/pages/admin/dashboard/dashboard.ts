import { Component, signal, OnInit, computed, inject, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { QuotationService } from '../../../services/quotation.service';
import { AuthService } from '../../../services/auth.service';
import { Location } from '../../../models/admin.model';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

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

export interface SpaceTypeBreakdown {
  spaceTypeId: number;
  spaceTypeName: string;
  total: number;
  available: number;
  quoted: number;
  booked: number;
  totalCapacity: number;
  filledCapacity: number;
  emptyCapacity: number;
  bookedCapacity: number;
  quotedCapacity: number;
  occupancyPercentage: number;
}

export interface ExpiringBookingItem {
  bookingId: number;
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  spaceTypeName: string;
  customerName: string;
  companyName?: string;
  bookingStart: string | Date;
  bookingEnd: string | Date;
  daysRemaining: number;
  bookingStatus: string;
  remainingTimeFormatted: string;
}

export interface ActiveQuotationItem {
  quotationId: number;
  quotationNumber: string;
  spaceId: number;
  spaceCode: string;
  spaceName: string;
  spaceTypeName: string;
  customerName: string;
  quotationDate: string | Date;
  quotationExpiryDate?: string | Date;
  quotationAmount: number;
  quotationStatus: string;
  bookingStatus: string;
}

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, FormsModule, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard implements OnInit, AfterViewInit, OnDestroy {
  private admin = inject(AdminService);
  private quotationService = inject(QuotationService);
  private router = inject(Router);
  protected auth = inject(AuthService);

  @ViewChild('capacityChartCanvas') capacityChartCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('locationChartCanvas') locationChartCanvas?: ElementRef<HTMLCanvasElement>;

  private capacityChart?: Chart;
  private locationChart?: Chart;

  protected readonly Math = Math;

  get isSuperAdmin(): boolean {
    return this.auth.hasRole('super_admin');
  }

  get userLocationId(): number | null {
    return this.auth.user()?.locationId ?? null;
  }

  loading = signal(true);

  // Top KPI Summary Counts
  kpiStats = signal({
    totalSpaces: 0,
    availableSpaces: 0,
    quotedSpaces: 0,
    bookedSpaces: 0,
    expiringSoonBookings: 0,
    activeCustomers: 0
  });

  // Space Type Breakdown List
  spaceTypeBreakdowns = signal<SpaceTypeBreakdown[]>([]);

  // Locations list signal
  locationsList = signal<Location[]>([]);

  // Main Spaces Operational List
  allSpaces = signal<SpaceOperationItem[]>([]);

  // Expiring Bookings List
  expiringBookings = signal<ExpiringBookingItem[]>([]);

  // Active Quotations List
  activeQuotations = signal<ActiveQuotationItem[]>([]);

  // Quotation Activity Feed (Customer Accept/Decline responses)
  quotationActivities = signal<any[]>([]);

  // Space Types dropdown options
  spaceTypeOptions = signal<string[]>([]);

  // Filter Signals
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

  // Private Spaces Computed Metrics
  privateSpacesList = computed(() => {
    return this.allSpaces().filter(s => s.isPrivateSpace);
  });

  totalPrivateCapacity = computed(() => {
    return this.privateSpacesList().reduce((acc, s) => acc + (s.capacity || 0), 0);
  });

  occupiedPrivateCapacity = computed(() => {
    return this.privateSpacesList().reduce((acc, s) => {
      if (s.status === 'Booked') {
        return acc + (s.attendantsCount || 0);
      }
      return acc;
    }, 0);
  });

  totalPrivateSpacesCount = computed(() => this.privateSpacesList().length);

  occupiedPrivateSpacesCount = computed(() => {
    return this.privateSpacesList().filter(s => s.status === 'Booked').length;
  });

  privateOccupancyPercentage = computed(() => {
    const total = this.totalPrivateCapacity();
    if (!total) return 0;
    return Math.round((this.occupiedPrivateCapacity() / total) * 100);
  });

  overCapacitySpacesList = computed(() => {
    return this.allSpaces().filter(s => s.isOverCapacity);
  });

  ngOnInit() {
    this.loadDashboardData();
  }

  ngAfterViewInit() {
    this.updateCharts();
  }

  ngOnDestroy() {
    if (this.capacityChart) this.capacityChart.destroy();
    if (this.locationChart) this.locationChart.destroy();
  }

  loadDashboardData() {
    this.loading.set(true);
    this.loadFallbackData();
  }

  private processEndpointResponse(data: any) {
    // Process KPI stats
    const kpi = data.kpiStats || data.summary || (Array.isArray(data) ? data[0]?.[0] : null);
    if (kpi) {
      this.kpiStats.set({
        totalSpaces: Number(kpi.totalSpaces ?? kpi.TotalSpaces ?? 0),
        availableSpaces: Number(kpi.availableSpaces ?? kpi.AvailableSpaces ?? 0),
        quotedSpaces: Number(kpi.quotedSpaces ?? kpi.QuotedSpaces ?? 0),
        bookedSpaces: Number(kpi.bookedSpaces ?? kpi.BookedSpaces ?? 0),
        expiringSoonBookings: Number(kpi.expiringSoonBookings ?? kpi.ExpiringSoonBookings ?? 0),
        activeCustomers: Number(kpi.activeCustomers ?? kpi.ActiveCustomers ?? 0)
      });
    }

    // Process Space Type breakdown
    const breakdownsData = data.spaceTypeBreakdowns || data.spaceTypes || (Array.isArray(data) ? data[1] : []);
    if (Array.isArray(breakdownsData)) {
      const breakdowns: SpaceTypeBreakdown[] = breakdownsData.map((b: any) => {
        const totCap = Number(b.totalCapacity || b.TotalCapacity || 0);
        const fillCap = Number(b.filledCapacity || b.FilledCapacity || 0);
        const empCap = Number(b.emptyCapacity || b.EmptyCapacity || Math.max(0, totCap - fillCap));
        const bkdCap = Number(b.bookedCapacity || b.BookedCapacity || 0);
        const qtdCap = Number(b.quotedCapacity || b.QuotedCapacity || 0);
        const occPct = totCap > 0 ? Math.round((fillCap / totCap) * 100) : Number(b.occupancyPercentage || b.OccupancyPercentage || 0);

        return {
          spaceTypeId: Number(b.spaceTypeId || b.SpaceTypeId || 0),
          spaceTypeName: String(b.spaceTypeName || b.SpaceTypeName || 'Other'),
          total: Number(b.total || b.Total || 0),
          available: Number(b.available || b.Available || 0),
          quoted: Number(b.quoted || b.Quoted || 0),
          booked: Number(b.booked || b.Booked || 0),
          totalCapacity: totCap,
          filledCapacity: fillCap,
          emptyCapacity: empCap,
          bookedCapacity: bkdCap,
          quotedCapacity: qtdCap,
          occupancyPercentage: occPct
        };
      });
      this.spaceTypeBreakdowns.set(breakdowns);
      this.spaceTypeOptions.set(breakdowns.map(b => b.spaceTypeName));
    }

    // Process All Spaces list
    const rawSpaces = data.allSpaces || data.spaces || (Array.isArray(data) ? data[2] : []);
    if (Array.isArray(rawSpaces)) {
      const processedSpaces: SpaceOperationItem[] = rawSpaces.map((s: any) => {
        const endDate = s.bookingEnd || s.BookingEnd || s.endOn || s.EndOn;
        const timeInfo = this.formatTimeRemaining(endDate);
        const statusVal = s.status || s.Status || 'Available';
        const isExpiring = statusVal === 'Booked' && timeInfo.days > 0 && timeInfo.days <= this.expiringThreshold();

        return {
          spaceId: Number(s.spaceId || s.SpaceId || s.id || 0),
          spaceCode: String(s.spaceCode || s.SpaceCode || s.code || ('Space-' + (s.id || ''))),
          spaceName: String(s.spaceName || s.SpaceName || s.name || ''),
          capacity: Number(s.capacity || s.Capacity || 0),
          spaceTypeId: Number(s.spaceTypeId || s.SpaceTypeId || 0),
          spaceTypeName: String(s.spaceTypeName || s.SpaceTypeName || s.spaceType || 'Other'),
          status: statusVal,
          bookingId: s.bookingId || s.BookingId || null,
          customerName: s.customerName || s.CustomerName || s.bookingCustomerName || s.BookingCustomerName || null,
          companyName: s.companyName || s.CompanyName || s.bookingCompanyName || s.BookingCompanyName || null,
          bookingStart: s.bookingStart || s.BookingStart || s.startOn || s.StartOn || null,
          bookingEnd: endDate || null,
          bookingStatus: s.bookingStatus || s.BookingStatus || null,
          quotationId: s.quotationId || s.QuotationId || null,
          quotationNumber: s.quotationNumber || s.QuotationNumber || null,
          quotationCustomerName: s.quotationCustomerName || s.QuotationCustomerName || null,
          quotationDate: s.quotationDate || s.QuotationDate || null,
          quotationExpiryDate: s.quotationExpiryDate || s.QuotationExpiryDate || null,
          quotationAmount: s.quotationAmount != null ? Number(s.quotationAmount) : (s.QuotationAmount != null ? Number(s.QuotationAmount) : null),
          quotationStatus: s.quotationStatus || s.QuotationStatus || null,
          daysRemainingNum: timeInfo.days,
          remainingTimeFormatted: timeInfo.text,
          isExpiringSoon: isExpiring
        };
      });
      this.allSpaces.set(processedSpaces);
    }

    // Process Expiring Bookings
    const rawExpiring = data.expiringBookings || (Array.isArray(data) ? data[3] : []);
    if (Array.isArray(rawExpiring)) {
      const processedExpiring: ExpiringBookingItem[] = rawExpiring.map((b: any) => {
        const endDate = b.bookingEnd || b.BookingEnd || b.endOn;
        const timeInfo = this.formatTimeRemaining(endDate);
        return {
          bookingId: Number(b.bookingId || b.BookingId || b.id || 0),
          spaceId: Number(b.spaceId || b.SpaceId || 0),
          spaceCode: String(b.spaceCode || b.SpaceCode || b.spaceName || 'Space'),
          spaceName: String(b.spaceName || b.SpaceName || ''),
          spaceTypeName: String(b.spaceTypeName || b.SpaceTypeName || 'Office'),
          customerName: String(b.customerName || b.CustomerName || b.userEmail || 'Customer'),
          companyName: b.companyName || b.CompanyName,
          bookingStart: b.bookingStart || b.BookingStart || b.startOn,
          bookingEnd: endDate,
          daysRemaining: timeInfo.days,
          bookingStatus: String(b.bookingStatus || b.BookingStatus || 'Active'),
          remainingTimeFormatted: timeInfo.text
        };
      });
      this.expiringBookings.set(processedExpiring);
    }

    // Process Active Quotations
    const rawQuotations = data.activeQuotations || (Array.isArray(data) ? data[4] : []);
    if (Array.isArray(rawQuotations)) {
      const processedQuotations: ActiveQuotationItem[] = rawQuotations.map((q: any) => ({
        quotationId: Number(q.quotationId || q.QuotationId || q.id || 0),
        quotationNumber: String(q.quotationNumber || q.QuotationNumber || '#Q-100'),
        spaceId: Number(q.spaceId || q.SpaceId || 0),
        spaceCode: String(q.spaceCode || q.SpaceCode || q.spaceName || 'Space'),
        spaceName: String(q.spaceName || q.SpaceName || ''),
        spaceTypeName: String(q.spaceTypeName || q.SpaceTypeName || 'Office'),
        customerName: String(q.customerName || q.CustomerName || 'Customer'),
        quotationDate: q.quotationDate || q.QuotationDate || q.createdDate,
        quotationExpiryDate: q.quotationExpiryDate || q.QuotationExpiryDate || q.validUntil,
        quotationAmount: Number(q.quotationAmount || q.QuotationAmount || q.totalAmount || 0),
        quotationStatus: String(q.quotationStatus || q.QuotationStatus || q.status || 'Pending'),
        bookingStatus: String(q.bookingStatus || q.BookingStatus || 'Not Booked')
      }));
      this.activeQuotations.set(processedQuotations);
    }
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

      // Active bookings map per spaceId (latest active booking)
      const spaceBookingMap = new Map<number, any>();
      const activeBookingsList: any[] = [];

      rawBookings.forEach((b: any) => {
        const isDeleted = b.isDeleted || b.IsDeleted || false;
        const statusId = b.bookingStatusId ?? b.BookingStatusId ?? b.statusId ?? b.StatusId;
        const statusStr = String(b.bookingStatusLabel || b.bookingStatus || b.status || '').toLowerCase();
        
        const isCancelledOrDone = statusStr.includes('cancel') || statusStr.includes('reject') || statusStr.includes('complete');
        const endDateStr = b.endOn || b.EndOn || b.endDateTime || b.EndDateTime;
        const endDate = endDateStr ? new Date(endDateStr) : null;
        
        const isActiveBooking = !isDeleted && (!statusId || statusId === 1 || statusId === 2) && !isCancelledOrDone && endDate && endDate >= now;

        if (isActiveBooking && b.spaceId) {
          activeBookingsList.push(b);
          const existing = spaceBookingMap.get(b.spaceId);
          if (!existing || new Date(existing.endOn || existing.EndOn || existing.endDateTime || 0) < endDate) {
            spaceBookingMap.set(b.spaceId, b);
          }
        }
      });

      // Active quotations map per spaceId (latest active quotation)
      const spaceQuotationMap = new Map<number, any>();
      const activeQuotationsList: ActiveQuotationItem[] = [];

      rawQuotations.forEach((q: any) => {
        const statusStr = String(q.status || q.Status || '').toLowerCase();
        const isActiveFlag = q.isActive ?? q.IsActive ?? true;
        const isConvertedOrDead = statusStr === 'converted' || statusStr === 'expired' || statusStr === 'cancelled' || statusStr === 'rejected';
        const validUntilStr = q.validUntil || q.ValidUntil;
        const validUntil = validUntilStr ? new Date(validUntilStr) : null;

        const isActiveQuotation = isActiveFlag && !isConvertedOrDead && (!validUntil || validUntil >= now);

        if (isActiveQuotation && q.spaceId) {
          const spaceObj = rawSpaces.find((s: any) => (s.id || s.Id) === q.spaceId);
          const custObj = rawCustomers.find((c: any) =>
            (c.id || c.Id) === q.customerId ||
            (c.userId || c.UserId) === q.customerId ||
            (c.email || c.Email || '').toLowerCase() === (q.customerEmail || q.userEmail || '').toLowerCase()
          );

          const qFullName = custObj
            ? ([custObj.firstName || custObj.FirstName, custObj.lastName || custObj.LastName].filter(Boolean).join(' ').trim() || custObj.name || custObj.Name)
            : null;

          const qCompName = custObj
            ? (custObj.companyName || custObj.CompanyName || custObj.company || custObj.Company || custObj.customerCompany || custObj.companyTitle)
            : null;

          const qItem: ActiveQuotationItem = {
            quotationId: q.id || q.Id,
            quotationNumber: q.quotationNumber || q.QuotationNumber || `#Q-${q.id}`,
            spaceId: q.spaceId || q.SpaceId,
            spaceCode: spaceObj?.code || spaceObj?.Code || `Space-${q.spaceId}`,
            spaceName: spaceObj?.name || spaceObj?.Name || `Space ${q.spaceId}`,
            spaceTypeName: typeMap.get(spaceObj?.spaceTypeIdInt || spaceObj?.SpaceTypeIdInt || spaceObj?.spaceTypeId) || 'Office',
            customerName: qFullName || q.customerName || 'Customer',
            quotationDate: q.quotationDate || q.QuotationDate || q.createdDate,
            quotationExpiryDate: validUntilStr,
            quotationAmount: Number(q.totalAmount || q.TotalAmount || 0),
            quotationStatus: q.status || q.Status || 'Pending',
            bookingStatus: spaceBookingMap.has(q.spaceId) ? 'Booked' : 'Not Booked'
          };

          if (!spaceBookingMap.has(q.spaceId)) {
            activeQuotationsList.push(qItem);
          }

          const existingQ = spaceQuotationMap.get(q.spaceId);
          if (!existingQ || new Date(existingQ.createdDate || 0) < new Date(q.createdDate || 0)) {
            spaceQuotationMap.set(q.spaceId, q);
          }
        }
      });

      // Construct SpaceOperationItem for each active space
      const processedSpaces: SpaceOperationItem[] = rawSpaces.map((s: any, idx: number) => {
        const sId = s.id || s.Id;
        const sCode = s.code || s.Code || `Space-${sId}`;
        const sName = s.name || s.Name || `Space ${sId}`;
        const sCap = s.capacity || s.Capacity || 1;
        const typeId = s.spaceTypeIdInt || s.SpaceTypeIdInt || s.spaceTypeId || s.SpaceTypeId || 0;
        const typeName = typeMap.get(typeId) || s.spaceTypeName || s.SpaceTypeName || 'Other';

        // Extract Location Name
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

        const activeBooking = spaceBookingMap.get(sId);
        const activeQuotation = spaceQuotationMap.get(sId);

        let spaceStatus: 'Booked' | 'Quoted' | 'Available' | 'Expired' = 'Available';
        let bStart: any = null;
        let bEnd: any = null;
        let bCustName: string | null = null;
        let bCompName: string | null = null;
        let bStatusStr: string | null = null;
        let bId: number | null = null;

        let qId: number | null = null;
        let qNum: string | null = null;
        let qCustName: string | null = null;
        let qDate: any = null;
        let qExpiry: any = null;
        let qAmt: number | null = null;
        let qStatusStr: string | null = null;

        let rawAttendantsCount = 0;

        if (activeBooking) {
          spaceStatus = 'Booked';
          bId = activeBooking.id || activeBooking.Id;
          bStart = activeBooking.startOn || activeBooking.StartOn || activeBooking.startDateTime;
          bEnd = activeBooking.endOn || activeBooking.EndOn || activeBooking.endDateTime;
          bStatusStr = activeBooking.bookingStatusLabel || activeBooking.bookingStatus || activeBooking.status || 'Confirmed';

          // Match Customer Object from DB
          const bUserEmail = (activeBooking.userEmail || activeBooking.customerEmail || '').toLowerCase();
          const custObj = rawCustomers.find((c: any) =>
            (c.id || c.Id) === activeBooking.customerId ||
            (c.userId || c.UserId) === activeBooking.userId ||
            (c.code || c.Code) === activeBooking.customerCode ||
            (bUserEmail && (c.email || c.Email || '').toLowerCase() === bUserEmail)
          );

          // Priority 1: Full Name from Customer record in DB
          const custFullName = custObj
            ? ([custObj.firstName || custObj.FirstName, custObj.lastName || custObj.LastName].filter(Boolean).join(' ').trim() || custObj.name || custObj.Name)
            : null;

          bCustName = custFullName || activeBooking.customerName || activeBooking.userEmail || (activeBooking.userId ? `User #${activeBooking.userId}` : 'Customer');

          // Priority 1: Customer's actual company name from DB
          const custCompName = custObj
            ? (custObj.companyName || custObj.CompanyName || custObj.company || custObj.Company || custObj.customerCompany || custObj.companyTitle)
            : null;

          // Avoid using venue/branch name if it was accidentally saved into activeBooking.companyName
          let finalBookingCompany = activeBooking.customerCompany || activeBooking.companyName || null;
          if (finalBookingCompany && (finalBookingCompany.includes('WorkNest') || finalBookingCompany.includes('I-8') || finalBookingCompany.includes('Center') || finalBookingCompany.includes('Plaza'))) {
            finalBookingCompany = null;
          }

          bCompName = custCompName || finalBookingCompany || null;

          // Attendant capacity parsing
          rawAttendantsCount = activeBooking.attendantsCount ?? activeBooking.occupantsCount ?? activeBooking.assignedAttendantsCount ?? (activeBooking.attendants ? activeBooking.attendants.length : 0);
        } else if (activeQuotation) {
          spaceStatus = 'Quoted';
          qId = activeQuotation.id || activeQuotation.Id;
          qNum = activeQuotation.quotationNumber || activeQuotation.QuotationNumber || `#Q-${qId}`;
          qDate = activeQuotation.quotationDate || activeQuotation.QuotationDate;
          qExpiry = activeQuotation.validUntil || activeQuotation.ValidUntil;
          qAmt = Number(activeQuotation.totalAmount || activeQuotation.TotalAmount || 0);
          qStatusStr = activeQuotation.status || activeQuotation.Status || 'Pending';

          const custObj = rawCustomers.find((c: any) =>
            (c.id || c.Id) === activeQuotation.customerId ||
            (c.email || c.Email || '').toLowerCase() === (activeQuotation.customerEmail || activeQuotation.userEmail || '').toLowerCase()
          );
          const qFullName = custObj
            ? ([custObj.firstName || custObj.FirstName, custObj.lastName || custObj.LastName].filter(Boolean).join(' ').trim() || custObj.name || custObj.Name)
            : null;
          qCustName = qFullName || activeQuotation.customerName || 'Customer';
        }

        const timeInfo = this.formatTimeRemaining(bEnd);
        const isExpiring = spaceStatus === 'Booked' && timeInfo.days > 0 && timeInfo.days <= thresholdDays;

        // Is Private Space logic
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

      // Compute KPI counts
      const totalSpacesCount = processedSpaces.length;
      const bookedCount = processedSpaces.filter(s => s.status === 'Booked').length;
      const quotedCount = processedSpaces.filter(s => s.status === 'Quoted').length;
      const availableCount = processedSpaces.filter(s => s.status === 'Available').length;
      const expiringCount = processedSpaces.filter(s => s.isExpiringSoon).length;
      const activeCustCount = rawCustomers.length > 0 ? rawCustomers.length : activeBookingsList.length;

      this.kpiStats.set({
        totalSpaces: totalSpacesCount,
        availableSpaces: availableCount,
        quotedSpaces: quotedCount,
        bookedSpaces: bookedCount,
        expiringSoonBookings: expiringCount,
        activeCustomers: activeCustCount
      });

      // Compute Space Type Breakdown
      const breakdownMap = new Map<string, {
        id: number;
        name: string;
        total: number;
        available: number;
        quoted: number;
        booked: number;
        totalCapacity: number;
        filledCapacity: number;
        emptyCapacity: number;
        bookedCapacity: number;
        quotedCapacity: number;
      }>();

      processedSpaces.forEach(s => {
        const typeName = s.spaceTypeName || 'Other';
        if (!breakdownMap.has(typeName)) {
          breakdownMap.set(typeName, {
            id: s.spaceTypeId,
            name: typeName,
            total: 0,
            available: 0,
            quoted: 0,
            booked: 0,
            totalCapacity: 0,
            filledCapacity: 0,
            emptyCapacity: 0,
            bookedCapacity: 0,
            quotedCapacity: 0
          });
        }
        const b = breakdownMap.get(typeName)!;
        const cap = s.capacity || 0;
        b.total++;
        b.totalCapacity += cap;

        if (s.status === 'Available') {
          b.available++;
          b.emptyCapacity += cap;
        } else if (s.status === 'Quoted') {
          b.quoted++;
          b.quotedCapacity += cap;
          b.emptyCapacity += cap;
        } else if (s.status === 'Booked') {
          b.booked++;
          b.bookedCapacity += cap;
          const occupiedSeats = (s.attendantsCount && s.attendantsCount > 0) ? s.attendantsCount : cap;
          b.filledCapacity += occupiedSeats;
          if (cap > occupiedSeats) {
            b.emptyCapacity += (cap - occupiedSeats);
          }
        }
      });

      const typeBreakdowns: SpaceTypeBreakdown[] = Array.from(breakdownMap.values()).map(b => {
        const occPct = b.totalCapacity > 0 ? Math.round((b.filledCapacity / b.totalCapacity) * 100) : 0;
        return {
          spaceTypeId: b.id,
          spaceTypeName: b.name,
          total: b.total,
          available: b.available,
          quoted: b.quoted,
          booked: b.booked,
          totalCapacity: b.totalCapacity,
          filledCapacity: b.filledCapacity,
          emptyCapacity: b.emptyCapacity,
          bookedCapacity: b.bookedCapacity,
          quotedCapacity: b.quotedCapacity,
          occupancyPercentage: occPct
        };
      });
      this.spaceTypeBreakdowns.set(typeBreakdowns);

      // Expiring Bookings List
      const expiringList: ExpiringBookingItem[] = processedSpaces
        .filter(s => s.status === 'Booked' && s.isExpiringSoon && s.bookingEnd)
        .map(s => ({
          bookingId: s.bookingId || 0,
          spaceId: s.spaceId,
          spaceCode: s.spaceCode,
          spaceName: s.spaceName,
          spaceTypeName: s.spaceTypeName,
          customerName: s.customerName || 'Customer',
          companyName: s.companyName || undefined,
          bookingStart: s.bookingStart!,
          bookingEnd: s.bookingEnd!,
          daysRemaining: s.daysRemainingNum || 0,
          bookingStatus: s.bookingStatus || 'Confirmed',
          remainingTimeFormatted: s.remainingTimeFormatted || ''
        }))
        .sort((a, b) => a.daysRemaining - b.daysRemaining);

      // Extract customer response activity items
      const activities: any[] = [];
      rawQuotations.forEach((q: any) => {
        const st = (q.status || q.Status || '').toString();
        const note = q.customerNote || q.responseNote || q.note || q.Remarks || '';
        if (st === 'Accepted' || st === 'Declined' || note) {
          const custObj = rawCustomers.find((c: any) => (c.id || c.Id) === q.customerId);
          activities.push({
            id: q.id || q.quotationId,
            quotationNumber: q.quotationNumber || `#Q-${q.id}`,
            versionNumber: q.versionNumber || q.version || 1,
            customerName: custObj ? `${custObj.firstName || ''} ${custObj.lastName || ''}`.trim() : (q.customerName || 'Customer'),
            status: st,
            customerNote: note,
            updatedDate: q.updatedDate || q.createdDate || new Date().toISOString()
          });
        }
      });
      activities.sort((a, b) => new Date(b.updatedDate).getTime() - new Date(a.updatedDate).getTime());
      this.quotationActivities.set(activities);

      this.expiringBookings.set(expiringList);
      this.activeQuotations.set(activeQuotationsList);

      this.loading.set(false);
      this.updateCharts();
    });
  }

  createNextVersionFromDashboard(activity: any) {
    this.router.navigate(['/admin/quotations'], { queryParams: { search: activity.quotationNumber || String(activity.id) } });
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

  // Filtered Spaces Computed Signal
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
    this.updateCharts();
  }

  setThreshold(days: number) {
    this.expiringThreshold.set(days);
    this.onFilterChange();
    this.loadDashboardData();
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

  // Chart Rendering Methods
  updateCharts() {
    setTimeout(() => {
      this.renderCapacityChart();
      this.renderLocationChart();
    }, 120);
  }

  private renderCapacityChart() {
    if (!this.capacityChartCanvas?.nativeElement) return;

    if (this.capacityChart) {
      this.capacityChart.destroy();
    }

    const privateSpaces = this.privateSpacesList();
    if (privateSpaces.length === 0) return;

    // Group capacity & attendants by Space Type (Private Spaces)
    const typeGroupMap = new Map<string, { capacity: number; occupants: number; overCapacity: number }>();
    
    privateSpaces.forEach(s => {
      const typeName = s.spaceTypeName || 'Private Office';
      if (!typeGroupMap.has(typeName)) {
        typeGroupMap.set(typeName, { capacity: 0, occupants: 0, overCapacity: 0 });
      }
      const item = typeGroupMap.get(typeName)!;
      item.capacity += (s.capacity || 0);
      if (s.status === 'Booked') {
        item.occupants += (s.attendantsCount || 0);
        if (s.isOverCapacity) {
          item.overCapacity += (s.excessAttendants || 0);
        }
      }
    });

    const labels = Array.from(typeGroupMap.keys());
    const capacityData = labels.map(l => typeGroupMap.get(l)!.capacity);
    const occupantsData = labels.map(l => typeGroupMap.get(l)!.occupants);
    const overCapData = labels.map(l => typeGroupMap.get(l)!.overCapacity);

    const ctx = this.capacityChartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    this.capacityChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Total Seat Capacity',
            data: capacityData,
            backgroundColor: 'rgba(99, 102, 241, 0.8)',
            borderColor: '#4f46e5',
            borderWidth: 1.5,
            borderRadius: 6
          },
          {
            label: 'Occupied Attendants',
            data: occupantsData,
            backgroundColor: 'rgba(16, 185, 129, 0.8)',
            borderColor: '#059669',
            borderWidth: 1.5,
            borderRadius: 6
          },
          {
            label: 'Over-Capacity Excess',
            data: overCapData,
            backgroundColor: 'rgba(239, 68, 68, 0.85)',
            borderColor: '#dc2626',
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { font: { family: 'Inter, system-ui, sans-serif', size: 12 }, usePointStyle: true, boxWidth: 8 }
          },
          tooltip: {
            padding: 12,
            backgroundColor: '#0f172a',
            titleFont: { size: 13, weight: 'bold' },
            bodyFont: { size: 12 }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: 'rgba(226, 232, 240, 0.6)' }, ticks: { stepSize: 1 } }
        }
      }
    });
  }

  private renderLocationChart() {
    if (!this.locationChartCanvas?.nativeElement) return;

    if (this.locationChart) {
      this.locationChart.destroy();
    }

    const spaces = this.allSpaces();
    if (spaces.length === 0) return;

    const locMap = new Map<string, { capacity: number; occupied: number }>();
    spaces.forEach(s => {
      const loc = s.locationName || 'Main Location';
      if (!locMap.has(loc)) {
        locMap.set(loc, { capacity: 0, occupied: 0 });
      }
      const cur = locMap.get(loc)!;
      cur.capacity += (s.capacity || 0);
      if (s.status === 'Booked') {
        cur.occupied += (s.attendantsCount || 0);
      }
    });

    const labels = Array.from(locMap.keys());
    const occupiedData = labels.map(l => locMap.get(l)!.occupied);
    const vacantData = labels.map(l => Math.max(0, locMap.get(l)!.capacity - locMap.get(l)!.occupied));

    const ctx = this.locationChartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    this.locationChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Occupied Capacity',
            data: occupiedData,
            backgroundColor: [
              '#6366f1',
              '#10b981',
              '#f59e0b',
              '#8b5cf6',
              '#ec4899'
            ],
            borderWidth: 2,
            borderColor: '#ffffff'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { font: { family: 'Inter, system-ui, sans-serif', size: 11 }, usePointStyle: true, boxWidth: 10 }
          },
          tooltip: {
            padding: 12,
            backgroundColor: '#0f172a'
          }
        },
        cutout: '68%'
      }
    });
  }

  // Navigation Links to Details Pages
  viewSpaceDetails(space: SpaceOperationItem) {
    this.router.navigate(['/admin/spaces'], { queryParams: { search: space.spaceCode } });
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

  viewAttendantsManagement(space: SpaceOperationItem) {
    this.router.navigate(['/admin/attendants']);
  }
}



