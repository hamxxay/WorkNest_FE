import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UnifiService } from '../../../../services/unifi.service';
import { ToastService } from '../../../../services/toast.service';
import { AuthService } from '../../../../services/auth.service';
import { AdminService } from '../../../../services/admin.service';
import { UnifiClient, UnifiMacFilterLogEntry, UnifiSpeedProfile, UnifiSsid, UnifiSsidLogAction } from '../../../../models/unifi.model';
import { NET_SHARED, ago, errMsg, fmt } from '../network-shared';

type Tab = 'clients' | 'filter' | 'history';
type Policy = 'off' | 'allow' | 'deny';

/** A change waiting for the user to confirm (with an optional reason). */
interface Pending {
  action: UnifiSsidLogAction;
  mac?: string;
  name?: string;
  roomNo?: string;
  policy?: Policy;
  profileId?: string | null;
  title: string;
  text: string;
  danger: boolean;
}

/**
 * Wi-Fi SSIDs: which networks are broadcasting, who is on each, and a per-SSID MAC filter.
 * Each SSID's filter is off, an allow-list (only listed devices may join) or a block-list (listed devices
 * can't join); MACs can be typed in by hand. Every change is logged with who made it and why.
 */
@Component({
  selector: 'app-network-ssids',
  standalone: true,
  imports: [FormsModule, ...NET_SHARED],
  templateUrl: './network-ssids.html',
  styleUrls: ['../network-shared.css', './network-ssids.css']
})
export class NetworkSsids implements OnInit, OnDestroy {
  private unifi = inject(UnifiService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);

  /** Speed limits are set by super admins only (the API enforces it too). */
  readonly canLimitSpeed = this.auth.hasRole('super_admin');
  private admin = inject(AdminService);

  /** UniFi speed profiles; the SSID's limit is chosen from these (or "No limit"). */
  profiles = signal<UnifiSpeedProfile[]>([]);
  newProfileOpen = signal(false);
  profileName = signal('');
  profileDown = signal<string>('');
  profileUp = signal<string>('');
  creatingProfile = signal(false);

  /** Rooms for the device list: spaces of the network's location(s) (WN_Spaces), grouped by type. */
  rooms = signal<{ type: string; names: string[] }[]>([]);
  private timer?: ReturnType<typeof setInterval>;

  readonly fmt = fmt;
  readonly ago = ago;

  ssids = signal<UnifiSsid[]>([]);
  activeCount = signal(0);
  wifiClients = signal(0);
  loading = signal(true);
  error = signal<string | null>(null);

  selectedId = signal<string | null>(null);
  tab = signal<Tab>('clients');
  search = signal('');

  newMac = signal('');
  newName = signal('');
  newRoom = signal('');
  pending = signal<Pending | null>(null);
  reason = signal('');
  saving = signal(false);

  log = signal<UnifiMacFilterLogEntry[]>([]);
  logLoading = signal(false);

  selected = computed(() => this.ssids().find(s => s.id === this.selectedId()) ?? null);

  /** The device list only exists while the SSID filters devices; on a normal SSID its tab falls back to Connected. */
  shownTab = computed<Tab>(() => (this.tab() === 'filter' && this.selected()?.filterPolicy === 'off' ? 'clients' : this.tab()));

  /** Name of each MAC we know (from the clients connected to any SSID), for the filter list. */
  private knownNames = computed(() => {
    const map = new Map<string, string>();
    for (const s of this.ssids()) for (const c of s.clients) map.set(this.colon(c.mac), c.name);
    return map;
  });

