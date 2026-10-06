import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HikDeviceService } from '../../../services/hik-device.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import { HikDevice, HikDeviceResult, HikStaff, HikStaffMachine, HikTag } from '../../../models/hik-device.model';
import { initials } from '../access/access-shared';

type EnrollType = 'fingerprint' | 'card' | 'face';

/**
 * Staff Access — janitors, office boys, etc. on the Hikvision machines (no booking).
 * Every Entrance machine is always included; room machines are chosen per staff member.
 */
@Component({
  selector: 'app-staff-access',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './staff-access.html',
  styleUrls: ['../access/access-shared.css', './staff-access.css']
})
export class StaffAccess implements OnInit {
  private hik = inject(HikDeviceService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  readonly initials = initials;
  readonly fingerSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly isAdmin = this.auth.hasRole('admin') || this.auth.hasRole('super_admin');

  staff = signal<HikStaff[]>([]);
  tags = signal<HikTag[]>([]);
  devices = signal<HikDevice[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  search = signal('');
  tagFilter = signal<number | null>(null);

  entranceMachines = computed(() => this.devices().filter(d => this.isEntrance(d.grp)));
  roomMachines = computed(() => this.devices().filter(d => !this.isEntrance(d.grp)));

  filteredStaff = computed(() => {
    const q = this.search().trim().toLowerCase();
    const tag = this.tagFilter();
    return this.staff().filter(s => {
      if (tag && s.tagId !== tag) return false;
      if (!q) return true;
      return [s.name, s.employeeNo, s.cnic, s.tag].some(v => (v || '').toLowerCase().includes(q));
    });
  });

  // ---- Add / Machines modal (shared form) ----
  formMode = signal<'add' | 'machines' | null>(null);
  formStaff = signal<HikStaff | null>(null);
  formName = '';
  formCnic = '';
  formTagId: number | null = null;
  formRoomIds = new Set<number>();
  formValidUntil = '';
  newTagName = '';
  saving = signal(false);
  formResult = signal<{ ok: boolean; error?: string | null; machineId?: string | null; devices: HikDeviceResult[] } | null>(null);

  // ---- Enroll prompt ----
  enrollStaff = signal<HikStaff | null>(null);
  enrollType: EnrollType = 'fingerprint';
  enrollCaptureId: number | null = null;
  enrollFingerNo = 1;
  cardMode: 'tap' | 'manual' = 'tap';
  manualCardNo = '';
  enrolling = signal(false);
  enrollResult = signal<any>(null);

  savingAccess = signal<string | null>(null);

  ngOnInit() {
    this.load();
    this.hik.getStaffTags().subscribe({ next: (t) => this.tags.set(t || []), error: (e: any) => this.toast.error(e?.error?.message ?? e?.message ?? 'Failed to load staff tags.') });
    this.hik.getDevices().subscribe({ next: (d) => this.devices.set(d || []), error: (e: any) => this.toast.error(e?.error?.message ?? e?.message ?? 'Failed to load devices.') });
  }

  load() {
    this.loading.set(true);
    this.hik.getStaff().subscribe({
      next: (rows) => { this.staff.set(rows || []); this.error.set(null); this.loading.set(false); },
      error: (err) => { this.loading.set(false); this.error.set(err.error?.message || err.message || 'Failed to load staff.'); }
    });
  }

  isEntrance(grp?: string | null): boolean {
    return (grp || '').toLowerCase().startsWith('entrance');
  }

  roomsOf(s: HikStaff): HikStaffMachine[] {
    return s.machines.filter(m => !this.isEntrance(m.grp));
  }

  entranceCountOf(s: HikStaff): number {
    return s.machines.filter(m => this.isEntrance(m.grp)).length;
  }

  offlineCountOf(s: HikStaff): number {
    return s.machines.filter(m => !m.online).length;
  }

  /** Full machine list on hover — the cell itself stays a one-line summary. */
  machinesTooltip(s: HikStaff): string {
    return s.machines.map(m => `${m.name}${m.online ? '' : ' (offline)'}`).join('\n');
  }

  // ---- Add staff / edit machines ----

  openAdd() {
    this.formMode.set('add');
    this.formStaff.set(null);
    this.formName = '';
    this.formCnic = '';
    this.formTagId = this.tagFilter();
    this.formRoomIds = new Set();
    this.formValidUntil = '';
    this.newTagName = '';
    this.formResult.set(null);
  }

  openMachines(s: HikStaff) {
    this.formMode.set('machines');
    this.formStaff.set(s);
    this.formRoomIds = new Set(this.roomsOf(s).map(m => m.deviceId));
    this.formValidUntil = s.validEnd ? s.validEnd.slice(0, 10) : '';
    this.formResult.set(null);
  }

  closeForm() {
    if (this.saving()) return;
    const changed = !!this.formResult()?.ok;
    this.formMode.set(null);
    if (changed) this.load();
  }

  toggleRoom(id: number, event: any) {
    if (event.target.checked) this.formRoomIds.add(id);
    else this.formRoomIds.delete(id);
  }

  addTag() {
    const name = this.newTagName.trim();
    if (!name) return;
    this.hik.addStaffTag(name).subscribe({
      next: (tag) => {
        this.tags.update(list => [...list.filter(t => t.id !== tag.id), tag].sort((a, b) => a.name.localeCompare(b.name)));
        this.formTagId = tag.id;
        this.newTagName = '';
      },
      error: (err) => this.toast.error(err.error?.message || 'Could not add the tag.')
    });
  }

  saveForm() {
    if (this.saving()) return;
    const body = { roomDeviceIds: Array.from(this.formRoomIds), validUntil: this.formValidUntil || null };

    if (this.formMode() === 'add') {
      const cnic = this.formCnic.replace(/\D/g, '');
      if (!this.formName.trim()) { this.toast.error('Enter the staff member\'s name.'); return; }
      if (cnic.length !== 13) { this.toast.error('CNIC must be 13 digits.'); return; }
      if (!this.formTagId) { this.toast.error('Choose a job tag (e.g. Janitor, Office Boy).'); return; }

      this.saving.set(true);
      this.hik.createStaff({ name: this.formName.trim(), cnic, tagId: this.formTagId, ...body }).subscribe({
        next: (res) => this.afterSave(res, `${this.formName.trim()} added as Machine ID ${res.machineId}.`),
        error: (err) => this.afterSaveError(err)
      });
      return;
    }

    const s = this.formStaff();
    if (!s) return;
    this.saving.set(true);
    this.hik.updateStaffMachines(s.employeeNo, body).subscribe({
      next: (res) => this.afterSave(res, `Machines updated for ${s.name}.`),
      error: (err) => this.afterSaveError(err)
    });
  }

  private afterSave(res: any, message: string) {
    this.saving.set(false);
    this.formResult.set(res);
    const queued = (res?.devices || []).filter((d: HikDeviceResult) => d.queued).length;
    this.toast.success(queued ? `${message} ${queued} offline machine(s) will update when they reconnect.` : message);
  }

  private afterSaveError(err: any) {
    this.saving.set(false);
    const res = err.error && typeof err.error === 'object' ? err.error : null;
    this.formResult.set(res?.devices ? res : null);
    this.toast.error(res?.error || res?.message || err.message || 'Save failed.');
  }

  // ---- Block / unblock ----

  toggleAccess(s: HikStaff, event: any) {
    const isEnabled = !!event.target.checked;
    this.savingAccess.set(s.employeeNo);
    this.hik.setStaffAccess(s.employeeNo, isEnabled).subscribe({
      next: (res: any) => {
        this.savingAccess.set(null);
        const devices: HikDeviceResult[] = res?.devices || [];
        const failed = devices.filter(d => !d.ok && !d.queued);
        const queued = devices.filter(d => d.queued).length;
        const action = isEnabled ? 'allowed' : 'blocked';
        if (failed.length) this.toast.error(`${s.name} ${action}, but ${failed.length} machine(s) failed: ${failed.map(d => d.device).join(', ')}`);
        else this.toast.success(`${s.name} ${action} on ${devices.length - queued} machine(s)${queued ? `; ${queued} offline machine(s) queued` : ''}.`);
        this.staff.update(list => list.map(x => x.employeeNo === s.employeeNo ? { ...x, enabled: isEnabled } : x));
      },
      error: (err) => {
        this.savingAccess.set(null);
        event.target.checked = !isEnabled;
        this.toast.error(err.error?.error || err.error?.message || 'Could not update access.');
      }
    });
  }

  // ---- Delete ----

  deleteStaff(s: HikStaff) {
    if (!confirm(`Remove ${s.name} (#${s.employeeNo}) from all machines? Their cards, fingerprints and face are deleted from the machines.`)) return;
    this.hik.deleteStaff(s.employeeNo).subscribe({
      next: (res) => {
        const queued = res.devices.filter(d => d.queued).length;
        this.toast.success(`${s.name} removed${queued ? `; ${queued} offline machine(s) will remove them when they reconnect` : ''}.`);
        this.load();
      },
      error: (err) => this.toast.error(err.error?.error || err.error?.message || 'Could not remove the staff member.')
    });
  }

  // ---- Enroll fingerprint / card / face ----

  captureOptions = computed(() => (this.enrollStaff()?.machines || []).filter(m => m.online));

  get enrollTitle(): string {
    return { fingerprint: 'Enroll Fingerprint', card: 'Tag Card', face: 'Enroll Face' }[this.enrollType];
  }

  get captureName(): string {
    return this.captureOptions().find(m => m.deviceId === Number(this.enrollCaptureId))?.name || 'the machine';
  }

  get enrollWaitingText(): string {
    if (this.enrollType === 'card' && this.cardMode === 'manual') return `Saving card ${this.manualCardNo.trim()} to the machines…`;
    return {
      fingerprint: `Place the finger on the sensor of ${this.captureName}…`,
      card: `Tap the card on the reader of ${this.captureName}…`,
      face: `Stand in front of the camera of ${this.captureName}…`
    }[this.enrollType];
  }

  openEnroll(s: HikStaff, type: EnrollType) {
    this.enrollStaff.set(s);
    this.enrollType = type;
    this.enrollFingerNo = Math.min(10, (s.fingerprints || 0) + 1);
    this.cardMode = 'tap';
    this.manualCardNo = '';
    this.enrollResult.set(null);
    this.enrolling.set(false);
    // Default capture machine: the first online Entrance machine, else any online machine they're on.
    const options = s.machines.filter(m => m.online);
    this.enrollCaptureId = (options.find(m => this.isEntrance(m.grp)) ?? options[0])?.deviceId ?? null;
  }

  closeEnroll() {
    if (this.enrolling()) return;
    const changed = !!this.enrollResult()?.ok;
    this.enrollStaff.set(null);
    if (changed) this.load();
  }

  startEnroll() {
    const s = this.enrollStaff();
    if (!s || this.enrolling()) return;
    if (!this.enrollCaptureId) { this.toast.error('None of this staff member\'s machines are online.'); return; }

    const manual = this.enrollType === 'card' && this.cardMode === 'manual';
    const cardNo = this.manualCardNo.trim();
    if (manual && !/^[0-9A-Za-z]{1,32}$/.test(cardNo)) { this.toast.error('Enter a valid card number (1–32 letters or digits).'); return; }

    const body: any = { captureDeviceId: Number(this.enrollCaptureId), fingerNo: Number(this.enrollFingerNo) || 1 };
    if (manual) body.cardNo = cardNo;

    this.enrolling.set(true);
    this.enrollResult.set(null);
    this.hik.enrollStaff(s.employeeNo, this.enrollType, body).subscribe({
      next: (res) => {
        this.enrolling.set(false);
        this.enrollResult.set(res);
        const queued = (res?.devices || []).filter((d: any) => d.queued).length;
        this.toast.success(`${this.enrollTitle} completed for ${s.name}${queued ? `; ${queued} offline machine(s) queued` : ''}.`);
      },
      error: (err) => {
        this.enrolling.set(false);
        this.enrollResult.set(err.error && typeof err.error === 'object' ? err.error : null);
        this.toast.error(err.error?.error || err.error?.message || err.message || 'Enrollment failed');
      }
    });
  }
}
