import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContactService } from '../../services/contact.service';

@Component({
  selector: 'app-contact',
  imports: [FormsModule, RouterLink],
  templateUrl: './contact.html',
  styleUrl: './contact.css'
})
export class Contact {
  form = {
    fullName: '',
    email: '',
    phone: '',
    message: ''
  };

  submitted = signal(false);
  error = signal('');

  constructor(private contactService: ContactService) {}

  onSubmit() {
    if (!this.form.fullName || !this.form.email || !this.form.message) {
      this.error.set('Please fill in all required fields.');
      return;
    }
    this.error.set('');

    this.contactService.submit(this.form).subscribe({
      next: (res) => {
        if (res.isSuccessful) {
          this.submitted.set(true);
          setTimeout(() => {
            this.submitted.set(false);
            this.form = { fullName: '', email: '', phone: '', message: '' };
          }, 3000);
        } else {
          this.error.set(res.message || 'Failed to send message.');
        }
      },
      error: (err) => {
        this.error.set(err.error?.message || 'Failed to send message. Please try again.');
      }
    });
  }
}
