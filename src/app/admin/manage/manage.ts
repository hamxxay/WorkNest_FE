import { Component, OnInit, signal, computed, effect } from '@angular/core';
import { Observable } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { AdminService } from '../../services/admin.service';
import { ApiResponse, User, Location, SpaceType, Space, Booking, PricingPlan, Membership, Payment, Contact, GalleryImage } from '../../models/admin.model';

interface Column { key: string; label: string; type?: string; }
interface EntityConfig {
  title: string;
  columns: Column[];
  // configuration now only used for metadata (fields, statusOptions, etc.)
  statusOptions?: string[];
  fields?: { key: string; label: string; type: string; options?: any[] }[];
  idKey?: string;
  // names of AdminService methods used in template for showing buttons
  loadFn?: string;
  deleteFn?: string;
  createFn?: string;
  updateFn?: string;
  statusFn?: string;
}

// typed handler signatures used by the component
// generic <T> corresponds to the item type returned by the load call
interface Handlers<T = any> {
  load: (page?: number, limit?: number, search?: string) => Observable<ApiResponse<T[]>>;
  delete?: (id: number | string) => Observable<ApiResponse<any>>;
  create?: (data: Partial<T>) => Observable<ApiResponse<T>>;
  update?: (id: number | string, data: Partial<T>) => Observable<ApiResponse<T>>;
  status?: (id: number | string, status: string) => Observable<ApiResponse<any>>;
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
  showModal = false;
  editItem: unknown = null;
  fullEditItem: unknown = null; // Store full entity details for spaces with relation IDs
  formData: Record<string, unknown> = {};
  saving = false;
  error = '';
  success = '';
  // reactive search and  state
  searchQuery = signal('');
  currentPage = signal(1);
  readonly pageSize = 20;
  totalItems = signal(0);

