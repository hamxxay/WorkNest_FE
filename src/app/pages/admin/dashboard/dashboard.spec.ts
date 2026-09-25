import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Dashboard, SpaceTypeCardData } from './dashboard';
import { AdminService } from '../../../services/admin.service';
import { QuotationService } from '../../../services/quotation.service';
import { AuthService } from '../../../services/auth.service';
import { provideRouter } from '@angular/router';

describe('Dashboard Component - Operations Control Center 2-Widget Layout', () => {
  let component: Dashboard;
  let adminServiceSpy: jasmine.SpyObj<AdminService>;
  let quotationServiceSpy: jasmine.SpyObj<QuotationService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  const now = new Date();
  const futureStart = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days in future
  const futureEnd = new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000);   // 40 days in future
  const activeStart = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
  const activeEndSoon = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // 5 days remaining (within 30d threshold)
  const activeEndLater = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days remaining (outside 30d threshold)

  const mockSpaceTypes = [
    { id: 1, name: 'Meeting Room', description: 'Meeting Room' },
    { id: 2, name: 'Dedicated Desk', description: 'Dedicated Desk' },
    { id: 3, name: 'Private Office', description: 'Private Office' }
  ];

  const mockLocations = [
    { id: 10, name: 'Gulberg Executive Center' }
  ];

  const mockCustomers = [
    { id: 101, firstName: 'Ali', lastName: 'Khan', company: 'TechWorks Ltd', email: 'ali@techworks.com' },
    { id: 102, firstName: 'Sara', lastName: 'Ahmed', company: 'DesignStudio', email: 'sara@designstudio.com' }
  ];

  const mockSpaces = [
    // Space 1: Has partial-shift booking (Morning only). Should count as BOOKED.
    { id: 1, code: 'MR-101', name: 'Meeting Room 1', capacity: 10, spaceTypeId: 1, locationId: 10 },
    // Space 2: Has active quotation AND active 24_7 booking. Should count under BOTH Booked and Quoted.
    { id: 2, code: 'MR-102', name: 'Meeting Room 2', capacity: 12, spaceTypeId: 1, locationId: 10 },
    // Space 3: Has NO active bookings (only a future booking). Should count as VACANT.
    { id: 3, code: 'MR-103', name: 'Meeting Room 3', capacity: 8, spaceTypeId: 1, locationId: 10 },
    // Space 4: Has an active booking expiring in 5 days. Should count as BOOKED and EXPIRING SOON (under 30d threshold).
    { id: 4, code: 'DD-201', name: 'Desk 1', capacity: 1, spaceTypeId: 2, locationId: 10 },
    // Space 5: Has an active booking expiring in 60 days. Should count as BOOKED but NOT Expiring Soon (under 30d threshold).
    { id: 5, code: 'DD-202', name: 'Desk 2', capacity: 1, spaceTypeId: 2, locationId: 10 }
  ];

  const mockBookings = [
    // Partial shift booking (Morning) on Space 1
    {
      id: 501,
      spaceId: 1,
      customerId: 101,
      shiftType: 'morning',
      startOn: activeStart.toISOString(),
      endOn: activeEndLater.toISOString(),
      bookingStatusLabel: 'Confirmed',
      bookingStatusId: 1
    },
    // Full 24_7 booking on Space 2
    {
      id: 502,
      spaceId: 2,
      customerId: 102,
      shiftType: '24_7',
      startOn: activeStart.toISOString(),
      endOn: activeEndLater.toISOString(),
      bookingStatusLabel: 'Confirmed',
      bookingStatusId: 1
    },
    // Future booking on Space 3 (starts in 10 days) -> Space 3 is currently VACANT
    {
      id: 503,
      spaceId: 3,
      customerId: 101,
      shiftType: '24_7',
      startOn: futureStart.toISOString(),
      endOn: futureEnd.toISOString(),
      bookingStatusLabel: 'Confirmed',
      bookingStatusId: 1
    },
    // Booking on Space 4 expiring soon (5 days left)
    {
      id: 504,
      spaceId: 4,
      customerId: 101,
      shiftType: '24_7',
      startOn: activeStart.toISOString(),
      endOn: activeEndSoon.toISOString(),
      bookingStatusLabel: 'Confirmed',
      bookingStatusId: 1
    },
    // Booking on Space 5 expiring later (60 days left)
    {
      id: 505,
      spaceId: 5,
      customerId: 102,
      shiftType: 'evening',
      startOn: activeStart.toISOString(),
      endOn: activeEndLater.toISOString(),
      bookingStatusLabel: 'Confirmed',
      bookingStatusId: 1
    }
  ];

  const mockQuotations = [
    // Active quotation on Space 2 (which is ALSO booked)
    {
      id: 701,
      quotationNumber: 'Q-701',
      spaceId: 2,
      customerId: 101,
      status: 'Pending',
      isActive: true,
      totalAmount: 45000,
      validUntil: activeEndLater.toISOString(),
      createdDate: activeStart.toISOString()
    }
  ];

  beforeEach(() => {
    adminServiceSpy = jasmine.createSpyObj('AdminService', [
      'getSpaces',
      'getBookings',
      'getCustomers',
      'getSpaceTypes',
      'getLocations'
    ]);
    quotationServiceSpy = jasmine.createSpyObj('QuotationService', ['getQuotations']);
    authServiceSpy = jasmine.createSpyObj('AuthService', ['hasRole', 'user']);

    adminServiceSpy.getSpaces.and.returnValue(of({ data: mockSpaces } as any));
    adminServiceSpy.getBookings.and.returnValue(of({ data: mockBookings } as any));
    adminServiceSpy.getCustomers.and.returnValue(of({ data: mockCustomers } as any));
    adminServiceSpy.getSpaceTypes.and.returnValue(of({ data: mockSpaceTypes } as any));
    adminServiceSpy.getLocations.and.returnValue(of({ data: mockLocations } as any));
    quotationServiceSpy.getQuotations.and.returnValue(of({ data: mockQuotations } as any));

    authServiceSpy.hasRole.and.returnValue(true);
    authServiceSpy.user.and.returnValue({ locationId: null } as any);

    TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        provideRouter([]),
        { provide: AdminService, useValue: adminServiceSpy },
        { provide: QuotationService, useValue: quotationServiceSpy },
        { provide: AuthService, useValue: authServiceSpy }
      ]
    });

    const fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
  });

  it('1. Booked count includes partial-shift spaces', async () => {
    component.loadDashboardData();
    // Allow Promise.all resolution
    await new Promise(resolve => setTimeout(resolve, 50));

    const meetingRoomCard = component.spaceTypeCards().find(c => c.spaceTypeId === 1);
    expect(meetingRoomCard).toBeDefined();
    // Meeting rooms: Space 1 (morning shift) + Space 2 (24_7 shift) = 2 Booked
    expect(meetingRoomCard!.bookedCount).toBe(2);

    const space1Detail = meetingRoomCard!.bookedDetails.find(d => d.spaceId === 1);
    expect(space1Detail).toBeDefined();
    expect(space1Detail!.occupiedShifts).toContain('Morning (6am-6pm)');
    expect(space1Detail!.openShifts).toContain('Evening (6pm-6am)');
  });

  it('2. Quoted count includes spaces that are also Booked', async () => {
    component.loadDashboardData();
    await new Promise(resolve => setTimeout(resolve, 50));

    const meetingRoomCard = component.spaceTypeCards().find(c => c.spaceTypeId === 1);
    expect(meetingRoomCard).toBeDefined();
    // Space 2 is both Booked and Quoted
    expect(meetingRoomCard!.quotedCount).toBe(1);
    expect(meetingRoomCard!.quotedDetails[0].spaceId).toBe(2);
    expect(meetingRoomCard!.quotedDetails[0].isAlsoBooked).toBe(true);
  });

  it('3. Vacant count excludes any space with an active booking on any shift', async () => {
    component.loadDashboardData();
    await new Promise(resolve => setTimeout(resolve, 50));

    const meetingRoomCard = component.spaceTypeCards().find(c => c.spaceTypeId === 1);
    expect(meetingRoomCard).toBeDefined();
    // Only Space 3 is vacant (Space 1 is morning-booked, Space 2 is 24_7-booked)
    expect(meetingRoomCard!.vacantCount).toBe(1);
    expect(meetingRoomCard!.vacantDetails[0].spaceId).toBe(3);
    expect(meetingRoomCard!.vacantDetails[0].nextBookingCustomer).toBe('Ali Khan');
  });

  it('4. Expiring Soon count matches the expiringThreshold filter logic reused correctly per space type', async () => {
    component.expiringThreshold.set(30); // 30 Days threshold
    component.loadDashboardData();
    await new Promise(resolve => setTimeout(resolve, 50));

    const deskCard = component.spaceTypeCards().find(c => c.spaceTypeId === 2);
    expect(deskCard).toBeDefined();
    expect(deskCard!.totalSpaces).toBe(2);
    expect(deskCard!.bookedCount).toBe(2);
    // Space 4 expires in 5 days (<= 30d threshold), Space 5 expires in 60 days (> 30d threshold)
    expect(deskCard!.expiringCount).toBe(1);
    expect(deskCard!.expiringDetails[0].spaceId).toBe(4);
  });
});
