import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HikDeviceService } from '../../../services/hik-device.service';
import { HikDeviceDetail, HikDeviceGroup, HikDeviceSaveRequest } from '../../../models/hik-device.model';

/** Value of the Group select that switches to the "new group" text box. */
const NEW_GROUP = '__new__';

/**
 * Add / edit an access machine (Hikvision) — Access Dashboard, admin and super admin. Loads the machine (no password:
 * an empty password on edit keeps the saved one) and the machine groups itself; the API tests the machine right after
 * saving, so Online / Model / Serial fill in when it answers (an offline machine is still saved).
 */
@Component({
  selector: 'app-manage-access-machine-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-access-machine-modal.html',
  styleUrls: ['../../../styles/form-popup.css', './manage-access-machine-modal.css']
})
export class ManageAccessMachineModal implements OnInit {
  private hik = inject(HikDeviceService);

  /** Machine to edit; null = add a new one. */
  @Input() machineId: number | null = null;
  /** Locations the user may pick (super admin: all; admin: their own). */
  @Input() locations: { id: number; name: string }[] = [];
  @Output() closed = new EventEmitter<void>();
  /** After a save: the saved machine (with its test result already applied). */
  @Output() saved = new EventEmitter<HikDeviceDetail | null>();

  readonly newGroup = NEW_GROUP;
  form: HikDeviceSaveRequest = this.blank();
  /** Group select value: a group name, '' (none) or NEW_GROUP. */
  groupChoice = '';
  newGroupName = '';
  /** Port typed by the user; empty = 80 (443 with HTTPS). */
  portText = '';

  groups = signal<HikDeviceGroup[]>([]);
  device = signal<HikDeviceDetail | null>(null);
  loading = signal(false);
  saving = signal(false);
  testing = signal(false);
  error = signal<string | null>(null);
  /** Result line of "Test connection". */
  testResult = signal<{ online: boolean; text: string } | null>(null);
  showPassword = signal(false);

  get isEdit(): boolean { return this.machineId != null; }

  ngOnInit() {
    // One location to choose from: pick it.
    if (!this.isEdit && this.locations.length === 1) this.form.locationId = this.locations[0].id;
    this.hik.getDeviceGroups().subscribe({
      next: res => {
        this.groups.set(res?.data || []);
        this.syncGroupChoice();
      },
      error: err => { if (err?.status === 503) this.error.set(err?.error?.message || 'The database update HIK_DEV_01 has not run yet.'); }
    });
    if (this.isEdit) this.loadMachine();
  }

  private blank(): HikDeviceSaveRequest {
    return { name: '', host: '', host2: '', port: null, useHttps: false, username: 'admin', password: '', location: '', grp: '', code: '', locationId: null };
  }

  private loadMachine() {
    this.loading.set(true);
    this.hik.getDevice(this.machineId!).subscribe({
      next: res => {
        const d = res?.data;
        this.loading.set(false);
        if (!d) { this.error.set('Machine not found.'); return; }
        this.device.set(d);
        this.form = {
          name: d.name || '', host: d.host || '', host2: d.host2 || '', port: d.port || null, useHttps: !!d.useHttps,
          username: d.username || '', password: '', location: d.location || '', grp: d.grp || '', code: d.code || '',
          locationId: d.locationId ?? null
        };
        this.portText = d.port ? String(d.port) : '';
        this.syncGroupChoice();
      },
      error: err => {
        this.loading.set(false);
        this.error.set(err?.error?.message || 'The machine could not be loaded.');
      }
    });
  }

  /** Shows the machine's group in the select (as its own option if it isn't in the list yet). */
  private syncGroupChoice() {
    if (this.groupChoice !== NEW_GROUP) this.groupChoice = (this.form.grp || '').trim();
  }

  hasLocationOption(id: number): boolean {
    return this.locations.some(l => l.id === id);
  }

  hasGroup(name: string): boolean {
    return this.groups().some(g => g.name.toLowerCase() === name.trim().toLowerCase());
  }

  onGroupChange(value: string) {
    this.groupChoice = value;
    if (value !== NEW_GROUP) this.newGroupName = '';
  }

  /** Port shown as placeholder when empty. */
  get defaultPort(): number { return this.form.useHttps ? 443 : 80; }

  close() {
    if (this.saving()) return;
    this.closed.emit();
  }

  private validate(): string | null {
    const f = this.form;
    if (!f.name.trim()) return 'Enter the machine name.';
    if (!f.locationId) return 'Pick the machine\'s location.';
    if (!f.host.trim()) return 'Enter the machine\'s IP address or host name.';
    if (/[\s/:]/.test(f.host.trim())) return 'Enter the IP address or host name only (no http:// and no port).';
    if ((f.host2 || '').trim() && /[\s/:]/.test((f.host2 || '').trim())) return 'Enter the failover IP address or host name only.';
    const port = this.portText.trim();
    if (port && (!/^\d+$/.test(port) || +port < 1 || +port > 65535)) return 'The port must be a number between 1 and 65535.';
    if (!f.username.trim()) return 'Enter the machine\'s username.';
    if (!this.isEdit && !f.password) return 'Enter the machine\'s password.';
    if (this.groupChoice === NEW_GROUP && !this.newGroupName.trim()) return 'Enter the new group name, or pick a group.';
    return null;
  }

  save() {
    if (this.saving()) return;
    const problem = this.validate();
    if (problem) { this.error.set(problem); return; }
    this.error.set(null);

    const f = this.form;
    const body: HikDeviceSaveRequest = {
      name: f.name.trim(),
      host: f.host.trim(),
      host2: (f.host2 || '').trim(),
      port: this.portText.trim() ? +this.portText.trim() : (this.isEdit ? this.defaultPort : null),
      useHttps: !!f.useHttps,
      username: f.username.trim(),
      // Edit: empty = keep the saved password.
      password: f.password || (this.isEdit ? null : ''),
      location: (f.location || '').trim(),
      grp: this.groupChoice === NEW_GROUP ? this.newGroupName.trim() : this.groupChoice,
      code: (f.code || '').trim(),
      locationId: f.locationId ? +f.locationId : null
    };

    this.saving.set(true);
    const call = this.isEdit ? this.hik.updateDevice(this.machineId!, body) : this.hik.addDevice(body);
    call.subscribe({
      next: res => {
        this.saving.set(false);
        this.saved.emit(res?.data?.device ?? null);
      },
      error: err => {
        this.saving.set(false);
        this.error.set(err?.error?.message || 'The machine could not be saved.');
      }
    });
  }

  /** Edit: connects to the saved machine now (save first to test changed settings). */
  testConnection() {
    if (!this.isEdit || this.testing()) return;
    this.testing.set(true);
    this.testResult.set(null);
    this.hik.testDevice(this.machineId!).subscribe({
      next: (res: any) => {
        this.testing.set(false);
        const r = res?.data;
        const extra = r?.online ? [r.model, r.serialNumber].filter(Boolean).join(' · ') : '';
        this.testResult.set({ online: !!r?.online, text: (res?.message || (r?.online ? 'Online.' : 'Offline.')) + (extra ? ` (${extra})` : '') });
      },
      error: (err: any) => {
        this.testing.set(false);
        this.testResult.set({ online: false, text: err?.error?.message || 'The machine could not be tested.' });
      }
    });
  }
}
