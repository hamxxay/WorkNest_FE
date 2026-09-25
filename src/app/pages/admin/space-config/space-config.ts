import { Component, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { AccountCoaService } from '../../../services/account-coa.service';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-space-config',
  imports: [CommonModule, FormsModule],
  templateUrl: './space-config.html',
  styleUrl: './space-config.css'
})
export class SpaceConfig implements OnInit {
  billingPeriods: any[] = [];
  private admin = inject(AdminService);
  private accountCoa = inject(AccountCoaService);
  private auth = inject(AuthService);

  get isSuperAdmin(): boolean {
    return this.auth.hasRole('super_admin');
  }

  get userLocationId(): number | null {
    return this.auth.user()?.locationId ?? null;
  }

  configs = signal<any[]>([]);
  loading = signal(false);
  saving  = signal(false);
  error   = '';
  success = '';

  // Filters
  filterCompanyId  = signal<number | null>(null);
  filterBranchId   = signal<number | null>(null);
  filterLocationId = signal<number | null>(null);

  // Dropdowns
  companyOptions:   { v: number; l: string }[] = [];
  branchOptions:    { v: number; l: string }[] = [];
  locationOptions:  { v: number; l: string; branchId?: number; companyId?: number }[] = [];
  spaceTypeOptions: { v: number; l: string }[] = [];
  floorOptions:     { v: number; l: string }[] = [];
  accountOptions:   { v: number; l: string }[] = [];
  amenityOptions:   { id: number; name: string }[] = [];
  selectedAmenityIds: number[] = [];

  // Modal
  showModal  = false;
  editItem: any = null;
  form: any = {};

  get isPrivate(): boolean {
    return (this.form.spaceCategory || '').toLowerCase().includes('private');
  }

  filteredBranches = computed(() => {
    const cid = this.filterCompanyId();
    return cid ? this.branchOptions : this.branchOptions;
  });

  filteredLocations = computed(() => {
    const bid = this.filterBranchId();
    return bid
      ? this.locationOptions.filter(l => l.branchId === bid)
      : this.locationOptions;
  });

  ngOnInit() {
    if (!this.isSuperAdmin && this.userLocationId) {
      this.filterLocationId.set(this.userLocationId);
    }
    this.loadDropdowns();
    this.load();
  }

  private loadDropdowns() {
    this.admin.getLocations(1, 1000, '').subscribe({
      next: (res: any) => {
        const items = res?.data ?? [];
        let mapped = items.map((l: any) => ({
          v: l.id, l: l.name,
          branchId: l.branchId, companyId: l.companyId
        }));
        if (!this.isSuperAdmin && this.userLocationId) {
          mapped = mapped.filter((l: any) => l.v === this.userLocationId);
          this.filterLocationId.set(this.userLocationId);
        }
        this.locationOptions = mapped;
      }
    });
    this.admin.getSpaceTypes(1, 1000, '').subscribe({
      next: (res: any) => {
        this.spaceTypeOptions = (res?.data ?? []).map((s: any) => ({
          v: s.id,
          l: s.description || s.displayName || s.label || s.typeName || s.name?.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim() || ''
        }));
      }
    });
    this.accountCoa.getAll().subscribe({
      next: (accounts) => {
        this.accountOptions = accounts.map(a => ({ v: a.accountId, l: a.description }));
      }
    });
    this.admin.getAmenities().subscribe({
      next: (res: any) => {
        this.amenityOptions = (res?.data ?? []).map((a: any) => ({ id: a.id, name: a.name }));
      }
    });
  }

  load() {
    this.loading.set(true);
    this.admin.getSpaceConfigsV2(
      this.filterCompanyId() ?? undefined,
      this.filterBranchId()  ?? undefined,
      this.filterLocationId() ?? undefined
    ).subscribe({
      next: (res: any) => {
        const v2 = res?.data ?? [];
        if (v2.length) {
          this.configs.set(v2);
          this.loading.set(false);
        } else {
          // Fall back to legacy endpoint
          this.admin.getSpaceConfig().subscribe({
            next: (r: any) => {
              this.configs.set((r?.data ?? []).map((c: any, i: number) => ({ ...c, id: c.id ?? i + 1 })));
              this.loading.set(false);
            },
            error: () => this.loading.set(false)
          });
        }
      },
      error: () => {
        this.admin.getSpaceConfig().subscribe({
          next: (r: any) => {
            this.configs.set((r?.data ?? []).map((c: any, i: number) => ({ ...c, id: c.id ?? i + 1 })));
            this.loading.set(false);
          },
          error: () => this.loading.set(false)
        });
      }
    });
  }

  onLocationFilterChange(val: any) {
    this.filterLocationId.set(val ? +val : null);
    this.load();
  }

  openCreate() {
    this.editItem = null;
    this.form = {
      openingTime: '08:00',
      closingTime: '20:00',
      status: 1,
      locationId: (!this.isSuperAdmin && this.userLocationId) ? this.userLocationId : null
    };
    if (!this.isSuperAdmin && this.userLocationId) {
      this.loadFloorsForLocation(this.userLocationId);
    }
    this.floorOptions = [];
    this.selectedAmenityIds = [];
    this.error = '';
    this.showModal = true;
  }

