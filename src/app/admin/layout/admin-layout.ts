import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.css'
})
export class AdminLayout {
  sidebarCollapsed = false;

  private readonly allMenuItems = [
    { label: 'Dashboard', icon: 'dashboard', route: '/admin', roles: ['Admin'] },
    { label: 'Users', icon: 'users', route: '/admin/users', roles: ['Admin'] },
    { label: 'Locations', icon: 'location', route: '/admin/locations', roles: ['Admin'] },
    { label: 'Space Types', icon: 'spacetype', route: '/admin/space-types', roles: ['Admin'] },
    { label: 'Spaces', icon: 'spaces', route: '/admin/spaces', roles: ['Admin'] },
    { label: 'Bookings', icon: 'bookings', route: '/admin/bookings', roles: ['Admin', 'Receptionist'] },
    { label: 'Pricing Plans', icon: 'pricing', route: '/admin/pricing', roles: ['Admin'] },
    { label: 'Memberships', icon: 'memberships', route: '/admin/memberships', roles: ['Admin'] },
    { label: 'Payments', icon: 'payments', route: '/admin/payments', roles: ['Admin'] },
    { label: 'Contacts', icon: 'contacts', route: '/admin/contacts', roles: ['Admin'] },
    { label: 'Gallery', icon: 'gallery', route: '/admin/gallery', roles: ['Admin'] },
  ];

  constructor(private authService: AuthService, private router: Router) {}

  get menuItems() {
    return this.allMenuItems.filter(item =>
      item.roles.some(r => this.authService.hasRole(r))
    );
  }

  get userRole(): string {
    return this.authService.hasRole('Admin') ? 'Administrator' : 'Receptionist';
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  getInitials(): string {
    const user = this.authService.getUser();
    if (!user) return '?';
    const name = (user.email || '').split('@')[0];
    const parts = name.split(/[._-]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  }

  getUserName(): string {
    const user = this.authService.getUser();
    if (!user) return 'Admin';
    return (user.email || '').split('@')[0].split(/[._-]/).map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
