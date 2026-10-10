import { Component, ElementRef, OnDestroy, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AgreementService } from '../../services/agreement.service';

type SignMode = 'draw' | 'type';

/** Font used for the typed signature (loaded in index.html; cursive fallbacks). */
const SIGNATURE_FONT = `'Dancing Script', 'Brush Script MT', 'Segoe Script', cursive`;

/**
 * Customer portal: sign an agreement electronically. Shows the agreement, the signer's name, a signature pad
 * (mouse / touch / pen) or a typed signature, and the consent checkbox. The signature is sent as a PNG; the API
 * appends a signature certificate to the agreement and creates the booking.
 */
@Component({
  selector: 'app-esign-panel',
  templateUrl: './esign-panel.html',
  styleUrl: './esign-panel.css'
})
export class ESignPanel implements OnInit, OnDestroy {
  private agreements = inject(AgreementService);
  private sanitizer = inject(DomSanitizer);

  agreementId = input.required<number>();
  defaultName = input<string>('');
  /** Signing finished; carries the message to show on the list. */
  signed = output<string>();
  cancelled = output<void>();

  readonly signatureFont = SIGNATURE_FONT;

  // Agreement preview (same PDF as "Download agreement")
  pdfLoading = signal(true);
  pdfError = signal(false);
  pdfUrl = signal<SafeResourceUrl | null>(null);
  private rawPdfUrl: string | null = null;

  signerName = signal('');
  mode = signal<SignMode>('draw');
  typedSignature = signal('');
  hasInk = signal(false);
  consent = signal(false);
  submitting = signal(false);
  error = signal('');

  private pad = viewChild<ElementRef<HTMLCanvasElement>>('pad');
  private drawing = false;
  private lastX = 0;
  private lastY = 0;

  nameValid = computed(() => {
    const n = this.signerName().trim();
    return n.length >= 2 && n.length <= 100;
  });
  hasSignature = computed(() => this.mode() === 'draw' ? this.hasInk() : this.typedSignature().trim().length >= 2);
  canSign = computed(() => this.nameValid() && this.hasSignature() && this.consent() && !this.submitting());

  ngOnInit() {
    const name = (this.defaultName() || '').trim();
    this.signerName.set(name);
    this.typedSignature.set(name);
    this.agreements.getMyAgreementPdf(this.agreementId()).subscribe({
      next: (blob: Blob) => {
        this.rawPdfUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        // Object URL we created from the API's PDF; safe to embed.
        this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.rawPdfUrl));
        this.pdfLoading.set(false);
      },
      error: () => { this.pdfLoading.set(false); this.pdfError.set(true); }
    });
  }

  ngOnDestroy() {
    if (this.rawPdfUrl) URL.revokeObjectURL(this.rawPdfUrl);
  }

  openPdf() {
    if (this.rawPdfUrl) window.open(this.rawPdfUrl, '_blank', 'noopener');
  }

  setMode(m: SignMode) {
    this.mode.set(m);
    this.error.set('');
    if (m === 'type' && !this.typedSignature().trim()) this.typedSignature.set(this.signerName().trim());
    if (m === 'draw') this.hasInk.set(false); // the pad is re-created empty
  }

  // ---- Signature pad (pointer events cover mouse, touch and pen) ----
  private point(e: PointerEvent): { x: number; y: number } {
    const canvas = this.pad()!.nativeElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  private context(): CanvasRenderingContext2D | null {
    const ctx = this.pad()?.nativeElement.getContext('2d') ?? null;
    if (ctx) {
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
      ctx.fillStyle = '#0f172a';
    }
    return ctx;
  }

  onPointerDown(e: PointerEvent) {
    if (this.submitting()) return;
    const ctx = this.context();
    if (!ctx) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.drawing = true;
    const p = this.point(e);
    this.lastX = p.x;
    this.lastY = p.y;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); // a tap leaves a dot
    ctx.fill();
  }

  onPointerMove(e: PointerEvent) {
    if (!this.drawing) return;
    const ctx = this.context();
    if (!ctx) return;
    e.preventDefault();
    const p = this.point(e);
    ctx.beginPath();
    ctx.moveTo(this.lastX, this.lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    this.lastX = p.x;
    this.lastY = p.y;
    if (!this.hasInk()) this.hasInk.set(true);
  }

  onPointerUp() { this.drawing = false; }

  clearPad() {
    const canvas = this.pad()?.nativeElement;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    this.hasInk.set(false);
  }

  /** The typed signature drawn in the signature font, as a PNG. */
  private async typedSignaturePng(): Promise<string> {
    const text = this.typedSignature().trim();
    try { await (document as any).fonts?.load?.(`600 72px 'Dancing Script'`); } catch { /* fall back to cursive */ }
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    let size = 96;
    ctx.font = `600 ${size}px ${SIGNATURE_FONT}`;
    while (size > 28 && ctx.measureText(text).width > canvas.width - 60) {
      size -= 4;
      ctx.font = `600 ${size}px ${SIGNATURE_FONT}`;
    }
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL('image/png');
  }

  async sign() {
    if (!this.canSign()) return;
    this.submitting.set(true); // set first: guards the double click while the PNG is prepared
    this.error.set('');
    let image = '';
    try {
      image = this.mode() === 'draw' ? this.pad()!.nativeElement.toDataURL('image/png') : await this.typedSignaturePng();
    } catch {
      this.submitting.set(false);
      this.error.set('Could not read your signature. Please clear it and try again.');
      return;
    }
    this.agreements.eSignMyAgreement(this.agreementId(), {
      signerName: this.signerName().trim(),
      signatureImage: image,
      consent: this.consent()
    }).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.signed.emit(res?.message || 'Signed. Our team will confirm your booking shortly.');
      },
      error: (err: any) => {
        this.submitting.set(false);
        this.error.set(err?.error?.message || 'We could not complete your signature. Please try again.');
      }
    });
  }

  cancel() {
    if (!this.submitting()) this.cancelled.emit();
  }
}
