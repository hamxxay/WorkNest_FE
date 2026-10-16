import {
  Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AdminService } from '../../../../services/admin.service';
import { OccupiedSpace, OccupiedSpaces } from '../../../../models/admin.model';
import { statusTone } from '../../ceo/ceo-shared';

/**
 * Right-side drawer behind the admin dashboard's Occupancy card: the rooms in use right now (GET
 * api/dashboard/occupied-spaces, same rule and locations as the card, so its count is the card's "X of Y").
 * One row per room with the booking that covers it; the booking number opens it on Bookings. Close, Escape,
 * focus kept inside while open and returned to the card on close. Full width on phones; the table scrolls inside.
 */
@Component({
  selector: 'app-occupied-rooms-drawer',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './occupied-rooms-drawer.html',
  styleUrl: './occupied-rooms-drawer.css'
})
export class OccupiedRoomsDrawer {
  private admin = inject(AdminService);
  private host = inject(ElementRef<HTMLElement>);

  /** Shown while true. */
  open = input<boolean>(false);
  /** The dashboard's location filter (one or several); empty = every location the user may see. */
  locationIds = input<number[]>([]);
  /** Bumped by the dashboard's Refresh: reloads the list when open. */
  refreshTick = input<number>(0);
  closed = output<void>();

  readonly statusTone = statusTone;

  status = signal<'loading' | 'ok' | 'error'>('loading');
  data = signal<OccupiedSpaces | null>(null);
  errorText = signal('');

  /** Location, then room, with numbers in order ("Office 99" before "Office 100"). */
  rows = computed<OccupiedSpace[]>(() => {
    const opts: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };
    return [...(this.data()?.items ?? [])].sort((a, b) =>
      (a.location ?? '').localeCompare(b.location ?? '', undefined, opts)
      || (a.room ?? '').localeCompare(b.room ?? '', undefined, opts)
      || (a.spaceCode ?? '').localeCompare(b.spaceCode ?? '', undefined, opts));
  });

  private sub: Subscription | null = null;
  private returnFocus: HTMLElement | null = null;
  private panel = viewChild<ElementRef<HTMLElement>>('panel');
  private heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());

    // Opened: remember where focus was, load, focus the heading. Closed from outside: stop loading.
    effect(() => {
      const isOpen = this.open();
      untracked(() => {
        if (!isOpen) { this.sub?.unsubscribe(); return; }
        const active = document.activeElement as HTMLElement | null;
        this.returnFocus = active && !this.host.nativeElement.contains(active) ? active : null;
        this.data.set(null);
        this.load();
        setTimeout(() => (this.heading()?.nativeElement ?? this.panel()?.nativeElement)?.focus({ preventScroll: true }));
      });
    });

    // Location filter changed or the dashboard refreshed while open: load again (keeps the old list until the new one).
    let first = true;
    effect(() => {
      this.locationIds(); this.refreshTick();
      untracked(() => { if (!first && this.open()) this.load(); first = false; });
    });
  }

  load() {
    this.sub?.unsubscribe();
    this.status.set('loading');
    this.sub = this.admin.getOccupiedSpaces(this.locationIds()).subscribe({
      next: res => { this.data.set(res); this.status.set('ok'); },
      error: (err: any) => {
        this.errorText.set(err?.status === 403
          ? 'Your account cannot see this list.'
          : err?.status === 0
            ? 'The server did not answer. Check your connection and try again.'
            : err?.error?.message || `Something went wrong${err?.status ? ` (error ${err.status})` : ''}. Please try again.`);
        this.status.set('error');
      }
    });
  }

  close() {
    if (!this.open()) return;
    this.sub?.unsubscribe();
    this.closed.emit();
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target && document.contains(target)) setTimeout(() => target.focus({ preventScroll: true }));
  }

  /** "15 Oct 2026" style dates; the API sends business time without a zone, so it is shown as is. */
  toDate(v: string | null | undefined): Date | null {
    if (!v) return null;
    const [d, t = '00:00:00'] = v.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm, ss] = t.split(':').map(Number);
    return y && m && day ? new Date(y, m - 1, day, hh || 0, mm || 0, ss || 0) : null;
  }

  /** "11%" or "11.4%" (as the card). */
  pctText(v: number | null | undefined): string {
    return `${Number(v || 0)}%`;
  }

  // ---------- keyboard: Escape closes, Tab stays inside ----------
  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent) {
    if (!this.open()) return;
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key !== 'Tab') return;
    const panel = this.panel()?.nativeElement;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), select, input'
    )).filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !panel.contains(active))) { e.preventDefault(); first.focus(); }
  }
}
