import { Component, inject } from '@angular/core';
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
  sidebarCollapsed = false;
  userRole = '';

  isSuperAdmin = false;
  isSalesExecutive = false;

  public toastService = inject(ToastService);
  private auth = inject(AuthService);
  private router = inject(Router);

  menuItems = [
    { route: '/admin',                label: 'Dashboard',         icon: 'dashboard'       },
    { route: '/admin/customers',      label: 'Customers',         icon: 'customers'       },
    { route: '/admin/users',          label: 'Users',             icon: 'users'           },
    { route: '/admin/locations',      label: 'Locations',         icon: 'location'        },
    { route: '/admin/spacetypes',     label: 'Space Types',       icon: 'spacetype'       },
    { route: '/admin/spaces',         label: 'Spaces',            icon: 'spaces'          },
    { route: '/admin/bookings',       label: 'Bookings',          icon: 'bookings'        },
    { route: '/admin/pricing',        label: 'Pricing',           icon: 'pricing'         },
    { route: '/admin/quotations',     label: 'Quotations',        icon: 'pricing'         },
    { route: '/admin/payments',       label: 'Payments',          icon: 'payments'        },
    { route: '/admin/invoices',       label: 'Invoices & Billing', icon: 'payments'        },

    { route: '/admin/contacts',       label: 'Contacts',          icon: 'contacts'        },
    { route: '/admin/gallery',             label: 'Gallery',           icon: 'gallery'                        },
    { route: '/admin/space-configuration',  label: 'Space Config',      icon: 'spaceconfig',  superAdminOnly: true },
    { route: '/admin/manage-spaces',        label: 'Manage Spaces',     icon: 'managespaces' },
    { route: '/admin/attendants',        label: 'Attendants & Access', icon: 'users' },
    { route: '/admin/challan-validity',     label: 'Challan Validity',  icon: 'challan' },
  ];

  constructor() {
    const u = this.auth.getUser();
    this.userRole = u?.roles?.[0] ?? 'Admin';
    this.isSuperAdmin = this.auth.hasRole('super_admin');
    const isAdmin = this.auth.hasRole('admin');
    this.isSalesExecutive = this.auth.hasRole('sales_executive');
    if (this.isSalesExecutive && !this.isSuperAdmin && !isAdmin) {
      this.userRole = 'Sales Executive';
      const allowedRoutes = ['/admin/quotations', '/admin/invoices', '/admin/bookings', '/admin/attendants', '/admin/contacts', '/admin/challan-validity'];
      this.menuItems = this.menuItems.filter(item => allowedRoutes.includes(item.route));
      if (!allowedRoutes.some(r => this.router.url.startsWith(r))) {
        this.router.navigate(['/admin/quotations']);
      }
    }
  }

  toggleSidebar() { this.sidebarCollapsed = !this.sidebarCollapsed; }

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
