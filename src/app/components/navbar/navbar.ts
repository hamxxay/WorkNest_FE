import { Component, signal, computed, Signal, HostListener, ElementRef, OnDestroy } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css'
})
export class Navbar implements OnDestroy {
  mobileOpen = signal(false);
  scrolled = signal(false);
  profileOpen = signal(false);
  locationOpen = signal(false);
  currentUrl = signal('/');
  user!: Signal<any>;

  initials = computed(() => {
    const u = this.user();
    if (!u) return '?';
    if (u.userId === 'guest') return 'G';
    if (u.displayName) {
      const parts = u.displayName.trim().split(' ');
      return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
    }
    const name = (u.email || '').split('@')[0];
    const parts = name.split(/[._-]/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  });

  displayName = computed(() => {
    const u = this.user();
    if (!u) return 'User';
    if (u.userId === 'guest') return 'Guest';
    if (u.displayName) return u.displayName;
    const name = (u.email || '').split('@')[0];
    return name
      .split(/[._-]/)
      .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
  });

  email = computed(() => this.user()?.email || '');
  roles = computed(() => this.user()?.roles || []);
  isAdmin = computed(() => this.authService.hasRole('Admin'));
  isGuest = computed(() => this.authService.isGuest());
  loggedIn = computed(() => !!this.user());
  overHero = computed(() => this.currentUrl() === '/' && !this.scrolled() && !this.mobileOpen());
  private routerEventsSub: Subscription;

  constructor(/*  */
    public authService: AuthService,
    private router: Router,
    private elRef: ElementRef
  ) {
    this.user = this.authService.user;
    this.currentUrl.set(this.router.url.split('?')[0] || '/');
    this.routerEventsSub = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.currentUrl.set(event.urlAfterRedirects.split('?')[0] || '/');
        this.onScroll();
      }
    });
  }

  @HostListener('window:scroll')
  onScroll() {
    this.scrolled.set(window.scrollY > 20);
  }

  @HostListener('window:resize')
  onResize() {
    if (window.innerWidth > 1024 && this.mobileOpen()) {
      this.closeMobile();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.mobileOpen()) {
      this.closeMobile();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.profileOpen()) {
      const profileEl = this.elRef.nativeElement.querySelector('.profile-wrapper');
      if (profileEl && !profileEl.contains(event.target as Node)) {
        this.profileOpen.set(false);
      }
    }
    if (this.locationOpen()) {
      const locEl = this.elRef.nativeElement.querySelector('.nav-dropdown-wrap');
      if (locEl && !locEl.contains(event.target as Node)) {
        this.locationOpen.set(false);
      }
    }
  }

  toggleMobile() {
    const nextState = !this.mobileOpen();
    this.mobileOpen.set(nextState);
    document.body.style.overflow = nextState ? 'hidden' : '';
    if (!nextState) {
      this.profileOpen.set(false);
    }
  }

  closeMobile() {
    this.mobileOpen.set(false);
    this.profileOpen.set(false);
    this.locationOpen.set(false);
    document.body.style.overflow = '';
  }

  toggleLocation() {
    this.locationOpen.update(v => !v);
  }

  toggleProfile() {
    this.profileOpen.update(v => !v);
  }

  logout() {
    this.authService.logout$().subscribe(() => {
      this.profileOpen.set(false);
      this.closeMobile();
      this.router.navigate(['/']);
    });
  }

  ngOnDestroy() {
    this.routerEventsSub.unsubscribe();
    document.body.style.overflow = '';
  }
}
