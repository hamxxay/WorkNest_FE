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
    this.authService.continueAsGuest();
    this.router.navigateByUrl(this.getRedirectUrl());
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

  private getRoleBasedRedirect(user?: any): string {
    const roles: string[] = user?.roles ?? [];
    const isSales = roles.some(r => String(r).toLowerCase().replace(/[\s_]/g, '') === 'salesexecutive');
    if (isSales) return '/admin/quotations';
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
