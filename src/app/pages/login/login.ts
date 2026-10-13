import { publicSiteUrl } from '../../utils/public-site';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class Login {
  email = '';
  password = '';
  showPassword = false;
  loading = signal(false);
  error = signal('');
  socialLoading = signal<'google' | null>(null);

  // Forgot password
  showForgotPassword = false;
  resetEmail = '';
  resetLoading = signal(false);
  resetSuccess = signal(false);
  resetError = signal('');

  private readonly fallbackRedirect = '/booking';

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  onSubmit() {
    if (!this.email || !this.password) {
      const msg = 'Please fill in all fields.';
      alert(msg);
      this.error.set(msg);
      return;
    }
    this.error.set('');
    this.loading.set(true);

    this.authService.login(this.email, this.password).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.isSuccessful) {
          if (!this.isStaff(res.data)) { this.sendCustomerToPublicSite(); return; }
          this.router.navigateByUrl(this.getRoleBasedRedirect(res.data));
        } else {
          const msg = res.message || 'Login failed.';
          alert(msg);
          this.error.set(msg);
        }
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err.error?.message || 'Invalid email or password.';
        alert(msg);
        this.error.set(msg);
      }
    });
  }

  signInWithGoogle() {
    this.error.set('');
    this.socialLoading.set('google');

    this.authService.loginWithGoogle().subscribe({
      next: (res) => {
        this.socialLoading.set(null);
        if (!this.isStaff(res.data)) { this.sendCustomerToPublicSite(); return; }
        this.router.navigateByUrl(this.getRoleBasedRedirect(res.data));
      },
      error: (err) => {
        this.socialLoading.set(null);
        const msg = err.error?.message || 'Google sign-in failed. Please try again.';
        alert(msg);
        this.error.set(msg);
      }
    });
  }

  continueAsGuest() {
    // The CMS is staff-only: guests browse the public website instead.
    window.location.href = publicSiteUrl('/login');
  }


  openForgotPassword() {
    this.resetEmail = this.email;
    this.resetError.set('');
    this.resetSuccess.set(false);
    this.showForgotPassword = true;
  }

  closeForgotPassword() {
    this.showForgotPassword = false;
    this.resetEmail = '';
    this.resetError.set('');
    this.resetSuccess.set(false);
  }

  submitReset() {
    if (!this.resetEmail) {
      const msg = 'Please enter your email address.';
      alert(msg);
      this.resetError.set(msg);
      return;
    }
    this.resetError.set('');
    this.resetLoading.set(true);

    this.authService.resetPassword$(this.resetEmail).subscribe({
      next: () => {
        this.resetLoading.set(false);
        this.resetSuccess.set(true);
      },
      error: (err) => {
        this.resetLoading.set(false);
        const code = err?.code ?? '';
        const msg = (code === 'auth/user-not-found' || code === 'auth/invalid-email')
          ? 'No account found with that email address.'
          : (err.error?.message || 'Failed to send reset email. Please try again.');
        alert(msg);
        this.resetError.set(msg);
      }
    });
  }

  /** Super admin, admin, sales executive and receptionist use the CMS; everyone else is a customer. */
  private isStaff(user?: any): boolean {
    const staff = ['superadmin', 'admin', 'salesexecutive', 'receptionist'];
    const roles: string[] = user?.roles ?? [];
    return roles.some(r => staff.includes(String(r).toLowerCase().replace(/[\s_]/g, '')));
  }

  /**
   * Customers use worknestpk.com: hand the session over (they arrive there signed in) and end it here.
   * The token goes after '#', which the browser never sends to a server; the site removes it on arrival.
   */
  private sendCustomerToPublicSite() {
    this.error.set('This portal is for WorkNest staff. Taking you to worknestpk.com...');
    const token = this.authService.getToken();
    const url = token
      ? `${publicSiteUrl(this.customerLandingPath())}#handoff=${encodeURIComponent(token)}`
      : publicSiteUrl('/login');
    const go = () => { window.location.replace(url); };
    // keepApiSession: the token was just handed to worknestpk.com, so only this portal's session ends here.
    this.authService.logout$({ keepApiSession: true }).subscribe({ next: go, error: go });
  }

  /** A customer page asked for in ?redirect= (My Bookings / Payments / Agreements), otherwise the home page. */
  private customerLandingPath(): string {
    const redirect = this.route.snapshot.queryParamMap.get('redirect') || '';
    return /^\/my-[a-z-]+(\?.*)?$/.test(redirect) ? redirect : '/';
  }

  private getRoleBasedRedirect(user?: any): string {
    const roles: string[] = user?.roles ?? [];
    const isSales = roles.some(r => String(r).toLowerCase().replace(/[\s_]/g, '') === 'salesexecutive');
    if (isSales) return '/admin/dashboard';
    const isAdmin = roles.some(r => {
      const norm = String(r).toLowerCase().replace(/[\s_]/g, '');
      return norm === 'admin' || norm === 'superadmin';
    });
    if (isAdmin) return '/admin/dashboard';
    const redirectParam = this.route.snapshot.queryParamMap.get('redirect');
    return redirectParam || this.fallbackRedirect;
  }

  private getRedirectUrl(): string {
    return this.route.snapshot.queryParamMap.get('redirect') || this.fallbackRedirect;
  }
}
