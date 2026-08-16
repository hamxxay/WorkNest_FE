import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { BookingService } from '../../services/booking.service';
import { SpaceService } from '../../services/space.service';
import { AuthService } from '../../services/auth.service';
import { AdminService } from '../../services/admin.service';


@Component({
  selector: 'app-my-meeting-rooms',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './my-meeting-rooms.html',
  styleUrls: ['./my-meeting-rooms.css']
})
export class MyMeetingRooms implements OnInit {
  // Current Month Stats
  currentMonthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  allocatedHours = 6;
  usedHours = signal(0);
  remainingHours = computed(() => Math.max(0, this.allocatedHours - this.usedHours()));

  // Active entitlement row details
  hasEntitlement = signal(false);
  entitlementLoading = signal(true);

  // Forms and Data lists
  bookingForm!: FormGroup;
  meetingRooms = signal<any[]>([]);
  bookingHistory = signal<any[]>([]);
  
  // Loading and State
  loadingHistory = signal(false);
  submitting = signal(false);
  cancelModalOpen = signal(false);
  selectedBookingToCancel = signal<any>(null);
  cancelReason = '';
  errorMessage = signal('');
  successMessage = signal('');

  // Slots & Slots locks
  availableSlots = signal<{ label: string; start: string; end: string; isLocked?: boolean }[]>([]);
  lockedSlots = signal<Set<string>>(new Set());

  readonly todayStr = new Date().toISOString().split('T')[0];

  constructor(
    private fb: FormBuilder,
    private bookingService: BookingService,
    private spaceService: SpaceService,
    private authService: AuthService,
    private adminService: AdminService
  ) {}


  ngOnInit() {
    this.initForm();
    this.checkEntitlementAndLoadData();
    this.loadMeetingRooms();
  }

  private initForm() {
    this.bookingForm = this.fb.group({
      spaceId: ['', Validators.required],
      date: [this.todayStr, Validators.required],
      startSlot: ['', Validators.required],
      durationHours: [1, [Validators.required, Validators.min(1), Validators.max(3)]]
    });

    // Listen to form value changes to regenerate and check slot availability
    this.bookingForm.get('spaceId')?.valueChanges.subscribe(() => this.onBookingDateTimeOrSpaceChange());
    this.bookingForm.get('date')?.valueChanges.subscribe(() => this.onBookingDateTimeOrSpaceChange());
    this.bookingForm.get('durationHours')?.valueChanges.subscribe(() => this.checkRemainingAllowanceAndLimitDuration());
  }

  private checkEntitlementAndLoadData() {
    this.entitlementLoading.set(true);
    const email = this.authService.user()?.email || '';
    if (!email) {
      this.entitlementLoading.set(false);
      return;
    }

    this.bookingService.getMeetingRoomEntitlement(this.todayStr).subscribe({
      next: (res: any) => {
        const ent = res?.data ?? res;
        if (ent && ent.status === 'Active' && ent.id > 0) {
          this.hasEntitlement.set(true);
          const usedMins = ent.usedMinutes ?? 0;
          this.usedHours.set(parseFloat((usedMins / 60).toFixed(2)));
          this.loadBookingHistory();
        } else {
          this.hasEntitlement.set(false);
        }
        this.entitlementLoading.set(false);
      },
      error: () => {
        this.hasEntitlement.set(false);
        this.entitlementLoading.set(false);
      }
    });
  }

  private loadMeetingRooms() {
    this.spaceService.getAll().subscribe({
      next: (res: any) => {
        const items = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        const filtered = items.filter((s: any) => {
          const typeName = (s.spaceTypeName || s.spaceType || '').toLowerCase();
          return typeName.includes('meeting') || typeName.includes('conference');
        });
        this.meetingRooms.set(filtered);
      }
    });
  }

