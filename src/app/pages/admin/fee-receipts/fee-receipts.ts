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
  FeeReceiptDetailDto,
  PaymentMode
} from '../../../services/fee-receipt.service';
import { ToastService } from '../../../services/toast.service';
import { AuthService } from '../../../services/auth.service';
import { LocationService } from '../../../services/location.service';
import { localDateIso } from '../../../utils/dates';
import { CNIC_FORMAT_PATTERN, CNIC_MAX_LENGTH, onCnicMaskInput } from '../../../utils/cnic';

type LoadSource = 'invoices' | 'receipts' | 'accounts' | 'locations';

/** PKR to 2 decimals (avoids 0.1 + 0.2 style leftovers in the figures). */
const round2 = (n: number) => Math.round(n * 100) / 100;
/** An amount typed by the user: digits with at most 2 decimals (commas allowed); NaN otherwise. */
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
function parseAmount(text: string): number {
  const t = text.trim().replace(/,/g, '');
  return AMOUNT_PATTERN.test(t) ? Number(t) : NaN;
}
const pkr = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  // Depositor (person who paid): both required. Errors show once the field has been left.
  depositorName = signal<string>('');
  depositorCnic = signal<string>('');
  depositorNameTouched = signal(false);
  depositorCnicTouched = signal(false);
  readonly depositorNameMaxLength = 150; // API / DepositorName NVARCHAR(150)
  readonly cnicMaxLength = CNIC_MAX_LENGTH;
  readonly onCnicMaskInput = onCnicMaskInput;

  // ── Payment mode (part payments, FR_01) ──────────────────────────────────
  // Full: the invoice's whole remaining balance (the server works it out again when saving, so a stale figure here can
  // never over- or under-pay). Partial: an amount the user types, 0 < amount <= balance; the server checks it again.
  paymentMode = signal<PaymentMode>('Full');
  partialAmountText = signal<string>('');
  partialAmountTouched = signal(false);
  /** Left to pay on the chosen invoice (net of WHT, less what was paid before). */
  balance = computed(() => round2(this.selectedInvoice()?.balanceAmount ?? 0));
  /** Custom invoices (type 7) are paid in full only: the amount is the whole balance and cannot be changed. */
  isCustomInvoice = computed(() => !!this.selectedInvoice()?.isCustom);
  /** Withholding-tax and custom invoices (and every invoice before the database update) are paid in full only. */
  partialAllowed = computed(() => !!this.selectedInvoice()?.allowPartial && !this.isCustomInvoice());
  /** This receipt's amount: the whole balance (Full) or the typed amount (Partial; NaN while it is not a valid amount). */
  receiptAmount = computed(() => this.paymentMode() === 'Full' ? this.balance() : parseAmount(this.partialAmountText()));
  /** Balance after this payment, live as the amount changes (the balance itself while the amount is not valid). */
  balanceAfter = computed(() => {
    const a = this.receiptAmount();
    return Number.isFinite(a) && a > 0 && a <= this.balance() ? round2(this.balance() - a) : this.balance();
  });
  /** Why the amount blocks Generate (empty when valid). */
  amountError = computed(() => {
    if (this.paymentMode() === 'Full') return this.balance() > 0 ? '' : 'This invoice has nothing left to pay.';
    const text = this.partialAmountText().trim();
    if (!text) return 'Enter the amount received.';
    const a = parseAmount(text);
    if (!Number.isFinite(a)) return 'Enter the amount as a number with at most 2 decimals, e.g. 25000 or 25000.50.';
    if (a <= 0) return 'The amount must be more than zero.';
    if (a > this.balance()) return `The amount cannot be more than the balance of PKR ${pkr(this.balance())}.`;
    return '';
  });

  setPaymentMode(mode: PaymentMode): void {
    if (mode === 'Partial' && !this.partialAllowed()) return;
    this.paymentMode.set(mode);
    // Partial starts at the whole balance; the user lowers it.
    if (mode === 'Partial' && !this.partialAmountText().trim()) this.partialAmountText.set(this.balance().toFixed(2));
    this.partialAmountTouched.set(false);
  }

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

  /** Why the depositor name blocks Generate (empty when valid). */
  depositorNameError = computed(() => {
    const name = this.depositorName().trim();
    if (!name) return 'Enter the depositor name.';
    if (name.length < 2) return 'Depositor name must be at least 2 characters.';
    if (name.length > this.depositorNameMaxLength) return `Depositor name cannot be longer than ${this.depositorNameMaxLength} characters.`;
    return '';
  });

  /** Why the depositor CNIC blocks Generate (empty when valid). */
  depositorCnicError = computed(() => {
    const cnic = this.depositorCnic().trim();
    if (!cnic) return 'Enter the depositor CNIC.';
    if (!CNIC_FORMAT_PATTERN.test(cnic)) return 'Depositor CNIC must be in the format 12345-1234567-1.';
    return '';
  });

  canSave = computed(() => {
    if (this.saving()) return false;
    if (!this.selectedInvoice()) return false;
    if (this.loadingAccounts() || !this.selectedAccountId()) return false;
    if (!this.paymentType()) return false;
    if (this.depositorNameError() || this.depositorCnicError()) return false;
    if (this.amountError()) return false;
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
    this.paymentMode.set('Full');
    this.partialAmountText.set('');
    this.partialAmountTouched.set(false);
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
    this.depositorName.set('');
    this.depositorCnic.set('');
    this.depositorNameTouched.set(false);
    this.depositorCnicTouched.set(false);
    this.paymentMode.set('Full');
    this.partialAmountText.set('');
    this.partialAmountTouched.set(false);
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
    this.depositorNameTouched.set(true);
    this.depositorCnicTouched.set(true);
    this.partialAmountTouched.set(true);
    if (!this.canSave()) return;
    const inv = this.selectedInvoice();
    if (!inv) return;

    this.saving.set(true);
    this.feeReceiptService.createReceipt({
      invoiceIdGUID: inv.invoiceIdGuid,
      cashInHandAccountId: this.selectedAccountId()!,
      receiptDate: this.receiptDate(),
      paymentType: this.paymentType(),
      remarks: this.remarks().trim() || null,
      depositorName: this.depositorName().trim(),
      depositorCnic: this.depositorCnic().trim(),
      paymentMode: this.paymentMode(),
      amount: this.paymentMode() === 'Partial' ? this.receiptAmount() : null
    }).subscribe({
      next: (receipt) => {
        this.saving.set(false);
        this.toastService.success(receipt.balanceAfter
          ? `Receipt ${receipt.code} generated. PKR ${pkr(receipt.balanceAfter)} is still due on the invoice.`
          : `Receipt ${receipt.code} generated successfully.`);

        // Reset form
        this.clearSelectedInvoice();

        // Immediately show printable receipt
        this.printableReceipt.set(receipt);
        this.showPrintModal.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.toastService.error(this.errMsg(err, 'Failed to create the receipt.'));
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
        this.setLoadError('receipts', `Could not load receipts: ${this.errMsg(err, 'request failed.')}`);
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
  savingPdf = signal(false);

  /**
   * Saves the receipt on screen as an A4 PDF (Receipt-<code>.pdf), the same copy the printer gets: the receipt body is
   * captured (html2canvas) and placed on as many A4 pages as it needs (jsPDF); both libraries load only when asked.
   */
  async saveReceiptPdf(): Promise<void> {
    const p = this.printableReceipt();
    const source = document.querySelector('#admin-receipt-printable .receipt-printable-body') as HTMLElement | null;
    if (!p || !source || this.savingPdf()) return;
    this.savingPdf.set(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const canvas = await html2canvas(source, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const w = pageW - margin * 2;
      // Page-sized slices of the capture, so a long receipt runs on to a second page instead of being squashed.
      const sliceH = Math.floor((canvas.width * (pageH - margin * 2)) / w);
      for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
        const part = document.createElement('canvas');
        part.width = canvas.width;
        part.height = Math.min(sliceH, canvas.height - y);
        const ctx = part.getContext('2d');
        if (!ctx) break;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, part.width, part.height);
        ctx.drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
        if (page) pdf.addPage();
        // JPEG keeps the file small enough to email (a PNG of the same capture is several MB).
        pdf.addImage(part.toDataURL('image/jpeg', 0.9), 'JPEG', margin, margin, w, (part.height * w) / canvas.width);
      }
      pdf.save(`Receipt-${(p.code || String(p.id)).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`);
    } catch {
      this.toastService.error('Could not save the receipt as PDF. Use Print Receipt and choose "Save as PDF" instead.');
    } finally {
      this.savingPdf.set(false);
    }
  }

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

  // ── Monthly receipts (RC_02) ──────────────────────────────────────────────
  /** "Nov 2026" / "November 2026" for the receipt's billing month ('' when the API sends none). */
  billingMonthName(r: FeeReceiptListItemDto, style: 'short' | 'long'): string {
    const m = /^(\d{4})-(\d{2})/.exec(r.billingMonth ?? '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-US', { month: style, year: 'numeric' }) : '';
  }

  /** List "Month" column: "Nov 2026 · 2 of 4"; "—" for a single-month receipt. */
  monthLabel(r: FeeReceiptListItemDto): string {
    if (r.monthCount <= 1) return '—';
    const name = this.billingMonthName(r, 'short');
    return `${name ? name + ' · ' : ''}${r.monthNo} of ${r.monthCount}`;
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
        this.toastService.success(`Receipt ${item.code} and every monthly receipt of the same payment have been voided. Invoice ${item.invoiceNumber} is marked Unpaid.`);
        this.loadReceipts();
      },
      error: (err) => {
        this.voiding.set(false);
        this.toastService.error(this.errMsg(err, 'Failed to void receipt.'));
      }
    });
  }
}