  openEdit(cfg: any) {
    this.editItem = cfg;
    this.form = {
      spaceCategory:   cfg.spaceCategory,
      totalSpaces:     cfg.totalSpaces,
      codePrefix:      cfg.codePrefix,
      minCode:         cfg.minCode,
      openingTime:     cfg.openingTime,
      closingTime:     cfg.closingTime,
      securityDeposit: cfg.securityDeposit,
      accountReceivableId: cfg.accountReceivableId,
      rentAccountId:       cfg.rentAccountId,
      servicesIncomeId:    cfg.servicesIncomeId,
      salesTaxId:          cfg.salesTaxId,
      depositAccountId:    cfg.depositAccountId ?? cfg.securityReceivedId,
      securityReceivedId:  cfg.securityReceivedId ?? cfg.depositAccountId,
      floorId:         cfg.floorId,
      pricePerHour:    cfg.pricePerHour,
      pricePerDay:     cfg.pricePerDay,
      pricePerMonth:   cfg.pricePerMonth,
      locationId:      cfg.locationId,
      branchId:        cfg.branchId,
      companyId:       cfg.companyId,
      spaceTypeId:     cfg.spaceTypeId,
    };
    this.selectedAmenityIds = cfg.amenities
      ? cfg.amenities.split(',').map((s: string) => +s.trim()).filter((n: number) => !isNaN(n))
      : [];
    this.loadFloorsForLocation(cfg.locationId);
    this.error = '';
    this.showModal = true;
  }

  onLocationChange() {
    this.floorOptions = [];
    this.form.floorId = null;
    if (this.form.locationId) this.loadFloorsForLocation(+this.form.locationId);
  }

  private loadFloorsForLocation(locationId: number) {
    if (!locationId) return;
    this.admin.getFloors(locationId).subscribe({
      next: (res: any) => {
        const items = res?.data ?? (Array.isArray(res) ? res : []);
        this.floorOptions = items.map((f: any) => ({
          v: f.id ?? f.Id,
          l: f.name || f.floorName || f.Name || f.FloorName || (f.floorNumber != null ? `Floor ${f.floorNumber}` : `Floor #${f.id}`)
        }));
      }
    });
  }

  toggleAmenity(id: number) {
    const idx = this.selectedAmenityIds.indexOf(id);
    if (idx === -1) this.selectedAmenityIds.push(id);
    else this.selectedAmenityIds.splice(idx, 1);
  }

  isAmenitySelected(id: number) { return this.selectedAmenityIds.includes(id); }

  validate(): string | null {
    if (!this.form.spaceCategory?.trim()) return 'Space Type is required.';
    if (!this.form.totalSpaces || +this.form.totalSpaces <= 0) return 'Quantity must be greater than zero.';
    if (!this.form.codePrefix?.trim()) return 'Prefix is required.';
    if (!this.form.minCode || +this.form.minCode <= 0) return 'Starting Code is required.';
    if (!this.form.locationId) return 'Location is required.';
    if (!this.form.spaceTypeId) return 'Space Type is required.';
    if (this.isPrivate && !this.form.depositAccountId) return 'Private spaces require a Deposit Account.';
    return null;
  }

  save() {
    const err = this.validate();
    if (err) { this.error = err; return; }

    const payload = {
      ...this.form,
      totalSpaces:      +this.form.totalSpaces,
      minCode:          +this.form.minCode,
      securityDeposit:  this.form.securityDeposit  ? +this.form.securityDeposit  : 0,
      pricePerHour:     this.form.pricePerHour     ? +this.form.pricePerHour     : 0,
      pricePerDay:      this.form.pricePerDay      ? +this.form.pricePerDay      : 0,
      pricePerMonth:    this.form.pricePerMonth    ? +this.form.pricePerMonth    : 0,
      locationId:       this.form.locationId       ? +this.form.locationId       : null,
      branchId:         this.form.branchId         ? +this.form.branchId         : null,
      companyId:        this.form.companyId        ? +this.form.companyId        : null,
      spaceTypeId:      this.form.spaceTypeId      ? +this.form.spaceTypeId      : null,
      accountReceivableId: this.form.accountReceivableId ? +this.form.accountReceivableId : null,
      rentAccountId:       this.form.rentAccountId       ? +this.form.rentAccountId       : null,
      servicesIncomeId:    this.form.servicesIncomeId    ? +this.form.servicesIncomeId    : null,
      salesTaxId:          this.form.salesTaxId          ? +this.form.salesTaxId          : null,
      depositAccountId:    this.form.depositAccountId    ? +this.form.depositAccountId    : null,
      securityReceivedId:  this.form.depositAccountId    ? +this.form.depositAccountId    : (this.form.securityReceivedId ? +this.form.securityReceivedId : null),
      floorId:          this.form.floorId          ? +this.form.floorId          : null,
      amenities:        this.selectedAmenityIds.join(',') || null,
    };

    this.saving.set(true);
    this.error = '';

    const obs = this.editItem
      ? this.admin.updateSpaceConfigV2(this.editItem.id, payload)
      : this.admin.createSpaceConfigV2(payload);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.showModal = false;
        this.success = this.editItem ? 'Configuration updated.' : 'Configuration created.';
        setTimeout(() => this.success = '', 3000);
        this.load();
      },
      error: (e: any) => {
        this.saving.set(false);
        this.error = e?.error?.message ?? e?.error?.detail ?? 'Failed to save.';
      }
    });
  }

  deleteConfig(cfg: any) {
    if (!confirm(`Delete configuration for "${cfg.spaceCategory}" at ${cfg.locationName}? This will not delete generated spaces.`)) return;
    this.admin.deleteSpaceConfigV2(cfg.id).subscribe({
      next: () => {
        this.success = 'Configuration deleted.';
        setTimeout(() => this.success = '', 3000);
        this.load();
      },
      error: (e: any) => { this.error = e?.error?.message ?? 'Failed to delete.'; }
    });
  }

  closeModal() { this.showModal = false; }
}
