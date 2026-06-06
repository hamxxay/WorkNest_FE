import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { AdminService } from '../../services/admin.service';
import { catchError, forkJoin, of } from 'rxjs';
import { ASSIGNABLE_ROLES, BILLING_CYCLES } from '../../utils/constants';

interface Column { key: string; label: string; type?: string; }
interface SelectOption { v: any; l: string; }
interface EntityConfig {
  title: string;
  columns: Column[];
  loadFn: string;
  deleteFn?: string;
  createFn?: string;
  updateFn?: string;
  statusFn?: string;
  statusOptions?: string[];
  fields?: { key: string; label: string; type: string; options?: SelectOption[] }[];
  idKey?: string;
}

@Component({
  selector: 'app-admin-manage',
  imports: [FormsModule, DatePipe, DecimalPipe],
  templateUrl: './manage.html',
  styleUrl: './manage.css'
})
export class AdminManage implements OnInit {
  entity = '';
  config!: EntityConfig;
  items = signal<any[]>([]);
  loading = signal(true);
  page = signal(1);
  pageSize = 10;
  readonly pageSizeOptions = [5, 10, 20, 50];
  totalCount = signal(0);
  totalPages = signal(1);
  showModal = false;
  editItem: any = null;
  formData: any = {};
  saving = false;
  error = '';
  success = '';
  searchQuery = '';
  showUserModal = false;
  userDetailsLoading = signal(false);
  userDetailsError = '';
  selectedUser = signal<any | null>(null);
  userHistory = signal<any | null>(null);
  showSpaceModal = false;
  spaceSummaryLoading = signal(false);
  spaceSummaryError = '';
  spaceSummary = signal<any | null>(null);
  showPlanModal = false;
  planSummaryLoading = signal(false);
  planSummaryError = '';
  planSummary = signal<any | null>(null);
  showMembershipModal = false;
  membershipSummaryLoading = signal(false);
  membershipSummaryError = '';
  membershipSummary = signal<any | null>(null);
  showPaymentModal = false;
  paymentSummaryLoading = signal(false);
  paymentSummaryError = '';
  paymentSummary = signal<any | null>(null);
  readonly weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  bookingCalendarLoading = signal(false);
  bookingCalendarDays = signal<any[]>([]);
  bookingCalendarMonth = signal(new Date());
  bookingSelectingEnd = signal(false);

