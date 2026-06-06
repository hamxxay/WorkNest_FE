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

  readonly menuItems = [
    { label: 'Dashboard', icon: 'dashboard', route: '/admin' },
    { label: 'Users', icon: 'users', route: '/admin/users' },
    { label: 'Locations', icon: 'location', route: '/admin/locations' },
    { label: 'Space Types', icon: 'spacetype', route: '/admin/space-types' },
    { label: 'Spaces', icon: 'spaces', route: '/admin/spaces' },
    { label: 'Bookings', icon: 'bookings', route: '/admin/bookings' },
    { label: 'Pricing Plans', icon: 'pricing', route: '/admin/pricing' },
    { label: 'Memberships', icon: 'memberships', route: '/admin/memberships' },
    { label: 'Payments', icon: 'payments', route: '/admin/payments' },
    { label: 'Contacts', icon: 'contacts', route: '/admin/contacts' },
    { label: 'Gallery', icon: 'gallery', route: '/admin/gallery' },
  ];

  constructor(private authService: AuthService, private router: Router) {}

  get userRole(): string {
    const user = this.authService.getUser();
    const roles = user?.roles ?? [];
    if (roles.some(r => r.toLowerCase() === 'admin')) return 'Administrator';
    if (roles.some(r => r.toLowerCase() === 'receptionist')) return 'Receptionist';
    return 'User';
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
