import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { UnifiService } from '../../../../services/unifi.service';
import { AdminService } from '../../../../services/admin.service';
import { ToastService } from '../../../../services/toast.service';
import { errMsg } from '../network-shared';

/**
 * "Location: I-8" chip on Network Overview. Super admins pick which WorkNest locations the UniFi network belongs
 * to; admins and sales executives of other locations then don't see the Network pages. Others just see the label.
 */
@Component({
  selector: 'app-network-location',
  standalone: true,
  template: `
    @if (scope(); as s) {
      <span class="loc-wrap">
        <button type="button" class="loc-chip" [disabled]="!s.canEdit" (click)="open.set(!open())"
          [title]="s.canEdit ? 'Choose the location this network belongs to' : 'Location of this network'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          {{ label() }}
          @if (s.canEdit) { <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg> }
        </button>
        @if (open()) {
          <div class="loc-backdrop" (click)="open.set(false)"></div>
          <div class="loc-menu" role="listbox" aria-multiselectable="true">
            <p class="loc-hint">This UniFi network belongs to:</p>
            @for (l of locations(); track l.id) {
              <label class="loc-option">
                <input type="checkbox" [checked]="picked().includes(l.id)" (change)="toggle(l.id)" />
                <span>{{ l.name }}</span>
              </label>
            }
            <p class="loc-hint small">Admins and sales executives of other locations won't see the Network pages. None ticked = every location.</p>
            <div class="loc-actions">
              <button type="button" class="btn-sm btn-outline" (click)="open.set(false)">Cancel</button>
              <button type="button" class="btn-sm btn-primary" (click)="save()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save' }}</button>
            </div>
          </div>
        }
      </span>
    }
  `,
  styles: [`
    .loc-wrap { position: relative; display: inline-flex; }
    .loc-chip { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #0f172a; font-weight: 600; font-size: 0.84rem; cursor: pointer; font-family: inherit; }
    .loc-chip:disabled { cursor: default; color: #475569; }
    .loc-chip:hover:not(:disabled) { border-color: #94a3b8; }
    .loc-backdrop { position: fixed; inset: 0; z-index: 40; }
    .loc-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 41; width: 270px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.15); padding: 12px; }
    .loc-hint { margin: 0 0 8px; font-size: 0.76rem; font-weight: 600; color: #475569; }
    .loc-hint.small { margin: 8px 0 0; font-weight: 400; color: #94a3b8; line-height: 1.4; }
    .loc-option { display: flex; align-items: center; gap: 8px; padding: 7px 4px; font-size: 0.86rem; color: #0f172a; cursor: pointer; border-radius: 8px; }
    .loc-option:hover { background: #f8fafc; }
    .loc-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    .btn-sm { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 8px; font-size: 0.76rem; font-weight: 600; cursor: pointer; font-family: inherit; }
    .btn-outline { border: 1px solid #e2e8f0; background: #fff; color: #334155; }
    .btn-primary { border: 1px solid #0d9488; background: #0d9488; color: #fff; }
    .btn-sm:disabled { opacity: .6; }
  `]
})
export class NetworkLocation implements OnInit {
  private unifi = inject(UnifiService);
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  scope = signal<{ locationIds: number[]; canEdit: boolean } | null>(null);
  locations = signal<{ id: number; name: string }[]>([]);
  picked = signal<number[]>([]);
  open = signal(false);
  saving = signal(false);

  label = computed(() => {
    const ids = this.scope()?.locationIds ?? [];
    if (!ids.length) return 'All locations';
    const names = ids.map(id => this.locations().find(l => l.id === id)?.name).filter(Boolean);
    return names.length ? names.join(', ') : `${ids.length} location${ids.length === 1 ? '' : 's'}`;
  });

  ngOnInit() {
    this.unifi.getScope().subscribe({
      next: s => { this.scope.set(s); this.picked.set([...s.locationIds]); },
      error: () => { /* chip stays hidden */ }
    });
    this.admin.getLocations(1, 1000).subscribe({
      next: (res: any) => {
        const raw = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : res?.data?.items ?? res?.items ?? [];
        this.locations.set(raw.map((l: any) => ({ id: Number(l.id ?? l.Id), name: String(l.name ?? l.Name ?? '') })).filter((l: any) => l.id > 0));
      },
      error: () => { /* names fall back to a count */ }
    });
  }

  toggle(id: number) {
    const cur = this.picked();
    this.picked.set(cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  }

  save() {
    this.saving.set(true);
    this.unifi.setScope(this.picked()).subscribe({
      next: s => { this.scope.set(s); this.saving.set(false); this.open.set(false); this.toast.success(`Network location saved: ${this.label()}.`); },
      error: err => { this.saving.set(false); this.toast.error(errMsg(err, 'The location could not be saved.')); }
    });
  }
}
