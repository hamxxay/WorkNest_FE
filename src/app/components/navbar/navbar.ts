// ============================================================
// Navigation Bar Component
// ============================================================
// This component provides the main navigation bar for the application.
// Features include:
// - Navigation links to different pages
// - Mobile menu toggle
// - User profile dropdown (when logged in)
// - Logout functionality
// - Responsive design for mobile and desktop
// - Sticky header behavior on scroll

import { Component, signal, computed, Signal, HostListener, ElementRef } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css'
})
export class Navbar {
  // Signal to track if mobile menu is open
  mobileOpen = signal(false);
  
  // Signal to track if user has scrolled (for sticky header effect)
  scrolled = signal(false);
  
  // Signal to track if user profile dropdown is open
  profileOpen = signal(false);

  // expose the reactive user signal from the auth service
  user!: Signal<any>;

  // derived view state – computed so templates don't re‑parse localStorage
  initials = computed(() => {
    const u = this.user();
    if (!u) return '?';
    const name = (u.email || '').split('@')[0];
    const parts = name.split(/[._-]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  });

  displayName = computed(() => {
    const u = this.user();
    if (!u) return 'User';
    const name = (u.email || '').split('@')[0];
    return name
      .split(/[._-]/)
      .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  });

  email = computed(() => this.user()?.email || '');
  roles = computed(() => this.user()?.roles || []);
  isAdmin = computed(() => this.authService.hasRole('Admin'));
  loggedIn = computed(() => !!this.user());

  constructor(
    public authService: AuthService,
    private router: Router,
    private elRef: ElementRef // Reference to the component's DOM element
  ) {
    this.user = this.authService.user;
  }

  /**
   * HostListener: Listens to window scroll events
   * Updates scrolled signal when user scrolls more than 20px
   * Used to add shadow/style to navbar when scrolling
   */
  @HostListener('window:scroll')
  onScroll() {
    this.scrolled.set(window.scrollY > 20);
  }

  @HostListener('window:resize')
  onResize() {
    if (window.innerWidth > 900 && this.mobileOpen()) {
      this.closeMobile();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.mobileOpen()) {
      this.closeMobile();
    }
  }

  /**
   * HostListener: Listens to global document click events
   * Closes profile dropdown when user clicks outside of it
   * Provides better UX for mobile and desktop users
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    // Check if profile dropdown is open
    if (this.profileOpen()) {
      // Get the profile dropdown element
      const profileEl = this.elRef.nativeElement.querySelector('.profile-wrapper');
      // If dropdown exists and click target is outside of it, close it
      if (profileEl && !profileEl.contains(event.target as Node)) {
        this.profileOpen.set(false);
      }
    }
  }

  /**
   * Toggle mobile menu visibility
   * Used in responsive design for small screens
   */
  toggleMobile() {
    const nextState = !this.mobileOpen();
    this.mobileOpen.set(nextState);
    document.body.style.overflow = nextState ? 'hidden' : '';
    if (!nextState) {
      this.profileOpen.set(false);
    }
  }

  /**
   * Close mobile menu
   * Called when user clicks on a navigation link on mobile
   */
  closeMobile() {
    this.mobileOpen.set(false);
    this.profileOpen.set(false);
    document.body.style.overflow = '';
  }

  /**
   * Toggle user profile dropdown visibility
   */
  toggleProfile() {
    this.profileOpen.update(v => !v);
  }

  /**
   * Handle user logout
   * Clears authentication data and redirects to home
   */
  logout() {
    // Call auth service logout observable so server cookie is cleared
    this.authService.logout$().subscribe(() => {
      // Close open dropdowns
      this.profileOpen.set(false);
      this.closeMobile();
      // Redirect to home page
      this.router.navigate(['/']);
    });
  }

  // Old helper methods have been replaced by computed signals above.
  // The logic remains here only for reference and may be removed later.
}
