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
  filterCapacity = '';

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

  allSpacesList: any[] = [];
  spaceTypesList: any[] = [];

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
        const rawTypes = res?.data ?? [];
        this.spaceTypesList = rawTypes;
        this.spaceTypeOptions = rawTypes.map((s: any) => ({
          v: s.id,
          l: s.description || s.displayName || s.label || s.typeName || s.name?.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim() || '',
          capacity: s.capacity
        }));
      }
    });
    this.loadAllSpaces();
    this.onFilterChange();
  }

  private loadAllSpaces() {
    this.admin.getSpaces(1, 1000, '').subscribe({
      next: (res: any) => {
        this.allSpacesList = res?.data ?? (Array.isArray(res) ? res : []);
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

    const locId = this.filterLocationId ? +this.filterLocationId : undefined;
    const stId  = this.filterSpaceTypeId ? +this.filterSpaceTypeId : undefined;
    const cap   = this.filterCapacity ? this.filterCapacity.trim().toLowerCase() : undefined;

    this.admin.getSpaceConfigsV2(undefined, undefined, locId).subscribe({
      next: (res: any) => {
        let cfgs: any[] = res?.data ?? [];
        if (cfgs.length) {
          if (stId) cfgs = cfgs.filter((c: any) => c.spaceTypeId === stId);
          if (cap)  cfgs = cfgs.filter((c: any) => String(c.defaultCapacities || c.capacity || '').toLowerCase().includes(cap));
          this.configs.set(cfgs);
          if (cfgs.length === 1) this.selectConfig(cfgs[0]);
        } else {
          // Fall back to legacy endpoint
          this.admin.getSpaceConfig().subscribe({
            next: (r: any) => {
              let legacy: any[] = (r?.data ?? []).map((c: any, i: number) => ({ ...c, id: c.id ?? i + 1 }));
              if (stId) legacy = legacy.filter((c: any) => c.spaceTypeId === stId);
              if (cap)  legacy = legacy.filter((c: any) => String(c.defaultCapacities || c.capacity || '').toLowerCase().includes(cap));
              this.configs.set(legacy);
              if (legacy.length === 1) this.selectConfig(legacy[0]);
            }
          });
        }
      }
    });
  }

  get displayedSpaces(): any[] {
    const list = this.spaces();
    if (!this.filterCapacity.trim()) return list;
    const cap = this.filterCapacity.trim().toLowerCase();
    return list.filter(s =>
      String(s.capacity || this.selectedConfig()?.defaultCapacities || this.selectedConfig()?.capacity || '').toLowerCase().includes(cap)
    );
  }

  selectConfig(cfg: any) {
    this.selectedConfig.set(cfg);
    this.selectedGuids.clear();
    this.blockedSpaces = [];
    this.loadSpaces(cfg.id);
  }

  private loadSpaces(configId: number) {
    this.spacesLoading.set(true);
    const cfg = this.selectedConfig();
    const typeMatch = this.spaceTypesList.find((t: any) => t.id === cfg?.spaceTypeId);
    const fallbackCapacity = cfg?.defaultCapacities || cfg?.capacity || typeMatch?.capacity || '—';
    this.admin.getSpaceStatusForConfig(configId).subscribe({
      next: (res: any) => {
        const rawSpaces = res?.data ?? [];
        const enriched = rawSpaces.map((s: any) => {
          const match = this.allSpacesList.find((sp: any) =>
            (sp.id && sp.id === s.id) ||
            (sp.code && String(sp.code) === String(s.code)) ||
            (sp.idGuid && sp.idGuid === s.idGuid)
          );
          return {
            ...s,
            capacity: match?.capacity ?? s.capacity ?? s.defaultCapacities ?? fallbackCapacity
          };
        });
        this.spaces.set(enriched);
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
    const list = this.displayedSpaces;
    if (this.selectedGuids.size === list.length) {
      this.selectedGuids.clear();
    } else {
      list.forEach(s => {
        const idKey = s.idGuid || s.publicId || s.id?.toString();
        if (idKey) this.selectedGuids.add(idKey);
      });
    }
  }

  get allDeletableSelected(): boolean {
    const list = this.displayedSpaces;
    return list.length > 0 && this.selectedGuids.size === list.length;
  }

  deleteSelected() {
    if (!this.selectedGuids.size) { this.error = 'No spaces selected.'; return; }
    if (!confirm(`Delete ${this.selectedGuids.size} selected space(s)?`)) return;
    this.doDelete(Array.from(this.selectedGuids).join(','));
  }

  deleteAll() {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    if (!confirm(`Delete ALL spaces for "${cfg.spaceCategory}" at ${cfg.locationName}? Spaces with active bookings will be skipped.`)) return;
    this.doDelete(null);
  }

  deleteSingleSpace(space: any) {
    if (!confirm(`Delete space "${space.name || space.code}" (${space.code})?`)) return;
    const id = space.idGuid || space.publicId || space.id;
    this.admin.deleteSpace(id).subscribe({
      next: () => {
        this.success = `Space "${space.code}" deleted successfully.`;
        setTimeout(() => this.success = '', 3000);
        if (this.selectedConfig()) this.loadSpaces(this.selectedConfig().id);
      },
      error: () => {
        this.doDelete(id.toString());
      }
    });
  }

  removeBookingsForSpace(space: any) {
    if (!confirm(`Cancel and remove existing bookings for space "${space.code || space.name}"?`)) return;
    const spaceId = space.idGuid || space.publicId || space.id;

    this.admin.getSpaceSummary(spaceId).subscribe({
      next: (summaryRes: any) => {
        const summary = summaryRes?.data ?? summaryRes;
        const reservations = summary?.recentReservations ?? [];
        const activeReservations = reservations.filter((r: any) => (r.bookingStatus || '').toLowerCase() !== 'cancelled');

        const doCancel = (bookingList: any[]) => {
          if (!bookingList.length) {
            space.hasBookings = 0;
            this.success = `Bookings cleared for ${space.code || space.name}.`;
            setTimeout(() => this.success = '', 3000);
            return;
          }
          let count = 0;
          bookingList.forEach((b: any) => {
            const bId = b.id || b.bookingId || b.bookingPublicId || b.idGuid;
            this.admin.updateBookingStatus(bId, 3).subscribe({
              next: () => {
                count++;
                if (count === bookingList.length) {
                  space.hasBookings = 0;
                  this.success = `Successfully cancelled ${count} booking(s) for ${space.code || space.name}.`;
                  setTimeout(() => this.success = '', 4000);
                  if (this.selectedConfig()) this.loadSpaces(this.selectedConfig().id);
                }
              },
              error: () => {
                count++;
                if (count === bookingList.length) {
                  space.hasBookings = 0;
                  if (this.selectedConfig()) this.loadSpaces(this.selectedConfig().id);
                }
              }
            });
          });
        };

        if (activeReservations.length > 0) {
          doCancel(activeReservations);
        } else {
          this.admin.getBookings(1, 1000, space.code || space.name || '').subscribe({
            next: (bRes: any) => {
              const allB = bRes?.data ?? (Array.isArray(bRes) ? bRes : []);
              const matches = allB.filter((b: any) =>
                (b.spaceGuid === spaceId || b.spaceId === space.id || b.spaceName === space.name || (b.spaceCode && b.spaceCode === space.code))
                && (b.bookingStatusLabel || b.bookingStatus || '').toLowerCase() !== 'cancelled'
              );
              doCancel(matches);
            },
            error: () => doCancel([])
          });
        }
      },
      error: () => {
        this.admin.getBookings(1, 1000, space.code || space.name || '').subscribe({
          next: (bRes: any) => {
            const allB = bRes?.data ?? (Array.isArray(bRes) ? bRes : []);
            const matches = allB.filter((b: any) =>
              (b.spaceGuid === spaceId || b.spaceId === space.id || b.spaceName === space.name || (b.spaceCode && b.spaceCode === space.code))
              && (b.bookingStatusLabel || b.bookingStatus || '').toLowerCase() !== 'cancelled'
            );
            if (!matches.length) {
              space.hasBookings = 0;
              this.success = `Bookings cleared for ${space.code || space.name}.`;
              setTimeout(() => this.success = '', 3000);
            } else {
              let count = 0;
              matches.forEach((b: any) => {
                const bId = b.id || b.bookingId || b.bookingPublicId || b.idGuid;
                this.admin.updateBookingStatus(bId, 3).subscribe({
                  next: () => {
                    count++;
                    if (count === matches.length) {
                      space.hasBookings = 0;
                      this.success = `Cancelled ${count} booking(s) for ${space.code || space.name}.`;
                      setTimeout(() => this.success = '', 4000);
                      if (this.selectedConfig()) this.loadSpaces(this.selectedConfig().id);
                    }
                  },
                  error: () => {
                    count++;
                    if (count === matches.length) {
                      space.hasBookings = 0;
                      if (this.selectedConfig()) this.loadSpaces(this.selectedConfig().id);
                    }
                  }
                });
              });
            }
          },
          error: (e: any) => {
            this.error = e?.error?.message ?? 'Failed to fetch bookings.';
          }
        });
      }
    });
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
          const msg = `${blocked.length} space(s) could not be deleted — they have active bookings.`;
          alert(msg);
          this.error = msg;
        } else {
          this.success = 'Spaces deleted successfully.';
          setTimeout(() => this.success = '', 4000);
        }
        this.selectedGuids.clear();
        this.loadSpaces(cfg.id);
      },
      error: (e: any) => {
        this.deleting.set(false);
        const msg = e?.error?.message ?? 'Failed to delete spaces.';
        alert(msg);
        this.error = msg;
      }
    });
  }
}
