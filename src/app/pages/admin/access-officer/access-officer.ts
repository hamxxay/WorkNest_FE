import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import {
  AccessOfficerService, AoAccessResult, AoDeviceResult, AoEnrollResult, AoEnrollType, AoError, AoLookup, AoMatch, NOT_FOUND_MESSAGE
} from '../../../services/access-officer.service';
import { CNIC_ERROR, formatCnicMask } from '../../../utils/cnic';

type AoAction = 'add' | 'remove' | 'restore';
type AoStatus = 'pending' | 'on' | 'off';

/** Result line under a room card after an action (stays until the next action or search). */
interface AoNotice { kind: 'ok' | 'warn' | 'error'; title: string; text: string; }

interface EnrolTarget { match: AoMatch; type: AoEnrollType; personId: number; name: string; }

/** How long the capture may take on the machine (shown on the waiting screen). */
const CAPTURE_SECONDS = 90;
/** Passport numbers are typed as they are (letters, digits, dashes); the API takes 5-30 letters / digits. */
const PASSPORT_MAX_LENGTH = 30;

/**
 * Access page (/admin/access): door access by CNIC. The Access Officer's only page (super admins may use it too).
 * One field: the CNIC (or passport number). The lookup lists every room the person is on, or waiting for, at the
 * officer's locations; per room: Add to room (pending), Enrol face / fingerprint, Remove access, Restore access.
 */
