import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-signup',
  imports: [FormsModule, RouterLink],
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
      this.error.set('Please fill in all fields.');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error.set('Passwords do not match.');
      return;
    }
    if (this.password.length < 8) {
      this.error.set('Password must be at least 8 characters.');
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
          this.success.set('Account created successfully! Redirecting to login...');
          setTimeout(() => this.router.navigate(['/login']), 2000);
        } else {
          this.error.set(res.message || 'Registration failed.');
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.message || 'Registration failed. Please try again.');
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
        this.error.set(err.error?.message || 'Social sign-up failed. Please try again.');
      }
    });
  }

  private getRedirectUrl(): string {
    return this.route.snapshot.queryParamMap.get('redirect') || this.fallbackRedirect;
  }
}
