import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  ServiceSwitch, ServiceSwitchesService, serviceSwitchErrorMessage
} from '../../../services/service-switches.service';
import { ToastService } from '../../../services/toast.service';
import {
  EmailOutboxService, OutboxCounts, OutboxItem, OutboxStatus, outboxErrorMessage
} from '../../../services/email-outbox.service';

type ServiceState = 'running' | 'paused' | 'config-off';

interface ServiceRow {
  item: ServiceSwitch;
  state: ServiceState;
  stateLabel: string;
  /** Local time of the last change, or null when it was never changed (or the date can't be read). */
  updatedAt: Date | null;
  /** "5 min ago", "yesterday"; empty past a month. */
  updatedRelative: string;
}

/**
 * Turning these off has a side effect outside the service itself, so the confirm says so prominently.
 * Keyed by the API's service name (its identifier), not by what is shown.
 */
const OFF_WARNINGS: Record<string, string> = {
  AccessCardRestriction: 'Lapsed customers will keep door access while this is off.',
  BillingAutomation: 'Recurring invoices will not be generated.',
  EmailSending: 'No e-mail goes out at all: invoices, challans, agreements, quotations and alerts wait in Pending emails until it is turned back on.',
};

/** The Email Sending switch's name (the API's identifier). */
const EMAIL_SENDING = 'EmailSending';

/** The tabs of Pending emails, in order. */
const OUTBOX_TABS: { status: OutboxStatus | null; label: string; count: (c: OutboxCounts) => number | null }[] = [
  { status: 'Pending', label: 'Pending', count: c => c.pending },
  { status: 'Failed', label: 'Failed', count: c => c.failed },
  { status: 'Sent', label: 'Sent', count: c => c.sent },
  { status: 'Discarded', label: 'Discarded', count: c => c.discarded },
  { status: null, label: 'All', count: () => null },
];

