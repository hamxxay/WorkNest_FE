import { Component, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { ToastService } from '../../../services/toast.service';
import { HikDeviceService } from '../../../services/hik-device.service';
import { HikDevice } from '../../../models/hik-device.model';

type EnrollType = 'fingerprint' | 'card' | 'face';

/** Days after an invoice's due date before access is suspended (matches WN_HIK_AccessSuspension_Run). */
const INVOICE_GRACE_DAYS = 7;

@Component({
  selector: 'app-attendant-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './attendant-management.html',
  styleUrl: './attendant-management.css'
})
export class AttendantManagement implements OnInit, OnDestroy {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private hikDevices = inject(HikDeviceService);

  customers = signal<any[]>([]);
  selectedCustomerId = '';

  activeSpaces = signal<any[]>([]);
  selectedBookingDetailId: number | null = null;
  selectedSpace: any = null;

  capacityInfo = signal<any>(null);
  attendants = signal<any[]>([]);
  readonly loadingAttendants = signal(false);

  // Add Attendant Modal
  showAddModal = false;
  addMode: 'new' | 'existing' = 'new';
  existingCompanyAttendants = signal<any[]>([]);
  selectedExistingPersonId: number | null = null;

  // Form Fields
  newName = '';
  newEmail = '';
  newPhone = '';
  newIdType = 'CNIC';
  newIdNumber = '';

  // Warning Modal
  readonly showWarningModal = signal(false);
  pendingAssignmentPayload: any = null;
  readonly warningModalText = signal('');
  readonly estimatedSurcharge = signal(0);
  seatPrice = 0;

  // Export Modal
  readonly showExportModal = signal(false);
  readonly exportDataJson = signal('');

  // Enroll Credential Modal (fingerprint / card / face on Hikvision terminals)
  devices = signal<HikDevice[]>([]);
  showEnrollModal = false;
  enrollType: EnrollType = 'fingerprint';
  enrollAttendant: any = null;
  enrollFingerNo = 1;
  cardMode: 'tap' | 'manual' = 'tap';
  manualCardNo = '';
  // Signals: the app is zoneless, so state changed in HTTP callbacks must be signals to re-render.
  enrolling = signal(false);
  savingAccess = signal(false);

  // Challan-based access suspension (overdue unpaid challan) for the selected booking
  suspension = signal<any>(null);
  challans = signal<any>(null);
  challansLoading = signal(false);

  /**
   * Earliest unpaid challan / invoice that has not expired yet — access is disabled the day after its
   * due / valid-until date (same rule as the hourly suspension job). Partial payments never suspend.
   */
  upcomingSuspension = computed(() => {
    if (this.suspension()) return null; // already suspended / temporarily extended
    const todayMs = new Date(new Date().toDateString()).getTime();
    // Invoices get INVOICE_GRACE_DAYS after the due date (same as WN_HIK_AccessSuspension_Run);
    // booking challans are disabled the day after they expire.
    const next = (this.challans()?.challans || [])
      .filter((c: any) => c.dueOn && (c.status === 'Unpaid' || (c.status === 'Overdue' && c.type !== 'Booking challan')))
      .map((c: any): { challan: any; payBy: Date; disableOn: Date } => {
        const [y, m, d] = c.dueOn.split('-').map(Number);
        const grace = c.type === 'Booking challan' ? 0 : INVOICE_GRACE_DAYS;
        return { challan: c, payBy: new Date(y, m - 1, d + grace), disableOn: new Date(y, m - 1, d + grace + 1) };
      })
      .filter((x: { disableOn: Date }) => x.disableOn.getTime() > todayMs)
      .sort((a: { disableOn: Date }, b: { disableOn: Date }) => a.disableOn.getTime() - b.disableOn.getTime())[0];
    if (!next) return null;
    return { ...next, daysLeft: Math.round((next.disableOn.getTime() - todayMs) / 86400000) };
  });
  showExtendModal = signal(false);
  extendUntil = '';
  extendReason = '';
  extending = signal(false);
  extendResult = signal<any>(null);
  enrollResult = signal<any>(null);
  selectedSpaceCode = signal('');
  selectedSpaceName = signal('');
  readonly fingerSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  private machineStatusTimer?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.loadCustomers();
    this.loadDevices();
    // Re-check machine online status while a space is selected, so the enrollment buttons
    // enable on their own once the room machine comes back online (and disable if it drops).
    this.machineStatusTimer = setInterval(() => {
      if (this.selectedBookingDetailId && !this.enrolling()) this.loadDevices();
    }, 30000);
  }

  ngOnDestroy() {
    if (this.machineStatusTimer) clearInterval(this.machineStatusTimer);
  }

  loadDevices() {
    this.hikDevices.getDevices().subscribe({
      next: (res) => this.devices.set(res || []),
      error: (err) => console.error('Failed to load Hikvision machines', err)
    });
  }

  loadCustomers() {
    this.admin.getCustomers(1, 1000, '').subscribe({
      next: (res: any) => {
        const raw = res?.data ?? res?.rows ?? res?.items ?? (Array.isArray(res) ? res : []);
        this.customers.set(raw);
      },
      error: (err) => this.toast.error(err?.error?.message ?? err?.message ?? 'Failed to load customers.')
    });
  }

  onCustomerChange() {
    this.selectedBookingDetailId = null;
    this.selectedSpace = null;
    this.capacityInfo.set(null);
    this.attendants.set([]);

    if (!this.selectedCustomerId) {
      this.activeSpaces.set([]);
      return;
    }

    const cid = parseInt(this.selectedCustomerId, 10);
    this.admin.getCustomerActiveSpaces(cid).subscribe({
      next: (res: any) => {
        this.activeSpaces.set(res || []);
      },
      error: (err) => this.toast.error('Failed to load active spaces for customer: ' + (err.error?.message || err.message))
    });

    this.admin.getCustomerAttendants(cid).subscribe({
      next: (res: any) => {
        this.existingCompanyAttendants.set(res || []);
      },
      error: (e: any) => this.toast.error(e?.error?.message ?? e?.message ?? 'Failed to load customer attendants.')
    });
  }

  selectSpace(space: any) {
    this.selectedBookingDetailId = space.bookingDetailId;
    this.selectedSpace = space;
    this.selectedSpaceCode.set((space?.spaceCode || '').toString().trim().toLowerCase());
    this.selectedSpaceName.set((space?.spaceName || '').toString());
    this.loadDevices(); // refresh online/offline status for Step 3
    this.loadAttendantsForSpace();
    this.loadSuspension();
  }

  loadSuspension() {
    const id = this.selectedBookingDetailId;
    this.suspension.set(null);
    this.challans.set(null);
    if (!id) return;
    this.challansLoading.set(true);
    this.admin.getBookingChallans(id).subscribe({
      next: (res) => { if (this.selectedBookingDetailId === id) { this.challans.set(res); this.challansLoading.set(false); } },
      error: () => this.challansLoading.set(false)
    });
    this.admin.getAccessSuspension(id).subscribe({
      next: (res) => { if (this.selectedBookingDetailId === id) this.suspension.set(res?.open ? res : null); },
      error: () => this.suspension.set(null)
    });
  }

  // ---- Manual extension while the challan is unpaid ----

  get todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  openExtendModal() {
    const s = this.suspension();
    this.extendUntil = s?.extended && s?.overrideUntil ? s.overrideUntil : this.todayIso;
    this.extendReason = '';
    this.extendResult.set(null);
    this.extending.set(false);
    this.showExtendModal.set(true);
  }

  closeExtendModal() {
    if (this.extending()) return;
    this.showExtendModal.set(false);
  }

  submitExtend() {
    if (!this.selectedBookingDetailId || this.extending()) return;
    if (!this.extendUntil || this.extendUntil < this.todayIso) { this.toast.error('Choose today or a later date.'); return; }
    if (this.extendReason.trim().length < 3) { this.toast.error('Enter a reason for the extension.'); return; }

    this.extending.set(true);
    this.admin.extendAccessSuspension(this.selectedBookingDetailId, { overrideUntil: this.extendUntil, reason: this.extendReason.trim() }).subscribe({
      next: (res) => {
        this.extending.set(false);
        this.extendResult.set(res);
        const devices: any[] = res?.devices || [];
        const failed = devices.filter(d => !d.ok && !d.queued).length;
        if (failed) this.toast.error(`Temporary access given until ${this.extendUntil}, but ${failed} machine(s) could not be updated.`);
        else this.toast.success(`Temporary access given until ${this.extendUntil}.`);
        this.loadSuspension();
        this.loadAttendantsForSpace();
      },
      error: (err) => {
        this.extending.set(false);
        this.toast.error(err.error?.error || err.error?.message || 'Could not extend access.');
      }
    });
  }

  loadAttendantsForSpace() {
    if (!this.selectedBookingDetailId) return;
    this.loadingAttendants.set(true);

    this.admin.checkAttendantCapacity(this.selectedBookingDetailId).subscribe({
      next: (cap: any) => this.capacityInfo.set(cap),
      error: (e: any) => this.toast.error(e?.error?.message ?? e?.message ?? 'Failed to check attendant capacity.')
    });

    this.admin.getBookingAttendants(this.selectedBookingDetailId).subscribe({
      next: (res: any) => {
        this.attendants.set(res || []);
        this.loadingAttendants.set(false);
      },
      error: (e: any) => {
        this.loadingAttendants.set(false);
        this.toast.error(e?.error?.message ?? e?.message ?? 'Failed to load attendants.');
      }
    });
  }

  openAddModal() {
    this.addMode = 'new';
    this.newName = '';
    this.newEmail = '';
    this.newPhone = '';
    this.newIdType = 'CNIC';
    this.newIdNumber = '';
    this.selectedExistingPersonId = null;
    this.showAddModal = true;
  }

  closeAddModal() {
    this.showAddModal = false;
  }

  submitAddAttendant() {
    if (!this.selectedCustomerId || !this.selectedBookingDetailId) return;

    if (this.addMode === 'new') {
      if (!this.newName || !this.newEmail || !this.newPhone || !this.newIdNumber) {
        this.toast.error('Please fill in all required person identity fields.');
        return;
      }

      const body = {
        customerId: parseInt(this.selectedCustomerId, 10),
        name: this.newName.trim(),
        email: this.newEmail.trim(),
        phone: this.newPhone.trim(),
        idType: this.newIdType,
        idNumber: this.newIdNumber.trim()
      };

      this.admin.addAttendant(body).subscribe({
        next: (res: any) => {
          this.closeAddModal();
          this.processBookingAssignment(res.personId);
        },
        error: (err) => this.toast.error('Failed to create person: ' + (err.error?.message || err.message))
      });
    } else {
      if (!this.selectedExistingPersonId) {
        this.toast.error('Please select an existing company attendant.');
        return;
      }
      this.closeAddModal();
      this.processBookingAssignment(this.selectedExistingPersonId);
    }
  }

  processBookingAssignment(personId: number) {
    const bId = this.selectedBookingDetailId!;
    const cId = parseInt(this.selectedCustomerId, 10);

    this.admin.checkAttendantCapacity(bId).subscribe({
      next: (cap: any) => {
        this.pendingAssignmentPayload = {
          bookingDetailId: bId,
          personId: personId,
          customerId: cId,
          assignedFrom: new Date().toISOString()
        };

        if (cap.wouldExceedCapacity) {
          if (!cap.allowsOverCapacity) {
            this.toast.error(`Over-capacity assignment is strictly not allowed for ${cap.spaceCategory} (${cap.spaceName}). Capacity limit is ${cap.roomCapacity}.`);
            return;
          }

          this.estimatedSurcharge.set(cap.estimatedSurcharge);
          this.seatPrice = cap.seatPrice;
          this.warningModalText.set(`Adding this attendant to ${cap.spaceName} exceeds the seat capacity (${cap.roomCapacity} seats). An over-capacity surcharge of PKR ${cap.estimatedSurcharge} will be applied.`);
          this.showWarningModal.set(true);
        } else {
          this.executeAssignment();
        }
      },
      error: (e: any) => this.toast.error(e?.error?.message ?? e?.message ?? 'Failed to check attendant capacity.')
    });
  }

  confirmOverCapacityAssignment() {
    this.showWarningModal.set(false);
    this.executeAssignment();
  }

  executeAssignment() {
    if (!this.pendingAssignmentPayload) return;
    this.admin.assignAttendantToBooking(this.pendingAssignmentPayload.bookingDetailId, this.pendingAssignmentPayload).subscribe({
      next: () => {
        this.pendingAssignmentPayload = null;
        this.onCustomerChange();
      },
      error: (err) => this.toast.error('Assignment failed: ' + (err.error?.message || err.message))
    });
  }

  toggleIndividualAccess(attendant: any, event: any) {
    const isEnabled = event.target.checked;
    const body = {
      bookingDetailId: this.selectedBookingDetailId,
      customerId: parseInt(this.selectedCustomerId, 10),
      personId: attendant.personId,
      isEnabled: isEnabled
    };
    this.savingAccess.set(true);
    this.admin.toggleAccessStatus(body).subscribe({
      next: (res: any) => {
        this.savingAccess.set(false);
        this.reportMachineSync(res?.machines, attendant.name);
        this.loadAttendantsForSpace();
      },
      error: () => {
        this.savingAccess.set(false);
        this.toast.error('Failed to update access status');
        this.loadAttendantsForSpace();
      }
    });
  }

  toggleBatchAccess(event: any) {
    const isEnabled = event.target.checked;
    const body = {
      bookingDetailId: this.selectedBookingDetailId,
      customerId: parseInt(this.selectedCustomerId, 10),
      personId: null,
      isEnabled: isEnabled
    };
    this.savingAccess.set(true);
    this.admin.toggleAccessStatus(body).subscribe({
      next: (res: any) => {
        this.savingAccess.set(false);
        this.reportMachineSync(res?.machines, 'everyone in this space');
        this.loadAttendantsForSpace();
      },
      error: () => {
        this.savingAccess.set(false);
        this.toast.error('Failed to update batch access status');
        this.loadAttendantsForSpace();
      }
    });
  }

  removeAttendant(personId: number) {
    if (!confirm('Are you sure you want to remove this attendant from this booking assignment?')) return;
    this.admin.removeAttendantFromBooking(this.selectedBookingDetailId!, personId).subscribe({
      next: () => this.loadAttendantsForSpace(),
      error: (err) => this.toast.error('Failed to remove attendant: ' + (err.error?.message || err.message))
    });
  }

  openExportModal() {
    this.admin.getHikvisionExport().subscribe({
      next: (res: any) => {
        this.exportDataJson.set(JSON.stringify(res, null, 2));
        this.showExportModal.set(true);
      },
      error: (err) => this.toast.error('Failed to fetch export: ' + (err.error?.message || err.message))
    });
  }

  // ---- Enroll fingerprint / card / face ----

  get enrollTitle(): string {
    return { fingerprint: 'Enroll Fingerprint', card: 'Tag Card', face: 'Enroll Face' }[this.enrollType];
  }

  get enrollWaitingText(): string {
    if (this.enrollType === 'card' && this.cardMode === 'manual') return `Saving card ${this.manualCardNo.trim()} to the machines…`;
    const machine = this.captureMachine()?.name || 'the room machine';
    return {
      fingerprint: `Place the finger on the sensor of ${machine}…`,
      card: `Tap the card on the reader of ${machine}…`,
      face: `Stand in front of the camera of ${machine}…`
    }[this.enrollType];
  }

  isEntranceDevice(d: HikDevice): boolean {
    return (d.grp || '').toLowerCase().startsWith('entrance');
  }

  isOnline(d: HikDevice): boolean {
    return !!d.online;
  }

  /**
   * Same rule as the API (HikEnrollmentService.RoomMatches): the machine's Code equals the space code,
   * or equals the room number in the space code / name (e.g. Code "354" ↔ "Office 354").
   */
  isRoomDevice(d: HikDevice): boolean {
    if (this.isEntranceDevice(d)) return false;
    const code = (d.code || '').toString().trim().toLowerCase();
    if (!code) return false;
    const spaceCode = this.selectedSpaceCode();
    if (spaceCode && code === spaceCode) return true;
    const num = (code.match(/\d+/)?.[0] || '').replace(/^0+/, '');
    if (!num) return false;
    return [spaceCode, this.selectedSpaceName()].some(src =>
      (src.match(/\d+/g) || []).some(n => n.replace(/^0+/, '') === num));
  }

  // Machines this booking's users get: the booked room's machine(s) + every Entrance machine.
  bookingMachines = computed(() => {
    this.selectedSpaceCode(); this.selectedSpaceName(); // track the selected space
    return this.devices()
      .filter(d => this.isEntranceDevice(d) || this.isRoomDevice(d))
      .sort((a, b) => Number(this.isEntranceDevice(a)) - Number(this.isEntranceDevice(b)));
  });

  offlineBookingMachines = computed(() => this.bookingMachines().filter(d => !d.online));

  roomMachines = computed(() => this.bookingMachines().filter(d => this.isRoomDevice(d)));

  /** The room machine the credential is captured on (an online one if there are several). */
  captureMachine = computed(() => {
    const room = this.roomMachines();
    return room.find(d => this.isOnline(d)) ?? room[0] ?? null;
  });

  entranceMachines = computed(() => this.bookingMachines().filter(d => this.isEntranceDevice(d)));

  /** Why capture can't start (room machine missing / offline), or null when it can. */
  get captureBlockedReason(): string | null {
    const machine = this.captureMachine();
    if (!machine) return `No machine is linked to ${this.selectedSpace?.spaceName || 'this booked room'}. Set the room machine's Code to the room number.`;
    if (!machine.online) return `${machine.name} (the booked room's machine) is offline — enrollment can't be captured until it is back online.`;
    return null;
  }

  openEnrollModal(attendant: any, type: EnrollType) {
    this.enrollAttendant = attendant;
    this.enrollType = type;
    this.enrollFingerNo = 1;
    this.cardMode = 'tap';
    this.manualCardNo = '';
    this.enrollResult.set(null);
    this.enrolling.set(false);
    this.showEnrollModal = true;
  }

  closeEnrollModal() {
    if (this.enrolling()) return;
    this.showEnrollModal = false;
    if (this.enrollResult()?.ok) this.loadAttendantsForSpace();
  }

  startEnroll() {
    if (!this.enrollAttendant || !this.selectedBookingDetailId || this.enrolling()) return;
    const blocked = this.captureBlockedReason;
    if (blocked) {
      this.toast.error(blocked);
      return;
    }

    const manualCard = this.enrollType === 'card' && this.cardMode === 'manual';
    const cardNo = this.manualCardNo.trim();
    if (manualCard && !/^[0-9A-Za-z]{1,32}$/.test(cardNo)) {
      this.toast.error('Enter a valid card number (1–32 letters or digits).');
      return;
    }

    // Machines are chosen by the API: booked room's machine (capture) + every Entrance machine.
    const body: any = { fingerNo: Number(this.enrollFingerNo) || 1 };
    if (manualCard) body.cardNo = cardNo;

    this.enrolling.set(true);
    this.enrollResult.set(null);
    this.admin.enrollAttendantCredential(this.selectedBookingDetailId, this.enrollAttendant.personId, this.enrollType, body).subscribe({
      next: (res: any) => {
        this.enrolling.set(false);
        this.enrollResult.set(res);
        const devices = res?.devices || [];
        const failed = devices.filter((d: any) => !d.ok && !d.queued).length;
        const queued = devices.filter((d: any) => d.queued).length;
        if (failed) this.toast.error(`Enrolled, but ${failed} machine(s) could not be updated.`);
        else if (queued) this.toast.success(`${this.enrollTitle} completed. ${queued} offline machine(s) will be updated when they reconnect.`);
        else this.toast.success(`${this.enrollTitle} completed for ${this.enrollAttendant.name}.`);
      },
      error: (err) => {
        this.enrolling.set(false);
        this.enrollResult.set(err.error && typeof err.error === 'object' ? err.error : null);
        this.toast.error(err.error?.error || err.error?.message || err.message || 'Enrollment failed');
      }
    });
  }

  /** Toast for the machine side of an Access Status change (block / unblock). */
  private reportMachineSync(machines: any, who: string) {
    const action = machines?.enabled ? 'enabled' : 'blocked';
    if (machines?.enabled && machines?.suspended) {
      this.toast.success(`Access saved for ${who}. Door access stays blocked while the challan is overdue — it is restored when the challan is paid or access is extended.`);
      return;
    }
    if (!machines || !machines.people) {
      this.toast.success(`Access ${action} for ${who}. Not enrolled on any machine yet, so there was nothing to change at the door.`);
      return;
    }
    const devices: any[] = machines.devices || [];
    const failed = devices.filter(d => !d.ok && !d.queued);
    const queued = devices.filter(d => d.queued);
    if (failed.length) {
      this.toast.error(`Access ${action} for ${who}, but ${failed.length} machine(s) failed: ${failed.map(d => d.device + (d.error ? ' (' + d.error + ')' : '')).join(', ')}`);
    } else if (queued.length) {
      this.toast.success(`Access ${action} for ${who} on ${devices.length - queued.length} machine(s). ${queued.length} offline machine(s) will update when they reconnect.`);
    } else {
      this.toast.success(`Access ${action} for ${who} on ${devices.length} machine(s).`);
    }
  }

  get allAttendantsEnabled(): boolean {
    const list = this.attendants();
    return list.length > 0 && list.every(a => a.isEnabled);
  }
}