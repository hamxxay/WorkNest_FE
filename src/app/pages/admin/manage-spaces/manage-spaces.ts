import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';

@Component({
  selector: 'app-manage-spaces',
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-spaces.html',
  styleUrl: './manage-spaces.css'
})
export class ManageSpaces implements OnInit {
  private admin = inject(AdminService);

  // Filters
  filterLocationId = '';
  filterSpaceTypeId = '';

  locationOptions:  { v: number; l: string; branchId?: number }[] = [];
  spaceTypeOptions: { v: number; l: string }[] = [];

  // Config for selected filters
  configs = signal<any[]>([]);
  selectedConfig = signal<any>(null);

  // Space status for selected config
  spaces = signal<any[]>([]);
  spacesLoading = signal(false);

  // Selection for delete
  selectedGuids = new Set<string>();

  // Operation state
  generating = signal(false);
  deleting   = signal(false);
  error   = '';
  success = '';

  // Blocked spaces from last delete attempt
  blockedSpaces: any[] = [];

  ngOnInit() {
    this.admin.getLocations(1, 1000, '').subscribe({
      next: (res: any) => {
        this.locationOptions = (res?.data ?? []).map((l: any) => ({
          v: l.id, l: l.name, branchId: l.branchId
        }));
      }
    });
    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        this.spaceTypeOptions = (res?.data ?? []).map((s: any) => ({ v: s.id, l: s.name }));
      }
    });
  }

  onFilterChange() {
    this.selectedConfig.set(null);
    this.spaces.set([]);
    this.selectedGuids.clear();
    this.error = '';
    this.success = '';
    this.blockedSpaces = [];

    if (!this.filterLocationId) return;

    const locId = +this.filterLocationId;
    const stId  = this.filterSpaceTypeId ? +this.filterSpaceTypeId : undefined;

    this.admin.getSpaceConfigsV2(undefined, undefined, locId).subscribe({
      next: (res: any) => {
        let cfgs: any[] = res?.data ?? [];
        if (stId) cfgs = cfgs.filter((c: any) => c.spaceTypeId === stId);
        this.configs.set(cfgs);
        if (cfgs.length === 1) this.selectConfig(cfgs[0]);
      }
    });
  }

  selectConfig(cfg: any) {
    this.selectedConfig.set(cfg);
    this.selectedGuids.clear();
    this.blockedSpaces = [];
    this.loadSpaces(cfg.id);
  }

  private loadSpaces(configId: number) {
    this.spacesLoading.set(true);
    this.admin.getSpaceStatusForConfig(configId).subscribe({
      next: (res: any) => {
        this.spaces.set(res?.data ?? []);
        this.spacesLoading.set(false);
      },
      error: () => this.spacesLoading.set(false)
    });
  }

  get existingCount(): number { return this.spaces().filter(s => s.status === 1).length; }
  get configuredCount(): number { return this.selectedConfig()?.totalSpaces ?? 0; }
  get missingCount(): number { return Math.max(0, this.configuredCount - this.existingCount); }

  generateSpaces() {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    this.generating.set(true);
    this.error = '';
    this.success = '';
    this.admin.generateSpacesFromConfig(cfg.id).subscribe({
      next: (res: any) => {
        this.generating.set(false);
        const d = res?.data ?? {};
        this.success = `Generated ${d.created ?? 0} space(s). ${d.skipped ?? 0} already existed.`;
        setTimeout(() => this.success = '', 5000);
        this.loadSpaces(cfg.id);
      },
      error: (e: any) => {
        this.generating.set(false);
        this.error = e?.error?.message ?? 'Failed to generate spaces.';
      }
    });
  }

  toggleSelect(guid: string) {
    if (this.selectedGuids.has(guid)) this.selectedGuids.delete(guid);
    else this.selectedGuids.add(guid);
  }

  isSelected(guid: string) { return this.selectedGuids.has(guid); }

  toggleSelectAll() {
    const deletable = this.spaces().filter(s => !s.hasBookings);
    if (this.selectedGuids.size === deletable.length) {
      this.selectedGuids.clear();
    } else {
      deletable.forEach(s => this.selectedGuids.add(s.idGuid));
    }
  }

  get allDeletableSelected(): boolean {
    const deletable = this.spaces().filter(s => !s.hasBookings);
    return deletable.length > 0 && this.selectedGuids.size === deletable.length;
  }

  deleteSelected() {
    if (!this.selectedGuids.size) { this.error = 'No spaces selected.'; return; }
    if (!confirm(`Delete ${this.selectedGuids.size} selected space(s)?`)) return;
    this.doDelete(Array.from(this.selectedGuids).join(','));
  }

  deleteAll() {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    if (!confirm(`Delete ALL spaces for "${cfg.spaceCategory}" at ${cfg.locationName}? Spaces with bookings will be skipped.`)) return;
    this.doDelete(null);
  }

  private doDelete(guids: string | null) {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    this.deleting.set(true);
    this.error = '';
    this.success = '';
    this.blockedSpaces = [];
    this.admin.deleteSpacesFromConfig(cfg.id, guids ?? undefined).subscribe({
      next: (res: any) => {
        this.deleting.set(false);
        const blocked: any[] = res?.data?.blocked ?? [];
        this.blockedSpaces = blocked;
        if (blocked.length) {
          this.error = `${blocked.length} space(s) could not be deleted — they have active bookings.`;
        } else {
          this.success = 'Spaces deleted successfully.';
          setTimeout(() => this.success = '', 4000);
        }
        this.selectedGuids.clear();
        this.loadSpaces(cfg.id);
      },
      error: (e: any) => {
        this.deleting.set(false);
        this.error = e?.error?.message ?? 'Failed to delete spaces.';
      }
    });
  }
}
