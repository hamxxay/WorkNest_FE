import { Component, HostListener, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.css'
})
export class AdminLayout {
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
        { route: '/admin/challan-validity', group: 'Finance', label: 'Challan Validity', icon: 'challan'        },
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
      const allowedRoutes = ['/admin/kyc', '/admin/quotations', '/admin/agreements', '/admin/lease-templates', '/admin/invoices', '/admin/bookings', '/admin/attendants', '/admin/staff-access', '/admin/contacts', '/admin/biometric-users', '/admin/challan-validity', '/admin/network', '/admin/network/clients', '/admin/network/devices', '/admin/network/internet', '/admin/network/wifi'];
      this.menuItems = this.menuItems.filter(item => allowedRoutes.includes(item.route));
      if (!allowedRoutes.some(r => this.router.url.startsWith(r))) {
        this.router.navigate(['/admin/quotations']);
      }
    }
  }

  // Sidebar sections, in this order; items keep their order inside a section.
  private static readonly GROUP_ORDER = ['', 'Sales', 'Finance', 'Spaces', 'Access Control', 'Network', 'Administration'];

  /** Visible menu items (role rules applied), grouped under section headings. */
  get menuGroups(): { name: string; items: any[] }[] {
    const visible = this.menuItems.filter((i: any) => (!i.superAdminOnly || this.isSuperAdmin) && (!i.adminOnly || this.isAdmin));
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
    return this.auth.getUser()?.email?.split('@')[0] ?? 'Admin';
  }

  getInitials(): string {
    const name = this.getUserName();
    return name.slice(0, 2).toUpperCase();
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
