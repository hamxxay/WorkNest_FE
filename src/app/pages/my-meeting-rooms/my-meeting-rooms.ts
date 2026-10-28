import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BookingService } from '../../services/booking.service';
import { localDateIso } from '../../utils/dates';

/** GET booking/meeting-room/entitlement (the month of the chosen date). */
interface Entitlement {
  hasEntitlement: boolean;
  date: string;
  status?: string | null;
  monthStart?: string | null;
  monthEnd?: string | null;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  maxBookingHours: number;
  privateSpaceName?: string | null;
  locationId?: number | null;
  locationName?: string | null;
  message?: string | null;
}

interface BusyTime { startOn: string; endOn: string; }

/** GET booking/meeting-room/rooms: a room the customer may book on the date, with the times taken. */
interface MeetingRoom {
  spaceId: number;
  spaceCode?: string | null;
  spaceName: string;
  capacity?: number | null;
  locationId?: number | null;
  locationName?: string | null;
  busy: BusyTime[];
}

/** GET booking/meeting-room/my. */
interface FreeBooking {
  bookingId: number;
  spaceName?: string | null;
  spaceCode?: string | null;
  locationName?: string | null;
  startOn: string;
  endOn: string;
  durationMinutes: number;
  bookingStatusCode?: string | null;
  bookingStatusLabel?: string | null;
  challanNumber?: string | null;
  cancelReason?: string | null;
  canCancel: boolean;
  isPast: boolean;
}

interface Slot { start: string; label: string; available: boolean; reason: string; }

/** Opening hours when the meeting-room space config has none (same default as the booking page). */
const DEFAULT_OPENING = '08:00';
const DEFAULT_CLOSING = '20:00';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * My Meeting Rooms: the free meeting-room hours that come with a confirmed private office booking (monthly
 * allowance). The customer books a room at their private office location in whole hours and can cancel before
 * the start; every rule is checked again by the API (procedures dbo.WN_MeetingRooms_*).
 */
@Component({
  selector: 'app-my-meeting-rooms',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './my-meeting-rooms.html',
  styleUrls: ['./my-meeting-rooms.css']
})
export class MyMeetingRooms implements OnInit {
  private bookingService = inject(BookingService);

  readonly todayStr = localDateIso();
  readonly notesMax = 500;
  readonly cancelReasonMax = 400;

  // ---- choices ----
  date = signal(this.todayStr);
  spaceId = signal<number | null>(null);
  durationHours = signal(1);
  startSlot = signal<string | null>(null);
  notes = signal('');

  // ---- data ----
  entitlement = signal<Entitlement | null>(null);
  rooms = signal<MeetingRoom[]>([]);
  bookings = signal<FreeBooking[]>([]);
  private spaceConfig = signal<any[]>([]);

  // ---- state ----
  entitlementLoading = signal(true);
  entitlementLoaded = signal(false);
  loadError = signal('');
  roomsLoading = signal(false);
  roomsError = signal('');
  bookingsLoading = signal(true);
  bookingsError = signal('');
  submitting = signal(false);
  formError = signal('');
  successMessage = signal('');

  cancelTarget = signal<FreeBooking | null>(null);
  cancelReason = signal('');
  cancelling = signal(false);
  cancelError = signal('');

  /** Ignores answers to an earlier date when the customer picks another one quickly. */
  private requestSeq = 0;
  private successTimer: ReturnType<typeof setTimeout> | null = null;

  hasEntitlement = computed(() => !!this.entitlement()?.hasEntitlement);

  monthLabel = computed(() => {
    const iso = this.entitlement()?.monthStart || this.date();
    const [y, m] = iso.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  });

  usedPercent = computed(() => {
    const e = this.entitlement();
    if (!e || e.allocatedMinutes <= 0) return 0;
    return Math.min(100, Math.round((e.usedMinutes / e.allocatedMinutes) * 100));
  });

  selectedRoom = computed(() => this.rooms().find(r => r.spaceId === this.spaceId()) ?? null);

  /** 1 .. the longest free booking the API allows. */
  durationOptions = computed(() => {
    const max = this.entitlement()?.maxBookingHours ?? 0;
    return Array.from({ length: Math.max(0, max) }, (_, i) => i + 1);
  });

  /** Opening hours of meeting rooms (space config "Meeting", the room's location first). */
  private openingHours = computed(() => {
    const locationId = this.selectedRoom()?.locationId ?? this.entitlement()?.locationId ?? null;
    const meeting = this.spaceConfig().filter(c => String(c?.spaceCategory ?? '').toLowerCase() === 'meeting');
    const cfg = meeting.find(c => locationId != null && Number(c?.locationId) === locationId && Number(c?.status ?? 1) === 1)
      ?? meeting.find(c => Number(c?.status ?? 1) === 1)
      ?? meeting[0];
    const hour = (t: unknown, fallback: string) => {
      const h = Number(String(t || fallback).split(':')[0]);
      return Number.isFinite(h) ? h : Number(fallback.split(':')[0]);
    };
    return { open: hour(cfg?.openingTime, DEFAULT_OPENING), close: hour(cfg?.closingTime, DEFAULT_CLOSING) };
  });

