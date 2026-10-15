import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthResult, AuthService, EMAIL_NOT_VERIFIED, authFailureCode } from '../../services/auth.service';
import { VerifyEmail } from '../../components/verify-email/verify-email';
import { handOffToPublicSite } from '../../utils/public-site';

@Component({
  selector: 'app-signup',
  imports: [FormsModule, RouterLink, VerifyEmail],
  templateUrl: './signup.html',
  styleUrl: './signup.css'
})
export class Signup {
  fullName = '';
  email = '';
  password = '';
  confirmPassword = '';
  showPassword = false;
  showConfirm = false;
  loading = signal(false);
  error = signal('');
  success = signal('');
  socialLoading = signal<'google' | null>(null);
  /** Set while the "Check your email" step is shown: the new account's email. */
  verifyEmail = signal<string | null>(null);
  /** The verification email went out with the sign-up (else the step sends it when it opens). */
  verificationSent = signal(false);
  private readonly fallbackRedirect = '/';

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  onSubmit() {
    this.error.set('');
    this.success.set('');

    if (!this.fullName || !this.email || !this.password || !this.confirmPassword) {
      const msg = 'Please fill in all fields.';
      alert(msg);
      this.error.set(msg);
      return;
    }
    if (this.password !== this.confirmPassword) {
      const msg = 'Passwords do not match.';
      alert(msg);
      this.error.set(msg);
      return;
    }
    if (this.password.length < 8) {
      const msg = 'Password must be at least 8 characters.';
      alert(msg);
      this.error.set(msg);
      return;
    }

    this.loading.set(true);

    const nameParts = this.fullName.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || undefined;

    this.authService.register(this.email, this.password, firstName, lastName).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.isSuccessful) {
          // The API only accepts the account once its email is verified: show "Check your email".
          this.verificationSent.set(res.emailSent);
          this.verifyEmail.set(this.authService.pendingVerificationEmail() || this.email);
        } else {
          const msg = res.message || 'Registration failed.';
          alert(msg);
          this.error.set(msg);
        }
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err.error?.message || 'Registration failed. Please try again.';
        alert(msg);
        this.error.set(msg);
      }
    });
  }

  signUpWithGoogle() {
    this.signInWithSocial('google');
  }

  private signInWithSocial(provider: 'google') {
    this.error.set('');
    this.success.set('');
    this.socialLoading.set(provider);

    this.authService.loginWithGoogle().subscribe({
      next: () => {
        this.socialLoading.set(null);
        this.router.navigateByUrl(this.getRedirectUrl());
      },
      error: (err) => {
        this.socialLoading.set(null);
        if (authFailureCode(err) === EMAIL_NOT_VERIFIED && this.authService.pendingVerificationEmail()) {
          this.verificationSent.set(false);
          this.verifyEmail.set(this.authService.pendingVerificationEmail());
          return;
        }
        const msg = err.error?.message || 'Social sign-up failed. Please try again.';
        alert(msg);
        this.error.set(msg);
      }
    });
  }

  /** The email is verified and the API signed the user in: staff go to their page, customers to worknestpk.com. */
  onEmailVerified(res: AuthResult) {
    this.verifyEmail.set(null);
    const staff = ['superadmin', 'admin', 'salesexecutive', 'receptionist', 'ceo', 'salesmanager', 'accessofficer'];
    const isStaff = (res.data?.roles ?? []).some(r => staff.includes(String(r).toLowerCase().replace(/[\s_]/g, '')));
    if (isStaff) {
      this.router.navigateByUrl(this.authService.getPostLoginRedirect());
      return;
    }
    this.success.set('Email verified. Taking you to worknestpk.com...');
    handOffToPublicSite(this.authService, '/');
  }

  /** Left the "Check your email" step (signed out of Firebase); message = why (e.g. account turned off), else null. */
  onVerificationBack(message: string | null) {
    this.verifyEmail.set(null);
    if (message) {
      alert(message);
      this.error.set(message);
    }
  }

  private getRedirectUrl(): string {
    return this.route.snapshot.queryParamMap.get('redirect') || this.fallbackRedirect;
  }
}