@Component({
  selector: 'app-access-officer',
  imports: [NgTemplateOutlet],
  templateUrl: './access-officer.html',
  styleUrls: ['../../../styles/form-popup.css', './access-officer.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AccessOfficerPage implements OnInit {
  private svc = inject(AccessOfficerService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  readonly captureSeconds = CAPTURE_SECONDS;
  readonly passportMaxLength = PASSPORT_MAX_LENGTH;
  readonly fingers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly isSuperAdmin = this.auth.hasRole('super_admin');

  // ---------- search ----------
  readonly query = signal('');
  readonly fieldError = signal<string | null>(null);
  readonly phase = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly result = signal<AoLookup | null>(null);
  readonly error = signal<AoError | null>(null);
  /** The CNIC the shown results are for. */
  readonly searchedFor = signal('');
  readonly refreshing = signal(false);
  private lookupSub: Subscription | null = null;

  // ---------- actions ----------
  /** One action at a time: the room card and button that is working. */
  readonly busy = signal<{ id: number; action: AoAction } | null>(null);
  readonly notices = signal<Record<number, AoNotice>>({});
  /** Read out by screen readers (results found, action done). */
  readonly live = signal('');

  // ---------- enrolment popup ----------
  readonly enrolTarget = signal<EnrolTarget | null>(null);
  readonly enrolPhase = signal<'ready' | 'waiting' | 'done'>('ready');
  readonly fingerNo = signal(1);
  readonly enrolResult = signal<AoEnrollResult | null>(null);
  readonly enrolError = signal<AoError | null>(null);
  readonly elapsed = signal(0);
  private enrolSub: Subscription | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  // ---------- remove access popup ----------
  readonly confirmTarget = signal<AoMatch | null>(null);

  /** The officer's location names (header); null while loading, [] when unknown. */
  readonly locationNames = signal<string[] | null>(null);

  readonly person = computed(() => this.result()?.person ?? null);
  readonly matches = computed(() => this.result()?.matches ?? []);
  /** Name for sentences: the person's name, else "this person" (pending only, no record yet). */
  readonly personName = computed(() => this.person()?.name || 'this person');
  readonly initials = computed(() => {
    const parts = (this.person()?.name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  });
  readonly enrolProgress = computed(() => Math.min(100, Math.round((this.elapsed() / CAPTURE_SECONDS) * 100)));

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.lookupSub?.unsubscribe();
      this.enrolSub?.unsubscribe();
      this.stopTimer();
    });
  }

  ngOnInit(): void {
    if (this.isSuperAdmin) {
      this.locationNames.set([]);
      return;
    }
    const u = this.auth.getUser();
    const ids = u?.locationIds?.length ? u.locationIds : this.auth.tokenLocationIds();
    const fallback = u?.locationId ? [u.locationId] : null;
    this.svc.locationNames(ids.length ? ids : fallback).subscribe(names => this.locationNames.set(names));
  }

  // ---------- search ----------

  /** CNIC: digits get the 12345-1234567-1 mask. Anything with a letter is a passport number, kept as typed. */
  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value;
    let next: string;
    if (/[a-z]/i.test(raw)) {
      next = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, PASSPORT_MAX_LENGTH);
    } else {
      next = formatCnicMask(raw);
    }
    if (next !== raw) {
      // Keep the caret after the same number of letters / digits.
      const caret = input.selectionStart ?? raw.length;
      const before = raw.slice(0, caret).replace(/[^A-Za-z0-9]/g, '').length;
      input.value = next;
      let pos = 0;
      for (let seen = 0; pos < next.length && seen < before; pos++) {
        if (/[A-Z0-9]/.test(next[pos])) seen++;
      }
      try { input.setSelectionRange(pos, pos); } catch { /* no selection support */ }
    }
    this.query.set(next);
    if (this.fieldError()) this.fieldError.set(null);
  }

  /** Error for the typed value, or null when it can be searched. */
  private validate(value: string): string | null {
    const v = value.trim();
    if (!v) return 'Enter a CNIC or passport number.';
    if (/[A-Z]/i.test(v)) return v.replace(/-/g, '').length >= 5 ? null : 'Enter the full passport number.';
    return v.replace(/\D/g, '').length === 13 ? null : CNIC_ERROR;
  }

  submit(event?: Event): void {
    event?.preventDefault();
    const value = this.query().trim();
    const problem = this.validate(value);
    if (problem) {
      this.fieldError.set(problem);
      return;
    }
    this.fieldError.set(null);
    this.notices.set({});
    this.runLookup(value, false);
  }

  clear(input?: HTMLInputElement): void {
    this.lookupSub?.unsubscribe();
    this.query.set('');
    this.fieldError.set(null);
    this.result.set(null);
    this.error.set(null);
    this.notices.set({});
    this.searchedFor.set('');
    this.refreshing.set(false);
    this.phase.set('idle');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  /** Searches again for the shown CNIC (after an action, or the Refresh button) without clearing the page. */
  refresh(): void {
    if (this.searchedFor() && !this.refreshing() && this.phase() === 'ready') this.runLookup(this.searchedFor(), true);
  }

  private runLookup(cnic: string, quiet: boolean): void {
    this.lookupSub?.unsubscribe();
    if (quiet) {
      this.refreshing.set(true);
    } else {
      this.phase.set('loading');
      this.error.set(null);
      this.searchedFor.set(cnic);
      this.live.set('Searching');
    }
    this.lookupSub = this.svc.lookup(cnic).subscribe({
      next: res => {
        this.refreshing.set(false);
        if (!res.matches.length) {
          // A lookup with nothing to show reads like the API's "not found".
          this.result.set(null);
          this.error.set({ status: 200, kind: 'not-found', title: 'No match found', message: NOT_FOUND_MESSAGE });
          this.phase.set('error');
          this.live.set('No match found.');
          return;
        }
        this.result.set(res);
        this.searchedFor.set(res.cnic || cnic);
        this.phase.set('ready');
        if (!quiet) {
          const n = res.matches.length;
          this.live.set(`${res.person?.name || 'Person'} found on ${n} ${n === 1 ? 'room' : 'rooms'}.`);
        }
      },
      error: (err: AoError) => {
        this.refreshing.set(false);
        if (quiet) {
          // Keep what is shown; the next action or search tries again.
          return;
        }
        if (err.kind === 'invalid') {
          // The API did not accept the number (400): say so under the field.
          this.result.set(null);
          this.error.set(null);
          this.phase.set('idle');
          this.fieldError.set(err.message);
          this.live.set(err.message);
          return;
        }
        this.result.set(null);
        this.error.set(err);
        this.phase.set('error');
        this.live.set(err.title);
      }
    });
  }

  // ---------- per room ----------

  status(m: AoMatch): AoStatus {
    if (m.state === 'pending') return 'pending';
    return m.accessEnabled ? 'on' : 'off';
  }

  statusLabel(m: AoMatch): string {
    return { pending: 'Waiting for CNIC check', on: 'Has access', off: 'Access removed' }[this.status(m)];
  }

  machineLabel(m: AoMatch): string {
    if (!m.roomMachine) return 'No machine';
    return m.roomMachine.online ? 'Online' : 'Offline';
  }

  roomName(m: AoMatch): string {
    return m.room || m.spaceCode || 'this room';
  }

  /** The person's id for this room (an add-to-room answer may carry it before the person record is loaded). */
  personIdFor(m: AoMatch): number | null {
    return m.personId ?? this.person()?.personId ?? null;
  }

  /** Why enrolment can't start on this room, or null when it can. */
  enrolBlocked(m: AoMatch): string | null {
    if (!m.roomMachine) return `No door machine is linked to ${this.roomName(m)}, so a face or fingerprint can't be captured. Ask an admin to set it up.`;
    if (!m.roomMachine.online) return `The ${this.roomName(m)} machine is offline. Enrolment needs it online; try again when it is back.`;
    if (this.personIdFor(m) == null) return 'Search the CNIC again to load this person.';
    return null;
  }

  isBusy(m: AoMatch, action?: AoAction): boolean {
    const b = this.busy();
    return !!b && b.id === m.bookingDetailId && (!action || b.action === action);
  }

  private setNotice(id: number, notice: AoNotice | null): void {
    const next = { ...this.notices() };
    if (notice) next[id] = notice; else delete next[id];
    this.notices.set(next);
    if (notice) this.live.set(`${notice.title}. ${notice.text}`);
  }

  /** Replaces one room card with the API's updated copy. */
  private patchMatch(id: number, update: (m: AoMatch) => AoMatch): void {
    const r = this.result();
    if (!r) return;
    this.result.set({ ...r, matches: r.matches.map(m => (m.bookingDetailId === id ? update(m) : m)) });
  }

  addToRoom(m: AoMatch): void {
    if (this.busy()) return;
    const id = m.bookingDetailId;
    this.busy.set({ id, action: 'add' });
    this.setNotice(id, null);
    this.svc.addToRoom(id, this.searchedFor()).subscribe({
      next: res => {
        this.busy.set(null);
        this.patchMatch(id, old => res.match ?? { ...old, state: 'assigned', accessEnabled: true });
        this.setNotice(id, {
          kind: 'ok', title: `Added to ${this.roomName(m)}`,
          text: res.message || 'The CNIC is checked. You can now enrol a face or fingerprint on the room machine.'
        });
        this.refresh();
      },
      error: (err: AoError) => this.writeFailed(id, err)
    });
  }

  restore(m: AoMatch): void {
    const personId = this.personIdFor(m);
    if (this.busy() || personId == null) return;
    const id = m.bookingDetailId;
    this.busy.set({ id, action: 'restore' });
    this.setNotice(id, null);
    this.svc.restoreAccess(id, personId).subscribe({
      next: res => {
        this.busy.set(null);
        this.patchMatch(id, old => res.match ?? { ...old, accessEnabled: true });
        this.setNotice(id, this.accessNotice(true, m, res));
        this.refresh();
      },
      error: (err: AoError) => this.writeFailed(id, err)
    });
  }

  // ---------- remove access (confirm first) ----------

  askRemove(m: AoMatch): void {
    if (this.busy()) return;
    this.confirmTarget.set(m);
    this.focusSoon('ao-confirm-cancel');
  }

  cancelRemove(): void {
    if (this.busy()) return;
    this.confirmTarget.set(null);
  }

  confirmRemove(): void {
    const m = this.confirmTarget();
    const personId = m ? this.personIdFor(m) : null;
    if (!m || personId == null || this.busy()) return;
    const id = m.bookingDetailId;
    this.busy.set({ id, action: 'remove' });
    this.setNotice(id, null);
    this.svc.removeAccess(id, personId).subscribe({
      next: res => {
        this.busy.set(null);
        this.confirmTarget.set(null);
        this.patchMatch(id, old => res.match ?? { ...old, accessEnabled: false });
        this.setNotice(id, this.accessNotice(false, m, res));
        this.refresh();
      },
      error: (err: AoError) => {
        this.confirmTarget.set(null);
        this.writeFailed(id, err);
      }
    });
  }

  /** A refused action: the API's words on the card. 409 (already in that state) refreshes the card to the real state. */
  private writeFailed(id: number, err: AoError): void {
    this.busy.set(null);
    this.setNotice(id, { kind: err.kind === 'conflict' ? 'warn' : 'error', title: err.title, text: err.message });
    if (err.kind === 'conflict' || err.kind === 'not-found') this.refresh();
  }

  /** Notice after Remove / Restore access: the API's sentence (else ours), plus the machine side. */
  private accessNotice(enabled: boolean, m: AoMatch, res: AoAccessResult): AoNotice {
    const title = enabled ? 'Door access restored' : 'Door access removed';
    const failed = res.devices.filter(d => !d.ok && !d.queued);
    const queued = res.devices.filter(d => d.queued);
    // The API's sentence already says when some machines failed; the list below names them.
    const base = res.message.replace(/\s*Some door machines could not be updated; see the machine list\.?$/, '') || (enabled
      ? `${this.personName()} can open ${this.roomName(m)} and the entrances again.`
      : `${this.personName()} can no longer open ${this.roomName(m)} or the entrances. They stay on ${m.customer || 'the customer'}'s booking.`);
    if (res.machineError) {
      return { kind: 'warn', title, text: `${base} ${res.machineError} They are updated with the next change.` };
    }
    if (failed.length) {
      return { kind: 'warn', title, text: `${base} ${machines(failed.length)} could not be updated: ${failed.map(d => d.device).join(', ')}.` };
    }
    if (queued.length) {
      return { kind: 'ok', title, text: `${base} ${machines(queued.length, 'offline ')} will update when ${queued.length === 1 ? 'it reconnects' : 'they reconnect'}.` };
    }
    return { kind: 'ok', title, text: base };
  }

  // ---------- enrolment ----------

  openEnrol(m: AoMatch, type: AoEnrollType): void {
    const personId = this.personIdFor(m);
    if (this.busy() || personId == null || this.enrolBlocked(m)) return;
    this.enrolTarget.set({ match: m, type, personId, name: this.personName() });
    this.fingerNo.set(1);
    this.enrolPhase.set('ready');
    this.enrolResult.set(null);
    this.enrolError.set(null);
    this.elapsed.set(0);
    this.focusSoon('ao-enrol-start');
  }

  closeEnrol(): void {
    if (this.enrolPhase() === 'waiting') return;
    const t = this.enrolTarget();
    const done = this.enrolResult()?.ok;
    this.enrolTarget.set(null);
    if (t && done) this.refresh();
  }

  startEnrol(): void {
    const t = this.enrolTarget();
    if (!t || this.enrolPhase() === 'waiting') return;
    this.enrolPhase.set('waiting');
    this.enrolResult.set(null);
    this.enrolError.set(null);
    this.startTimer();
    this.live.set(this.waitingText(t));
    this.enrolSub?.unsubscribe();
    this.enrolSub = this.svc.enroll(t.type, t.match.bookingDetailId, t.personId, this.fingerNo()).subscribe({
      next: res => {
        this.stopTimer();
        this.enrolResult.set(res);
        this.enrolPhase.set('done');
        if (res.ok) {
          const id = t.match.bookingDetailId;
          this.patchMatch(id, old => ({ ...old, credentials: { ...old.credentials, [t.type]: true } }));
          this.setNotice(id, { kind: 'ok', title: `${t.type === 'face' ? 'Face' : 'Fingerprint'} enrolled`, text: this.enrolSummary(res) });
        } else {
          this.live.set(res.error || 'Enrolment failed.');
        }
        this.focusSoon('ao-enrol-done');
      },
      error: (err: AoError) => {
        this.stopTimer();
        this.enrolError.set(err);
        this.enrolResult.set(err.enroll ?? null);
        this.enrolPhase.set('done');
        this.live.set(`${err.title}. ${err.message}`);
        this.focusSoon('ao-enrol-done');
      }
    });
  }

  /** "Ask Ali to stand at the Office 349 machine and look at the camera." */
  waitingText(t: EnrolTarget): string {
    const room = this.roomName(t.match);
    return t.type === 'face'
      ? `Ask ${t.name} to stand at the ${room} machine and look at the camera`
      : `Ask ${t.name} to place finger ${this.fingerNo()} on the ${room} machine`;
  }

  /** One line for the room card after a good enrolment. */
  private enrolSummary(res: AoEnrollResult): string {
    if (res.summary) return res.summary;
    const ok = res.devices.filter(d => d.ok).length;
    const queued = res.devices.filter(d => d.queued).length;
    if (!res.devices.length) return 'Saved on the room machine and the entrances.';
    return `Saved on ${ok} of ${machines(res.devices.length)}${queued ? `, ${queued} offline (will update when ${queued === 1 ? 'it reconnects' : 'they reconnect'})` : ''}.`;
  }

  /** The room's own machine (where the capture happens) as opposed to an Entrance machine. */
  isRoomDevice(d: AoDeviceResult, m: AoMatch): boolean {
    const name = (m.roomMachine?.name || '').trim().toLowerCase();
    return !!name && d.device.trim().toLowerCase() === name;
  }

  deviceState(d: AoDeviceResult): 'ok' | 'queued' | 'failed' {
    if (d.queued) return 'queued';
    return d.ok ? 'ok' : 'failed';
  }

  deviceText(d: AoDeviceResult, m: AoMatch): string {
    if (d.queued) return 'Offline: updates when it reconnects';
    if (!d.ok) return d.error ? `Failed: ${d.error}` : 'Failed';
    const what = this.isRoomDevice(d, m) ? 'Captured' : 'Copied';
    if (d.verified === true) return `${what}, confirmed on the machine`;
    return what;
  }

  /** Room machine first, then the entrances. */
  sortedDevices(res: AoEnrollResult, m: AoMatch): AoDeviceResult[] {
    return [...res.devices].sort((a, b) => Number(this.isRoomDevice(b, m)) - Number(this.isRoomDevice(a, m)));
  }

  setFinger(n: number): void {
    if (this.enrolPhase() !== 'waiting') this.fingerNo.set(n);
  }

  private startTimer(): void {
    this.stopTimer();
    this.elapsed.set(0);
    const started = Date.now();
    this.timer = setInterval(() => this.elapsed.set(Math.floor((Date.now() - started) / 1000)), 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------- popups ----------

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirmTarget()) this.cancelRemove();
    else if (this.enrolTarget()) this.closeEnrol();
  }

  private focusSoon(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 30);
  }

  // ---------- display helpers ----------

  /** "1 Oct 2026 – 31 Dec 2026"; one side missing shows only the other. */
  dateRange(m: AoMatch): string {
    const a = fmtDate(m.startOn), b = fmtDate(m.endOn);
    if (a && b) return `${a} – ${b}`;
    if (a) return `From ${a}`;
    if (b) return `Until ${b}`;
    return 'Dates not set';
  }

  idLabel(): string {
    const t = (this.person()?.idType || '').trim();
    return !t || /cnic/i.test(t) ? 'CNIC' : t;
  }
}

/** "2026-10-01" (or an ISO date-time) -> "1 Oct 2026"; '' when it is not a date. */
function fmtDate(v: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "1 machine", "3 offline machines". */
function machines(n: number, kind = ''): string {
  return `${n} ${kind}machine${n === 1 ? '' : 's'}`;
}
