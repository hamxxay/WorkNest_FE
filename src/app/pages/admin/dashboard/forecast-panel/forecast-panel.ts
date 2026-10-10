import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AdminService } from '../../../../services/admin.service';
import { DashboardOverview } from '../dashboard-overview/dashboard-overview';

interface ForecastMonth {
  month: string; label: string;
  expectedRent: number; confirmedRent: number;
  totalSpaces: number; occupiedSpaces: number; occupancyPct: number;
  leasesEnding: number; leasesStarting: number; pendingStarting: number;
}
interface ForecastLocation { locationId: number; name: string; months: ForecastMonth[]; }

/**
 * "Next 3 months" forecast (GET api/dashboard/forecast) from current leases: expected rent (prorated on a
 * 30-day month), occupancy at month end, leases ending / starting. Follows the dashboard's location picker
 * and refresh; when several locations are in scope, one location can be picked to see its own numbers.
 */
@Component({
  selector: 'app-forecast-panel',
  standalone: true,
  templateUrl: './forecast-panel.html',
  styleUrl: './forecast-panel.css'
})
export class ForecastPanel {
  private admin = inject(AdminService);

  locationIds = input<number[]>([]);
  refreshTick = input<number>(0);
  months = input<number>(3);

  loading = signal(true);
  failed = signal(false);
  data = signal<any | null>(null);
  /** 0 = all locations in scope, otherwise one location's rows. */
  selected = signal(0);

  money = DashboardOverview.money;
  fullMoney(v: number | null | undefined): string {
    return 'PKR ' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  constructor() {
    effect(() => {
      this.locationIds();
      this.refreshTick();
      this.months();
      untracked(() => this.load());
    });
  }

  load() {
    if (!this.data()) this.loading.set(true);
    this.admin.getDashboardForecast(this.locationIds(), this.months()).subscribe({
      next: (res) => {
        this.data.set(res);
        if (!(res?.locations ?? []).some((l: ForecastLocation) => l.locationId === this.selected())) this.selected.set(0);
        this.failed.set(false);
        this.loading.set(false);
      },
      error: () => { this.failed.set(true); this.loading.set(false); }
    });
  }

  locations = computed<ForecastLocation[]>(() => this.data()?.locations ?? []);
  rows = computed<ForecastMonth[]>(() => {
    const id = this.selected();
    const loc = id ? this.locations().find(l => l.locationId === id) : null;
    return loc ? loc.months : (this.data()?.totals ?? []);
  });
  /** Rent bar widths relative to the biggest month shown. */
  maxRent = computed(() => Math.max(1, ...this.rows().map(r => r.expectedRent || 0)));
  totals = computed(() => {
    const r = this.rows();
    return {
      rent: r.reduce((a, x) => a + (x.expectedRent || 0), 0),
      ending: r.reduce((a, x) => a + (x.leasesEnding || 0), 0),
      starting: r.reduce((a, x) => a + (x.leasesStarting || 0), 0)
    };
  });
  hasLeases = computed(() => this.rows().some(r => r.expectedRent > 0 || r.occupiedSpaces > 0 || r.leasesStarting > 0));
}
