import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LocationService } from '../../../services/location.service';
import { ToastService } from '../../../services/toast.service';
import {
  AlertLogRow, AlertRecipient, NetworkAlertsService, networkAlertsErrorMessage
} from '../../../services/network-alerts.service';

interface LocationGroup {
  id: number;
  name: string;
  recipients: AlertRecipient[];
  activeCount: number;
}

const KIND_LABELS: Record<string, string> = { alert: 'Down', reminder: 'Reminder', recovery: 'Back online', test: 'Test' };

/**
 * Network alerts (Administration, super admin only): who gets the outage e-mails of each location (access machine,
 * internet line or network device down for 5 minutes), "Send test email" per location, and the last 50 alerts sent.
 * The server does the checking (NetworkAlerts service switch, Administration > Services); this page only edits the list.
 */
@Component({
  selector: 'app-network-alerts',
  imports: [DatePipe, FormsModule],
  templateUrl: './network-alerts.html',
  styleUrls: ['../manage-base/manage-list.css', './network-alerts.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NetworkAlertsPage implements OnInit {
  private readonly api = inject(NetworkAlertsService);
  private readonly locationService = inject(LocationService);
  private readonly toast = inject(ToastService);

  /** Every location: the page lists them all, so a new one can be given its first recipient. */
  readonly locations = signal<{ id: number; name: string }[]>([]);
  readonly recipients = signal<AlertRecipient[]>([]);
  readonly log = signal<AlertLogRow[]>([]);
  readonly loading = signal(true);
  readonly logLoading = signal(false);
  readonly loadError = signal('');
  readonly logError = signal('');

  readonly newLocationId = signal<number | null>(null);
  readonly newEmail = signal('');
  readonly adding = signal(false);
  readonly formError = signal('');

  /** Recipient ids with a change in flight, and the one waiting for "Remove" to be confirmed. */
  readonly busyIds = signal<ReadonlySet<number>>(new Set());
  readonly confirmRemoveId = signal<number | null>(null);
  readonly testingLocation = signal<number | null>(null);

  readonly groups = computed<LocationGroup[]>(() => {
    const byLocation = new Map<number, AlertRecipient[]>();
    for (const r of this.recipients()) byLocation.set(r.locationId, [...(byLocation.get(r.locationId) ?? []), r]);
    const known = new Map(this.locations().map(l => [l.id, l.name]));
    for (const r of this.recipients()) if (!known.has(r.locationId)) known.set(r.locationId, r.locationName);
    return [...known.entries()]
      .map(([id, name]): LocationGroup => {
        const list = byLocation.get(id) ?? [];
        return { id, name, recipients: list, activeCount: list.filter(r => r.isActive).length };
      })
      .sort((a, b) => (b.recipients.length > 0 ? 1 : 0) - (a.recipients.length > 0 ? 1 : 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  });

  ngOnInit(): void {
    this.locationService.getAll().subscribe({
      next: (res: any) => {
        const list: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        this.locations.set(list.map(l => ({ id: Number(l.id), name: String(l.name ?? `Location ${l.id}`) })));
        if (this.newLocationId() == null && list.length === 1) this.newLocationId.set(Number(list[0].id));
      },
      error: () => this.locations.set([])
    });
    this.load();
    this.loadLog();
  }

  load(): void {
    this.loading.set(true);
    this.api.recipients().subscribe({
      next: list => { this.recipients.set(list); this.loadError.set(''); this.loading.set(false); },
      error: err => { this.loadError.set(networkAlertsErrorMessage(err, "The recipients couldn't be loaded.")); this.loading.set(false); }
    });
  }

  loadLog(): void {
    this.logLoading.set(true);
    this.api.log().subscribe({
      next: rows => { this.log.set(rows); this.logError.set(''); this.logLoading.set(false); },
      error: err => { this.logError.set(networkAlertsErrorMessage(err, "The recent alerts couldn't be loaded.")); this.logLoading.set(false); }
    });
  }

  refresh(): void { this.load(); this.loadLog(); }

  add(): void {
    const locationId = this.newLocationId();
    const email = this.newEmail().trim();
    if (locationId == null) { this.formError.set('Choose a location.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.formError.set('Enter a valid e-mail address.'); return; }
    this.formError.set('');
    this.adding.set(true);
    this.api.add(locationId, email).subscribe({
      next: msg => { this.adding.set(false); this.newEmail.set(''); this.toast.success(msg || 'Recipient added.', 'Added'); this.load(); },
      error: err => { this.adding.set(false); this.formError.set(networkAlertsErrorMessage(err, 'The recipient was not added.')); }
    });
  }

  toggle(r: AlertRecipient): void {
    this.setBusy(r.id, true);
    this.api.setActive(r.id, !r.isActive).subscribe({
      next: () => {
        this.setBusy(r.id, false);
        this.recipients.update(list => list.map(x => x.id === r.id ? { ...x, isActive: !r.isActive } : x));
      },
      error: err => { this.setBusy(r.id, false); this.toast.error(networkAlertsErrorMessage(err, 'Nothing was changed.'), 'Not changed'); }
    });
  }

  remove(r: AlertRecipient): void {
    if (this.confirmRemoveId() !== r.id) { this.confirmRemoveId.set(r.id); return; }
    this.confirmRemoveId.set(null);
    this.setBusy(r.id, true);
    this.api.remove(r.id).subscribe({
      next: () => {
        this.setBusy(r.id, false);
        this.recipients.update(list => list.filter(x => x.id !== r.id));
        this.toast.success(`${r.email} removed.`, 'Removed');
      },
      error: err => { this.setBusy(r.id, false); this.toast.error(networkAlertsErrorMessage(err, 'The recipient was not removed.'), 'Not removed'); }
    });
  }

  sendTest(g: LocationGroup): void {
    this.testingLocation.set(g.id);
    this.api.test(g.id).subscribe({
      next: msg => { this.testingLocation.set(null); this.toast.success(msg || 'Test e-mail sent.', 'Sent'); this.loadLog(); },
      error: err => { this.testingLocation.set(null); this.toast.error(networkAlertsErrorMessage(err, 'The test e-mail could not be sent.'), 'Not sent'); }
    });
  }

  kindLabel(kind: string): string { return KIND_LABELS[kind] ?? kind; }

  private setBusy(id: number, busy: boolean): void {
    this.busyIds.update(s => { const next = new Set(s); if (busy) next.add(id); else next.delete(id); return next; });
  }
}
