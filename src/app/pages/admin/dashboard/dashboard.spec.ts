import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { Dashboard } from './dashboard';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { MainDashboardService, MainDetailRow } from '../../../services/main-dashboard.service';

/**
 * Main dashboard (DASH_01): the space type cards, their tag lists and the inventory table come from the API
 * (counted there for every row); the page only maps and shows them, and shows failures with Retry.
 */
describe('Dashboard - server-side totals', () => {
  let component: Dashboard;
  let main: jasmine.SpyObj<MainDashboardService>;

  const detail = (over: Partial<MainDetailRow>): MainDetailRow => ({
    spaceId: 1, spaceCode: 'MR-101', spaceName: 'Meeting Room 1', capacity: 10, locationName: 'I-8',
    bookingId: 501, bookingStart: '2026-10-01T09:00:00', bookingEnd: '2026-12-01T18:00:00', bookingStatus: 'Confirmed',
    customerName: 'Ali Khan', companyName: 'TechWorks Ltd', has247: false, hasMorning: true, hasEvening: false,
    nextBookingDate: null, nextBookingCustomer: null, quotationId: null, quotationNumber: null, quotationStatus: null,
    quotationDate: null, quotationExpiryDate: null, quotationAmount: null, isAlsoBooked: false, daysRemaining: null, ...over
  });

  beforeEach(() => {
    const admin = jasmine.createSpyObj('AdminService', ['getLocations', 'getAnnouncements']);
    admin.getLocations.and.returnValue(of({ data: [{ id: 1, name: 'I-8' }] }));
    admin.getAnnouncements.and.returnValue(of({ data: { items: [] } }));
    const auth = jasmine.createSpyObj('AuthService', ['hasRole', 'user', 'isLocationBound']);
    auth.hasRole.and.returnValue(true);
    auth.user.and.returnValue({ locationId: null } as any);
    auth.isLocationBound.and.returnValue(false);
    main = jasmine.createSpyObj('MainDashboardService', ['getSummary', 'getDetails', 'getInventory']);
    main.getSummary.and.returnValue(of({
      expiringDays: 30, totalSpaces: 1069, generatedAt: null,
      cards: [{ spaceTypeId: 1, spaceTypeName: 'Private Office', locationId: 1, locationName: 'I-8', totalSpaces: 1069,
        bookedCount: 900, vacantCount: 169, quotedCount: 3, expiringCount: 7 }]
    }));
    main.getInventory.and.returnValue(of({ total: 1069, page: 1, pageSize: 10, items: [] }));
    main.getDetails.and.returnValue(of({ tag: 'booked', spaceTypeId: 1, total: 900, page: 1, pageSize: 25, items: [detail({})] }));

    TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        provideRouter([]),
        { provide: AdminService, useValue: admin },
        { provide: AuthService, useValue: auth },
        { provide: MainDashboardService, useValue: main }
      ]
    });
    component = TestBed.createComponent(Dashboard).componentInstance;
  });

  it('shows the API counts (no 1,000-row cap)', () => {
    component.loadDashboardData();
    expect(component.totalSpacesCount()).toBe(1069);
    expect(component.spaceTypeCards()[0].bookedCount).toBe(900);
    expect(component.inventoryTotal()).toBe(1069);
    expect(component.totalPages()).toBe(107);
  });

  it('builds the shift labels of a booked space from its live bookings', () => {
    component.loadDashboardData();
    component.toggleTagDropdown(new Event('click'), 1, 'booked');
    const row = component.bookedRows()[0];
    expect(row.occupiedShifts).toEqual(['Morning (6am-6pm)']);
    expect(row.openShifts).toEqual(['Evening (6pm-6am)']);
    expect(component.trayHasMore()).toBeTrue();
  });

  it('shows a failure with its message instead of empty figures', () => {
    main.getSummary.and.returnValue(throwError(() => ({ status: 503, needsDbUpdate: true, title: 'Database update needed', message: 'Run DASH_01_main_dashboard_TEST.sql on the database, then refresh this page.' })));
    component.loadSummary();
    expect(component.summaryStatus()).toBe('error');
    expect(component.summaryError()?.message).toContain('DASH_01_main_dashboard');
  });

  it('checks the custom range before using it', () => {
    component.openCustom();
    component.draftFrom.set('2026-03-02');
    component.draftTo.set('2026-03-01');
    component.applyCustom();
    expect(component.customError()).toContain('on or before');
    expect(component.period()).toBe('month');

    component.draftFrom.set('2026-01-01');
    component.draftTo.set('2026-03-31');
    component.applyCustom();
    expect(component.period()).toBe('custom');
    expect(component.rangeFrom()).toBe('2026-01-01');
    expect(component.rangeTo()).toBe('2026-03-31');
  });
});