@Component({
  selector: 'app-admin-services',
  imports: [DatePipe],
  templateUrl: './services.html',
  // The shared admin page look (page padding, header, cards, buttons) and the shared popup look come first.
  styleUrls: ['../manage/manage.css', '../../../styles/form-popup.css', './services.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServicesPage implements OnInit, OnDestroy {
  private readonly api = inject(ServiceSwitchesService);
  private readonly toast = inject(ToastService);
  private readonly outboxApi = inject(EmailOutboxService);

  // ---------- Pending emails ----------
  readonly outboxTabs = OUTBOX_TABS;
  readonly outboxStatus = signal<OutboxStatus | null>('Pending');
  readonly outboxItems = signal<OutboxItem[]>([]);
  readonly outboxCounts = signal<OutboxCounts>({ pending: 0, sending: 0, sent: 0, failed: 0, discarded: 0 });
  readonly outboxLoading = signal(false);
  readonly outboxLoaded = signal(false);
  /** Set when the list can't be loaded (e.g. 503 "Database update needed: run SS_02..."). */
  readonly outboxError = signal('');
  /** The Email Sending switch, as the outbox list last reported it. */
  readonly emailSendingOn = signal(true);
  /** Ids being sent / discarded. */
  readonly outboxBusy = signal<ReadonlySet<number>>(new Set());
  /** Waiting for "discard" to be confirmed: one e-mail, or 'all'. */
  readonly discardTarget = signal<OutboxItem | 'all' | null>(null);
  readonly discardAllBusy = signal(false);
  private outboxSub?: Subscription;
  readonly outboxOpenCount = computed(() => this.outboxCounts().pending + this.outboxCounts().sending + this.outboxCounts().failed);

  readonly items = signal<ServiceSwitch[]>([]);
  readonly loading = signal(false);
  /** True once a load has finished (so "no services" is not shown before the first answer). */
  readonly loaded = signal(false);
  readonly loadError = signal('');

  /** Names of the services whose change is being saved. */
  readonly pending = signal<ReadonlySet<string>>(new Set());
  readonly anyPending = computed(() => this.pending().size > 0);
  /** Last failed change per service name, shown under that service until it is changed again. */
  readonly rowErrors = signal<Record<string, string>>({});

  /** The service waiting for "turn off" to be confirmed. */
  readonly confirmTarget = signal<ServiceSwitch | null>(null);

  readonly rows = computed<ServiceRow[]>(() => this.items().map(item => {
    const state: ServiceState = !item.configEnabled ? 'config-off' : item.isEnabled ? 'running' : 'paused';
    const updatedAt = parseUtc(item.updatedAt);
    return {
      item,
      state,
      stateLabel: state === 'running' ? 'Running' : state === 'paused' ? 'Paused' : 'Off in server settings',
      updatedAt,
      updatedRelative: updatedAt ? relativeTime(updatedAt) : '',
    };
  }));

  readonly counts = computed(() => {
    const rows = this.rows();
    return {
      running: rows.filter(r => r.state === 'running').length,
      paused: rows.filter(r => r.state === 'paused').length,
      configOff: rows.filter(r => r.state === 'config-off').length,
    };
  });

  ngOnInit(): void {
    this.load();
    this.loadOutbox();
  }

  ngOnDestroy(): void {
    this.outboxSub?.unsubscribe();
  }

  loadOutbox(): void {
    // A newer load replaces an older one (another tab, or a reload after an action): its answer never lands late.
    this.outboxSub?.unsubscribe();
    this.outboxLoading.set(true);
    this.outboxSub = this.outboxApi.list(this.outboxStatus()).subscribe({
      next: res => {
        this.outboxItems.set(res.items);
        this.outboxCounts.set(res.counts);
        this.emailSendingOn.set(res.emailSendingOn);
        this.outboxError.set('');
        this.outboxLoading.set(false);
        this.outboxLoaded.set(true);
      },
      error: err => {
        this.outboxLoading.set(false);
        this.outboxLoaded.set(true);
        this.outboxError.set(outboxErrorMessage(err, "The pending e-mails couldn't be loaded. Please try again."));
      }
    });
  }

  showOutboxTab(status: OutboxStatus | null): void {
    if (this.outboxStatus() === status) return;
    this.outboxStatus.set(status);
    this.outboxItems.set([]);
    this.loadOutbox();
  }

  isOutboxBusy(id: number): boolean {
    return this.outboxBusy().has(id);
  }

  /** Pending / Failed e-mails can be sent now or discarded. */
  canAct(item: OutboxItem): boolean {
    return item.status === 'Pending' || item.status === 'Failed';
  }

  outboxDate(value: string | null): Date | null {
    return parseUtc(value);
  }

  sendNow(item: OutboxItem): void {
    if (this.isOutboxBusy(item.id) || !this.emailSendingOn()) return;
    this.setOutboxBusy(item.id, true);
    this.outboxApi.send(item.id).subscribe({
      next: msg => { this.setOutboxBusy(item.id, false); this.toast.success(msg || `E-mail sent to ${item.toEmail}.`, 'Sent'); this.loadOutbox(); },
      error: err => {
        this.setOutboxBusy(item.id, false);
        this.toast.error(outboxErrorMessage(err, 'The e-mail could not be sent.'), 'Not sent');
        this.loadOutbox();
      }
    });
  }

  askDiscard(target: OutboxItem | 'all'): void {
    this.discardTarget.set(target);
    focusSoon('ob-confirm-cancel');
  }

  cancelDiscard(): void {
    this.discardTarget.set(null);
  }

  confirmDiscard(): void {
    const target = this.discardTarget();
    if (!target) return;
    this.discardTarget.set(null);
    if (target === 'all') {
      this.discardAllBusy.set(true);
      this.outboxApi.discardAll().subscribe({
        next: msg => { this.discardAllBusy.set(false); this.toast.success(msg || 'Pending e-mails discarded.', 'Discarded'); this.loadOutbox(); },
        error: err => { this.discardAllBusy.set(false); this.toast.error(outboxErrorMessage(err, 'Nothing was discarded.'), 'Not discarded'); this.loadOutbox(); }
      });
      return;
    }
    this.setOutboxBusy(target.id, true);
    this.outboxApi.discard(target.id).subscribe({
      next: msg => { this.setOutboxBusy(target.id, false); this.toast.success(msg || 'E-mail discarded.', 'Discarded'); this.loadOutbox(); },
      error: err => {
        this.setOutboxBusy(target.id, false);
        this.toast.error(outboxErrorMessage(err, 'The e-mail was not discarded.'), 'Not discarded');
        this.loadOutbox();
      }
    });
  }

  private setOutboxBusy(id: number, on: boolean): void {
    this.outboxBusy.update(set => {
      const copy = new Set(set);
      if (on) copy.add(id); else copy.delete(id);
      return copy;
    });
  }

  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.loadError.set('');
    this.api.list().subscribe({
      next: list => {
        this.items.set(list);
        this.rowErrors.set({});
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: err => {
        this.loading.set(false);
        const message = serviceSwitchErrorMessage(err, 'load');
        // A refresh that fails keeps the list on screen; a first load shows the error with Try again.
        if (this.items().length > 0) {
          this.toast.error(message, "Couldn't refresh");
        } else {
          this.loadError.set(message);
        }
      }
    });
  }

  isPending(name: string): boolean {
    return this.pending().has(name);
  }

  /** The switch: turning off asks first, turning on saves at once. */
  onToggle(item: ServiceSwitch): void {
    if (this.isPending(item.name)) return;
    if (item.isEnabled) {
      this.confirmTarget.set(item);
      focusSoon('sv-confirm-cancel');
      return;
    }
    this.save(item, true);
  }

  offWarning(item: ServiceSwitch): string | null {
    return OFF_WARNINGS[item.name] ?? null;
  }

  confirmOff(): void {
    const item = this.confirmTarget();
    if (!item) return;
    this.confirmTarget.set(null);
    this.save(item, false);
    focusSoon(switchId(item.name));
  }

  cancelOff(): void {
    const item = this.confirmTarget();
    if (!item) return;
    this.confirmTarget.set(null);
    focusSoon(switchId(item.name));
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.discardTarget()) this.cancelDiscard();
    else if (this.confirmTarget()) this.cancelOff();
  }

  switchId(name: string): string {
    return switchId(name);
  }

  /** Optimistic: the switch moves now; the saved service replaces it, or it moves back if the save fails. */
  private save(item: ServiceSwitch, isEnabled: boolean): void {
    const before = this.items().find(i => i.name === item.name) ?? item;
    this.setRowError(item.name, '');
    this.replace(item.name, { ...before, isEnabled, running: isEnabled && before.configEnabled });
    this.setPending(item.name, true);

    this.api.setEnabled(item.name, isEnabled).subscribe({
      next: ({ item: saved, message }) => {
        this.setPending(item.name, false);
        if (saved && saved.name === item.name) this.replace(item.name, saved);
        if (item.name === EMAIL_SENDING) this.loadOutbox();
        const now = saved ?? this.items().find(i => i.name === item.name) ?? before;
        const text = message || `${now.displayName} turned ${isEnabled ? 'on' : 'off'}.`;
        if (isEnabled && !now.configEnabled) {
          // Saved, but the server setting still holds it off: say so instead of a plain "turned on".
          this.toast.warning(`${text} It stays off until the server setting is turned on.`, 'Saved');
        } else {
          this.toast.success(text, 'Saved');
        }
      },
      error: err => {
        this.setPending(item.name, false);
        this.replace(item.name, before);
        const message = serviceSwitchErrorMessage(err, 'change');
        this.setRowError(item.name, message);
        this.toast.error(message, 'Not changed');
      }
    });
  }

  private replace(name: string, next: ServiceSwitch): void {
    this.items.update(list => list.map(i => (i.name === name ? next : i)));
  }

  private setPending(name: string, on: boolean): void {
    this.pending.update(set => {
      const copy = new Set(set);
      if (on) copy.add(name); else copy.delete(name);
      return copy;
    });
  }

  private setRowError(name: string, message: string): void {
    this.rowErrors.update(errors => {
      const copy = { ...errors };
      if (message) copy[name] = message; else delete copy[name];
      return copy;
    });
  }
}

function switchId(name: string): string {
  return 'sv-switch-' + name.replace(/[^A-Za-z0-9_-]/g, '-');
}

function focusSoon(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus(), 30);
}

/** The API sends UTC; a value without a zone ("2026-10-13T08:32:24") is read as UTC, not browser time. */
function parseUtc(value: string | null): Date | null {
  if (!value) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeTime(d: Date): string {
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 0) return '';
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  return days <= 31 ? (days === 1 ? 'yesterday' : `${days} days ago`) : '';
}
