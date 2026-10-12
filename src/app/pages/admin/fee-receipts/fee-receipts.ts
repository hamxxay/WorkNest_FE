import { Component, OnInit, OnDestroy, HostListener, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { 
  FeeReceiptService, 
  UnpaidInvoiceDto, 
  FeeReceiptAccountDto, 
  FeeReceiptListItemDto, 
  FeeReceiptDetailDto 
} from '../../../services/fee-receipt.service';
import { ToastService } from '../../../services/toast.service';
import { AuthService } from '../../../services/auth.service';
import { LocationService } from '../../../services/location.service';

@Component({
  selector: 'app-fee-receipts',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, DecimalPipe],
  templateUrl: './fee-receipts.html',
  styleUrl: './fee-receipts.css'
})
export class FeeReceiptsComponent implements OnInit, OnDestroy {
  private feeReceiptService = inject(FeeReceiptService);
  private toastService = inject(ToastService);
  private auth = inject(AuthService);
  private locationService = inject(LocationService);

  // Tabs: 'create' or 'list'
  activeTab = signal<'create' | 'list'>('create');

  // Today string YYYY-MM-DD
  todayStr = new Date().toISOString().split('T')[0];

  // User Scope
  isSuperAdmin = computed(() => this.auth.hasRole('super_admin'));
  userLocationId = computed(() => this.auth.getUser()?.locationId ?? null);

  // Locations for filter dropdown
  locations = signal<any[]>([]);

  // ── Form State ────────────────────────────────────────────────────────────
  invoiceSearchQuery = signal('');
  invoiceDropdownOpen = signal(false);
  searchingInvoices = signal(false);
  unpaidInvoices = signal<UnpaidInvoiceDto[]>([]);
  selectedInvoice = signal<UnpaidInvoiceDto | null>(null);

  accounts = signal<FeeReceiptAccountDto[]>([]);
  loadingAccounts = signal(false);
  selectedAccountId = signal<number | null>(null);

  paymentType = signal<string>('Cash');
  paymentTypeOptions: string[] = ['Cash'];

  receiptDate = signal<string>(this.todayStr);
  remarks = signal<string>('');
  saving = signal(false);

  // Search debouncer
  private invoiceSearch$ = new Subject<string>();
  private searchSub: Subscription | null = null;

  // ── List State ────────────────────────────────────────────────────────────
  loadingReceipts = signal(false);
  receipts = signal<FeeReceiptListItemDto[]>([]);
  totalReceipts = signal(0);
  currentPage = signal(1);
  pageSize = signal(10);
  listSearch = signal('');
  listStatus = signal<number | null>(null); // null = All, 1 = Active, 0 = Void
  listLocationId = signal<number | null>(null);

  private listSearch$ = new Subject<string>();
  private listSearchSub: Subscription | null = null;

  // ── Modals ────────────────────────────────────────────────────────────────
  showPrintModal = signal(false);
  printableReceipt = signal<FeeReceiptDetailDto | null>(null);
  loadingPrintable = signal(false);

  showVoidModal = signal(false);
  receiptToVoid = signal<FeeReceiptListItemDto | null>(null);
  voidReason = signal('');
  voiding = signal(false);

  // ── Validation Computed ───────────────────────────────────────────────────
  minReceiptDate = computed(() => {
    const inv = this.selectedInvoice();
    if (!inv || !inv.issuedOn) return '';
    return inv.issuedOn.toString().split('T')[0];
  });

  canSave = computed(() => {
    if (this.saving()) return false;
    const inv = this.selectedInvoice();
    if (!inv) return false;
    if (!this.selectedAccountId()) return false;
    if (!this.paymentType()) return false;
    const date = this.receiptDate();
    if (!date) return false;
    if (date > this.todayStr) return false;
    const minDate = this.minReceiptDate();
    if (minDate && date < minDate) return false;
    return true;
  });

