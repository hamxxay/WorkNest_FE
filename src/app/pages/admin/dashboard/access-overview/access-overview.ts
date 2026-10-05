import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../../../services/admin.service';
import { ToastService } from '../../../../services/toast.service';

type ListFilter = 'all' | 'suspended' | 'extended' | 'ending';

/**
 * Admin dashboard "Door access" card: machines online / offline, operations queued for offline machines,
 * suspended bookings and temporary access ending soon — plus the suspended bookings list with a
 * "Give temporary access" action (same endpoint as Attendants & Access).
 */
@Component({
  selector: 'app-access-overview',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe],
  templateUrl: './access-overview.html',
  styleUrl: './access-overview.css'
})
export class AccessOverview implements OnInit, OnDestroy {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private timer?: ReturnType<typeof setInterval>;

  loading = signal(true);
  failed = signal(false);
  overview = signal<any | null>(null);
  filter = signal<ListFilter>('all');
  lastUpdated = signal<Date | null>(null);

  items = computed<any[]>(() => {
    const all: any[] = this.overview()?.items ?? [];
    switch (this.filter()) {
      case 'suspended': return all.filter(i => !i.extended);
      case 'extended': return all.filter(i => i.extended);
      case 'ending': return all.filter(i => i.endingSoon);
      default: return all;
    }
  });

  // Temporary access modal
  target = signal<any | null>(null);
  extendUntil = '';
  extendReason = '';
  extending = signal(false);

  get todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  ngOnInit() {
    this.load();
    // Machine status changes on its own — refresh every minute while the dashboard is open.
    this.timer = setInterval(() => this.load(true), 60000);
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  load(silent = false) {
    if (!silent) this.loading.set(true);
    this.admin.getAccessOverview().subscribe({
      next: (res) => {
        this.overview.set(res);
        this.failed.set(false);
        this.loading.set(false);
        this.lastUpdated.set(new Date());
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      }
    });
  }

  showList(f: ListFilter) {
    this.filter.set(f);
    document.getElementById('suspended-bookings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  openExtend(item: any) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    this.extendUntil = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    this.extendReason = '';
    this.target.set(item);
  }

  closeExtend() {
    if (!this.extending()) this.target.set(null);
  }

  confirmExtend() {
    const item = this.target();
    if (!item || this.extending()) return;
    if (!this.extendUntil || this.extendUntil < this.todayIso) { this.toast.error('Choose today or a later date.'); return; }
    if (this.extendReason.trim().length < 3) { this.toast.error('Enter a reason for the temporary access.'); return; }

    this.extending.set(true);
    this.admin.extendAccessSuspension(item.bookingDetailId, { overrideUntil: this.extendUntil, reason: this.extendReason.trim() }).subscribe({
      next: (res) => {
        this.extending.set(false);
        this.target.set(null);
        const devices: any[] = res?.devices || [];
        const failed = devices.filter(d => !d.ok && !d.queued).length;
        const queued = devices.filter(d => d.queued).length;
        if (failed) this.toast.error(`Temporary access given until ${this.extendUntil}, but ${failed} machine(s) could not be updated.`);
        else this.toast.success(`Temporary access given until ${this.extendUntil}` + (queued ? ` (${queued} offline machine(s) will update when back online).` : '.'));
        this.load(true);
      },
      error: (err) => {
        this.extending.set(false);
        this.toast.error(err.error?.error || err.error?.message || 'Could not give temporary access.');
      }
    });
  }
}
