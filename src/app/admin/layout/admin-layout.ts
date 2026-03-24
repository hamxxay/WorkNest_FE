import { Component, OnInit, OnDestroy, computed, Signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.css'
})
export class AdminLayout implements OnInit, OnDestroy {
  sidebarCollapsed = false;
  mobileSidebarOpen = false;

  private destroy$ = new Subject<void>();

  // reactive references will be set in constructor because they rely
  // on authService which isn't available during field initialization.
  user!: Signal<any>;
  initials!: Signal<string>;
  userName!: Signal<string>;

  constructor(private authService: AuthService, private router: Router) {
    // assign after dependencies are ready
    this.user = this.authService.user;
    this.initials = computed(() => {
      const u = this.user();
      if (!u) return '?';
      const name = (u.email || '').split('@')[0];
      const parts = name.split(/[._-]/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return name.substring(0, 2).toUpperCase();
    });
    this.userName = computed(() => {
      const u = this.user();
      if (!u) return 'Admin';
      return (u.email || '').split('@')[0].split(/[._-]/).map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    });
  }

  // Close mobile sidebar when navigating
  ngOnInit() {
    this.router.events
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.mobileSidebarOpen = false;
      });
  }

  ngOnDestroy() {
    // complete any active streams to avoid memory leaks
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  // helper methods replaced by `initials` and `userName` computed signals above

  logout() {
    this.authService.logout$().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }
  toggleMobileSidebar() {
    this.mobileSidebarOpen = !this.mobileSidebarOpen;
  }

  closeMobileSidebar() {
    this.mobileSidebarOpen = false;
  }

  menuItems = [
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
    { label: 'Home', icon: 'home', route: '/' }
  ];
}
