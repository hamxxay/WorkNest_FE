import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, catchError, filter, map, of, shareReplay } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { UnifiService } from '../../../../services/unifi.service';
import { AdminService } from '../../../../services/admin.service';
import { AuthService } from '../../../../services/auth.service';
import { GwnNetwork, GwnService } from '../../../../services/gwn.service';

/**
 * "I-8 · UniFi | F-7 · Grandstream" at the top of every Network page. Shows only the networks this user may see
 * (UniFi: api/unifi/scope; Grandstream: api/gwn/networks) and keeps the same kind of page when switching
 * (Clients -> Clients, Wi-Fi -> Wi-Fi; a device page goes to the device list; Internet goes to the overview).
 * Hidden when the user can see only the network they are on.
 */

interface SwitchOption { key: string; label: string; sub: string; kind: 'unifi' | 'gwn'; netId?: number }

// Read once per session (each Network page shows the switch).
let unifiAllowed$: Observable<boolean> | null = null;
let locationNames$: Observable<Map<number, string>> | null = null;

const UNIFI_DEFAULT = 'I-8';
const GWN_DEFAULTS: Record<number, string> = { 2: 'F-7' };

/** The same kind of page on the other network. */
export function counterpart(path: string, to: 'unifi' | 'gwn'): string {
  const p = path.split(/[?#]/)[0].replace(/\/+$/, '');
  const rest = p.startsWith('/admin/network/gwn') ? p.slice('/admin/network/gwn'.length) : p.slice('/admin/network'.length);
  const page = rest.startsWith('/clients') ? '/clients' : rest.startsWith('/device') ? '/devices' : rest.startsWith('/wifi') ? '/wifi' : '';
  return to === 'gwn' ? `/admin/network/gwn${page}` : `/admin/network${page}`;
}

@Component({
  selector: 'app-network-switch',
  standalone: true,
  template: `
    @if (show()) {
      <nav class="ns no-print" aria-label="Network location">
        <span class="ns-label">Location</span>
        <div class="ns-seg" role="tablist">
          @for (o of options(); track o.key) {
            <button type="button" role="tab" [attr.aria-selected]="o.key === activeKey()" [class.active]="o.key === activeKey()" (click)="go(o)">
              <span class="ns-dot" [class.gwn]="o.kind === 'gwn'"></span>
              <b>{{ o.label }}</b><span class="ns-sub"> · {{ o.sub }}</span>
            </button>
          }
        </div>
      </nav>
    }`,
  styles: [`
    :host { display: block; }
    .ns { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: -8px 0 18px; font-family: 'Inter', system-ui, sans-serif; }
    .ns-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; }
    .ns-seg { display: inline-flex; gap: 4px; background: #f1f5f9; border-radius: 10px; padding: 4px; max-width: 100%; flex-wrap: wrap; }
    .ns-seg button { display: inline-flex; align-items: center; gap: 6px; border: none; background: transparent; border-radius: 7px; padding: 7px 12px;
      font-size: 0.8rem; color: #475569; cursor: pointer; white-space: nowrap; font-family: inherit; }
    .ns-seg button b { font-weight: 700; }
    .ns-seg button:hover:not(.active) { color: #0f172a; }
    .ns-seg button.active { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1); }
    .ns-seg button:focus-visible { outline: 2px solid #0d9488; outline-offset: 1px; }
    .ns-sub { color: #64748b; font-weight: 500; }
    .ns-dot { width: 8px; height: 8px; border-radius: 50%; background: #6366f1; }
    .ns-dot.gwn { background: #0d9488; }
    @media (max-width: 760px) { .ns-seg button { min-height: 36px; } }`]
})
export class NetworkSwitch implements OnInit {
  private router = inject(Router);
  private unifi = inject(UnifiService);
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private gwn = inject(GwnService);

  private path = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });

  unifiOk = signal<boolean | null>(null);
  networks = signal<GwnNetwork[] | null>(null);
  names = signal<Map<number, string>>(new Map());

  onGwn = computed(() => this.path().split(/[?#]/)[0].startsWith('/admin/network/gwn'));

  options = computed<SwitchOption[]>(() => {
    const out: SwitchOption[] = [];
    const names = this.names();
    if (this.unifiOk()) out.push({ key: 'unifi', label: UNIFI_DEFAULT, sub: 'UniFi', kind: 'unifi' });
    for (const n of this.networks() || []) {
      const loc = (n.locationIds || []).map(id => GWN_DEFAULTS[id] || names.get(id)).filter(Boolean).join(', ');
      out.push({ key: `gwn-${n.id}`, label: loc || n.name, sub: 'Grandstream', kind: 'gwn', netId: n.id });
    }
    return out;
  });

  activeKey = computed(() => {
    if (!this.onGwn()) return 'unifi';
    const list = this.networks() || [];
    const id = this.gwn.net() ?? list[0]?.id;
    return `gwn-${id}`;
  });

  show = computed(() => {
    const o = this.options();
    if (this.unifiOk() === null || this.networks() === null) return false;
    return o.length > 1 || (o.length === 1 && o[0].key !== this.activeKey());
  });

  ngOnInit() {
    const superAdmin = this.auth.hasRole('super_admin');
    if (!unifiAllowed$) {
      unifiAllowed$ = superAdmin ? of(true) : this.unifi.getScope().pipe(map(s => !!s.allowed), catchError(() => of(true)), shareReplay(1));
    }
    unifiAllowed$.subscribe(ok => this.unifiOk.set(ok));
    this.gwn.getNetworks().subscribe({
      next: list => {
        this.networks.set(list);
        // A remembered network this user may no longer see falls back to the default one.
        const cur = this.gwn.net();
        if (cur && list.length && !list.some(n => n.id === cur)) this.gwn.setNet(null);
      },
      error: () => this.networks.set([])
    });
    if (!locationNames$) {
      locationNames$ = this.admin.getLocations(1, 1000).pipe(
        map((res: any) => {
          const raw = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : res?.data?.items ?? res?.items ?? [];
          return new Map<number, string>(raw.map((l: any) => [Number(l.id ?? l.Id), String(l.name ?? l.Name ?? '')] as [number, string]).filter(([id, n]: [number, string]) => id > 0 && !!n));
        }),
        catchError(() => of(new Map<number, string>())),
        shareReplay(1)
      );
    }
    locationNames$.subscribe(m => this.names.set(m));
  }

  go(o: SwitchOption) {
    if (o.key === this.activeKey()) return;
    if (o.kind === 'gwn') this.gwn.setNet(o.netId ?? null);
    // Another Grandstream network on the same page: the page reloads its data when GwnService.net changes.
    this.router.navigateByUrl(counterpart(this.path(), o.kind));
  }
}