  /** Whole-hour start times for the chosen room, date and duration. */
  slots = computed<Slot[]>(() => {
    const room = this.selectedRoom();
    const date = this.date();
    if (!room || !date) return [];
    const { open, close } = this.openingHours();
    const duration = this.durationHours();
    const now = Date.now();
    const busy = room.busy
      .map(b => ({ start: new Date(b.startOn).getTime(), end: new Date(b.endOn).getTime() }))
      .filter(b => !isNaN(b.start) && !isNaN(b.end));

    const slots: Slot[] = [];
    for (let h = open; h < close; h++) {
      const start = new Date(`${date}T${pad(h)}:00:00`).getTime();
      const end = start + duration * 3600000;
      const label = `${pad(h)}:00 - ${pad(h + duration)}:00`;
      let reason = '';
      if (h + duration > close) reason = 'After closing';
      else if (start <= now) reason = 'Passed';
      else if (busy.some(b => b.start < end && b.end > start)) reason = 'Taken';
      slots.push({ start: `${pad(h)}:00`, label, available: !reason, reason });
    }
    return slots;
  });

  canSubmit = computed(() => {
    const e = this.entitlement();
    return !!e?.hasEntitlement && !this.submitting() && !this.entitlementLoading()
      && !!this.spaceId() && !!this.startSlot()
      && this.durationHours() * 60 <= (e.remainingMinutes ?? 0)
      && !!this.slots().find(s => s.start === this.startSlot() && s.available);
  });

  ngOnInit() {
    this.bookingService.getSpaceConfig().subscribe({
      next: (res: any) => this.spaceConfig.set(Array.isArray(res?.data) ? res.data : []),
      error: () => this.spaceConfig.set([]) // default opening hours are used
    });
    this.loadForDate();
    this.loadBookings();
  }

  // ---- loading ----

  /** Allowance and rooms for the chosen date (the allowance is per calendar month and private office). */
  loadForDate() {
    const seq = ++this.requestSeq;
    const date = this.date();
    this.entitlementLoading.set(true);
    this.loadError.set('');
    this.bookingService.getMeetingRoomEntitlement(date).subscribe({
      next: (res: any) => {
        if (seq !== this.requestSeq) return;
        const e: Entitlement | null = res?.data ?? null;
        this.entitlement.set(e);
        this.entitlementLoading.set(false);
        this.entitlementLoaded.set(true);
        this.clampDuration();
        if (e?.hasEntitlement) this.loadRooms(seq, date);
        else { this.rooms.set([]); this.spaceId.set(null); this.startSlot.set(null); }
      },
      error: (err: any) => {
        if (seq !== this.requestSeq) return;
        this.entitlement.set(null);
        this.rooms.set([]);
        this.entitlementLoading.set(false);
        this.entitlementLoaded.set(true);
        this.loadError.set(err?.error?.message || err?.message || 'Your meeting-room hours could not be loaded.');
      }
    });
  }

  private loadRooms(seq: number, date: string) {
    this.roomsLoading.set(true);
    this.roomsError.set('');
    this.bookingService.getFreeMeetingRooms(date).subscribe({
      next: (res: any) => {
        if (seq !== this.requestSeq) return;
        const rooms: MeetingRoom[] = (res?.data?.rooms ?? []).map((r: any) => ({ ...r, busy: Array.isArray(r?.busy) ? r.busy : [] }));
        this.rooms.set(rooms);
        // keep the chosen room when it is still offered; one room only = choose it
        if (!rooms.some(r => r.spaceId === this.spaceId())) this.spaceId.set(rooms.length === 1 ? rooms[0].spaceId : null);
        if (!this.slots().some(s => s.start === this.startSlot() && s.available)) this.startSlot.set(null);
        this.roomsLoading.set(false);
      },
      error: (err: any) => {
        if (seq !== this.requestSeq) return;
        this.rooms.set([]);
        this.roomsLoading.set(false);
        this.roomsError.set(err?.error?.message || err?.message || 'The meeting rooms could not be loaded.');
      }
    });
  }

  loadBookings() {
    this.bookingsLoading.set(true);
    this.bookingsError.set('');
    this.bookingService.getMyFreeMeetingRooms().subscribe({
      next: (res: any) => {
        this.bookings.set(Array.isArray(res?.data) ? res.data : []);
        this.bookingsLoading.set(false);
      },
      error: (err: any) => {
        this.bookings.set([]);
        this.bookingsLoading.set(false);
        this.bookingsError.set(err?.error?.message || err?.message || 'Your meeting-room bookings could not be loaded.');
      }
    });
  }

