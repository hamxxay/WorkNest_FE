import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import {
  ACCOUNT_DISABLED,
  AuthResult,
  AuthService,
  SIGNED_OUT,
  authFailureCode,
} from '../../services/auth.service';

/** Seconds before "Resend email" can be pressed again (Firebase also limits how often it sends). */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * "Check your email" step of the sign-in and sign-up pages, shown while the signed-in Firebase user's email is
 * not verified (the API refuses it with EMAIL_NOT_VERIFIED). Sends the verification link (unless alreadySent),
 * resends it after a cooldown, and on "I've verified" reloads the Firebase user, takes a fresh ID token and
 * exchanges it with the API (AuthService.completeEmailVerification$).
 */
@Component({
  selector: 'app-verify-email',
  templateUrl: './verify-email.html',
  styleUrl: './verify-email.css'
})
export class VerifyEmail implements OnInit {
  private readonly authService = inject(AuthService);

  /** Where the link goes: the signed-in Firebase user's email. */
  readonly email = input.required<string>();
  readonly heading = input('Check your email');
  readonly subtitle = input('');
  readonly backLabel = input('Back to sign in');
  /** True when the link was just sent (sign-up): nothing is sent on open and the resend cooldown starts. */
  readonly alreadySent = input(false);

  /** The email is verified and the API signed the user in. */
  readonly verified = output<AuthResult>();
  /** Left this step (signed out of Firebase); carries a message for the form (e.g. account turned off) or null. */
  readonly back = output<string | null>();

  readonly sending = signal(false);
  readonly checking = signal(false);
  readonly leaving = signal(false);
  readonly sentOnce = signal(false);
  readonly cooldown = signal(0);
  readonly info = signal('');
  readonly error = signal('');

  readonly resendLabel = computed(() => {
    if (this.sending()) return 'Sending...';
    const wait = this.cooldown();
    return wait > 0 ? `Resend email (${wait}s)` : 'Resend email';
  });
  readonly confirmLabel = computed(() => this.checking() ? 'Checking...' : "I've verified");

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
  }

  ngOnInit(): void {
    if (this.alreadySent()) {
      this.sentOnce.set(true);
      this.startCooldown();
    } else {
      this.send(false);
    }
  }

  resend(): void {
    if (this.sending() || this.cooldown() > 0 || this.leaving()) return;
    this.send(true);
  }

  confirm(): void {
    if (this.checking() || this.leaving()) return;
    this.error.set('');
    this.info.set('');
    this.checking.set(true);

    this.authService.completeEmailVerification$().subscribe({
      next: res => {
        this.checking.set(false);
        this.verified.emit(res);
      },
      error: err => {
        this.checking.set(false);
        const message = err?.error?.message || 'Could not sign you in. Please try again.';
        const code = authFailureCode(err);
        // Turned off (already signed out of Firebase) or no Firebase user any more: back to the form with the reason.
        if (code === ACCOUNT_DISABLED || code === SIGNED_OUT) {
          this.back.emit(message);
          return;
        }
        this.error.set(message);
      }
    });
  }

  goBack(): void {
    if (this.leaving()) return;
    this.leaving.set(true);
    this.stopTimer();
    const done = () => this.back.emit(null);
    this.authService.cancelEmailVerification$().subscribe({ complete: done, error: done });
  }

  private send(isResend: boolean): void {
    this.error.set('');
    this.info.set('');
    this.sending.set(true);

    this.authService.sendVerificationEmail$().subscribe({
      next: () => {
        this.sending.set(false);
        this.sentOnce.set(true);
        if (isResend) {
          this.info.set(`A new link is on its way to ${this.email()}.`);
        }
        this.startCooldown();
      },
      error: err => {
        this.sending.set(false);
        const message = err?.error?.message || 'Could not send the verification email. Please try again.';
        const code = authFailureCode(err);
        if (code === SIGNED_OUT) {
          this.back.emit(message);
          return;
        }
        this.error.set(message);
        if (code === 'auth/too-many-requests') {
          this.startCooldown();
        }
      }
    });
  }

  private startCooldown(): void {
    this.stopTimer();
    this.cooldown.set(RESEND_COOLDOWN_SECONDS);
    this.timer = setInterval(() => {
      const next = this.cooldown() - 1;
      this.cooldown.set(Math.max(next, 0));
      if (next <= 0) this.stopTimer();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