  // computed list of pages - not used in template directly but helps
  totalPages = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.pageSize)));

  private handlers!: Handlers;

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
        { key: 'lastName', label: 'Last Name', type: 'text' },
        { key: 'password', label: 'Password', type: 'password' },
        { key: 'role', label: 'Role', type: 'select', options: [{v:'Admin',l:'Admin'},{v:'Public',l:'Public'}] }
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
        { key: 'hourlyAllowed', label: 'Hourly', type: 'boolean' },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ],
      loadFn: 'getSpaceTypes', deleteFn: 'deleteSpaceType', createFn: 'createSpaceType', updateFn: 'updateSpaceType',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'capacity', label: 'Capacity', type: 'number' },
        { key: 'hourlyAllowed', label: 'Hourly Allowed', type: 'checkbox' }
      ]
    },
    spaces: {
      title: 'Spaces',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'locationName', label: 'Location' },
        { key: 'spaceTypeName', label: 'Type' },
        { key: 'code', label: 'Code' },
        { key: 'pricePerHour', label: '$/hr', type: 'currency' },
        { key: 'pricePerDay', label: '$/day', type: 'currency' },
        { key: 'status', label: 'Status', type: 'status' }
      ],
      loadFn: 'getSpaces', deleteFn: 'deleteSpace', createFn: 'createSpace', updateFn: 'updateSpace',
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'locationId', label: 'Location ID', type: 'number' },
        { key: 'spaceTypeId', label: 'Space Type ID', type: 'number' },
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
      statusFn: 'updateBookingStatus',
      statusOptions: ['Pending', 'Confirmed', 'Cancelled', 'Completed']
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
        { key: 'billingCycle', label: 'Billing Cycle', type: 'select', options: [{v:'Monthly',l:'Monthly'},{v:'Quarterly',l:'Quarterly'},{v:'Yearly',l:'Yearly'}] },
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
        { key: 'locationId', label: 'Location ID (optional)', type: 'number' }
      ]
    }
  };

  private setHandlers() {
    switch (this.entity) {
      case 'users':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getUsers(p, l, s),
          delete: id => this.admin.deleteUser(String(id)),
          create: data => this.admin.createUser(data),
          update: (id, data) => this.admin.updateUser(String(id), data),
          status: (id, status) => status === 'Activate' ? this.admin.activateUser(String(id)) : this.admin.deactivateUser(String(id))
        };
        break;
      case 'locations':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getLocations(p, l, s),
          delete: id => this.admin.deleteLocation(Number(id)),
          create: data => this.admin.createLocation(data),
          update: (id, data) => this.admin.updateLocation(Number(id), data)
        };
        break;
      case 'space-types':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getSpaceTypes(p, l, s),
          delete: id => this.admin.deleteSpaceType(Number(id)),
          create: data => this.admin.createSpaceType(data),
          update: (id, data) => this.admin.updateSpaceType(Number(id), data)
        };
        break;
      case 'spaces':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getSpaces(p, l, s),
          delete: id => this.admin.deleteSpace(Number(id)),
          create: data => this.admin.createSpace(data),
          update: (id, data) => this.admin.updateSpace(Number(id), data)
        };
        break;
      case 'bookings':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getBookings(p, l, s),
          status: (id, status) => this.admin.updateBookingStatus(id as number, status)
        };
        break;
      case 'pricing':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getPricingPlans(p, l, s),
          delete: id => this.admin.deletePricingPlan(id as number),
          create: data => this.admin.createPricingPlan(data),
          update: (id, data) => this.admin.updatePricingPlan(id as number, data)
        };
        break;
      case 'memberships':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getMemberships(p, l, s),
          delete: id => this.admin.deleteMembership(id as number),
          status: (id, status) => this.admin.updateMembershipStatus(id as number, status)
        };
        break;
      case 'payments':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getPayments(p, l, s),
          delete: id => this.admin.deletePayment(id as number),
          status: (id, status) => this.admin.updatePaymentStatus(id as number, status)
        };
        break;
      case 'contacts':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getContacts(p, l, s),
          delete: id => this.admin.deleteContact(id as number),
          status: (id, status) => this.admin.updateContactStatus(id as number, status)
        };
        break;
      case 'gallery':
        this.handlers = {
          load: (p?, l?, s?) => this.admin.getGalleryAll(p, l, s),
          delete: id => this.admin.deleteGalleryImage(id as number),
          create: data => this.admin.createGalleryImage(data),
          update: (id, data) => this.admin.updateGalleryImage(id as number, data)
        };
        break;
      default:
        this.handlers = { load: (_p?, _l?, _s?) => this.admin.getUsers() };
    }
  }

  constructor(private route: ActivatedRoute, public admin: AdminService) {
    // flag to prevent the first debounced search from firing before the
    // initial page-triggered load completes.
    let searchInitialized = false;

    // reload when page changes immediately
    effect(() => {
      // access to create dependency but not otherwise used
      this.currentPage();
      if (this.config) this.load();
      // mark search effect ready after first page effect runs
      if (!searchInitialized) {
        searchInitialized = true;
      }
    });

    // debounce search query updates; reset page and ensure one load
    // even when already on page 1.
    let searchTimer: any;
    effect(() => {
      // dependency on query
      this.searchQuery();
      if (!searchInitialized) {
        // skip until page effect has run once
        return;
      }
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (this.config) {
          if (this.currentPage() === 1) {
            // already on first page, call load directly
            this.load();
          } else {
            // change page to 1; page effect will fire load
            this.currentPage.set(1);
          }
        }
      }, 300);
    });
  }

  ngOnInit() {
    this.route.data.subscribe(data => {
      this.entity = data['entity'] || '';
      this.config = this.configs[this.entity];
      if (this.config) {
        this.setHandlers();
        this.load();
      }
    });
  }

  load() {
    this.loading.set(true);
    const page = this.currentPage();
    const limit = this.pageSize;
    const search = this.searchQuery();
    this.handlers.load(page, limit, search).subscribe({
      next: (res: any) => {
        this.items.set(res.data || []);
        // expect server to send total count in response (e.g. res.total)
        this.totalItems.set(res.total ?? this.items().length);
        this.loading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.totalItems.set(0);
        this.loading.set(false);
      }
    });
  }

  // filtered list is now handled server-side; items() already contains
  // only the current page/search results.

  getCellValue(item: any, col: Column): string {
    const val = item[col.key];
    if (val == null) return '—';
    if (col.type === 'date') return val;
    if (col.type === 'currency') return '$' + Number(val).toFixed(2);
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
    this.error = '';

    // For spaces, load full entity details to ensure we have relation IDs
    // (locationId, spaceTypeId) which are not exposed in the list view
    if (this.entity === 'spaces') {
      this.saving = true;
      this.admin.getSpaceById(item.id).subscribe({
        next: (res: any) => {
          this.saving = false;
          if (res.data) {
            // Store full details and populate form with complete data
            this.fullEditItem = res.data;
            this.formData = { ...res.data };
            this.showModal = true;
          } else {
            this.error = 'Failed to load space details';
          }
        },
        error: (err: any) => {
          this.saving = false;
          this.error = 'Failed to load space details';
          console.error('Failed to load space details:', err);
        }
      });
    } else {
      // For other entities, use row data directly
      this.fullEditItem = item;
      this.formData = { ...item };
      this.showModal = true;
    }
  }

  closeModal() {
    this.showModal = false;
    this.editItem = null;
    this.fullEditItem = null;
    this.formData = {};
    this.error = '';
  }

  save() {
    this.saving = true;
    this.error = '';
    const id = (this.editItem as any)?.id;
    
    // For spaces, build strict payload with required relation IDs
    let payload = this.formData;
    if (this.entity === 'spaces' && this.editItem) {
      const fullItem = this.fullEditItem as any || this.editItem as any;
      payload = {
        name: this.formData['name'],
        code: this.formData['code'],
        description: this.formData['description'],
        floor: this.formData['floor'],
        pricePerHour: this.formData['pricePerHour'],
        pricePerDay: this.formData['pricePerDay'],
        imageUrl: this.formData['imageUrl'],
        amenities: this.formData['amenities'],
        // Include relation IDs from full entity details
        locationId: fullItem.locationId,
        spaceTypeId: fullItem.spaceTypeId
      };
    }

    const call = this.editItem
      ? this.handlers.update!(id, payload)
      : this.handlers.create!(payload);

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
    if (!this.handlers.delete) return;
    if (!confirm('Are you sure you want to delete this item?')) return;
    this.handlers.delete(item.id)!.subscribe({
      next: () => { this.load(); this.flashSuccess('Deleted successfully'); },
      error: (err: any) => { alert(err.error?.message || 'Delete failed'); }
    });
  }

  changeStatus(item: any, status: string) {
    if (!this.handlers.status) return;
    this.handlers.status(item.id, status)!.subscribe({
      next: () => { this.load(); this.flashSuccess('Status updated'); },
      error: (err: any) => { alert(err.error?.message || 'Status update failed'); }
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

  /**
   * Navigate to the next page if not already at the last page.
   * Updating currentPage will trigger the page effect, which calls load().
   */
  nextPage() {
    const next = this.currentPage() + 1;
    if (next <= this.totalPages()) {
      this.currentPage.set(next);
    }
  }

  /**
   * Navigate to the previous page if not already at the first page.
   * Updating currentPage will trigger the page effect, which calls load().
   */
  prevPage() {
    const prev = this.currentPage() - 1;
    if (prev >= 1) {
      this.currentPage.set(prev);
    }
  }

  /**
   * Check if we are at the first page.
   */
  isFirstPage(): boolean {
    return this.currentPage() === 1;
  }

  /**
   * Check if we are at the last page.
   */
  isLastPage(): boolean {
    return this.currentPage() >= this.totalPages();
  }
}
