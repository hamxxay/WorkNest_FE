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
  private readonly fallbackRedirect = '/';

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  onSubmit() {
    if (!this.email || !this.password) {
      this.error.set('Please fill in all fields.');
      return;
    }
    this.error.set('');
    this.loading.set(true);

    this.authService.login(this.email, this.password).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.isSuccessful) {
          this.router.navigateByUrl(this.getRedirectUrl());
        } else {
          this.error.set(res.message || 'Login failed.');
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.message || 'Invalid email or password.');
      }
    });
  }

  signInWithGoogle() {
    this.error.set('');
    this.socialLoading.set('google');

    this.authService.loginWithGoogle().subscribe({
      next: () => {
        this.socialLoading.set(null);
        this.router.navigateByUrl(this.getRedirectUrl());
      },
      error: (err) => {
        this.socialLoading.set(null);
        this.error.set(err.error?.message || 'Google sign-in failed. Please try again.');
      }
    });
  }

  continueAsGuest() {
    this.authService.continueAsGuest();
    this.router.navigateByUrl(this.getRedirectUrl());
  }

  private getRedirectUrl(): string {
    return this.route.snapshot.queryParamMap.get('redirect') || this.fallbackRedirect;
  }
}