  // ---- choices ----

  onDateChange(value: string) {
    if (!value || value === this.date()) return;
    this.date.set(value < this.todayStr ? this.todayStr : value);
    this.startSlot.set(null);
    this.formError.set('');
    this.loadForDate();
  }

  onRoomChange(value: string) {
    const id = Number(value);
    this.spaceId.set(id > 0 ? id : null);
    this.startSlot.set(null);
    this.formError.set('');
  }

  onDurationChange(value: string) {
    const hours = Number(value);
    if (hours > 0) this.durationHours.set(hours);
    if (!this.slots().some(s => s.start === this.startSlot() && s.available)) this.startSlot.set(null);
    this.formError.set('');
  }

  pickSlot(slot: Slot) {
    if (!slot.available) return;
    this.startSlot.set(slot.start);
    this.formError.set('');
  }

  durationAllowed(hours: number): boolean {
    return hours * 60 <= (this.entitlement()?.remainingMinutes ?? 0);
  }

  /** Keeps the duration within the longest booking and the hours left. */
  private clampDuration() {
    const allowed = this.durationOptions().filter(h => this.durationAllowed(h));
    if (!allowed.includes(this.durationHours())) this.durationHours.set(allowed.length ? allowed[allowed.length - 1] : 1);
  }

  // ---- book ----

  submitBooking() {
    const spaceId = this.spaceId();
    const slot = this.startSlot();
    if (!spaceId || !slot) {
      this.formError.set('Choose a room and a start time.');
      return;
    }
    if (!this.canSubmit()) {
      this.formError.set('This time is not available. Please choose another start time or a shorter booking.');
      return;
    }
    this.submitting.set(true);
    this.formError.set('');
    const notes = this.notes().trim();
    this.bookingService.bookFreeMeetingRoom({
      spaceId,
      startOn: `${this.date()}T${slot}:00`, // Pakistan wall-clock time, no offset (as every booking)
      durationHours: this.durationHours(),
      notes: notes || undefined
    }).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.startSlot.set(null);
        this.notes.set('');
        this.showSuccess(res?.message || 'Meeting room booked with your free hours.');
        this.loadForDate();
        this.loadBookings();
      },
      error: (err: any) => {
        this.submitting.set(false);
        this.formError.set(err?.error?.message || err?.message || 'The meeting room could not be booked.');
        this.loadForDate(); // the room may have been taken meanwhile
      }
    });
  }

  // ---- cancel ----

  openCancel(b: FreeBooking) {
    this.cancelTarget.set(b);
    this.cancelReason.set('');
    this.cancelError.set('');
  }

  closeCancel() {
    if (this.cancelling()) return;
    this.cancelTarget.set(null);
  }

  confirmCancel() {
    const b = this.cancelTarget();
    if (!b || this.cancelling()) return;
    this.cancelling.set(true);
    this.cancelError.set('');
    this.bookingService.cancelFreeMeetingRoom(b.bookingId, this.cancelReason().trim()).subscribe({
      next: (res: any) => {
        this.cancelling.set(false);
        this.cancelTarget.set(null);
        this.showSuccess(res?.message || 'Booking cancelled. The hours are back in your monthly allowance.');
        this.loadForDate();
        this.loadBookings();
      },
      error: (err: any) => {
        this.cancelling.set(false);
        this.cancelError.set(err?.error?.message || err?.message || 'The booking could not be cancelled.');
      }
    });
  }

  // ---- display ----

  /** Minutes as hours: 360 -> "6", 90 -> "1.5". */
  hoursText(minutes: number | null | undefined): string {
    const h = (minutes ?? 0) / 60;
    return Number.isInteger(h) ? String(h) : h.toFixed(1);
  }

  hoursUnit(minutes: number | null | undefined): string {
    return (minutes ?? 0) === 60 ? 'hour' : 'hours';
  }

  dayOf(iso: string): string { return (iso || '').slice(0, 10); }

  timeOf(iso: string): string { return (iso || '').slice(11, 16); }

  statusClass(b: FreeBooking): string {
    return 'status-' + String(b.bookingStatusCode || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  roomLabel(r: MeetingRoom): string {
    const seats = r.capacity ? ` (${r.capacity} ${r.capacity === 1 ? 'seat' : 'seats'})` : '';
    return `${r.spaceName}${seats}`;
  }

  private showSuccess(message: string) {
    this.successMessage.set(message);
    if (this.successTimer) clearTimeout(this.successTimer);
    this.successTimer = setTimeout(() => this.successMessage.set(''), 6000);
  }
}
