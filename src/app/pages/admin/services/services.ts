import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  ServiceSwitch, ServiceSwitchesService, serviceSwitchErrorMessage
} from '../../../services/service-switches.service';
import { ToastService } from '../../../services/toast.service';

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
};

@Component({
  selector: 'app-admin-services',
  imports: [DatePipe],
  templateUrl: './services.html',
  // The shared admin page look (page padding, header, cards, buttons) and the shared popup look come first.
  styleUrls: ['../manage/manage.css', '../../../styles/form-popup.css', './services.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServicesPage implements OnInit {
  private readonly api = inject(ServiceSwitchesService);
  private readonly toast = inject(ToastService);

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
    if (this.confirmTarget()) this.cancelOff();
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
