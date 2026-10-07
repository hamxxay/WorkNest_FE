import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { AdminService } from '../../../services/admin.service';
import { ToastService } from '../../../services/toast.service';

/** Signed-in staff member's own profile: view details, edit name and phone, change password. */
@Component({
  selector: 'app-admin-profile',
  imports: [FormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.css'
})
export class AdminProfile implements OnInit {
  private auth = inject(AuthService);
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly changingPassword = signal(false);
  readonly passwordError = signal('');

  email = '';
  role = '';
  locationName = '';
  name = '';
  phone = '';
  private savedName = '';
  private savedPhone = '';

  readonly passwordSignIn = this.auth.hasPasswordSignIn();
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  ngOnInit(): void {
    this.auth.getMyProfile().subscribe({
      next: data => {
        if (!data) {
          this.loadError.set('Could not load your profile.');
        } else {
          this.email = data.email ?? this.auth.getUser()?.email ?? '';
          this.role = this.formatRole(data.role ?? data.roles?.[0] ?? '');
          this.name = this.savedName = data.name ?? '';
          this.phone = this.savedPhone = data.phone ?? '';
          if (data.locationId) this.loadLocationName(Number(data.locationId));
        }
        this.loading.set(false);
      },
      error: err => {
        this.loadError.set(err?.error?.message || 'Could not load your profile.');
        this.loading.set(false);
      }
    });
  }

  get initials(): string {
    const source = (this.name || this.email.split('@')[0] || '?').trim();
    const parts = source.split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2)).toUpperCase();
  }

  get hasChanges(): boolean {
    return this.name.trim() !== this.savedName || this.phone.trim() !== this.savedPhone;
  }

  saveProfile(): void {
    if (!this.name.trim()) {
      this.toast.error('Name is required.');
      return;
    }
    this.saving.set(true);
    this.auth.updateMyProfile(this.name.trim(), this.phone.trim()).subscribe({
      next: data => {
        this.name = this.savedName = data?.name ?? this.name.trim();
        this.phone = this.savedPhone = data?.phone ?? this.phone.trim();
        this.saving.set(false);
        this.toast.success('Your profile has been updated.');
      },
      error: err => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || 'Could not save your profile.');
      }
    });
  }

  resetProfile(): void {
    this.name = this.savedName;
    this.phone = this.savedPhone;
  }

  changePassword(): void {
    this.passwordError.set('');
    if (!this.currentPassword || !this.newPassword) {
      this.passwordError.set('Enter your current and new password.');
      return;
    }
    if (this.newPassword.length < 8) {
      this.passwordError.set('The new password must be at least 8 characters.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.passwordError.set("The new passwords don't match.");
      return;
    }
    this.changingPassword.set(true);
    this.auth.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.currentPassword = this.newPassword = this.confirmPassword = '';
        this.toast.success('Your password has been changed.');
      },
      error: (err: Error) => {
        this.changingPassword.set(false);
        this.passwordError.set(err.message);
      }
    });
  }

  private loadLocationName(id: number): void {
    this.admin.getLocations(1, 500).subscribe({
      next: (res: any) => {
        const items: any[] = res?.data ?? (Array.isArray(res) ? res : []);
        const loc = items.find(l => Number(l.id ?? l.locationId) === id);
        this.locationName = loc?.name ?? loc?.locationName ?? '';
      },
      error: () => undefined
    });
  }

  private formatRole(role: string): string {
    return (role || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
