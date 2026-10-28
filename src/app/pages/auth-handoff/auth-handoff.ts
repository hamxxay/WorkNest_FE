import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { takeHandoffCode } from '../../utils/public-site';

/**
 * /auth/handoff#code=...: staff who signed in on worknestpk.com arrive here with a one-time code and land on their
 * dashboard signed in (the same page as after signing in here). A missing, expired or used code shows the sign-in page
 * with a short message.
 */
@Component({
  selector: 'app-auth-handoff',
  template: `<p class="handoff-wait">Signing you in...</p>`,
  styles: [`.handoff-wait { padding: 96px 16px; text-align: center; color: #64748b; }`]
})
export class AuthHandoff implements OnInit {
  constructor(private authService: AuthService, private router: Router) {}

  ngOnInit(): void {
    const code = takeHandoffCode();
    if (!code) { this.failed(); return; }
    this.authService.redeemHandoff$(code).subscribe({
      // The API only redeems a CMS code for staff, so the role decides the dashboard as after any sign-in.
      next: () => { void this.router.navigateByUrl(this.authService.getPostLoginRedirect(), { replaceUrl: true }); },
      error: () => this.failed()
    });
  }

  private failed(): void {
    void this.router.navigate(['/login'], { queryParams: { handoff: 'expired' }, replaceUrl: true });
  }
}
