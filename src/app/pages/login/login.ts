// ============================================================
// Login Page Component
// ============================================================
// This component handles user login functionality.
// It collects email and password from the user, validates them,
// and submits them to the authentication service.
// On successful login, user is redirected to home page.
// On failure, error messages are displayed.

import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class Login {
  // Two-way binding for email input field
  email = '';
  
  // Two-way binding for password input field
  password = '';
  
  // Toggle for showing/hiding password field
  showPassword = false;
  
  // Signal for tracking login loading state
  // Signal provides fine-grained reactivity in Angular 21+
  loading = signal(false);
  
  // Signal for error messages to display to user
  error = signal('');

  constructor(private authService: AuthService, private router: Router) {}

  /**
   * Handle form submission on login
   * Validates inputs, calls auth service, and handles response
   */
  onSubmit() {
    // Validate that both email and password are provided
    if (!this.email || !this.password) {
      this.error.set('Please fill in all fields.');
      return;
    }
    
    // Clear any previous error messages
    this.error.set('');
    
    // Set loading state to true (button becomes disabled, loader shows)
    this.loading.set(true);

    // Call the auth service login method
    this.authService.login(this.email, this.password).subscribe({
      // Handle successful response
      next: (res) => {
        this.loading.set(false);
        // Check if backend returned success status
        if (res.isSuccessful) {
          // Navigate to home page on successful login
          this.router.navigate(['/']);
        } else {
          // Display error message from backend
          this.error.set(res.message || 'Login failed.');
        }
      },
      // Handle error response
      error: (err) => {
        this.loading.set(false);
        // Display error message from backend or generic message
        this.error.set(err.error?.message || 'Invalid email or password.');
      }
    });
  }
}
