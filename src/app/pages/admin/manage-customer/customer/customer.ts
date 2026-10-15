import { Component, signal, OnInit, computed, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../../services/admin.service';
import { ToastService } from '../../../../services/toast.service';
import { CNIC_MAX_LENGTH, cnicError, onCnicInput } from '../../../../utils/cnic';
import { isValidPhone, phoneError } from '../../../../utils/phone';

@Component({
  selector: 'app-customer',
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './customer.html',
  styleUrl: './customer.css'
})
export class Customer implements OnInit {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  // ---- list state ----
  readonly loading = signal(true);
  readonly items = signal<any[]>([]);
  readonly totalCount = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 25, 50];
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize())));
  readonly canPrev = computed(() => this.page() > 1);
  readonly canNext = computed(() => this.page() < this.totalPages());
  readonly success = signal('');
  // - Global Discard Confirmation Modal -
    readonly showDiscardConfirm = signal(false);
    pendingDiscardAction: (() => void) | null = null;
    discardConfirmTitle = 'Discard Unsaved Changes?';
    discardConfirmMessage = 'You have unsaved changes in this form. Closing now will discard all entered details.';


  searchQuery = '';
  private searchTimer: any;

  // ---- modal state ----
  readonly showModal = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  editItem: any = null;
  formData: any = {};

  readonly cityOptions = signal<{ v: any; l: string }[]>([]);
  readonly citiesLoading = signal(false);
  readonly citiesError = signal('');

  readonly cnicMaxLength = CNIC_MAX_LENGTH;
  readonly cnicError = cnicError;

  countryCodeOptions: { v: string; l: string }[] = [
    { v: '+92', l: 'PK (+92)' }, { v: '+1', l: 'US/CA (+1)' }, { v: '+44', l: 'UK (+44)' },
    { v: '+971', l: 'UAE (+971)' }, { v: '+966', l: 'KSA (+966)' }, { v: '+91', l: 'IN (+91)' },
    { v: '+61', l: 'AU (+61)' }, { v: '+49', l: 'DE (+49)' }, { v: '+33', l: 'FR (+33)' },
    { v: '+81', l: 'JP (+81)' }, { v: '+86', l: 'CN (+86)' }, { v: '+974', l: 'QA (+974)' },
    { v: '+968', l: 'OM (+968)' }, { v: '+965', l: 'KW (+965)' }, { v: '+90', l: 'TR (+90)' },
    { v: '+60', l: 'MY (+60)' }, { v: '+65', l: 'SG (+65)' },
  ];
  selectedCountryCode = '+92';

  ngOnInit() {
    this.loadCityOptions();
    this.load();
  }

  // ---------------- helpers ----------------
  private showError(msg: string) { if (msg) this.toast.error(msg, 'Error'); }
  private showSuccess(msg: string) { if (msg) this.toast.success(msg, 'Success'); }

  private fail(msg: string): void {
    this.error.set(msg);
    this.showError(msg);
    this.saving.set(false);
  }

  // ---------------- list ----------------
  private load() {
    this.loading.set(true);
    this.admin.getCustomers(this.page(), this.pageSize(), this.searchQuery).subscribe({
      next: (res: any) => {
        const data = Array.isArray(res) ? res
          : Array.isArray(res?.data) ? res.data
          : Array.isArray(res?.data?.items) ? res.data.items
          : Array.isArray(res?.items) ? res.items
          : [];
        this.items.set(data);
        this.totalCount.set(res?.total ?? res?.totalCount ?? res?.data?.total ?? res?.data?.totalCount ?? data.length);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  get filtered() {
    const list = this.items();
    if (list.length > this.pageSize()) {
      const start = (this.page() - 1) * this.pageSize();
      return list.slice(start, start + this.pageSize());
    }
    return list;
  }

  onSearch() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.load(); }, 150);
  }
  onSearchImmediate() { clearTimeout(this.searchTimer); this.page.set(1); this.load(); }
  clearSearch() { this.searchQuery = ''; this.onSearchImmediate(); }

  onPageSizeChange(size: number) { this.pageSize.set(+size); this.page.set(1); this.load(); }
  prevPage() { if (this.canPrev()) { this.page.update(p => p - 1); this.load(); } }
  nextPage() { if (this.canNext()) { this.page.update(p => p + 1); this.load(); } }

  getType(item: any): string {
    return item.customerType ||
      (item.company && item.company.trim() && item.company.toLowerCase() !== 'individual' ? 'Company' : 'Individual');
  }
  getCompany(item: any): string {
    return (item.company && item.company.trim() && item.company.toLowerCase() !== 'individual') ? item.company : '-';
  }

  // ---------------- cities ----------------
  private loadCityOptions() {
    if (this.cityOptions().length) return;
    this.citiesLoading.set(true);
    this.citiesError.set('');
    this.admin.getCities().subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.cityOptions.set(items.map((c: any) => ({ v: c.id, l: c.name })));
        this.citiesLoading.set(false);
      },
      error: () => {
        this.citiesError.set('Failed to load cities.');
        this.citiesLoading.set(false);
      }
    });
  }

  // ---------------- input handlers ----------------
  onCnicFieldInput(event: Event) {
    this.formData.cnicOrPassport = onCnicInput(event);
  }

  onPhoneInput(event: any) {
    const input = event.target as HTMLInputElement;
    const clean = input.value.replace(/\D/g, '').slice(0, 11);
    this.formData.phoneNumber = clean;
    input.value = clean;
  }

  setCustomerType(type: 'Individual' | 'Company') {
    this.formData.customerType = type;
    if (type === 'Individual') this.formData.company = '';
  }

  // ---------------- create / edit ----------------
  openCreate() {
    this.editItem = null;
    this.formData = { customerType: 'Individual', company: '', countryCode: '+92' };
    this.selectedCountryCode = '+92';
    this.error.set('');
    this.showModal.set(true);
  }

  openEdit(item: any) {
    this.editItem = { ...item, idGuid: item.idGuid ?? item.idGUID ?? item.id };
    this.formData = { ...item };

    this.formData.customerType =
      (item.customerType === 'Company' || (item.company && item.company.trim() && item.company.toLowerCase() !== 'individual'))
        ? 'Company' : 'Individual';

    if (!this.formData.addressLine1 && this.formData.address) {
      const parts = this.formData.address.split(',');
      this.formData.addressLine1 = parts[0]?.trim() || '';
      this.formData.addressLine2 = parts.slice(1).join(',').trim() || '';
    }

    // Split stored phone into country code + local number
    const rawPhone = (this.formData.phoneNumber || this.formData.phone || '').trim();
    if (rawPhone.startsWith('+')) {
      const match = this.countryCodeOptions.find(c => rawPhone.startsWith(c.v));
      if (match) {
        this.selectedCountryCode = match.v;
        const national = rawPhone.slice(match.v.length).replace(/\D/g, '');
        this.formData.phoneNumber = national.length === 10 ? '0' + national : national.slice(0, 11);
      } else {
        this.selectedCountryCode = '+92';
        const digits = rawPhone.replace(/\D/g, '');
        this.formData.phoneNumber = digits.length === 10 ? '0' + digits : digits.slice(0, 11);
      }
    } else {
      this.selectedCountryCode = '+92';
      const digits = rawPhone.replace(/\D/g, '');
      if (digits.length === 10 && !digits.startsWith('0')) this.formData.phoneNumber = '0' + digits;
      else if (digits.length === 12 && digits.startsWith('92')) this.formData.phoneNumber = '0' + digits.slice(2);
      else this.formData.phoneNumber = digits.slice(0, 11);
    }

    this.error.set('');
    this.showModal.set(true);
  }

  closeModal() {
     this.requestDiscardableClose(this.isEntityFormDirty(), () => {
    this.showModal.set(false);
    this.formData = {};
    this.editItem = null;
    this.error.set('');
  });
}
  requestDiscardableClose(isDirty: boolean, closeAction: () => void, title?: string, message?: string) {
    if (isDirty) {
      this.discardConfirmTitle = title || 'Discard Unsaved Changes?';
      this.discardConfirmMessage = message || 'You have unsaved changes in this form. Closing now will discard all entered details.';
      this.pendingDiscardAction = closeAction;
      this.showDiscardConfirm.set(true);
    } else {
      closeAction();
    }
  }
  isEntityFormDirty(): boolean {
    if (!this.formData) return false;
    if (this.editItem) {
      return Object.keys(this.formData).some(k => {
        const val = this.formData[k];
        const orig = (this.editItem as any)[k];
        if (val === orig) return false;
        if ((val === '' || val === null || val === undefined) && (orig === '' || orig === null || orig === undefined)) return false;
        return String(val) !== String(orig);
      });
    }
    return Object.values(this.formData).some(v => v !== undefined && v !== null && String(v).trim() !== '' && v !== false);
  }

  save() {
    this.saving.set(true);
    this.error.set('');

    const cnicMsg = cnicError(this.formData.cnicOrPassport);
    if (cnicMsg) return this.fail(cnicMsg);

    const custType = this.formData.customerType === 'Company' ? 'Company' : 'Individual';
    const compName = custType === 'Company' ? (this.formData.company || '').trim() : null;
    const fn = (this.formData.firstName || '').trim();
    const em = (this.formData.email || '').trim();
    const addr1 = (this.formData.addressLine1 || '').trim();
    let phoneDigits = (this.formData.phoneNumber || '').replace(/\D/g, '');
    if (phoneDigits.startsWith('0')) phoneDigits = phoneDigits.substring(1);
    const ntnVal = (this.formData.ntn || '').trim();

    if (custType === 'Company') {
      if (!compName) return this.fail('Company / Business Name is required when Customer Type is Company.');
      if (!ntnVal) return this.fail('NTN (National Tax Number) is required when Customer Type is Company.');
      const cleanNtn = ntnVal.replace(/-/g, '');
      if (cleanNtn.length !== 8 || !/^\d+$/.test(cleanNtn)) {
        return this.fail('Please enter a valid 8-digit NTN (e.g. 1234567-8).');
      }
    }
    if (!fn) return this.fail('First Name is required.');
    if (!em) return this.fail('Email address is required.');
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(em)) {
      return this.fail('Please enter a valid email address (e.g. user@example.com).');
    }
    if (!this.editItem) {
      const isDuplicate = this.items().some(c => (c.email || c.customerEmail || '').toLowerCase() === em.toLowerCase());
      if (isDuplicate) return this.fail(`A customer with email address '${em}' already exists.`);
    }
    if (!phoneDigits || phoneDigits.length !== 10) {
      return this.fail('Phone number must contain 10 digits (e.g. 3001234567).');
    }
    if (!addr1) return this.fail('Address Line 1 is required.');

    const countryCode = this.selectedCountryCode || '+92';
    const fullPhone = `${countryCode}${phoneDigits}`;
    if (!isValidPhone(fullPhone)) return this.fail(phoneError(fullPhone)!);

    const addr2 = (this.formData.addressLine2 || '').trim();
    const payload = {
      ...this.formData,
      customerType: custType,
      company: compName,
      firstName: fn,
      lastName: (this.formData.lastName || '').trim(),
      email: em,
      countryCode,
      phoneNumber: fullPhone,
      phone: fullPhone,
      addressLine1: addr1,
      addressLine2: addr2,
      address: addr1 + (addr2 ? ', ' + addr2 : ''),
      cityId: this.formData.cityId ? Number(this.formData.cityId) : null,
      ntn: ntnVal || null,
      secpRegistrationNo: (this.formData.secpRegistrationNo || '').trim() || null,
      isActive: this.editItem ? (this.formData.isActive ?? true) : true
    };

    const obs = this.editItem
      ? this.admin.updateCustomer(this.editItem.idGuid ?? this.editItem.idGUID ?? this.editItem.id, payload)
      : this.admin.createCustomer(payload);

    obs.subscribe({
      next: (res: any) => {
        if (res && (res.isSuccessful === false || res.isSuccess === false || res.success === false || res.hasError)) {
          return this.fail(res.message || res.errorMessage || res.ErrorMessage || res.error || 'An error occurred while saving.');
        }
        const wasEdit = !!this.editItem;
        this.saving.set(false);
        this.showModal.set(false);
        this.success.set(wasEdit ? 'Updated successfully.' : 'Created successfully.');
        setTimeout(() => this.success.set(''), 3000);
        this.load();
      },
      error: (e: any) => this.fail(e?.error?.message ?? e?.error?.ErrorMessage ?? e?.message ?? 'An error occurred.')
    });
  }

  // ---------------- delete ----------------
  deleteItem(item: any) {
    if (!confirm('Delete this item?')) return;
    const id = item.idGuid ?? item.idGUID ?? item.id;
    this.admin.deleteCustomer(id).subscribe({
      next: () => { this.showSuccess('Customer deleted.'); this.load(); },
      error: (e: any) => this.showError(e?.error?.message ?? e?.error?.ErrorMessage ?? e?.message ?? 'Failed to delete item.')
    });
  }


cancelDiscard() {
    this.showDiscardConfirm.set(false);
    this.pendingDiscardAction = null;
  }
  confirmDiscard() {
    this.showDiscardConfirm.set(false);
    if (this.pendingDiscardAction) {
      const action = this.pendingDiscardAction;
      this.pendingDiscardAction = null;
      action();
    }
  }


}