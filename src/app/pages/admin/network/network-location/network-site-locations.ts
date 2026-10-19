import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { UnifiService } from '../../../../services/unifi.service';
import { AdminService } from '../../../../services/admin.service';
import { ToastService } from '../../../../services/toast.service';
import { UnifiSiteLocation, UnifiSiteLocations } from '../../../../models/unifi.model';
import { errMsg } from '../network-shared';

/**
 * "Sites and locations" on Network Overview (shown when the network has more than one UniFi site): which WorkNest
 * location each site serves. The CEO and Sales Manager dashboards show a site's network under these locations (a Sales
 * Manager only the sites of their locations). A site without its own choice uses the network-wide location chip.
 * Super admins change it; everyone else reads it. Data: GET / PUT api/unifi/site-locations (database update NET_01).
 */
@Component({
  selector: 'app-network-site-locations',
  standalone: true,
  template: `
    @if (state(); as s) {
      @if (!s.available) {
        <p class="sl-note" role="status">Every site uses the network's location for now. {{ s.message }}</p>
      }
      <ul class="sl-list">
        @for (site of s.sites; track site.id) {
          <li>
            <div class="sl-row">
              <span class="sl-site">{{ site.name }}</span>
              <span class="sl-serves">
                {{ serves(site) }}
                @if (site.source === 'network') { <small>network setting</small> }
              </span>
              @if (s.canEdit && s.available) {
                <button type="button" class="btn-sm btn-outline" (click)="edit(site)" [attr.aria-expanded]="editing() === site.id"
                  [attr.aria-label]="'Change the location of ' + site.name">Change</button>
              }
            </div>
            @if (editing() === site.id) {
              <div class="sl-editor" role="group" [attr.aria-label]="'Locations served by ' + site.name">
                @for (l of locations(); track l.id) {
                  <label class="sl-option">
                    <input type="checkbox" [checked]="picked().includes(l.id)" (change)="toggle(l.id)" />
                    <span>{{ l.name }}</span>
                  </label>
                }
                <p class="sl-hint">None ticked = the network's location ({{ networkLabel() }}).</p>
                <div class="sl-actions">
                  <button type="button" class="btn-sm btn-outline" (click)="editing.set(null)">Cancel</button>
                  <button type="button" class="btn-sm btn-primary" (click)="save(site)" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save' }}</button>
                </div>
              </div>
            }
          </li>
        }
      </ul>
    } @else if (failed()) {
      <p class="sl-note">The site locations could not be read right now.</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .sl-note { margin: 0 0 10px; font-size: 0.8rem; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 8px 12px; }
    .sl-list { list-style: none; margin: 0; padding: 0; }
    .sl-list li { border-bottom: 1px solid #f1f5f9; }
    .sl-list li:last-child { border-bottom: none; }
    .sl-row { display: flex; align-items: center; gap: 12px; padding: 10px 2px; flex-wrap: wrap; }
    .sl-site { font-weight: 600; font-size: 0.86rem; color: #0f172a; min-width: 160px; }
    .sl-serves { flex: 1; min-width: 0; font-size: 0.84rem; color: #334155; }
    .sl-serves small { margin-left: 6px; font-size: 0.72rem; color: #94a3b8; }
    .sl-editor { margin: 0 2px 12px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; max-width: 360px; }
    .sl-option { display: flex; align-items: center; gap: 8px; padding: 6px 4px; font-size: 0.86rem; color: #0f172a; cursor: pointer; border-radius: 8px; }
    .sl-option:hover { background: #fff; }
    .sl-hint { margin: 8px 0 0; font-size: 0.76rem; color: #94a3b8; }
    .sl-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .btn-sm { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 8px; font-size: 0.76rem; font-weight: 600; cursor: pointer; font-family: inherit; }
    .btn-outline { border: 1px solid #e2e8f0; background: #fff; color: #334155; }
    .btn-outline:hover { border-color: #94a3b8; }
    .btn-primary { border: 1px solid #0d9488; background: #0d9488; color: #fff; }
    .btn-sm:disabled { opacity: .6; }
    .btn-sm:focus-visible, .sl-option input:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
    @media (max-width: 640px) { .btn-sm { height: 40px; } .sl-site { min-width: 0; flex-basis: 100%; } }
  `]
})
export class NetworkSiteLocations implements OnInit {
  private unifi = inject(UnifiService);
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  state = signal<UnifiSiteLocations | null>(null);
  failed = signal(false);
  locations = signal<{ id: number; name: string }[]>([]);
  editing = signal<string | null>(null);
  picked = signal<number[]>([]);
  saving = signal(false);

  private nameOf = computed(() => new Map(this.locations().map(l => [l.id, l.name])));

  networkLabel = computed(() => {
    const ids = this.state()?.networkLocationIds ?? [];
    return ids.length ? this.names(ids) : 'every location';
  });

  ngOnInit() {
    this.unifi.getSiteLocations().subscribe({
      next: s => this.state.set(s),
      error: () => this.failed.set(true)
    });
    this.admin.getLocations(1, 1000).subscribe({
      next: (res: any) => {
        const raw = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : res?.data?.items ?? res?.items ?? [];
        this.locations.set(raw.map((l: any) => ({ id: Number(l.id ?? l.Id), name: String(l.name ?? l.Name ?? '') })).filter((l: any) => l.id > 0));
      },
      error: () => { /* names fall back to "location 2" */ }
    });
  }

  private names(ids: number[]): string {
    return ids.map(id => this.nameOf().get(id) ?? `location ${id}`).join(', ');
  }

  serves(site: UnifiSiteLocation): string {
    return site.everyLocation || !site.locationIds.length ? 'Every location' : this.names(site.locationIds);
  }

  edit(site: UnifiSiteLocation) {
    if (this.editing() === site.id) { this.editing.set(null); return; }
    this.picked.set(site.source === 'site' ? [...site.locationIds] : []);
    this.editing.set(site.id);
  }

  toggle(id: number) {
    const cur = this.picked();
    this.picked.set(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  }

  save(site: UnifiSiteLocation) {
    this.saving.set(true);
    this.unifi.setSiteLocations(site.id, this.picked()).subscribe({
      next: s => {
        this.state.set(s);
        this.saving.set(false);
        this.editing.set(null);
        const now = s.sites.find(x => x.id === site.id);
        this.toast.success(now ? `Saved: ${site.name} serves ${this.serves(now)}.` : 'Saved.');
      },
      error: err => { this.saving.set(false); this.toast.error(errMsg(err, 'The site location could not be saved.')); }
    });
  }
}
