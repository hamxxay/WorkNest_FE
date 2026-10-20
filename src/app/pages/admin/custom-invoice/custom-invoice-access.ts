import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  CustomInvoiceAccessItem, CustomInvoiceService, customInvoiceErrorMessage
} from '../../../services/custom-invoice.service';
import { ToastService } from '../../../services/toast.service';

/**
 * Super admins only: which admin users may use the Custom Invoice page (GET / POST api/custom-invoices/access).
 * Each switch saves at once; it moves back and says why when the save fails.
 */
@Component({
  selector: 'app-ci-access-panel',
  imports: [DatePipe],
  templateUrl: './custom-invoice-access.html',
  styleUrls: ['./ci-shared.css', './custom-invoice-access.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CiAccessPanel implements OnInit {
  private readonly api = inject(CustomInvoiceService);
  private readonly toast = inject(ToastService);

  readonly items = signal<CustomInvoiceAccessItem[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly loadError = signal('');
  readonly filter = signal('');
  readonly pending = signal<ReadonlySet<number>>(new Set());
  readonly rowErrors = signal<Record<number, string>>({});

  readonly withAccess = computed(() => this.items().filter(i => i.hasAccess).length);
  readonly shown = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const list = this.items();
    if (!q) return list;
    return list.filter(i => [i.name, i.email, ...i.locationNames].some(t => t.toLowerCase().includes(q)));
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.loadError.set('');
    this.api.getAccessList().subscribe({
      next: list => {
        this.items.set([...list].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)));
        this.rowErrors.set({});
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: err => {
        this.loading.set(false);
        const message = customInvoiceErrorMessage(err, "The admin users couldn't be loaded. Please try again.");
        if (this.items().length > 0) this.toast.error(message, "Couldn't refresh");
        else this.loadError.set(message);
      }
    });
  }

  isPending(userId: number): boolean {
    return this.pending().has(userId);
  }

  switchId(userId: number): string {
    return `ci-access-${userId}`;
  }

  toggle(item: CustomInvoiceAccessItem): void {
    if (this.isPending(item.userId)) return;
    const hasAccess = !item.hasAccess;
    const before = item;
    this.setRowError(item.userId, '');
    this.replace(item.userId, { ...item, hasAccess });
    this.setPending(item.userId, true);
    this.api.setAccess(item.userId, hasAccess).subscribe({
      next: ({ item: saved, message }) => {
        this.setPending(item.userId, false);
        if (saved && saved.userId === item.userId) this.replace(item.userId, saved);
        const who = before.name || before.email;
        this.toast.success(message || (hasAccess ? `${who} can now create custom invoices.` : `${who} can no longer create custom invoices.`), 'Saved');
      },
      error: err => {
        this.setPending(item.userId, false);
        this.replace(item.userId, before);
        const message = customInvoiceErrorMessage(err, "The change wasn't saved. Please try again.");
        this.setRowError(item.userId, message);
        this.toast.error(message, 'Not changed');
      }
    });
  }

  /** The API sends UTC; a value without a zone is read as UTC, not browser time. */
  grantedDate(value: string | null): Date | null {
    if (!value) return null;
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) || value.length <= 10 ? value : value + 'Z';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private replace(userId: number, next: CustomInvoiceAccessItem): void {
    this.items.update(list => list.map(i => (i.userId === userId ? next : i)));
  }

  private setPending(userId: number, on: boolean): void {
    this.pending.update(set => {
      const copy = new Set(set);
      if (on) copy.add(userId); else copy.delete(userId);
      return copy;
    });
  }

  private setRowError(userId: number, message: string): void {
    this.rowErrors.update(errors => {
      const copy = { ...errors };
      if (message) copy[userId] = message; else delete copy[userId];
      return copy;
    });
  }
}
