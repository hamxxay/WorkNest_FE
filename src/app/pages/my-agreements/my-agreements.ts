import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AgreementService } from '../../services/agreement.service';
import { AuthService } from '../../services/auth.service';
import { ESignPanel } from './esign-panel';

type Stage = 'sign' | 'review' | 'booked' | 'other';

/**
 * Customer portal: agreements sent to me. Either sign electronically (the booking is created straight away),
 * or download the agreement, print and sign it, and upload the signed copy with the date I signed it (held for
 * admin verification). Shows when my booking is confirmed.
 */
@Component({
  selector: 'app-my-agreements',
  imports: [DatePipe, DecimalPipe, RouterLink, ESignPanel],
  templateUrl: './my-agreements.html',
  styleUrl: './my-agreements.css'
})
export class MyAgreements implements OnInit {
  private agreements = inject(AgreementService);
  private auth = inject(AuthService);

  loading = signal(true);
  items = signal<any[]>([]);
  error = signal('');
  success = signal('');

  // Upload form (one agreement at a time)
  uploadFor = signal<number | null>(null);
  file = signal<File | null>(null);
  signedDate = signal('');
  uploading = signal(false);
  busyDownload = signal<number | null>(null);

  // E-signature panel (one agreement at a time)
  esignFor = signal<number | null>(null);

  ngOnInit() { this.load(); }

  load() {
    this.agreements.getMyAgreements().subscribe({
      next: (res: any) => {
        const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        this.items.set(rows);
        this.loading.set(false);
      },
      error: () => { this.items.set([]); this.loading.set(false); this.error.set('Could not load your agreements.'); }
    });
  }

  id(a: any): number { return Number(a.id ?? a.Id); }

  stage(a: any): Stage {
    if (a.bookingId ?? a.BookingId) return 'booked';
    const status = String(a.status ?? a.Status ?? '').toLowerCase();
    if (status === 'signeduploaded' || (a.hasSignedCopy ?? a.HasSignedCopy)) return 'review';
    if (status === 'agreementsent' || status === 'sent' || status === 'emailfailed') return 'sign';
    return 'other';
  }

  /** A newer agreement was sent for the same quotation: only the latest one can be signed online. */
  superseded(a: any): boolean {
    const q = Number(a.quotationId ?? a.QuotationId);
    return this.items().some(o => Number(o.quotationId ?? o.QuotationId) === q && this.id(o) > this.id(a));
  }

  signerName(a: any): string {
    return a.customerName || a.CustomerName || this.auth.getUser()?.displayName || '';
  }

  openESign(a: any) {
    this.uploadFor.set(null);
    this.esignFor.set(this.id(a));
    this.error.set('');
    this.success.set('');
  }
  closeESign() { this.esignFor.set(null); }
  onESigned(message: string) {
    this.esignFor.set(null);
    this.success.set(message);
    this.load();
  }

  todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  minDate(a: any): string {
    const sent = a.sentDate ?? a.SentDate;
    return sent ? String(sent).slice(0, 10) : '';
  }

  openUpload(a: any) {
    this.esignFor.set(null);
    this.uploadFor.set(this.id(a));
    this.file.set(null);
    this.signedDate.set(this.todayIso());
    this.error.set('');
    this.success.set('');
  }
  cancelUpload() { if (!this.uploading()) this.uploadFor.set(null); }

  onFile(event: any) {
    const f: File | undefined = event?.target?.files?.[0];
    this.error.set('');
    if (f && !(f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))) { this.error.set('Please choose a PDF file.'); this.file.set(null); return; }
    if (f && f.size > 10 * 1024 * 1024) { this.error.set('The file is larger than 10 MB.'); this.file.set(null); return; }
    this.file.set(f ?? null);
  }

  submit() {
    const id = this.uploadFor();
    const f = this.file();
    const d = this.signedDate();
    if (!id || !f || !d || this.uploading()) return;
    this.uploading.set(true);
    this.agreements.uploadMySignedAgreement(id, f, d).subscribe({
      next: (res: any) => {
        this.uploading.set(false);
        this.uploadFor.set(null);
        this.success.set(res?.message || 'Your signed agreement was received. We will verify it and confirm your booking.');
        this.load();
      },
      error: (err: any) => {
        this.uploading.set(false);
        this.error.set(err?.error?.message || 'Upload failed. Please try again.');
      }
    });
  }

  download(a: any, signed = false) {
    const id = this.id(a);
    this.busyDownload.set(id);
    const req = signed ? this.agreements.getMySignedPdf(id) : this.agreements.getMyAgreementPdf(id);
    req.subscribe({
      next: (blob: Blob) => {
        this.busyDownload.set(null);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `WorkNest-Agreement-${id}${signed ? '-signed' : ''}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
      error: () => { this.busyDownload.set(null); this.error.set('Could not download the agreement.'); }
    });
  }
}
