import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.css'
})
export class AdminLayout {
  sidebarCollapsed = false;
  userRole = '';

  menuItems = [
    { route: '/admin',              label: 'Dashboard',   icon: 'dashboard'    },
    { route: '/admin/customers',    label: 'Customers',   icon: 'customers'    },
    { route: '/admin/users',        label: 'Users',       icon: 'users'        },
    { route: '/admin/locations', label: 'Locations',   icon: 'location'     },
    { route: '/admin/spacetypes',label: 'Space Types', icon: 'spacetype'    },
    { route: '/admin/spaces',    label: 'Spaces',      icon: 'spaces'       },
    { route: '/admin/bookings',  label: 'Bookings',    icon: 'bookings'     },
    { route: '/admin/pricing',   label: 'Pricing',     icon: 'pricing'      },
    { route: '/admin/payments',  label: 'Payments',    icon: 'payments'     },
    { route: '/admin/contacts',  label: 'Contacts',    icon: 'contacts'     },
    { route: '/admin/gallery',      label: 'Gallery',        icon: 'gallery'      },
    { route: '/admin/spaceconfig',   label: 'Space Config',   icon: 'spaceconfig'  },
  ];

  private auth = inject(AuthService);
  private router = inject(Router);

  constructor() {
    const u = this.auth.getUser();
    this.userRole = u?.roles?.[0] ?? 'Admin';
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
