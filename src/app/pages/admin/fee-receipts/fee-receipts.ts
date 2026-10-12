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
import { localDateIso } from '../../../utils/dates';

type LoadSource = 'invoices' | 'receipts' | 'accounts' | 'locations';

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

  // Today (browser-local calendar day) as YYYY-MM-DD
  todayStr = localDateIso();

  // User Scope
  isSuperAdmin = computed(() => this.auth.hasRole('super_admin'));
  /** Voiding is limited to admins / super admins; other roles can view and print only. */
  canVoid = computed(() => this.auth.hasRole('admin') || this.auth.hasRole('super_admin'));
  /** Location ids a location-bound user is assigned to (empty for super admin). */
  private ownLocationIds = computed<number[]>(() => {
    if (this.isSuperAdmin()) return [];
    const u = this.auth.getUser();
    const ids: (number | null | undefined)[] = u?.locationIds?.length ? u.locationIds : [u?.locationId];
    return ids.filter((x): x is number => x != null).map(Number);
  });
  /** Super admin always gets the location filter; location-bound users only when they have several locations. */
  showLocationFilter = computed(() => this.isSuperAdmin() || this.ownLocationIds().length > 1);

  // Locations for filter dropdown (limited to the user's own for location-bound users)
  locations = signal<any[]>([]);

  // ── Load errors (shown in the page banner) ────────────────────────────────
  private loadErrors = signal<Partial<Record<LoadSource, string>>>({});
  error = computed(() => Object.values(this.loadErrors()).filter(Boolean).join(' '));
  invoicesFailed = computed(() => !!this.loadErrors().invoices);
  receiptsFailed = computed(() => !!this.loadErrors().receipts);
  accountsFailed = computed(() => !!this.loadErrors().accounts);

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
  listLocationId = signal<number | null>(null); // null = all (the API limits location-bound users to theirs)

  private listSearch$ = new Subject<string>();
  private listSearchSub: Subscription | null = null;

  // ── Modals ────────────────────────────────────────────────────────────────
  showPrintModal = signal(false);
  printableReceipt = signal<FeeReceiptDetailDto | null>(null);
  loadingPrintable = signal(false);
  printableLoadingId = signal<number | null>(null);

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

  /** Why the receipt date blocks Generate (empty when valid). */
  dateError = computed(() => {
    if (!this.selectedInvoice()) return '';
    const date = this.receiptDate();
    if (!date) return 'Select a receipt date.';
    if (date > this.todayStr) return 'Receipt date cannot be in the future.';
    const minDate = this.minReceiptDate();
    if (minDate && date < minDate) return 'Receipt date cannot be before the invoice issue date.';
    return '';
  });

  /** Why the account selection blocks Generate (empty when valid or still loading). */
  accountError = computed(() => {
    if (!this.selectedInvoice() || this.loadingAccounts()) return '';
    if (this.accountsFailed()) return 'Accounts could not be loaded, so the receipt cannot be generated.';
    if (this.accounts().length === 0) return "No cash or bank account is set up for this invoice's company, so the receipt cannot be generated.";
    if (!this.selectedAccountId()) return 'Select a deposit / cash account.';
    return '';
  });

  canSave = computed(() => {
    if (this.saving()) return false;
    if (!this.selectedInvoice()) return false;
    if (this.loadingAccounts() || !this.selectedAccountId()) return false;
    if (!this.paymentType()) return false;
    return !this.dateError() && !this.accountError();
  });

  ngOnInit(): void {
    if (this.showLocationFilter()) {
      this.loadLocations();
    }

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

  // ── Errors ────────────────────────────────────────────────────────────────
  private errMsg(err: any, fallback: string): string {
    return err?.error?.message ?? err?.message ?? fallback;
  }

  private setLoadError(source: LoadSource, message: string | null): void {
    this.loadErrors.update(cur => {
      const next = { ...cur };
      if (message) next[source] = message; else delete next[source];
      return next;
    });
  }

  dismissError(): void {
    this.loadErrors.set({});
  }

  private loadLocations(): void {
    this.locationService.getAll().subscribe({
      next: (res: any) => {
        const list: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const own = new Set(this.ownLocationIds());
        this.locations.set(this.isSuperAdmin() ? list : list.filter(l => own.has(Number(l.id))));
        this.setLoadError('locations', null);
      },
      error: (err) => {
        this.locations.set([]);
        this.setLoadError('locations', `Could not load locations: ${this.errMsg(err, 'request failed.')}`);
      }
    });
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
    // Editing the search after picking an invoice drops the old selection.
    if (this.selectedInvoice()) {
      this.resetSelection();
    }
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
    // No locationId: the API scopes location-bound users to their own locations.
    this.feeReceiptService.getUnpaidInvoices(search, undefined, 30).subscribe({
      next: (list) => {
        this.unpaidInvoices.set(list);
        this.searchingInvoices.set(false);
        this.setLoadError('invoices', null);
      },
      error: (err) => {
        this.unpaidInvoices.set([]);
        this.searchingInvoices.set(false);
        this.setLoadError('invoices', `Could not load unpaid invoices: ${this.errMsg(err, 'request failed.')}`);
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

  /** Clears the chosen invoice and everything derived from it (keeps the search text). */
  private resetSelection(): void {
    this.selectedInvoice.set(null);
    this.accounts.set([]);
    this.selectedAccountId.set(null);
    this.setLoadError('accounts', null);
    this.paymentType.set('Cash');
    this.receiptDate.set(this.todayStr);
    this.remarks.set('');
  }

  clearSelectedInvoice(): void {
    this.resetSelection();
    this.invoiceSearchQuery.set('');
    this.fetchUnpaidInvoices('');
  }

  loadAccounts(companyId: number): void {
    this.loadingAccounts.set(true);
    this.feeReceiptService.getAccounts(companyId).subscribe({
      next: (accs) => {
        this.accounts.set(accs);
        this.loadingAccounts.set(false);
        this.setLoadError('accounts', null);
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
      error: (err) => {
        this.accounts.set([]);
        this.loadingAccounts.set(false);
        this.setLoadError('accounts', `Could not load cash / bank accounts: ${this.errMsg(err, 'request failed.')}`);
      }
    });
  }

  // ── Save Receipt ──────────────────────────────────────────────────────────
  saveReceipt(): void {
    if (!this.canSave()) return;
    const inv = this.selectedInvoice();
    if (!inv) return;

    this.saving.set(true);
    this.feeReceiptService.createReceipt({
      invoiceIdGUID: inv.invoiceIdGuid,
      cashInHandAccountId: this.selectedAccountId()!,
      receiptDate: this.receiptDate(),
      paymentType: this.paymentType(),
      remarks: this.remarks().trim() || null
    }).subscribe({
      next: (receipt) => {
        this.saving.set(false);
        this.toastService.success(`Fee receipt ${receipt.code} generated successfully.`);

        // Reset form
        this.clearSelectedInvoice();

        // Immediately show printable receipt
        this.printableReceipt.set(receipt);
        this.showPrintModal.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.toastService.error(this.errMsg(err, 'Failed to create fee receipt.'));
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
        this.setLoadError('receipts', null);
      },
      error: (err) => {
        this.receipts.set([]);
        this.totalReceipts.set(0);
        this.loadingReceipts.set(false);
        this.setLoadError('receipts', `Could not load fee receipts: ${this.errMsg(err, 'request failed.')}`);
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
    if (this.loadingPrintable()) return;
    this.loadingPrintable.set(true);
    this.printableLoadingId.set(receiptItem.id);
    this.feeReceiptService.getReceiptById(receiptItem.id).subscribe({
      next: (detail) => {
        this.printableReceipt.set(detail);
        this.showPrintModal.set(true);
        this.loadingPrintable.set(false);
        this.printableLoadingId.set(null);
      },
      error: (err) => {
        this.loadingPrintable.set(false);
        this.printableLoadingId.set(null);
        this.toastService.error(this.errMsg(err, 'Failed to load receipt details for printing.'));
      }
    });
  }

  closePrintModal(): void {
    this.showPrintModal.set(false);
    this.printableReceipt.set(null);
  }

  /**
   * Prints only the receipt: copies it into a body-level container and hides the rest of the app
   * while printing (rules under body.printing-receipt in styles.css). The copy keeps Angular's
   * scoped-style attributes, so the receipt styles still apply, and it is not clipped by the popup.
   */
  triggerPrint(): void {
    const source = document.querySelector('#admin-receipt-printable .receipt-printable-body');
    if (!source) return;
    const root = document.createElement('div');
    root.className = 'receipt-print-root';
    root.appendChild(source.cloneNode(true));
    document.body.appendChild(root);
    document.body.classList.add('printing-receipt');

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener('afterprint', cleanup);
      document.body.classList.remove('printing-receipt');
      root.remove();
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  // ── Void Receipt Flow ─────────────────────────────────────────────────────
  openVoidModal(item: FeeReceiptListItemDto): void {
    if (!this.canVoid() || item.status === 0) return; // Not allowed / already void
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
    this.feeReceiptService.voidReceipt({ id: item.id, voidReason: reason }).subscribe({
      next: () => {
        this.voiding.set(false);
        this.closeVoidModal();
        this.toastService.success(`Receipt ${item.code} has been voided. Invoice ${item.invoiceNumber} is marked Unpaid.`);
        this.loadReceipts();
      },
      error: (err) => {
        this.voiding.set(false);
        this.toastService.error(this.errMsg(err, 'Failed to void receipt.'));
      }
    });
  }
}
