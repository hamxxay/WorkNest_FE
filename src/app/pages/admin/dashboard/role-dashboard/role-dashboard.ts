import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../../../services/admin.service';
import { DashboardOverview, DashPeriod } from '../dashboard-overview/dashboard-overview';

export type DashRole = 'sales_executive' | 'admin' | 'super_admin';

interface Tile { key: string; label: string; value: string; sub: string; link: string; tone: 'ok' | 'warn' | 'danger' | 'neutral'; }

/**
 * Dashboard sections that differ by role (GET api/dashboard/role).
 * Sales executive: sales pipeline, tour inquiries & follow-ups, renewals, collections.
 * Admin: team & service (branch operations and finance come from the overview above it).
 * Super admin: team & service, location comparison, staff overview, system health.
 */
@Component({
  selector: 'app-role-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './role-dashboard.html',
  styleUrl: './role-dashboard.css'
})
export class RoleDashboard {
  private admin = inject(AdminService);

  role = input<DashRole>('admin');
  locationIds = input<number[]>([]);
  refreshTick = input<number>(0);
  period = input<DashPeriod>('month');

  loading = signal(true);
  failed = signal(false);
  data = signal<any | null>(null);
  salesTab = signal<'signature' | 'confirm'>('signature');

  money = DashboardOverview.money;
  fullMoney(v: number | null | undefined): string {
    return 'PKR ' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  periodWord = computed(() => `this ${this.period()}`);

  constructor() {
    effect(() => {
      this.role();
      this.locationIds();
      this.refreshTick();
      this.period();
      untracked(() => this.load());
    });
  }

  load() {
    if (!this.data()) this.loading.set(true);
    this.admin.getRoleDashboard(this.period(), this.locationIds()).subscribe({
      next: (res) => { this.data.set(res); this.failed.set(false); this.loading.set(false); },
      error: () => { this.failed.set(true); this.loading.set(false); }
    });
  }

  sales = computed(() => this.data()?.sales ?? null);
  team = computed(() => this.data()?.team ?? null);
  locations = computed<any[]>(() => this.data()?.locations ?? []);
  staff = computed(() => this.data()?.staff ?? null);
  system = computed(() => this.data()?.system ?? null);

  // ---------- sales executive ----------
  salesTiles = computed<Tile[]>(() => {
    const s = this.sales();
    if (!s) return [];
    return [
      { key: 'quotes', label: 'Quotations', value: `${s.quotationsCreated}`, sub: `created ${this.periodWord()}`, link: '/admin/quotations', tone: 'neutral' },
      { key: 'conv', label: 'Conversion', value: `${s.conversionPct}%`, sub: `${s.converted} converted · ${this.money(s.convertedValue)}`, link: '/admin/quotations', tone: s.conversionPct >= 30 ? 'ok' : s.quotationsCreated ? 'warn' : 'neutral' },
      { key: 'inq', label: 'New inquiries', value: `${s.newInquiries}`, sub: `${s.inquiriesInPeriod} received ${this.periodWord()}`, link: '/admin/contacts', tone: s.newInquiries ? 'warn' : 'ok' },
      { key: 'fu', label: 'Follow-ups due', value: `${s.followUpsDue}`, sub: 'future prospects to call', link: '/admin/contacts', tone: s.followUpsDue ? 'danger' : 'ok' },
      { key: 'ren', label: 'Renewals due', value: `${s.renewalsDue}`, sub: `leases ending in ${s.renewalDays} days`, link: '/admin/bookings', tone: s.renewalsDue ? 'warn' : 'ok' },
      { key: 'od', label: 'Overdue', value: this.money(s.overdue), sub: `${s.overdueCount} invoices · ${this.money(s.outstanding)} outstanding`, link: '/admin/invoices', tone: s.overdueCount ? 'danger' : 'ok' }
    ];
  });

  /** Pipeline stages as bars, widths relative to the largest stage. */
  pipeline = computed(() => {
    const s = this.sales();
    if (!s) return [];
    const stages = [
      { label: 'Draft', n: s.draft, cls: 'st-draft' },
      { label: 'Sent', n: s.sent, cls: 'st-sent' },
      { label: 'Accepted', n: s.accepted, cls: 'st-acc' },
      { label: 'Agreement', n: s.agreementStage, cls: 'st-agr' },
      { label: 'Converted', n: s.converted, cls: 'st-conv' },
      { label: 'Lost', n: s.lost, cls: 'st-lost' }
    ];
    const max = Math.max(1, ...stages.map(x => x.n || 0));
    return stages.map(x => ({ ...x, pct: Math.round(((x.n || 0) / max) * 100) }));
  });

  daysFromToday(date: string | null): number {
    if (!date) return 0;
    const d = new Date(date + 'T00:00:00');
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - t.getTime()) / 86_400_000);
  }
  initial(name: string | null | undefined): string {
    return (name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  // ---------- admin / super admin ----------
  teamTiles = computed<Tile[]>(() => {
    const t = this.team();
    if (!t) return [];
    return [
      { key: 'cmp', label: 'Open complaints', value: `${t.openComplaints}`, sub: 'open or in progress', link: '/admin/complaints', tone: t.openComplaints ? 'danger' : 'ok' },
      { key: 'wa', label: 'WhatsApp unread', value: `${t.unreadWhatsApp}`, sub: 'chats waiting for a reply', link: '/admin/whatsapp', tone: t.unreadWhatsApp ? 'warn' : 'ok' },
      { key: 'inq', label: 'New inquiries', value: `${t.newInquiries}`, sub: 'tour inquiries not handled', link: '/admin/contacts', tone: t.newInquiries ? 'warn' : 'ok' },
      { key: 'kyc', label: 'KYC to review', value: `${t.kycPending}`, sub: 'customers with pending documents', link: '/admin/kyc', tone: t.kycPending ? 'warn' : 'ok' },
      { key: 'sus', label: 'Access suspended', value: `${t.accessSuspended}`, sub: 'bookings locked for unpaid challans', link: '/admin/attendants', tone: t.accessSuspended ? 'danger' : 'ok' },
      { key: 'mac', label: 'Machines offline', value: `${t.machinesOffline}/${t.machines}`, sub: t.machinesOffline ? 'door machines not reachable' : 'all door machines online', link: '/admin/access-dashboard', tone: t.machinesOffline ? 'danger' : 'ok' }
    ];
  });

  locationTotals = computed(() => {
    const l = this.locations();
    const sum = (k: string) => l.reduce((a, x) => a + Number(x[k] || 0), 0);
    const spaces = sum('totalSpaces'); const occ = sum('occupiedSpaces');
    return {
      totalSpaces: spaces, occupiedSpaces: occ, occupancyPct: spaces ? Math.round((occ * 1000) / spaces) / 10 : 0,
      activeBookings: sum('activeBookings'), invoiced: sum('invoiced'), collected: sum('collected'),
      outstanding: sum('outstanding'), overdue: sum('overdue')
    };
  });
  collectionRate(inv: number, col: number): number {
    return inv > 0 ? Math.round((col / inv) * 100) : 0;
  }

  jobLabel(job: string): string {
    const map: Record<string, string> = { online: 'Machine status', maintenance: 'Maintenance', events: 'Event copy', watch: 'Access watch', clock: 'Clock sync' };
    return map[(job || '').toLowerCase()] ?? job;
  }
  ago(iso: string | null | undefined): string {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '—';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  }
}