  private configs: Record<string, EntityConfig> = {
    users: {
      title: 'Users',
      idKey: 'id',
      columns: [
        { key: 'email', label: 'Email' },
        { key: 'firstName', label: 'First Name' },
        { key: 'lastName', label: 'Last Name' },
        { key: 'roles', label: 'Roles', type: 'roles' },
        { key: 'isActive', label: 'Status', type: 'boolean' },
        { key: 'createdAt', label: 'Created', type: 'date' }
      ],
      loadFn: 'getUsers', deleteFn: 'deleteUser',
      statusOptions: ['Activate', 'Deactivate'],
      fields: [
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'firstName', label: 'First Name', type: 'text' },
        // amazonq-ignore-next-line
        { key: 'lastName', label: 'Last Name', type: 'text' },
        { key: 'password', label: 'Password', type: 'password' },
        { key: 'role', label: 'Role', type: 'select', options: ASSIGNABLE_ROLES }
      ]
    },
    locations: {
      title: 'Locations',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'address', label: 'Address' },
        { key: 'city', label: 'City' },
        { key: 'openingTime', label: 'Opens' },
        { key: 'closingTime', label: 'Closes' },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ],
      loadFn: 'getLocations', deleteFn: 'deleteLocation', createFn: 'createLocation', updateFn: 'updateLocation',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'address', label: 'Address', type: 'text' },
        { key: 'city', label: 'City', type: 'text' },
        { key: 'openingTime', label: 'Opening Time', type: 'text' },
        { key: 'closingTime', label: 'Closing Time', type: 'text' }
      ]
    },
    'space-types': {
      title: 'Space Types',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'capacity', label: 'Capacity' },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ],
      loadFn: 'getSpaceTypes',
      updateFn: 'updateSpaceType',
      fields: [
        { key: 'capacity', label: 'Capacity', type: 'number' }
      ]
    },
    spaces: {
      title: 'Spaces',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'locationName', label: 'Location' },
        { key: 'spaceTypeName', label: 'Type' },
        { key: 'code', label: 'Code' },
        { key: 'pricePerHour', label: 'PKR/hr', type: 'currency' },
        { key: 'pricePerDay', label: 'PKR/day', type: 'currency' },
        { key: 'status', label: 'Status', type: 'status' }
      ],
      loadFn: 'getSpaces', deleteFn: 'deleteSpace', createFn: 'createSpace', updateFn: 'updateSpace',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'locationId', label: 'Location', type: 'select', options: [] },
        { key: 'spaceTypeId', label: 'Space Type', type: 'select', options: [] },
        { key: 'code', label: 'Code', type: 'text' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'floor', label: 'Floor', type: 'text' },
        { key: 'pricePerHour', label: 'Price/Hour', type: 'number' },
        { key: 'pricePerDay', label: 'Price/Day', type: 'number' },
        { key: 'imageUrl', label: 'Image URL', type: 'text' },
        { key: 'amenities', label: 'Amenities (comma-separated)', type: 'text' }
      ]
    },
    bookings: {
      title: 'Bookings',
      columns: [
        { key: 'userEmail', label: 'User' },
        { key: 'spaceName', label: 'Space' },
        { key: 'startDateTime', label: 'Start', type: 'date' },
        { key: 'endDateTime', label: 'End', type: 'date' },
        { key: 'totalAmount', label: 'Amount', type: 'currency' },
        { key: 'bookingStatus', label: 'Status', type: 'status' }
      ],
      loadFn: 'getBookings',
      updateFn: 'updateBooking',
      statusFn: 'updateBookingStatus',
      statusOptions: ['Pending', 'Confirmed', 'Cancelled', 'Completed'],
      fields: [
        { key: 'spaceId', label: 'Space', type: 'select', options: [] },
        { key: 'startDateTime', label: 'Start Date', type: 'date' },
        { key: 'endDateTime', label: 'End Date', type: 'date' },
        { key: 'chairCount', label: 'Chair Count (office only)', type: 'number' },
        { key: 'notes', label: 'Notes', type: 'textarea' }
      ]
    },
    pricing: {
      title: 'Pricing Plans',
      columns: [
        { key: 'name', label: 'Plan' },
        { key: 'price', label: 'Price', type: 'currency' },
        { key: 'billingCycle', label: 'Cycle' },
        { key: 'includesHours', label: 'Hours' },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ],
      loadFn: 'getPricingPlans', deleteFn: 'deletePricingPlan', createFn: 'createPricingPlan', updateFn: 'updatePricingPlan',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'billingCycle', label: 'Billing Cycle', type: 'select', options: BILLING_CYCLES },
        { key: 'price', label: 'Price', type: 'number' },
        { key: 'includesHours', label: 'Included Hours', type: 'number' }
      ]
    },
    memberships: {
      title: 'Memberships',
      columns: [
        { key: 'userEmail', label: 'User' },
        { key: 'planName', label: 'Plan' },
        { key: 'startDate', label: 'Start', type: 'date' },
        { key: 'endDate', label: 'End', type: 'date' },
        { key: 'status', label: 'Status', type: 'status' }
      ],
      loadFn: 'getMemberships', deleteFn: 'deleteMembership',
      statusFn: 'updateMembershipStatus',
      statusOptions: ['Active', 'Paused', 'Expired', 'Cancelled']
    },
    payments: {
      title: 'Payments',
      columns: [
        { key: 'userEmail', label: 'User' },
        { key: 'amount', label: 'Amount', type: 'currency' },
        { key: 'paymentMethod', label: 'Method' },
        { key: 'paymentStatus', label: 'Status', type: 'status' },
        { key: 'paidAt', label: 'Paid At', type: 'date' }
      ],
      loadFn: 'getPayments', deleteFn: 'deletePayment',
      statusFn: 'updatePaymentStatus',
      statusOptions: ['Pending', 'Paid', 'Failed', 'Refunded']
    },
    contacts: {
      title: 'Contact Messages',
      columns: [
        { key: 'fullName', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'message', label: 'Message' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'createdAt', label: 'Date', type: 'date' }
      ],
      loadFn: 'getContacts', deleteFn: 'deleteContact',
      statusFn: 'updateContactStatus',
      statusOptions: ['New', 'InProgress', 'Resolved']
    },
    gallery: {
      title: 'Gallery Images',
      columns: [
        { key: 'title', label: 'Title' },
        { key: 'imageUrl', label: 'Image', type: 'image' },
        { key: 'sortOrder', label: 'Order' },
        { key: 'isActive', label: 'Active', type: 'boolean' },
        { key: 'createdAt', label: 'Created', type: 'date' }
      ],
      loadFn: 'getGalleryAll', deleteFn: 'deleteGalleryImage', createFn: 'createGalleryImage', updateFn: 'updateGalleryImage',
      fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'imageUrl', label: 'Image URL', type: 'text' },
        { key: 'sortOrder', label: 'Sort Order', type: 'number' },
        { key: 'locationId', label: 'Location (optional)', type: 'select', options: [{ v: '', l: 'No location' }] }
      ]
    }
  };

  constructor(private route: ActivatedRoute, public admin: AdminService) {}

  ngOnInit() {
    this.route.data.subscribe(data => {
      this.entity = data['entity'] || '';
      this.config = this.configs[this.entity];
      this.page.set(1);
      this.loadReferenceOptions();
      if (this.config) this.load();
    });
  }

  load() {
    this.loading.set(true);
    (this.admin as any)[this.config.loadFn]().subscribe({
      next: (res: any) => {
        const items: any[] = Array.isArray(res) ? res
          : Array.isArray(res?.data?.items) ? res.data.items
          : Array.isArray(res?.data) ? res.data
          : Array.isArray(res?.items) ? res.items
          : [];
        this.items.set(items);
        this.totalCount.set(res?.data?.totalCount ?? items.length);
        this.totalPages.set(res?.data?.totalPages ?? Math.max(1, Math.ceil(items.length / this.pageSize)));
        this.loading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.totalCount.set(0);
        this.totalPages.set(1);
        this.loading.set(false);
      }
    });
  }

  get filtered() {
    const allItems = this.items();
    if (!this.searchQuery) return allItems;
    const q = this.searchQuery.toLowerCase();
    return allItems.filter((item: any) =>
      this.config.columns.some(col =>
        String(item[col.key] || '').toLowerCase().includes(q)
      )
    );
  }

  canPrev(): boolean {
    return this.page() > 1;
  }

  canNext(): boolean {
    return this.page() < this.totalPages();
  }

  prevPage() {
    if (!this.canPrev()) return;
    this.page.update(v => v - 1);
    this.load();
  }

  nextPage() {
    if (!this.canNext()) return;
    this.page.update(v => v + 1);
    this.load();
  }

  onPageSizeChange(value: any) {
    const next = Number(value);
    this.pageSize = Number.isFinite(next) && next > 0 ? next : 10;
    this.page.set(1);
    this.load();
  }

  getCellValue(item: any, col: Column): string {
    const val = item[col.key];
    if (val == null) return '—';
    if (col.type === 'date') return val;
    if (col.type === 'currency') return 'PKR ' + Number(val).toFixed(2);
    if (col.type === 'boolean') return val ? 'Yes' : 'No';
    if (col.type === 'roles') return Array.isArray(val) ? val.join(', ') : val;
    return String(val);
  }

  openCreate() {
    this.editItem = null;
    this.formData = {};
    if (this.config.fields) {
      for (const f of this.config.fields) {
        this.formData[f.key] = f.type === 'checkbox' ? false : '';
      }
    }
    this.error = '';
    this.showModal = true;
  }

  openEdit(item: any) {
    this.editItem = item;
    this.formData = { ...item };
    if (this.entity === 'spaces') {
      // Resolve locationId and spaceTypeId from names since list API doesn't return IDs
      this.admin.getLocations().pipe(catchError(() => of([]))).subscribe((locs: any) => {
        const locList: any[] = Array.isArray(locs) ? locs : (locs?.data ?? []);
        const matched = locList.find((l: any) => l.name === item.locationName);
        if (matched) this.formData.locationId = matched.id;
      });
      this.admin.getSpaceTypes().pipe(catchError(() => of([]))).subscribe((types: any) => {
        const typeList: any[] = Array.isArray(types) ? types : (types?.data ?? []);
        const matched = typeList.find((t: any) => t.name === item.spaceTypeName);
        if (matched) this.formData.spaceTypeId = matched.id;
      });
    }
    if (this.entity === 'bookings') {
      this.formData.startDateTime = this.toDateOnly(item.startDateTime);
      this.formData.endDateTime = this.toDateOnly(item.endDateTime);
      this.formData.chairCount = this.extractChairCount(item.notes);
      const base = item.startDateTime ? new Date(item.startDateTime) : new Date();
      this.bookingCalendarMonth.set(new Date(base.getFullYear(), base.getMonth(), 1));
      this.bookingSelectingEnd.set(false);
      this.loadBookingCalendar();
    }
    this.error = '';
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
    this.editItem = null;
    this.formData = {};
    this.error = '';
  }

  openBookingUser(item: any) {
    if (this.entity !== 'bookings') return;
    this.openUserDetails(item, item?.userId, item?.userEmail);
  }

  openUserFromUsers(item: any) {
    if (this.entity !== 'users') return;
    this.openUserDetails(item, item?.id, item?.email);
  }

  private openUserDetails(item: any, userId: string | null | undefined, fallbackEmail: string | null | undefined) {
    this.userDetailsError = '';
    this.selectedUser.set(null);
    this.userHistory.set(null);
    this.showUserModal = true;

    if (!userId) {
      this.selectedUser.set({
        email: fallbackEmail ?? 'N/A',
        firstName: null,
        lastName: null,
        phoneNumber: null,
        roles: [],
        isActive: null,
        emailConfirmed: null,
        createdAt: null
      });
      this.userDetailsError = 'User history is not available for this booking.';
      return;
    }

    this.userDetailsLoading.set(true);
    forkJoin({
      profile: this.admin.getUserById(String(userId)).pipe(catchError(() => of(null))),
      history: this.admin.getUserHistory(String(userId)).pipe(catchError(() => of(null)))
    }).subscribe((result: any) => {
      this.userDetailsLoading.set(false);

      const profile = result?.profile;
      if (profile?.isSuccessful && profile?.data) {
        this.selectedUser.set(profile.data);
      } else {
        this.userDetailsError = 'Failed to load full user profile.';
        this.selectedUser.set({ email: fallbackEmail ?? 'N/A', roles: [] });
      }

      const history = result?.history;
      if (history?.isSuccessful && history?.data) {
        this.userHistory.set(history.data);
      } else {
        this.userHistory.set({
          stats: { totalBookings: 0, totalPayments: 0, totalPaidAmount: 0, failedPayments: 0, cancelledBookings: 0 },
          recentBookings: [],
          recentPayments: []
        });
      }
    });
  }

  closeUserModal() {
    this.showUserModal = false;
    this.userDetailsLoading.set(false);
    this.userDetailsError = '';
    this.selectedUser.set(null);
    this.userHistory.set(null);
  }

  openSpaceDetails(item: any) {
    if (this.entity !== 'spaces') return;
    this.showSpaceModal = true;
    this.spaceSummaryLoading.set(true);
    this.spaceSummaryError = '';
    this.spaceSummary.set(null);

    const id = Number(item?.id);
    if (!id) {
      this.spaceSummaryLoading.set(false);
      this.spaceSummaryError = 'Space summary is not available.';
      return;
    }

    this.admin.getSpaceSummary(id).subscribe({
      next: (res: any) => {
        this.spaceSummaryLoading.set(false);
        if (res?.isSuccessful && res?.data) {
          this.spaceSummary.set(res.data);
        } else {
          this.spaceSummaryError = res?.message || 'Failed to load space summary.';
        }
      },
      error: () => {
        this.spaceSummaryLoading.set(false);
        this.spaceSummaryError = 'Failed to load space summary.';
      }
    });
  }

  closeSpaceModal() {
    this.showSpaceModal = false;
    this.spaceSummaryLoading.set(false);
    this.spaceSummaryError = '';
    this.spaceSummary.set(null);
  }

  openPricingPlanSummary(item: any) {
    if (this.entity !== 'pricing') return;
    this.showPlanModal = true;
    this.planSummaryLoading.set(true);
    this.planSummaryError = '';
    this.planSummary.set(null);

    const id = Number(item?.id);
    if (!id) {
      this.planSummaryLoading.set(false);
      this.planSummaryError = 'Pricing plan summary is not available.';
      return;
    }

    this.admin.getPricingPlanSummary(id).subscribe({
      next: (res: any) => {
        this.planSummaryLoading.set(false);
        if (res?.isSuccessful && res?.data) {
          this.planSummary.set(res.data);
        } else {
          this.planSummaryError = res?.message || 'Failed to load pricing plan summary.';
        }
      },
      error: () => {
        this.planSummaryLoading.set(false);
        this.planSummaryError = 'Failed to load pricing plan summary.';
      }
    });
  }

  closePlanModal() {
    this.showPlanModal = false;
    this.planSummaryLoading.set(false);
    this.planSummaryError = '';
    this.planSummary.set(null);
  }

  openMembershipSummary(item: any) {
    if (this.entity !== 'memberships') return;
    this.showMembershipModal = true;
    this.membershipSummaryLoading.set(true);
    this.membershipSummaryError = '';
    this.membershipSummary.set(null);

    const id = Number(item?.id);
    if (!id) {
      this.membershipSummaryLoading.set(false);
      this.membershipSummaryError = 'Membership summary is not available.';
      return;
    }

    this.admin.getMembershipSummary(id).subscribe({
      next: (res: any) => {
        this.membershipSummaryLoading.set(false);
        if (res?.isSuccessful && res?.data) {
          this.membershipSummary.set(res.data);
        } else {
          this.membershipSummaryError = res?.message || 'Failed to load membership summary.';
        }
      },
      error: () => {
        this.membershipSummaryLoading.set(false);
        this.membershipSummaryError = 'Failed to load membership summary.';
      }
    });
  }

  closeMembershipModal() {
    this.showMembershipModal = false;
    this.membershipSummaryLoading.set(false);
    this.membershipSummaryError = '';
    this.membershipSummary.set(null);
  }

  openPaymentSummary(item: any) {
    if (this.entity !== 'payments') return;
    this.showPaymentModal = true;
    this.paymentSummaryLoading.set(true);
    this.paymentSummaryError = '';
    this.paymentSummary.set(null);

    const id = Number(item?.id);
    if (!id) {
      this.paymentSummaryLoading.set(false);
      this.paymentSummaryError = 'Payment summary is not available.';
      return;
    }

    this.admin.getPaymentSummary(id).subscribe({
      next: (res: any) => {
        this.paymentSummaryLoading.set(false);
        if (res?.isSuccessful && res?.data) {
          this.paymentSummary.set(res.data);
        } else {
          this.paymentSummaryError = res?.message || 'Failed to load payment summary.';
        }
      },
      error: () => {
        this.paymentSummaryLoading.set(false);
        this.paymentSummaryError = 'Failed to load payment summary.';
      }
    });
  }

  closePaymentModal() {
    this.showPaymentModal = false;
    this.paymentSummaryLoading.set(false);
    this.paymentSummaryError = '';
    this.paymentSummary.set(null);
  }

  get userDisplayName(): string {
    const user = this.selectedUser();
    if (!user) return 'User';
    const first = (user.firstName || '').trim();
    const last = (user.lastName || '').trim();
    const full = `${first} ${last}`.trim();
    return full || user.userName || user.email || 'User';
  }

  save() {
    this.saving = true;
    this.error = '';
    const id = this.editItem?.id;
    const fn = this.editItem ? this.config.updateFn : this.config.createFn;
    if (!fn) return;

    const payload = this.toSubmitPayload();
    const call = this.editItem
      ? (this.admin as any)[fn](id, payload)
      : (this.admin as any)[fn](payload);

    call.subscribe({
      next: (res: any) => {
        this.saving = false;
        if (res.isSuccessful) {
          this.closeModal();
          this.load();
          this.flashSuccess(this.editItem ? 'Updated successfully' : 'Created successfully');
        } else {
          this.error = res.message || 'Operation failed';
        }
      },
      error: (err: any) => {
        this.saving = false;
        this.error = err.error?.message || 'Operation failed';
      }
    });
  }

  deleteItem(item: any) {
    if (!this.config.deleteFn) return;
    if (!confirm('Are you sure you want to delete this item?')) return;
    (this.admin as any)[this.config.deleteFn](item.id).subscribe({
      next: () => { this.load(); this.flashSuccess('Deleted successfully'); },
      error: (err: any) => { alert(err.error?.message || 'Delete failed'); }
    });
  }

  changeStatus(item: any, status: string) {
    if (!this.config.statusFn) return;
    (this.admin as any)[this.config.statusFn](item.id, status).subscribe({
      next: () => { this.load(); this.flashSuccess('Status updated'); },
      error: (err: any) => { alert(err.error?.message || 'Status update failed'); }
    });
  }

  changeUserRole(item: any, role: string) {
    if (!role) return;
    this.admin.updateUserRole(item.id, role).subscribe({
      next: () => { this.load(); this.flashSuccess('Role updated'); },
      error: (err: any) => { alert(err.error?.message || 'Role update failed'); }
    });
  }

  toggleActive(item: any) {
    if (this.entity === 'users') {
      const fn = item.isActive ? 'deactivateUser' : 'activateUser';
      (this.admin as any)[fn](item.id).subscribe({
        next: () => { this.load(); },
        error: (err: any) => { alert(err.error?.message || 'Failed'); }
      });
    }
  }

  private flashSuccess(msg: string) {
    this.success = msg;
    setTimeout(() => this.success = '', 3000);
  }

  private toDateTimeLocal(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private toDateOnly(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private extractChairCount(notes: string | null | undefined): number | null {
    if (!notes) return null;
    const match = notes.match(/ChairCount:\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  private toSubmitPayload(): any {
    if (this.entity === 'bookings') {
      return {
        spaceId: Number(this.formData.spaceId),
        startDateTime: `${this.formData.startDateTime}T00:00:00`,
        endDateTime: `${this.formData.endDateTime}T00:00:00`,
        chairCount: this.formData.chairCount ? Number(this.formData.chairCount) : null,
        notes: this.formData.notes || null
      };
    }

    const payload: any = { ...this.formData };
    const numericFields = this.config.fields
      ?.filter(f => f.type === 'number')
      .map(f => f.key) ?? [];

    for (const key of Object.keys(payload)) {
      const isIdField = key.toLowerCase().endsWith('id');
      const isNumeric = numericFields.includes(key);
      if (!isIdField && !isNumeric) continue;
      if (payload[key] === '' || payload[key] == null) {
        payload[key] = null;
        continue;
      }
      const n = Number(payload[key]);
      if (!Number.isNaN(n)) payload[key] = n;
    }
    return payload;
  }

  private loadReferenceOptions() {
    if (!this.config?.fields) return;

    if (this.entity === 'spaces') {
      forkJoin({
        locations: this.admin.getLocations(1, 200).pipe(catchError(() => of({ data: { items: [] } }))),
        types: this.admin.getSpaceTypes(1, 200).pipe(catchError(() => of({ data: { items: [] } })))
      }).subscribe((res: any) => {
        const locations = this.extractItems(res.locations).map((x: any) => ({ v: x.id, l: `${x.name} (${x.city})` }));
        const types = this.extractItems(res.types).map((x: any) => ({ v: x.id, l: x.name }));
        this.setFieldOptions('locationId', locations);
        this.setFieldOptions('spaceTypeId', types);
      });
      return;
    }

    if (this.entity === 'bookings') {
      this.admin.getSpaces(1, 300).pipe(catchError(() => of({ data: { items: [] } }))).subscribe((res: any) => {
        const spaces = this.extractItems(res).map((x: any) => ({ v: x.id, l: `${x.name} (${x.code})` }));
        this.setFieldOptions('spaceId', spaces);
      });
      return;
    }

    if (this.entity === 'gallery') {
      this.admin.getLocations(1, 200).pipe(catchError(() => of({ data: { items: [] } }))).subscribe((res: any) => {
        const locations = this.extractItems(res).map((x: any) => ({ v: x.id, l: `${x.name} (${x.city})` }));
        this.setFieldOptions('locationId', [{ v: '', l: 'No location' }, ...locations]);
      });
    }
  }

  private extractItems(response: any): any[] {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data?.items)) return response.data.items;
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.items)) return response.items;
    return [];
  }

  private setFieldOptions(fieldKey: string, options: SelectOption[]) {
    if (!this.config?.fields) return;
    const field = this.config.fields.find(f => f.key === fieldKey);
    if (field) field.options = options;
  }

  onFieldChange(key: string) {
    if (this.entity === 'bookings' && key === 'spaceId') {
      this.bookingSelectingEnd.set(false);
      this.loadBookingCalendar();
    }
  }

  get bookingMonthTitle(): string {
    const d = this.bookingCalendarMonth();
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  get bookingMonthCells(): any[] {
    const monthDate = this.bookingCalendarMonth();
    const year = monthDate.getFullYear();
    const monthIndex = monthDate.getMonth();
    const firstDayIndex = new Date(year, monthIndex, 1).getDay();
    const totalDays = new Date(year, monthIndex + 1, 0).getDate();
    const dayMap = new Map<number, any>();
    for (const day of this.bookingCalendarDays()) dayMap.set(day.day, day);

    const cells: any[] = [];
    for (let i = 0; i < firstDayIndex; i++) cells.push({ placeholder: true });
    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      const item = dayMap.get(dayNum);
      cells.push(item ?? { date: this.toLocalDateText(year, monthIndex, dayNum), day: dayNum, isBooked: false, bookedCount: 0 });
    }
    while (cells.length % 7 !== 0) cells.push({ placeholder: true });
    return cells;
  }

  prevBookingMonth() {
    const d = new Date(this.bookingCalendarMonth());
    d.setMonth(d.getMonth() - 1);
    this.bookingCalendarMonth.set(d);
    this.loadBookingCalendar();
  }

  nextBookingMonth() {
    const d = new Date(this.bookingCalendarMonth());
    d.setMonth(d.getMonth() + 1);
    this.bookingCalendarMonth.set(d);
    this.loadBookingCalendar();
  }

  pickBookingDate(day: any) {
    if (!day || day.placeholder || day.isBooked || this.isBookingPast(day.date)) return;
    if (!this.formData.startDateTime || !this.bookingSelectingEnd()) {
      this.formData.startDateTime = day.date;
      this.formData.endDateTime = day.date;
      this.bookingSelectingEnd.set(true);
      return;
    }
    if (day.date < this.formData.startDateTime) {
      this.formData.endDateTime = this.formData.startDateTime;
      this.formData.startDateTime = day.date;
    } else {
      this.formData.endDateTime = day.date;
    }
    this.bookingSelectingEnd.set(false);
  }

  isBookingInRange(dateText: string): boolean {
    if (!this.formData.startDateTime || !this.formData.endDateTime) return false;
    return dateText >= this.formData.startDateTime && dateText <= this.formData.endDateTime;
  }

  isBookingPast(dateText: string): boolean {
    const d = new Date(`${dateText}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d < today;
  }

  private loadBookingCalendar() {
    if (this.entity !== 'bookings') return;
    const spaceId = Number(this.formData.spaceId);
    if (!spaceId) {
      this.bookingCalendarDays.set([]);
      return;
    }
    const d = this.bookingCalendarMonth();
    this.bookingCalendarLoading.set(true);
    this.admin.getBookingCalendar(spaceId, d.getFullYear(), d.getMonth() + 1)
      .pipe(catchError(() => of({ data: { days: [] } })))
      .subscribe((res: any) => {
        this.bookingCalendarDays.set(res?.data?.days || []);
        this.bookingCalendarLoading.set(false);
      });
  }

  private toLocalDateText(year: number, monthIndex: number, day: number): string {
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
  }
}