  clients = computed<UnifiClient[]>(() => {
    const s = this.selected();
    if (!s) return [];
    const q = this.search().trim().toLowerCase();
    return s.clients
      .filter(c => !q || [c.name, c.macDisplay, c.ip, c.hostname, c.uplinkName].some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  ngOnInit() {
    this.load();
    this.loadProfiles();
    this.loadRooms();
    this.timer = setInterval(() => this.load(true), 60000);
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }

  load(silent = false) {
    if (!silent) this.loading.set(true);
    this.unifi.getSsids().subscribe({
      next: res => {
        this.ssids.set(res.ssids);
        this.activeCount.set(res.activeCount);
        this.wifiClients.set(res.wifiClients);
        if (!this.selectedId() || !res.ssids.some(s => s.id === this.selectedId()))
          this.selectedId.set(res.ssids.find(s => s.enabled)?.id ?? res.ssids[0]?.id ?? null);
        this.error.set(null);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        if (!silent || !this.ssids().length) this.error.set(`Couldn't load the SSIDs: ${errMsg(err)}`);
      }
    });
  }

  select(id: string) {
    this.selectedId.set(id);
    this.newProfileOpen.set(false);
    this.search.set('');
    if (this.tab() === 'history') this.loadLog();
  }
  setTab(t: Tab) {
    this.tab.set(t);
    if (t === 'history') this.loadLog();
  }

  loadLog() {
    const id = this.selectedId();
    if (!id) return;
    this.logLoading.set(true);
    this.unifi.getMacFilterLog(id).subscribe({
      next: r => { this.log.set(r.entries); this.logLoading.set(false); },
      error: () => { this.log.set([]); this.logLoading.set(false); }
    });
  }

  // ---------- labels ----------
  colon(mac: string): string {
    const m = (mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    return m.length === 12 ? m.match(/../g)!.join(':') : (mac || '').toLowerCase();
  }
  /** Name entered for this MAC on the selected SSID, else the name of the device if it is connected somewhere. */
  nameOf(mac: string): string {
    const c = this.colon(mac);
    return this.detailOf(c)?.name || this.knownNames().get(c) || '';
  }
  roomOf(mac: string): string { return this.detailOf(this.colon(mac))?.roomNo || ''; }
  private detailOf(mac: string) { return this.selected()?.devices?.find(d => d.mac === mac); }
  policyLabel(p: Policy): string { return p === 'allow' ? 'Allowed devices only' : p === 'deny' ? 'Block listed devices' : 'Normal'; }
  securityLabel(s: string): string {
    const map: Record<string, string> = { wpapsk: 'WPA2/WPA3 Personal', wpaeap: 'WPA Enterprise', open: 'Open', osen: 'OSEN' };
    return map[(s || '').toLowerCase()] ?? (s || '—');
  }
  actionLabel(a: string): string {
    const map: Record<string, string> = { add: 'Added to list', remove: 'Removed from list', block: 'Blocked', unblock: 'Unblocked', mode: 'Access changed', hide: 'Name hidden', unhide: 'Name shown', speed: 'Speed limit changed' };
    return map[a] ?? a;
  }
  /** True when this device may not join the SSID under its current filter. */
  isBlocked(s: UnifiSsid, mac: string): boolean {
    if (s.filterPolicy === 'off') return false;
    const listed = s.macList.includes(this.colon(mac));
    return s.filterPolicy === 'deny' ? listed : !listed;
  }
  validMac(v: string): boolean { return (v || '').toLowerCase().replace(/[^0-9a-f]/g, '').length === 12; }

  // ---------- actions (all confirmed first) ----------
  askBlock(c: UnifiClient) {
    const s = this.selected()!;
    this.ask({
      action: 'block', mac: c.mac, name: c.name, danger: true,
      title: `Block ${c.name} from “${s.name}”?`,
      text: s.filterPolicy === 'off'
        ? `This turns on a block-list for “${s.name}” with this device on it. It is disconnected now and can't rejoin this SSID; other SSIDs are not affected.`
        : s.filterPolicy === 'allow'
          ? `This removes the device from the “${s.name}” allow-list. It is disconnected now and can't rejoin this SSID.`
          : `This adds the device to the “${s.name}” block-list. It is disconnected now and can't rejoin this SSID.`
    });
  }
  askUnblock(mac: string) {
    const s = this.selected()!;
    this.ask({ action: 'unblock', mac, danger: false, title: `Let ${this.nameOf(mac) || this.colon(mac)} join “${s.name}” again?`, text: 'The device can connect to this SSID again.' });
  }
  askAdd() {
    const s = this.selected()!;
    const mac = this.newMac().trim();
    const name = this.newName().trim();
    if (!this.validMac(mac)) { this.toast.error('Enter a valid MAC address, e.g. aa:bb:cc:dd:ee:ff.'); return; }
    if (!name) { this.toast.error('Enter a name for the device, e.g. the person or the printer it belongs to.'); return; }
    if (s.macList.includes(this.colon(mac))) { this.toast.error('This MAC is already in the list.'); return; }
    const listWord = s.filterPolicy === 'allow' ? 'allowed devices' : s.filterPolicy === 'deny' ? 'blocked devices' : 'device list';
    this.ask({
      action: 'add', mac, name, roomNo: this.newRoom().trim() || undefined, danger: s.filterPolicy === 'deny',
      title: `Add ${name} (${this.colon(mac)}) to the ${listWord}?`,
      text: s.filterPolicy === 'off'
        ? `“${s.name}” is normal Wi-Fi, so the list takes effect once you set Access to “Allowed devices only” (only listed devices can join) or “Block listed devices”.`
        : s.filterPolicy === 'allow' ? `This device will be allowed to join “${s.name}”.` : `This device will be kept off “${s.name}”.`
    });
  }
  askRemove(mac: string) {
    const s = this.selected()!;
    this.ask({
      action: 'remove', mac, danger: s.filterPolicy === 'allow',
      title: `Remove ${this.nameOf(mac) || this.colon(mac)} from the list?`,
      text: s.filterPolicy === 'allow' ? `This device will no longer be allowed on “${s.name}” and is disconnected if it is on it now.`
        : s.filterPolicy === 'deny' ? `This device will be able to join “${s.name}” again.` : 'The filter is off, so this changes nothing until a mode is turned on.'
    });
  }
  askMode(p: Policy) {
    const s = this.selected()!;
    if (p === s.filterPolicy) return;
    const onNow = s.clients.filter(c => p === 'allow' ? !s.macList.includes(this.colon(c.mac)) : p === 'deny' && s.macList.includes(this.colon(c.mac))).length;
    this.ask({
      action: 'mode', policy: p, danger: p !== 'off',
      title: p === 'off' ? `Make “${s.name}” normal Wi-Fi?` : p === 'allow' ? `Allow only listed devices on “${s.name}”?` : `Block the listed devices on “${s.name}”?`,
      text: p === 'off' ? 'Every device with the password can join this SSID. The list is kept for later.'
        : p === 'allow'
          ? (s.macList.length
            ? `Only the ${s.macList.length} listed device(s) can join. ${onNow ? `${onNow} device(s) connected now are not on the list and will be dropped when the access points apply the change.` : ''}`
            : `The device list is empty, so NO device can join “${s.name}” until you add one in the Device list.${onNow ? ` The ${onNow} device(s) connected now will be dropped.` : ''}`)
          : `The ${s.macList.length} listed device(s) can't join. ${onNow ? `${onNow} of them are connected now.` : ''}`
    });
  }

  askHidden(hidden: boolean) {
    const s = this.selected()!;
    if (hidden === s.hidden) return;
    this.ask({
      action: hidden ? 'hide' : 'unhide', danger: false,
      title: hidden ? `Hide the name “${s.name}”?` : `Show the name “${s.name}”?`,
      text: hidden
        ? 'The SSID stops appearing in the Wi-Fi list. Devices that already joined it keep connecting automatically; a new device has to type the name by hand.'
        : 'The SSID appears in the Wi-Fi list of nearby devices again.'
    });
  }

  /** The device-list tab is named after what the list does on this SSID. */
  listTabLabel(s: UnifiSsid): string {
    return s.filterPolicy === 'allow' ? 'Allowed devices' : s.filterPolicy === 'deny' ? 'Blocked devices' : 'Device list';
  }

  profileLabel(p: UnifiSpeedProfile): string {
    return `${p.name} (↓ ${p.downMbps ?? '∞'} / ↑ ${p.upMbps ?? '∞'} Mbps)`;
  }
  speedText(s: UnifiSsid): string {
    const l = s.speedLimit;
    if (!l || (l.downMbps == null && l.upMbps == null)) return 'No limit';
    return `↓ ${l.downMbps ?? '∞'} / ↑ ${l.upMbps ?? '∞'} Mbps`;
  }

  loadProfiles() {
    this.unifi.getSpeedProfiles().subscribe({ next: r => this.profiles.set(r.profiles), error: () => { /* dropdown keeps the last list */ } });
  }

  /** Dropdown change: "" = no limit, "__new" = open the new-profile form, else a profile id. */
  pickProfile(value: string, el: HTMLSelectElement) {
    const s = this.selected()!;
    const current = s.speedProfile?.id ?? '';
    if (value === '__new') { el.value = current; this.newProfileOpen.set(true); return; }
    if (value === current) return;
    el.value = current; // stays on the current profile until confirmed
    this.askProfile(value || null);
  }

  private askProfile(profileId: string | null) {
    const s = this.selected()!;
    const p = this.profiles().find(x => x.id === profileId);
    this.ask({
      action: 'speed', profileId, danger: false,
      title: p ? `Use “${p.name}” on “${s.name}”?` : `Remove the speed limit on “${s.name}”?`,
      text: p
        ? `Every device on “${s.name}” is capped at ${p.downMbps ?? 'unlimited'} Mbps download and ${p.upMbps ?? 'unlimited'} Mbps upload. The limit is per device, so several busy devices together can use more.`
        : 'Devices on this SSID can use the full internet speed again.'
    });
  }

  private mbps(v: string): number | null | undefined {
    const t = (v ?? '').toString().trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : undefined;
  }

  createProfile() {
    const name = this.profileName().trim();
    const down = this.mbps(this.profileDown());
    const up = this.mbps(this.profileUp());
    if (!name) { this.toast.error('Give the profile a name, e.g. “100 Mbps”.'); return; }
    if (down === undefined || up === undefined) { this.toast.error('Enter whole Mbps between 1 and 10,000.'); return; }
    if (down == null && up == null) { this.toast.error('Enter a download and/or upload speed.'); return; }
    this.creatingProfile.set(true);
    this.unifi.createSpeedProfile(name, down, up).subscribe({
      next: p => {
        this.creatingProfile.set(false);
        this.newProfileOpen.set(false);
        this.profileName.set(''); this.profileDown.set(''); this.profileUp.set('');
        this.profiles.update(list => [...list, p].sort((a, b) => a.name.localeCompare(b.name)));
        this.toast.success(`Profile “${p.name}” created.`);
        this.askProfile(p.id); // offer to use it on this SSID straight away
      },
      error: err => { this.creatingProfile.set(false); this.toast.error(errMsg(err, 'The profile could not be created.')); }
    });
  }

  private loadRooms() {
    this.unifi.getScope().subscribe({
      next: scope => this.admin.getSpaces(1, 2000).subscribe({
        next: (res: any) => {
          const raw: any[] = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : res?.data?.items ?? res?.items ?? [];
          const spaces = raw
            .filter(x => !scope.locationIds.length || scope.locationIds.includes(Number(x.locationId ?? x.LocationId)))
            .map(x => ({ name: String(x.name ?? x.Name ?? '').trim(), type: String(x.spaceTypeName ?? x.SpaceTypeName ?? 'Other') || 'Other' }))
            .filter(x => x.name);
          const byType = new Map<string, string[]>();
          for (const x of spaces) byType.set(x.type, [...(byType.get(x.type) ?? []), x.name]);
          const num = (n: string) => Number((n.match(/\d+/) ?? ['0'])[0]);
          this.rooms.set([...byType].map(([type, names]) => ({ type, names: [...new Set(names)].sort((a, b) => num(a) - num(b) || a.localeCompare(b)) }))
            .sort((a, b) => a.type.localeCompare(b.type)));
        },
        error: () => { /* the room stays optional */ }
      }),
      error: () => { /* the room stays optional */ }
    });
  }

  private ask(p: Pending, resetReason = true) {
    if (resetReason) this.reason.set('');
    this.pending.set(p);
  }
  cancel() { if (!this.saving()) this.pending.set(null); }

  confirm() {
    const p = this.pending();
    const s = this.selected();
    if (!p || !s) return;
    this.saving.set(true);
    const reason = this.reason().trim() || undefined;
    const call = p.action === 'speed'
      ? this.unifi.setSpeedProfile(s.id, p.profileId ?? null, reason)
      : p.action === 'hide' || p.action === 'unhide'
      ? this.unifi.setSsidVisibility(s.id, p.action === 'hide', reason)
      : this.unifi.updateMacFilter(s.id, { action: p.action, mac: p.mac, name: p.name, roomNo: p.roomNo, policy: p.policy, reason });
    call.subscribe({
      next: updated => {
        this.ssids.update(list => list.map(x => (x.id === updated.id && updated.name ? updated : x)));
        this.saving.set(false);
        this.pending.set(null);
        if (p.action === 'add') { this.newMac.set(''); this.newName.set(''); this.newRoom.set(''); }
        if (p.action === 'speed') this.loadProfiles();
        // After switching to "Allowed devices only", go straight to the list where devices are added.
        if (p.action === 'mode' && p.policy === 'allow') this.tab.set('filter');
        this.toast.success(this.actionLabel(p.action) + '.', s.name);
        if (this.tab() === 'history') this.loadLog();
        setTimeout(() => this.load(true), 4000); // the console takes a moment to show the change on clients
      },
      error: err => { this.saving.set(false); this.toast.error(errMsg(err, 'The change could not be saved.')); }
    });
  }
}
