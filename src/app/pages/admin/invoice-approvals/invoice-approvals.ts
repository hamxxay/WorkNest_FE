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
}