import { Component, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';

@Component({
  selector: 'app-challan-validity',
  imports: [FormsModule],
  templateUrl: './challan-validity.html',
  styleUrl: './challan-validity.css'
})
export class ChallanValidity {
  searchQuery = '';
  searching = signal(false);
  searchError = '';

  // Only allow alphanumeric, hyphens, spaces — covers booking IDs and challan numbers like WN-20250729-000001
  private readonly SAFE_PATTERN = /^[a-zA-Z0-9\-\s]{1,50}$/;

  onSearchInput(val: string) {
    // Strip anything not alphanumeric, hyphen, or space; collapse multiple spaces
    this.searchQuery = val.replace(/[^a-zA-Z0-9\-\s]/g, '').replace(/\s{2,}/g, ' ').slice(0, 50);
  }

  get searchValid(): boolean {
    return this.SAFE_PATTERN.test(this.searchQuery.trim());
  }

  result = signal<any>(null);

  newExpiryDate = '';
  remarks = '';
  saving = signal(false);
  saveError = '';
  saveSuccess = '';

  private admin = inject(AdminService);

  private readonly BOOKING_STATUS: Record<number, { label: string; cls: string }> = {
    1: { label: 'Pending',   cls: 'pending' },
    2: { label: 'Confirmed', cls: 'confirmed' },
    3: { label: 'Cancelled', cls: 'cancelled' },
    4: { label: 'Completed', cls: 'confirmed' },
  };

  bookingStatusLabel(val: any): string {
    return this.BOOKING_STATUS[val]?.label ?? (val?.toString() || '—');
  }
  bookingStatusClass(val: any): string {
    return 'cv-status-' + (this.BOOKING_STATUS[val]?.cls ?? 'unknown');
  }

  private toIso(val: string): string {
    if (!val) return '';
    // DD/MM/YYYY
    const dmy = val.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    // ISO or native-parseable (e.g. "2025-07-29T00:00:00")
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    // Truncated style-107 "29 Jul 202" — pad 3-digit year with current century
    const fixed = val.replace(/(\b\d{3}\b)$/, (y) => y + String(new Date().getFullYear()).slice(3));
    const d2 = new Date(fixed);
    if (!isNaN(d2.getTime())) return d2.toISOString().split('T')[0];
    return val;
  }

  expiryDisplay(): string {
    const r = this.result();
    if (!r?.currentExpiryDate) return '—';
    const d = new Date(this.toIso(r.currentExpiryDate));
    return isNaN(d.getTime()) ? r.currentExpiryDate : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  get minNewExpiry(): string {
    const r = this.result();
    if (!r?.currentExpiryDate) return new Date().toISOString().split('T')[0];
    const d = new Date(this.toIso(r.currentExpiryDate));
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  search() {
    if (!this.searchQuery.trim()) return;
    if (!this.searchValid) {
      this.searchError = 'Invalid search input. Use booking number or challan number only.';
      return;
    }
    this.searching.set(true);
    this.searchError = '';
    this.result.set(null);
    this.newExpiryDate = '';
    this.remarks = '';
    this.saveError = '';
    this.saveSuccess = '';

    this.admin.searchChallan(this.searchQuery.trim()).subscribe({
      next: (res: any) => {
        this.searching.set(false);
        const data = res?.data ?? res;
        if (!data || (!data.bookingId && !data.challanNumber)) {
          this.searchError = 'No challan found for the given search term.';
        } else {
          this.result.set(data);
        }
      },
      error: (e: any) => {
        this.searching.set(false);
        this.searchError = e?.error?.message ?? 'Search failed. Please try again.';
      }
    });
  }

  extend() {
    const r = this.result();
    if (!r || !this.newExpiryDate) {
      this.saveError = !r ? 'No booking loaded.' : 'Please select a new expiry date.';
      return;
    }

    const currentIso = this.toIso(r.currentExpiryDate ?? '');
    if (currentIso && this.newExpiryDate <= currentIso) {
      this.saveError = 'New expiry date must be after the current expiry date.';
      return;
    }

    this.saving.set(true);
    this.saveError = '';
    this.saveSuccess = '';

    this.admin.extendChallanValidity({
      bookingId: r.bookingId,
      newExpiryDate: this.newExpiryDate,
      remarks: this.remarks || undefined,
    }).subscribe({
      next: (res: any) => {
        this.saving.set(false);
        this.saveSuccess = res?.message ?? 'Challan validity extended successfully.';
        this.result.update(prev => ({ ...prev, currentExpiryDate: this.newExpiryDate }));
        this.newExpiryDate = '';
        this.remarks = '';
        setTimeout(() => this.saveSuccess = '', 5000);
      },
      error: (e: any) => {
        this.saving.set(false);
        this.saveError = e?.error?.message ?? 'Failed to extend validity. Please try again.';
      }
    });
  }
}
