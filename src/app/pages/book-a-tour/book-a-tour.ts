import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContactService } from '../../services/contact.service';

@Component({
  selector: 'app-book-a-tour',
  imports: [FormsModule, RouterLink],
  templateUrl: './book-a-tour.html',
  styleUrl: './book-a-tour.css'
})
export class BookATour {
  form = {
    fullName: '',
    email: '',
    phone: '',
    preferredDate: '',
    timeSlot: '',
    message: ''
  };

  submitted = signal(false);
  loading = signal(false);
  error = signal('');

  timeSlots = [
    '09:00 AM – 10:00 AM',
    '10:00 AM – 11:00 AM',
    '11:00 AM – 12:00 PM',
    '12:00 PM – 01:00 PM',
    '02:00 PM – 03:00 PM',
    '03:00 PM – 04:00 PM',
    '04:00 PM – 05:00 PM',
  ];

  get minDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  constructor(private contactService: ContactService) {}

  onSubmit() {
    if (!this.form.fullName || !this.form.email || !this.form.phone || !this.form.preferredDate || !this.form.timeSlot) {
      this.error.set('Please fill in all required fields.');
      return;
    }
    this.error.set('');
    this.loading.set(true);

    const summary = `${this.form.preferredDate} ${this.form.timeSlot}`;
    const notes = this.form.message ? ` | ${this.form.message}` : '';
    const payload = {
      fullName: this.form.fullName,
      email: this.form.email,
      phone: this.form.phone.slice(0, 20),
      message: `Tour: ${summary}${notes}`.slice(0, 100)
    };

    this.contactService.submit(payload).subscribe({
      next: () => {
        this.loading.set(false);
        this.submitted.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        const detail = err.error?.detail;
        const msg = Array.isArray(detail)
          ? detail.map((d: any) => d.msg).join(', ')
          : err.error?.message || err.error?.detail || 'Failed to submit. Please try again.';
        this.error.set(msg);
      }
    });
  }
}