  ngOnInit(): void {
    // Set default location filter if location-bound
    if (!this.isSuperAdmin() && this.userLocationId()) {
      this.listLocationId.set(this.userLocationId());
    }

    // Load locations
    this.locationService.getAll().subscribe({
      next: (res: any) => {
        const list = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        this.locations.set(list);
      },
      error: () => {}
    });

    // Setup invoice search debounce
    this.searchSub = this.invoiceSearch$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(query => {
        this.fetchUnpaidInvoices(query);
      });

    // Setup list search debounce
    this.listSearchSub = this.listSearch$
      .pipe(debounceTime(350), distinctUntilChanged())
      .subscribe(() => {
        this.currentPage.set(1);
        this.loadReceipts();
      });

    // Initial load of unpaid invoices
    this.fetchUnpaidInvoices('');
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
    this.listSearchSub?.unsubscribe();
  }

  // Close dropdown on click outside
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.invoice-dropdown-container')) {
      this.invoiceDropdownOpen.set(false);
    }
  }

  // ── Tab Management ────────────────────────────────────────────────────────
  switchTab(tab: 'create' | 'list'): void {
    this.activeTab.set(tab);
    if (tab === 'list') {
      this.loadReceipts();
    } else {
      if (this.unpaidInvoices().length === 0) {
        this.fetchUnpaidInvoices('');
      }
    }
  }

  // ── Invoice Search & Selection ────────────────────────────────────────────
  onInvoiceSearchInput(value: string): void {
    this.invoiceSearchQuery.set(value);
    this.invoiceDropdownOpen.set(true);
    this.invoiceSearch$.next(value);
  }

  onInvoiceInputFocus(): void {
    this.invoiceDropdownOpen.set(true);
    if (this.unpaidInvoices().length === 0) {
      this.fetchUnpaidInvoices(this.invoiceSearchQuery());
    }
  }

  fetchUnpaidInvoices(search: string): void {
    this.searchingInvoices.set(true);
    const locId = this.isSuperAdmin() ? undefined : (this.userLocationId() ?? undefined);
    this.feeReceiptService.getUnpaidInvoices(search, locId, 30).subscribe({
      next: (list) => {
        this.unpaidInvoices.set(list);
        this.searchingInvoices.set(false);
      },
      error: () => {
        this.unpaidInvoices.set([]);
        this.searchingInvoices.set(false);
      }
    });
  }

  selectInvoice(inv: UnpaidInvoiceDto): void {
    this.selectedInvoice.set(inv);
    this.invoiceSearchQuery.set(inv.dropdownDisplay);
    this.invoiceDropdownOpen.set(false);

    // Adjust receipt date if today is somehow before invoice date (shouldn't happen, but safe)
    const invDate = inv.issuedOn ? inv.issuedOn.toString().split('T')[0] : '';
    if (invDate && this.todayStr < invDate) {
      this.receiptDate.set(invDate);
    } else {
      this.receiptDate.set(this.todayStr);
    }

    // Load accounts for this invoice's company
    this.loadAccounts(inv.companyId);
  }

  clearSelectedInvoice(): void {
    this.selectedInvoice.set(null);
    this.invoiceSearchQuery.set('');
    this.accounts.set([]);
    this.selectedAccountId.set(null);
    this.paymentType.set('Cash');
    this.receiptDate.set(this.todayStr);
    this.remarks.set('');
    this.fetchUnpaidInvoices('');
  }

  loadAccounts(companyId: number): void {
    this.loadingAccounts.set(true);
    this.feeReceiptService.getAccounts(companyId).subscribe({
      next: (accs) => {
        this.accounts.set(accs);
        this.loadingAccounts.set(false);
        // Preselect primary Cash account (Account 101 or isCashInHand)
        const acc101 = accs.find(a => a.accountId === 101);
        if (acc101) {
          this.selectedAccountId.set(acc101.accountId);
        } else {
          const cashInHand = accs.find(a => a.isCashInHand);
          if (cashInHand) {
            this.selectedAccountId.set(cashInHand.accountId);
          } else if (accs.length > 0) {
            this.selectedAccountId.set(accs[0].accountId);
          }
        }
      },
      error: () => {
        this.accounts.set([]);
        this.loadingAccounts.set(false);
      }
    });
  }

  // ── Save Receipt ──────────────────────────────────────────────────────────
  saveReceipt(): void {
    if (!this.canSave()) return;
    const inv = this.selectedInvoice();
    if (!inv) return;

    this.saving.set(true);
    const invoiceGuid = inv.invoiceIdGuid || (inv as any).invoiceIdGUID || (inv as any).InvoiceIdGUID;
    const accountId = this.selectedAccountId()!;

    const payload = {
      invoiceIdGUID: invoiceGuid,
      invoiceIdGuid: invoiceGuid,
      cashInHandAccountId: accountId,
      accountId: accountId,
      receiptDate: this.receiptDate(),
      paymentType: this.paymentType(),
      remarks: this.remarks().trim() || null
    };

    this.feeReceiptService.createReceipt(payload).subscribe({
      next: (res) => {
        this.saving.set(false);
        const receipt = res.data;
        this.toastService.success(`Fee receipt ${receipt.code} generated successfully!`);

        // Reset form
        this.clearSelectedInvoice();

        // Immediately show printable receipt
        this.printableReceipt.set(receipt);
        this.showPrintModal.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        const msg = err.error?.message || err.message || 'Failed to create fee receipt.';
        this.toastService.error(msg);
      }
    });
  }

  // ── List & Pagination ─────────────────────────────────────────────────────
  onListSearchInput(val: string): void {
    this.listSearch.set(val);
    this.listSearch$.next(val);
  }

  onFilterChange(): void {
    this.currentPage.set(1);
    this.loadReceipts();
  }

  loadReceipts(): void {
    this.loadingReceipts.set(true);
    const params = {
      page: this.currentPage(),
      limit: this.pageSize(),
      search: this.listSearch(),
      locationId: this.listLocationId(),
      status: this.listStatus()
    };

    this.feeReceiptService.getReceipts(params).subscribe({
      next: (res) => {
        this.receipts.set(res.items || []);
        this.totalReceipts.set(res.total || 0);
        this.loadingReceipts.set(false);
      },
      error: () => {
        this.receipts.set([]);
        this.totalReceipts.set(0);
        this.loadingReceipts.set(false);
      }
    });
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.currentPage.set(p);
    this.loadReceipts();
  }

  totalPages = computed(() => {
    return Math.ceil(this.totalReceipts() / this.pageSize()) || 1;
  });

  // ── Print Modal Flow ──────────────────────────────────────────────────────
  openPrintReceipt(receiptItem: FeeReceiptListItemDto): void {
    this.loadingPrintable.set(true);
    this.feeReceiptService.getReceiptById(receiptItem.id).subscribe({
      next: (detail) => {
        this.printableReceipt.set(detail);
        this.showPrintModal.set(true);
        this.loadingPrintable.set(false);
      },
      error: (err) => {
        this.loadingPrintable.set(false);
        this.toastService.error('Failed to load receipt details for printing.');
      }
    });
  }

  closePrintModal(): void {
    this.showPrintModal.set(false);
    this.printableReceipt.set(null);
  }

  triggerPrint(): void {
    window.print();
  }

  // ── Void Receipt Flow ─────────────────────────────────────────────────────
  openVoidModal(item: FeeReceiptListItemDto): void {
    if (item.status === 0) return; // Already void
    this.receiptToVoid.set(item);
    this.voidReason.set('');
    this.showVoidModal.set(true);
  }

  closeVoidModal(): void {
    this.showVoidModal.set(false);
    this.receiptToVoid.set(null);
    this.voidReason.set('');
  }

  confirmVoid(): void {
    const item = this.receiptToVoid();
    const reason = this.voidReason().trim();
    if (!item) return;
    if (!reason) {
      this.toastService.warning('Please enter a reason for voiding this receipt.');
      return;
    }

    this.voiding.set(true);
    const payload = {
      id: item.id,
      receiptId: item.id,
      receiptGUID: item.idGuid,
      voidReason: reason
    };
    this.feeReceiptService.voidReceipt(payload).subscribe({
      next: () => {
        this.voiding.set(false);
        this.showVoidModal.set(false);
        this.toastService.success(`Receipt ${item.code} has been voided. Invoice ${item.invoiceNumber} is marked Unpaid.`);
        this.loadReceipts();
      },
      error: (err) => {
        this.voiding.set(false);
        const msg = err.error?.message || err.message || 'Failed to void receipt.';
        this.toastService.error(msg);
      }
    });
  }
}
