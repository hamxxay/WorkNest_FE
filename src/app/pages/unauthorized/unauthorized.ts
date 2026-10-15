import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-unauthorized',
  templateUrl: './unauthorized.html',
  styleUrl: './unauthorized.css'
})
export class Unauthorized {
  constructor(private auth: AuthService, private router: Router) {}

  goHome() {
    if (this.auth.isCeoOnly()) {
      this.router.navigate(['/admin/ceo']);
    } else if (this.auth.isSalesManagerOnly()) {
      this.router.navigate(['/admin/sales-manager']);
    } else if (this.auth.isAccessOfficerOnly()) {
      this.router.navigate(['/admin/access']);
    } else if (this.auth.hasRole('admin')) {
      this.router.navigate(['/admin']);
    } else {
      this.router.navigate(['/']);
    }
  }
}
