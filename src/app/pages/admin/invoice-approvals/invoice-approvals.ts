import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { LocationService } from '../../../services/location.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-invoice-approvals',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DecimalPipe],
  templateUrl: './invoice-approvals.html',
  styleUrl: './invoice-approvals.css'
})
export class InvoiceApprovalsComponent implements OnInit {
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private locationService = inject(LocationService);
  private toast = inject(ToastService);

  // User & permissions
  readonly isSuperAdmin = computed(() => this.auth.hasRole('super_admin'));
  readonly isAdmin = computed(() => this.auth.hasRole('admin') || this.isSuperAdmin());
  readonly isSalesExecutive = computed(() => this.auth.hasRole('sales_executive'));

  // Queue state
  readonly queue = signal<any[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string>('');
  readonly searchQuery = signal<string>('');
  readonly locations = signal<any[]>([]);
  readonly selectedLocationId = signal<number | null>(null);

  // Review modal state
  readonly selectedInvoice = signal<any | null>(null);
  readonly invoiceDetails = signal<any | null>(null);
  readonly detailsLoading = signal<boolean>(false);
  readonly viewLoading = signal<boolean>(false);
  readonly viewSuccess = signal<boolean>(false);
  readonly viewError = signal<string>('');
  readonly approving = signal<boolean>(false);
  readonly approvalResult = signal<{ success: boolean; message: string } | null>(null);

  // Generate recurring invoice modal state
  readonly showGenerateRecurringModal = signal<boolean>(false);
  readonly generatingRecurring = signal<boolean>(false);
  readonly selectedBookingId = signal<number | null>(null);
  readonly bookingsList = signal<any[]>([]);
  readonly bookingsLoading = signal<boolean>(false);
  readonly bookingSearch = signal<string>('');

  readonly filteredBookings = computed(() => {
    const q = this.bookingSearch().trim().toLowerCase();
    const list = this.bookingsList();
    if (!q) return list;
    return list.filter(b => {
      const id = String(b.bookingId ?? b.id ?? '');
      const cust = String(b.fullName || b.customerName || b.customer || '').toLowerCase();
      const space = String(b.spaceCode || b.spaceTitle || '').toLowerCase();
      const comp = String(b.companyName || '').toLowerCase();
      return id.includes(q) || cust.includes(q) || space.includes(q) || comp.includes(q);
    });
  });

  // Filtered queue items
  readonly filteredQueue = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const items = this.queue();
    if (!q) return items;
    return items.filter(item => {
      const invNum = (item.invoiceNumber || item.InvoiceNumber || '').toLowerCase();
      const cust = (item.customerName || item.CustomerName || '').toLowerCase();
      const email = (item.customerEmail || item.CustomerEmail || '').toLowerCase();
      const comp = (item.companyName || item.CompanyName || '').toLowerCase();
      const space = (item.spaceName || item.SpaceName || '').toLowerCase();
      const loc = (item.locationName || item.LocationName || '').toLowerCase();
      return invNum.includes(q) || cust.includes(q) || email.includes(q) || comp.includes(q) || space.includes(q) || loc.includes(q);
    });
  });

  // Summary counts
  readonly totalPendingCount = computed(() => this.queue().length);
  readonly totalPendingAmount = computed(() =>
    this.queue().reduce((sum, item) => sum + (Number(item.grandTotal || item.GrandTotal || 0)), 0)
  );

  ngOnInit(): void {
    this.loadLocations();
    this.loadQueue();
  }

  loadLocations(): void {
    this.locationService.getAll().subscribe({
      next: (res: any) => {
        const data = res?.data || res || [];
        this.locations.set(Array.isArray(data) ? data : []);
      },
      error: () => {
        // Fallback or leave empty
      }
    });
  }

  loadQueue(): void {
    this.loading.set(true);
    this.error.set('');
    const locId = this.selectedLocationId();
    this.admin.getApprovalQueue(locId ?? undefined).subscribe({
      next: (res: any) => {
        this.loading.set(false);
        const data = res?.data || res || [];
        this.queue.set(Array.isArray(data) ? data : []);
      },
      error: (err: any) => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'Failed to load invoice approval queue.');
      }
    });
  }

  onLocationChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.selectedLocationId.set(val ? Number(val) : null);
    this.loadQueue();
  }

  openReview(item: any): void {
    const invoiceId = item.id || item.Id;
    if (!invoiceId) return;

    this.selectedInvoice.set(item);
    this.invoiceDetails.set(null);
    this.approvalResult.set(null);
    this.viewSuccess.set(false);
    this.viewError.set('');
    this.viewLoading.set(true);
    this.detailsLoading.set(true);

    // 1. Fetch full invoice details
    this.admin.getInvoiceDetails(invoiceId).subscribe({
      next: (res: any) => {
        this.detailsLoading.set(false);
        this.invoiceDetails.set(res?.data || res);
      },
      error: () => {
        this.detailsLoading.set(false);
      }
    });

    // 2. Call POST /view
    this.admin.recordInvoiceViewed(invoiceId).subscribe({
      next: () => {
        this.viewLoading.set(false);
        this.viewSuccess.set(true);
        // Update local item viewed status
        item.viewedAt = new Date().toISOString();
        item.ViewedAt = item.viewedAt;
        const currentName = this.auth.user()?.displayName || 'Current User';
        item.viewedByName = currentName;
        item.ViewedByName = currentName;
      },
      error: (err: any) => {
        this.viewLoading.set(false);
        this.viewSuccess.set(false);
        this.viewError.set(err?.error?.message || 'Failed to record invoice view.');
      }
    });
  }

  closeReview(): void {
    this.selectedInvoice.set(null);
    this.invoiceDetails.set(null);
    this.approvalResult.set(null);
  }

  approveCurrentInvoice(): void {
    const inv = this.selectedInvoice();
    if (!inv || !this.isAdmin() || !this.viewSuccess() || this.approving()) return;

    const invoiceId = inv.id || inv.Id;
    this.approving.set(true);
    this.approvalResult.set(null);

    this.admin.approveInvoice(invoiceId).subscribe({
      next: (res: any) => {
        this.approving.set(false);
        const msg = res?.message || 'Invoice approved successfully and delivery email dispatched!';
        this.approvalResult.set({ success: true, message: msg });
        this.toast.success(msg);

        // Remove approved invoice from queue
        this.queue.update(items => items.filter(x => (x.id || x.Id) !== invoiceId));
      },
      error: (err: any) => {
        this.approving.set(false);
        const errMsg = err?.error?.message || err?.message || 'Failed to approve invoice.';
        this.approvalResult.set({ success: false, message: errMsg });
        this.toast.error(errMsg);
      }
    });
  }

  openGenerateRecurringModal(): void {
    this.selectedBookingId.set(null);
    this.bookingSearch.set('');
    this.showGenerateRecurringModal.set(true);
    if (this.bookingsList().length === 0) {
      this.loadBookingsForRecurring();
    }
  }

  closeGenerateRecurringModal(): void {
    this.showGenerateRecurringModal.set(false);
  }

  loadBookingsForRecurring(): void {
    this.bookingsLoading.set(true);
    this.admin.getBookings(1, 1000, '').subscribe({
      next: (res: any) => {
        this.bookingsLoading.set(false);
        const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        this.bookingsList.set(list);
        if (list.length > 0 && !this.selectedBookingId()) {
          const first = list[0];
          this.selectedBookingId.set(Number(first.id ?? first.bookingId ?? null));
        }
      },
      error: () => {
        this.bookingsLoading.set(false);
      }
    });
  }

  submitGenerateRecurringInvoice(): void {
    const bookingId = this.selectedBookingId();
    if (!bookingId) {
      this.toast.error('Please select or enter a valid Booking ID.');
      return;
    }

    this.generatingRecurring.set(true);
    this.admin.generateRecurringInvoice(Number(bookingId), false).subscribe({
      next: (res: any) => {
        this.generatingRecurring.set(false);
        if (res?.success || res?.isSuccessful) {
          const invNum = res.data?.invoiceNumber || res.invoiceNumber ? ` (#${res.data?.invoiceNumber || res.invoiceNumber})` : '';
          this.toast.success(res.message || `Recurring invoice${invNum} generated and added to Invoice Approvals queue.`);
          this.closeGenerateRecurringModal();
          this.loadQueue();
        } else {
          this.toast.error(res?.message || 'Failed to generate recurring invoice.');
        }
      },
      error: (err: any) => {
        this.generatingRecurring.set(false);
        const msg = err?.error?.message || err?.message || 'Error generating recurring invoice.';
        this.toast.error(msg);
      }
    });
  }
}