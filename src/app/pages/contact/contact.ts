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
      const msg = 'Please fill in all required fields.';
      alert(msg);
      this.error.set(msg);
      return;
    }
    this.error.set('');

    this.contactService.submit(this.form).subscribe({
      next: (res) => {
        if (res.isSuccessful) {
          const msg = `Hi WorkNest! I just sent a message via the website.\n\nName: ${this.form.fullName}\nEmail: ${this.form.email}\nPhone: ${this.form.phone}\nMessage: ${this.form.message}`;
          this.contactService.sendWhatsApp(msg);
          this.submitted.set(true);
          setTimeout(() => {
            this.submitted.set(false);
            this.form = { fullName: '', email: '', phone: '', message: '' };
          }, 3000);
        } else {
          const msg = res.message || 'Failed to send message.';
          alert(msg);
          this.error.set(msg);
        }
      },
      error: (err) => {
        const msg = err.error?.message || 'Failed to send message. Please try again.';
        alert(msg);
        this.error.set(msg);
      }
    });
  }
}