  private loadBookingHistory() {
    this.loadingHistory.set(true);
    this.bookingService.getMyFreeMeetingRooms().subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.bookingHistory.set(items.sort((a: any, b: any) => {
          return new Date(b.startDateTime || b.startOn).getTime() - new Date(a.startDateTime || a.startOn).getTime();
        }));
        this.loadingHistory.set(false);
      },
      error: () => {
        this.loadingHistory.set(false);
      }
    });
  }

  // Hook triggered when date, start hour, or space changes to resolve slot overlaps
  onBookingDateTimeOrSpaceChange() {
    const spaceId = this.bookingForm.get('spaceId')?.value;
    const date = this.bookingForm.get('date')?.value;
    if (!spaceId || !date) {
      this.availableSlots.set([]);
      return;
    }

    this.adminService.getBookingCalendar(spaceId, new Date(date).getFullYear(), new Date(date).getMonth() + 1).subscribe({

      next: (res: any) => {
        const bookedDates = res?.data?.bookedDates ?? [];
        // Generate hourly slots (e.g. 09:00 to 20:00)
        const slots = [];
        for (let h = 9; h < 20; h++) {
          const start = `${String(h).padStart(2, '0')}:00`;
          const end = `${String(h + 1).padStart(2, '0')}:00`;
          
          // Check if slot is already booked in database (overlapping check)
          const isLocked = this.checkIfSlotBooked(date, start, end);
          slots.push({ label: `${start} - ${end}`, start, end, isLocked });
        }
        this.availableSlots.set(slots);
      },
      error: () => {
        // Fallback slots generation
        const slots = [];
        for (let h = 9; h < 20; h++) {
          const start = `${String(h).padStart(2, '0')}:00`;
          const end = `${String(h + 1).padStart(2, '0')}:00`;
          slots.push({ label: `${start} - ${end}`, start, end, isLocked: false });
        }
        this.availableSlots.set(slots);
      }
    });
  }

  private checkIfSlotBooked(dateStr: string, startStr: string, endStr: string): boolean {
    const startM = new Date(`${dateStr}T${startStr}:00`).getTime();
    const endM = new Date(`${dateStr}T${endStr}:00`).getTime();
    
    // We check all bookings loaded from history or check if database locked it
    return this.bookingHistory().some((b: any) => {
      const bStatus = (b.bookingStatusLabel || b.bookingStatus || b.status || '').toLowerCase();
      if (bStatus === 'cancelled' || bStatus === 'rejected') return false;

      const bStart = new Date(b.startDateTime || b.startOn).getTime();
      const bEnd = new Date(b.endDateTime || b.endOn).getTime();
      if (isNaN(bStart) || isNaN(bEnd)) return false;

      return (bStart < endM && bEnd > startM);
    });
  }

  checkRemainingAllowanceAndLimitDuration() {
    const dur = Number(this.bookingForm.get('durationHours')?.value);
    const rem = this.remainingHours();
    if (dur > rem) {
      this.bookingForm.get('durationHours')?.setValue(Math.floor(rem) || 1);
    }
  }

  submitBooking() {
    if (this.bookingForm.invalid) {
      this.errorMessage.set('Please fill out all booking fields.');
      return;
    }

    const { spaceId, date, startSlot, durationHours } = this.bookingForm.value;
    const rem = this.remainingHours();
    if (durationHours > rem) {
      this.errorMessage.set(`Duration exceeds your remaining monthly allowance of ${rem} hours.`);
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const startDateTime = `${date}T${startSlot}:00`;
    const payload = {
      spaceId: Number(spaceId),
      startOn: startDateTime,
      durationHours: Number(durationHours),
      notes: 'Monthly free meeting room hours reservation.'
    };

    const email = this.authService.user()?.email || '';

    this.bookingService.bookFreeMeetingRoom(payload).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.successMessage.set('Meeting room booked successfully!');
        this.bookingForm.patchValue({ startSlot: '' });
        this.checkEntitlementAndLoadData();
        setTimeout(() => this.successMessage.set(''), 5000);
      },
      error: (err: any) => {
        this.submitting.set(false);
        this.errorMessage.set(err?.error?.message || err?.message || 'Failed to book meeting room.');
      }
    });
  }

  openCancelModal(booking: any) {
    this.selectedBookingToCancel.set(booking);
    this.cancelReason = '';
    this.cancelModalOpen.set(true);
  }

  closeCancelModal() {
    this.cancelModalOpen.set(false);
    this.selectedBookingToCancel.set(null);
  }

  confirmCancelBooking() {
    const booking = this.selectedBookingToCancel();
    if (!booking) return;

    this.bookingService.cancelFreeMeetingRoom(booking.id || booking.bookingId, this.cancelReason).subscribe({
      next: () => {
        this.closeCancelModal();
        this.successMessage.set('Booking cancelled successfully. Allowance has been restored.');
        this.checkEntitlementAndLoadData();
        setTimeout(() => this.successMessage.set(''), 5000);
      },
      error: (err: any) => {
        this.errorMessage.set(err?.error?.message || 'Failed to cancel booking.');
        this.closeCancelModal();
      }
    });
  }

  getBookingDuration(b: any): string {
    const start = new Date(b.startDateTime || b.startOn).getTime();
    const end = new Date(b.endDateTime || b.endOn).getTime();
    if (isNaN(start) || isNaN(end)) return '—';
    const hrs = (end - start) / 3600000;
    return `${hrs} ${hrs === 1 ? 'Hour' : 'Hours'}`;
  }

  canCancel(b: any): boolean {
    const status = (b.bookingStatusLabel || b.bookingStatus || b.status || '').toLowerCase();
    if (status === 'cancelled' || status === 'completed' || status === 'rejected') return false;
    const start = new Date(b.startDateTime || b.startOn).getTime();
    return start > Date.now();
  }
}
