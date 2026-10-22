import { UnifiService } from '../../../services/unifi.service';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { Subscription, filter } from 'rxjs';
import { AdminService } from '../../../services/admin.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import { CustomInvoiceService } from '../../../services/custom-invoice.service';
import {
  ACCESS_OFFICER_HOME, CEO_HOME, SALES_EXECUTIVE_ROUTES, SALES_MANAGER_HOME, isAccessOfficerUrl, isCeoUrl, isSalesExecutiveUrl,
  isSalesManagerUrl
} from '../../../guards/admin.guard';
import { roleLabelFor } from '../../../utils/constants';

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
  /** Icons-only sidebar (tablets by default; the toggle switches it). Never on phones, where the sidebar is a drawer. */
  sidebarCollapsed = AdminLayout.screenMode() === 'compact';
  /** Phone width: the sidebar is an off-canvas drawer opened from the top bar's menu button. */
  readonly isPhone = signal(AdminLayout.screenMode() === 'phone');
  /** Phone drawer open. */
  readonly mobileNavOpen = signal(false);
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly sidebarToggleBtn = viewChild<ElementRef<HTMLButtonElement>>('sidebarToggle');
  private readonly mainEl = viewChild<ElementRef<HTMLElement>>('adminMain');
  /** Path (no query) of the last page, so only a new page (not a filter in the URL) scrolls back to the top. */
  private lastPath = '';
  userRole = '';

  isSuperAdmin = false;
  isAdmin = false;
  isSalesExecutive = false;
  /** CEO: only the CEO dashboard in the sidebar, no badges or other staff calls (they would be refused). */
  isCeo = false;
  /** Sales Manager: only the sales dashboard in the sidebar, no badges or other staff calls (same reason). */
  isSalesManager = false;
  /** Access Officer: only the Access page in the sidebar, no badges or other staff calls (same reason). */
  isAccessOfficer = false;
  /** CEO / Sales Manager / Access Officer: their one page (logo link, no profile page); null for everyone else. */
  dashboardHome: string | null = null;

  public toastService = inject(ToastService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private admin = inject(AdminService);
  private unifi = inject(UnifiService);
  private titleService = inject(Title);
  private customInvoices = inject(CustomInvoiceService);

  /** Items waiting on staff, keyed by sidebar route (from api/admin/nav-badges). Last good values are kept on errors. */
  badges = signal<Record<string, number>>({});
  /** Routes whose badge is shown in red (overdue invoices, suspended door access). */
  private static readonly URGENT_ROUTES = new Set(['/admin/invoices', '/admin/attendants']);
  // New tour inquiries, complaints and WhatsApp messages should show without a page refresh.
  private static readonly POLL_MS = 20_000;
  private static readonly NAV_DEBOUNCE_MS = 1_000;
  private baseTitle = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private navTimer: ReturnType<typeof setTimeout> | null = null;
  private navSub: Subscription | null = null;
  private badgeSub: Subscription | null = null;
  private drawerSub: Subscription | null = null;

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
    { route: CEO_HOME, group: '',                 label: 'CEO dashboard',     icon: 'ceo', superAdminOnly: true },
    { route: SALES_MANAGER_HOME, group: '',       label: 'Sales dashboard',   icon: 'sales-dash', superAdminOnly: true },
    { route: '/admin/customers', group: 'Sales',      label: 'Customers',         icon: 'customers'       },
    { route: '/admin/kyc', group: 'Sales',            label: 'KYC Portal',        icon: 'kyc'             },
    { route: '/admin/users', group: 'Administration',          label: 'Users',             icon: 'users'           },
    { route: '/admin/locations', group: 'Spaces',      label: 'Locations',         icon: 'location'        },
    { route: '/admin/spacetypes', group: 'Spaces',     label: 'Space Types',       icon: 'spacetype'       },
    { route: '/admin/spaces', group: 'Spaces',         label: 'Spaces',            icon: 'spaces'          },
    { route: '/admin/bookings', group: 'Sales',       label: 'Bookings',          icon: 'bookings'        },
    { route: '/admin/quotations', group: 'Sales',     label: 'Quotations',        icon: 'pricing'         },
    { route: '/admin/quotation-responses', group: 'Sales', label: 'Quotation Responses', icon: 'quotation-responses' },
    { route: '/admin/payments', group: 'Finance',       label: 'Payments',          icon: 'payments'        },
    { route: '/admin/agreements', group: 'Sales',     label: 'Agreements',        icon: 'challan'         },
    { route: '/admin/lease-templates', group: 'Sales', label: 'Lease Templates',  icon: 'challan', superAdminOnly: true },
    { route: '/admin/invoices', group: 'Finance',       label: 'Invoices & Billing', icon: 'payments'        },
      { route: '/admin/invoice-approvals', group: 'Finance', label: 'Invoice Approvals', icon: 'payments' },
    { route: '/admin/fee-receipts', group: 'Finance',       label: 'Receipts',            icon: 'receipt'         },
    // Shown to super admins, and to admins a super admin has given access (api/custom-invoices/access/me).
    { route: '/admin/custom-invoice', group: 'Finance',     label: 'Custom Invoice',      icon: 'custom-invoice', customInvoiceOnly: true },
    { route: '/admin/contacts', group: 'Sales',       label: 'Tour Inquiries',    icon: 'contacts'        },
    { route: '/admin/complaints', group: 'Sales',     label: 'Complaints',        icon: 'complaints'      },
    { route: '/admin/whatsapp', group: 'Sales',       label: 'WhatsApp Inbox',    icon: 'whatsapp'        },
    { route: '/admin/gallery', group: 'Spaces',        label: 'Gallery',           icon: 'gallery'         },
    { route: '/admin/space-configuration', group: 'Spaces', label: 'Space Config', icon: 'spaceconfig',  superAdminOnly: true },
    { route: '/admin/manage-spaces', group: 'Spaces',  label: 'Manage Spaces',     icon: 'managespaces'    },
    { route: '/admin/attendants', group: 'Access Control',     label: 'Attendants & Access', icon: 'users'         },
    { route: '/admin/biometric-users', group: 'Access Control', label: 'Access Users',     icon: 'biometrics'      },
    { route: '/admin/staff-access', group: 'Access Control',        label: 'Staff Access',        icon: 'users' },
    { route: ACCESS_OFFICER_HOME, group: 'Access Control',          label: 'Access by CNIC',      icon: 'access-officer', superAdminOnly: true },
    { route: '/admin/access-dashboard', group: 'Access Control',    label: 'Access Dashboard',    icon: 'access-dashboard', adminOnly: true },
    { route: '/admin/access-activity-log', group: 'Access Control', label: 'Access Activity Log', icon: 'access-activity',  adminOnly: true },
    { route: '/admin/access-analytics', group: 'Access Control',    label: 'Access Analytics',    icon: 'access-analytics', adminOnly: true },
    { route: '/admin/network', group: 'Network',          label: 'Network Overview', icon: 'network'         },
    { route: '/admin/network/clients', group: 'Network',  label: 'Clients',          icon: 'net-clients'     },
    { route: '/admin/network/devices', group: 'Network',  label: 'Devices',          icon: 'net-devices'     },
    { route: '/admin/network/internet', group: 'Network', label: 'Internet',         icon: 'net-internet'    },
    { route: '/admin/network/wifi', group: 'Network',     label: 'Wi-Fi',            icon: 'net-wifi'        },
    { route: '/admin/challan-validity', group: 'Finance', label: 'Challan Validity', icon: 'challan', superAdminOnly: true },
      { route: '/admin/audit-log', group: 'Administration', label: 'Audit Log', icon: 'audit', superAdminOnly: true },
    { route: '/admin/login-history', group: 'Administration', label: 'Login History', icon: 'login-history', superAdminOnly: true },
    { route: '/admin/services', group: 'Administration', label: 'Services', icon: 'net-devices', superAdminOnly: true },
    { route: '/admin/message-templates', group: 'Administration', label: 'Message Templates', icon: 'message-template', adminOnly: true },
    { route: '/admin/reports/security-deposits', group: 'Finance', label: 'Security Deposit Report', icon: 'reports' },
  ];

  constructor() {
    const u = this.auth.getUser();
    this.userRole = u?.roles?.[0] ?? 'Admin';
    this.isSuperAdmin = this.auth.hasRole('super_admin');
    const isAdmin = this.auth.hasRole('admin');
    this.isAdmin = isAdmin || this.isSuperAdmin;
    this.isSalesExecutive = this.auth.hasRole('sales_executive');
    this.isCeo = this.auth.isCeoOnly();
    this.isSalesManager = this.auth.isSalesManagerOnly();
    this.isAccessOfficer = this.auth.isAccessOfficerOnly();
    if (this.isCeo) {
      this.userRole = 'CEO';
      this.dashboardHome = CEO_HOME;
      // Same rule as adminGuard: the CEO dashboard and nothing else.
      this.menuItems = [{ route: CEO_HOME, group: '', label: 'CEO dashboard', icon: 'ceo' }];
      if (!isCeoUrl(this.router.url)) {
        this.router.navigate([CEO_HOME]);
      }
    } else if (this.isSalesManager) {
      this.userRole = 'sales_manager';
      this.dashboardHome = SALES_MANAGER_HOME;
      // Same rule as adminGuard: the sales dashboard and nothing else.
      this.menuItems = [{ route: SALES_MANAGER_HOME, group: '', label: 'Sales dashboard', icon: 'sales-dash' }];
      if (!isSalesManagerUrl(this.router.url)) {
        this.router.navigate([SALES_MANAGER_HOME]);
      }
    } else if (this.isAccessOfficer) {
      this.userRole = 'access_officer';
      this.dashboardHome = ACCESS_OFFICER_HOME;
      // Same rule as adminGuard: the Access page and nothing else.
      this.menuItems = [{ route: ACCESS_OFFICER_HOME, group: '', label: 'Access', icon: 'access-officer' }];
      if (!isAccessOfficerUrl(this.router.url)) {
        this.router.navigate([ACCESS_OFFICER_HOME]);
      }
    } else if (this.isSalesExecutive && !this.isSuperAdmin && !isAdmin) {
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
    this.lastPath = this.router.url.split(/[?#]/)[0];
    // Phones: a link opened from the drawer closes it. A new page starts at the top (the page scrolls inside
    // <main>, which the router's own scroll handling does not reset).
    this.drawerSub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.mobileNavOpen.set(false);
      const path = this.router.url.split(/[?#]/)[0];
      if (path !== this.lastPath) {
        this.lastPath = path;
        this.mainEl()?.nativeElement.scrollTo({ top: 0 });
      }
    });
    // The role's database label (auth/me) when the sign-in response did not bring it.
    if (!this.auth.getUser()?.roleDisplayName) this.auth.refreshProfileLabels();
    // A CEO / Sales Manager / Access Officer has no sidebar badges or network section (those APIs are staff-only).
    if (this.dashboardHome) return;
    this.loadNetworkScope();
    this.loadCustomInvoiceAccess();
    this.loadBadges();
    this.pollTimer = setInterval(() => { if (!document.hidden) this.loadBadges(); }, AdminLayout.POLL_MS);
    // Browsers slow timers in background tabs: refresh as soon as the tab is visible / focused again.
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onVisible);
    // Refresh soon after each navigation, so handling an item updates its count.
    this.navSub = this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.currentPath.set(this.router.url.split(/[?#]/)[0]);
      if (this.navTimer) clearTimeout(this.navTimer);
      this.navTimer = setTimeout(() => { this.navTimer = null; this.loadBadges(); }, AdminLayout.NAV_DEBOUNCE_MS);
    });
  }

  private lastBadgeLoad = 0;
  private readonly onVisible = () => {
    if (!document.hidden && Date.now() - this.lastBadgeLoad > 3_000) this.loadBadges();
  };

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onVisible);
    if (this.navTimer) clearTimeout(this.navTimer);
    this.navSub?.unsubscribe();
    this.badgeSub?.unsubscribe();
    this.drawerSub?.unsubscribe();
    if (this.baseTitle) this.titleService.setTitle(this.baseTitle);
  }

  private loadBadges() {
    if (!this.auth.isAuthenticated()) return;
    this.lastBadgeLoad = Date.now();
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
    return this.menuItems.filter((i: any) => (!i.superAdminOnly || this.isSuperAdmin) && (!i.adminOnly || this.isAdmin)
      && (!i.customInvoiceOnly || this.customInvoiceAllowed())
      && (i.group !== 'Network' || this.networkAllowed()));
  }

  /**
   * Custom Invoice: super admins always; an admin once api/custom-invoices/access/me says canUse (hidden until then,
   * and when the check fails). The page's guard and the API check it again.
   */
  readonly customInvoiceAllowed = computed(() =>
    this.isSuperAdmin || (this.isAdmin && this.customInvoices.myAccess()?.canUse === true));
  private loadCustomInvoiceAccess() {
    if (this.isSuperAdmin || !this.isAdmin) return;
    this.customInvoices.getMyAccess().subscribe({ error: () => { /* keep the item hidden */ } });
  }

  /** False when the UniFi network belongs to other locations than this admin's / sales executive's (api/unifi/scope). */
  readonly networkAllowed = signal(true);
  private loadNetworkScope() {
    if (this.isSuperAdmin) return;
    this.unifi.getScope().subscribe({ next: s => this.networkAllowed.set(s.allowed), error: () => { /* keep the section */ } });
  }

  get menuGroups(): { name: string; items: any[] }[] {
    const visible = this.visibleItems();
    return AdminLayout.GROUP_ORDER
      .map(name => ({ name, items: visible.filter((i: any) => (i.group ?? '') === name) }))
      .filter(g => g.items.length > 0);
  }

  /** The sidebar's own button: collapses / expands it, or closes the drawer on a phone. */
  toggleSidebar() {
    if (this.isPhone()) { this.closeMobileNav(true); return; }
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  openMobileNav() {
    this.mobileNavOpen.set(true);
    // Move focus into the drawer (its close button) once it is visible.
    setTimeout(() => this.sidebarToggleBtn()?.nativeElement.focus(), 30);
  }

  /** Closes the phone drawer; `refocus` returns focus to the top bar's menu button (Escape / close button). */
  closeMobileNav(refocus = false) {
    if (!this.mobileNavOpen()) return;
    this.mobileNavOpen.set(false);
    if (refocus) setTimeout(() => this.menuButton()?.nativeElement.focus(), 0);
  }

  @HostListener('document:keydown.escape')
  onEscape() { this.closeMobileNav(true); }

  // Phones (< 768px): drawer. Tablets / small laptops (< 1280px): icons only. Wider: full sidebar.
  // The toggle still works, and the sidebar only auto-changes when the window crosses a breakpoint.
  private static readonly PHONE_WIDTH = 768;
  private static readonly COMPACT_WIDTH = 1280;
  private static screenMode(): 'phone' | 'compact' | 'wide' {
    if (typeof window === 'undefined') return 'wide';
    const w = window.innerWidth;
    return w < AdminLayout.PHONE_WIDTH ? 'phone' : w < AdminLayout.COMPACT_WIDTH ? 'compact' : 'wide';
  }
  private lastMode = AdminLayout.screenMode();

  @HostListener('window:resize')
  onResize() {
    const mode = AdminLayout.screenMode();
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      this.isPhone.set(mode === 'phone');
      this.sidebarCollapsed = mode === 'compact';
      this.mobileNavOpen.set(false);
    }
  }

  /** CEO and Sales Manager have one page: no sidebar, the dashboard fills the screen under a slim top bar. */
  get focusMode(): boolean {
    return this.isCeo || this.isSalesManager;
  }

  /** The role as the database words it (auth/me roleDisplayName); else made from the role name ("super_admin" -> "Super Admin"). */
  get roleLabel(): string {
    return this.auth.getUser()?.roleDisplayName?.trim() || roleLabelFor(this.userRole);
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
    // Go to /login once sign-out has finished (it first ends the API session, up to ~1.5 s).
    this.auth.logout$().subscribe(() => this.router.navigate(['/login']));
  }
}

