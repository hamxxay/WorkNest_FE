import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { Subscription, filter } from 'rxjs';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import { SALES_EXECUTIVE_ROUTES, isSalesExecutiveUrl } from '../../../guards/admin.guard';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.css'
})
export class AdminLayout implements OnInit, OnDestroy {
  get boundLocationId(): number | null {
    return this.auth.getUser()?.locationId ?? null;
  }
  sidebarCollapsed = typeof window !== 'undefined' && window.innerWidth < 1280;
  userRole = '';

  isSuperAdmin = false;
  isAdmin = false;
  isSalesExecutive = false;

  public toastService = inject(ToastService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private admin = inject(AdminService);
  private titleService = inject(Title);

  /** Items waiting on staff, keyed by sidebar route (from api/admin/nav-badges). Last good values are kept on errors. */
  badges = signal<Record<string, number>>({});
  /** Routes whose badge is shown in red (overdue invoices, suspended door access). */
  private static readonly URGENT_ROUTES = new Set(['/admin/invoices', '/admin/attendants']);
  private static readonly POLL_MS = 60_000;
  private static readonly NAV_DEBOUNCE_MS = 1_000;
  private baseTitle = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private navTimer: ReturnType<typeof setTimeout> | null = null;
  private navSub: Subscription | null = null;
  private badgeSub: Subscription | null = null;

  /** Path of the open page (no query string), to show that page's "Mark as read" bar. */
  private currentPath = signal(this.router.url.split(/[?#]/)[0]);
  markingRead = signal(false);

  /** The open page's badge, if it has one waiting. */
  currentBadge = computed(() => {
    const path = this.currentPath();
    const item = this.visibleItems().find((i: any) => i.route === path);
    const n = item ? this.badges()[item.route] ?? 0 : 0;
    return item && n > 0 ? { route: item.route as string, label: item.label as string, count: n } : null;
  });

  /** Total of the badges on menu items this user can see (role filters are fixed after construction). */
  badgeTotal = computed(() => {
    const b = this.badges();
    return this.visibleItems().reduce((sum: number, i: any) => sum + (b[i.route] > 0 ? b[i.route] : 0), 0);
  });

  menuItems = [
    { route: '/admin', group: '',                label: 'Dashboard',         icon: 'dashboard'       },
    { route: '/admin/customers', group: 'Sales',      label: 'Customers',         icon: 'customers'       },
    { route: '/admin/kyc', group: 'Sales',            label: 'KYC Portal',        icon: 'kyc'             },
    { route: '/admin/users', group: 'Administration',          label: 'Users',             icon: 'users'           },
    { route: '/admin/locations', group: 'Spaces',      label: 'Locations',         icon: 'location'        },
    { route: '/admin/spacetypes', group: 'Spaces',     label: 'Space Types',       icon: 'spacetype'       },
    { route: '/admin/spaces', group: 'Spaces',         label: 'Spaces',            icon: 'spaces'          },
    { route: '/admin/bookings', group: 'Sales',       label: 'Bookings',          icon: 'bookings'        },
    { route: '/admin/pricing', group: 'Finance',        label: 'Pricing',           icon: 'pricing'         },
    { route: '/admin/quotations', group: 'Sales',     label: 'Quotations',        icon: 'pricing'         },
    { route: '/admin/quotation-responses', group: 'Sales', label: 'Quotation Responses', icon: 'quotation-responses' },
    { route: '/admin/payments', group: 'Finance',       label: 'Payments',          icon: 'payments'        },
    { route: '/admin/agreements', group: 'Sales',     label: 'Agreements',        icon: 'challan'         },
    { route: '/admin/lease-templates', group: 'Sales', label: 'Lease Templates',  icon: 'challan'         },
    { route: '/admin/invoices', group: 'Finance',       label: 'Invoices & Billing', icon: 'payments'        },
    { route: '/admin/contacts', group: 'Sales',       label: 'Contacts',          icon: 'contacts'        },
    { route: '/admin/gallery', group: 'Spaces',        label: 'Gallery',           icon: 'gallery'         },
    { route: '/admin/space-configuration', group: 'Spaces', label: 'Space Config', icon: 'spaceconfig',  superAdminOnly: true },
    { route: '/admin/manage-spaces', group: 'Spaces',  label: 'Manage Spaces',     icon: 'managespaces'    },
    { route: '/admin/attendants', group: 'Access Control',     label: 'Attendants & Access', icon: 'users'         },
    { route: '/admin/biometric-users', group: 'Access Control', label: 'Access Users',     icon: 'biometrics'      },
    { route: '/admin/staff-access', group: 'Access Control',        label: 'Staff Access',        icon: 'users' },
    { route: '/admin/access-dashboard', group: 'Access Control',    label: 'Access Dashboard',    icon: 'access-dashboard', adminOnly: true },
    { route: '/admin/access-activity-log', group: 'Access Control', label: 'Access Activity Log', icon: 'access-activity',  adminOnly: true },
    { route: '/admin/access-analytics', group: 'Access Control',    label: 'Access Analytics',    icon: 'access-analytics', adminOnly: true },
    { route: '/admin/network', group: 'Network',          label: 'Network Overview', icon: 'network'         },
    { route: '/admin/network/clients', group: 'Network',  label: 'Clients',          icon: 'net-clients'     },
    { route: '/admin/network/devices', group: 'Network',  label: 'Devices',          icon: 'net-devices'     },
    { route: '/admin/network/internet', group: 'Network', label: 'Internet',         icon: 'net-internet'    },
    { route: '/admin/network/wifi', group: 'Network',     label: 'Wi-Fi',            icon: 'net-wifi'        },
    { route: '/admin/challan-validity', group: 'Finance', label: 'Challan Validity', icon: 'challan', superAdminOnly: true },
    { route: '/admin/reports/security-deposits', group: 'Finance', label: 'Security Deposit Report', icon: 'reports' },
  ];

  constructor() {
    const u = this.auth.getUser();
    this.userRole = u?.roles?.[0] ?? 'Admin';
    this.isSuperAdmin = this.auth.hasRole('super_admin');
    const isAdmin = this.auth.hasRole('admin');
    this.isAdmin = isAdmin || this.isSuperAdmin;
    this.isSalesExecutive = this.auth.hasRole('sales_executive');
    if (this.isSalesExecutive && !this.isSuperAdmin && !isAdmin) {
      this.userRole = 'Sales Executive';
      // Same allow-list as adminGuard (challan-validity is super-admin only, so not listed).
      this.menuItems = this.menuItems.filter(item => SALES_EXECUTIVE_ROUTES.includes(item.route));
      if (!isSalesExecutiveUrl(this.router.url)) {
        this.router.navigate(['/admin/dashboard']);
      }
    }
  }

  ngOnInit() {
    this.baseTitle = this.titleService.getTitle();
    this.loadBadges();
    this.pollTimer = setInterval(() => this.loadBadges(), AdminLayout.POLL_MS);
    // Refresh soon after each navigation, so handling an item updates its count.
    this.navSub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.currentPath.set(this.router.url.split(/[?#]/)[0]);
      if (this.navTimer) clearTimeout(this.navTimer);
      this.navTimer = setTimeout(() => { this.navTimer = null; this.loadBadges(); }, AdminLayout.NAV_DEBOUNCE_MS);
    });
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.navTimer) clearTimeout(this.navTimer);
    this.navSub?.unsubscribe();
    this.badgeSub?.unsubscribe();
    if (this.baseTitle) this.titleService.setTitle(this.baseTitle);
  }

  private loadBadges() {
    if (!this.auth.isAuthenticated()) return;
    this.badgeSub?.unsubscribe();
    this.badgeSub = this.admin.getNavBadges().subscribe({
      next: res => {
        const next: Record<string, number> = {};
        if (res && typeof res === 'object') {
          for (const [route, value] of Object.entries(res)) {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0) next[route] = Math.floor(n);
          }
        }
        this.badges.set(next);
        this.updateTitle();
      },
      error: () => { /* keep the last values; badges are a hint, never an error */ }
    });
  }

  /** Clears the badges of the given routes (all visible ones when omitted) for this login, on every device. */
  markRead(routes?: string[]) {
    if (this.markingRead()) return;
    const targets = routes ?? this.visibleItems().map((i: any) => i.route as string).filter(r => this.badgeCount(r) > 0);
    if (targets.length === 0) return;
    const previous = this.badges();
    const next = { ...previous };
    for (const r of targets) delete next[r];
    this.badges.set(next);
    this.updateTitle();
    this.markingRead.set(true);
    this.admin.markNavBadgesRead(routes).subscribe({
      next: () => { this.markingRead.set(false); this.loadBadges(); },
      error: err => {
        this.markingRead.set(false);
        this.badges.set(previous);
        this.updateTitle();
        this.toastService.error(err?.error?.message || 'Could not mark as read. Please try again.');
      }
    });
  }

  private updateTitle() {
    const total = this.badgeTotal();
    this.titleService.setTitle(total > 0 ? `(${total}) ${this.baseTitle}` : this.baseTitle);
  }

  badgeCount(route: string): number {
    return this.badges()[route] ?? 0;
  }

  badgeText(route: string): string {
    const n = this.badgeCount(route);
    return n > 99 ? '99+' : String(n);
  }

  isUrgentBadge(route: string): boolean {
    return AdminLayout.URGENT_ROUTES.has(route);
  }

  // Sidebar sections, in this order; items keep their order inside a section.
  private static readonly GROUP_ORDER = ['', 'Sales', 'Finance', 'Spaces', 'Access Control', 'Network', 'Administration'];

  /** Visible menu items (role rules applied), grouped under section headings. */
  private visibleItems(): any[] {
    return this.menuItems.filter((i: any) => (!i.superAdminOnly || this.isSuperAdmin) && (!i.adminOnly || this.isAdmin));
  }

  get menuGroups(): { name: string; items: any[] }[] {
    const visible = this.visibleItems();
    return AdminLayout.GROUP_ORDER
      .map(name => ({ name, items: visible.filter((i: any) => (i.group ?? '') === name) }))
      .filter(g => g.items.length > 0);
  }

  toggleSidebar() { this.sidebarCollapsed = !this.sidebarCollapsed; }

  // Icon-only sidebar on smaller screens; the toggle still works, and the sidebar
  // only auto-changes when the window crosses the breakpoint.
  private static readonly COMPACT_WIDTH = 1280;
  private wasCompact = typeof window !== 'undefined' && window.innerWidth < AdminLayout.COMPACT_WIDTH;

  @HostListener('window:resize')
  onResize() {
    const compact = window.innerWidth < AdminLayout.COMPACT_WIDTH;
    if (compact !== this.wasCompact) {
      this.sidebarCollapsed = compact;
      this.wasCompact = compact;
    }
  }

  /** "super_admin" -> "Super Admin" */
  get roleLabel(): string {
    return (this.userRole || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  getUserName(): string {
    const user = this.auth.getUser();
    return user?.displayName?.trim() || user?.email?.split('@')[0] || 'Admin';
  }

  getInitials(): string {
    const parts = this.getUserName().split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
