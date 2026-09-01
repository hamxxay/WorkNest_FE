import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { QuotationService } from '../../services/quotation.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-my-quotations',
  imports: [CommonModule, DatePipe, DecimalPipe, FormsModule, RouterLink],
  templateUrl: './my-quotations.html',
  styleUrl: './my-quotations.css'
})
export class MyQuotations implements OnInit {
  quotations = signal<any[]>([]);
  activeQuotation = signal<any>(null);
  loading = signal(true);
  submitting = signal(false);
  errorMsg = signal('');
  successMsg = signal('');

  // Response Modals
  showAcceptModal = false;
  showDeclineModal = false;
  acceptNote = '';
  declineNote = '';
  declineValidationError = '';

  selectedQuotationId: number | null = null;
  selectedVersionId: number | null = null;

  constructor(
    private quotationService: QuotationService,
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.route.params.subscribe(params => {
      const qId = params['id'] ? parseInt(params['id'], 10) : null;
      if (qId && !isNaN(qId)) {
        this.loadSingleQuotation(qId);
      } else {
        this.loadCustomerQuotations();
      }
    });
  }

  loadCustomerQuotations() {
    this.loading.set(true);
    this.quotationService.getCustomerActiveQuotation().subscribe({
      next: (res: any) => {
        const list = this.extractQuotations(res);
        this.quotations.set(list);
        if (list.length > 0) {
          this.activeQuotation.set(list[0]);
        }
        this.loading.set(false);
      },
      error: () => {
        this.quotations.set([]);
        this.activeQuotation.set(null);
        this.loading.set(false);
      }
    });
  }

  loadSingleQuotation(id: number) {
    this.loading.set(true);
    this.quotationService.getQuotationById(id).subscribe({
      next: (res: any) => {
        const item = res?.data ?? res;
        if (item) {
          const formatted = this.formatQuotationItem(item);
          this.activeQuotation.set(formatted);
          this.quotations.set([formatted]);
        }
        this.loading.set(false);
      },
      error: () => {
        this.errorMsg.set('Unable to load requested quotation.');
        this.loading.set(false);
      }
    });
  }

  selectQuotationItem(q: any) {
    this.activeQuotation.set(q);
  }

  private extractQuotations(res: any): any[] {
    const d = res?.data;
    let raw: any[];
    if (Array.isArray(d)) raw = d;
    else if (Array.isArray(d?.items)) raw = d.items;
    else if (Array.isArray(d?.quotations)) raw = d.quotations;
    else if (Array.isArray(res?.items)) raw = res.items;
    else if (Array.isArray(res)) raw = res;
    else if (d && typeof d === 'object') raw = [d];
    else return [];

    return raw.map(q => this.formatQuotationItem(q));
  }

  private formatQuotationItem(q: any): any {
    const statusStr = (q.status || q.Status || 'Sent').toString();
    const canRespond = statusStr.toLowerCase() === 'sent' || statusStr.toLowerCase() === 'pending' || q.canRespond === true;

    return {
      ...q,
      id: q.id ?? q.quotationId ?? q.Id,
      versionId: q.versionId ?? q.versionNumber ?? q.currentVersion ?? 1,
      quotationNumber: q.quotationNumber ?? q.QuotationNumber ?? `WN-Q-${q.id || '001'}`,
      versionNumber: q.versionNumber ?? q.version ?? q.currentVersion ?? 1,
      status: statusStr,
      canRespond: canRespond,
      spaceName: q.spaceName ?? q.space?.name ?? `Workspace #${q.spaceId || ''}`,
      spaceTypeName: q.spaceTypeName ?? q.spaceType ?? 'Office',
      monthlyRent: q.monthlyRent ?? q.subtotalAmount ?? q.totalAmount ?? 0,
      contractPeriod: q.contractPeriodMonths ?? q.months ?? q.contractPeriod ?? 12,
      billingPeriodMonths: q.billingPeriodMonths ?? 3,
      securityDeposit: q.securityDeposit ?? q.effectiveSecurityDeposit ?? 0,
      discountAmount: q.discountAmount ?? 0,
      totalAmount: q.totalAmount ?? q.TotalAmount ?? 0,
      validUntil: q.validUntil ?? q.ValidUntil ?? q.validityDate,
      customerNote: q.customerNote ?? q.responseNote ?? q.note ?? '',
      respondedDate: q.respondedDate ?? q.updatedDate ?? null
    };
  }

  openAcceptModal(q: any) {
    if (!q.canRespond) return;
    this.selectedQuotationId = q.id;
    this.selectedVersionId = q.versionId;
    this.acceptNote = '';
    this.showAcceptModal = true;
  }

  closeAcceptModal() {
    this.showAcceptModal = false;
    this.acceptNote = '';
  }

  confirmAccept() {
    if (!this.selectedQuotationId || !this.selectedVersionId) return;
    this.submitting.set(true);
    this.errorMsg.set('');

    this.quotationService.acceptQuotation(
      this.selectedQuotationId,
      this.selectedVersionId,
      this.acceptNote
    ).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.closeAcceptModal();
        this.successMsg.set('Quotation accepted successfully!');
        
        // Update local active quotation state
        const updated = {
          ...this.activeQuotation(),
          status: 'Accepted',
          canRespond: false,
          customerNote: this.acceptNote || 'Accepted by customer',
          respondedDate: new Date().toISOString()
        };
        this.activeQuotation.set(updated);
        this.quotations.update(list => list.map(item => item.id === updated.id ? updated : item));

        setTimeout(() => this.successMsg.set(''), 4000);
      },
      error: (err: any) => {
        this.submitting.set(false);
        const msg = err?.error?.message || err?.error?.detail || err?.message || 'Failed to accept quotation. Please try again.';
        this.errorMsg.set(msg);
        setTimeout(() => this.errorMsg.set(''), 5000);
      }
    });
  }

  openDeclineModal(q: any) {
    if (!q.canRespond) return;
    this.selectedQuotationId = q.id;
    this.selectedVersionId = q.versionId;
    this.declineNote = '';
    this.declineValidationError = '';
    this.showDeclineModal = true;
  }

  closeDeclineModal() {
    this.showDeclineModal = false;
    this.declineNote = '';
    this.declineValidationError = '';
  }

  confirmDecline() {
    const trimmed = (this.declineNote || '').trim();
    if (!trimmed) {
      this.declineValidationError = 'Please provide a valid reason for declining this quotation.';
      return;
    }

    if (!this.selectedQuotationId || !this.selectedVersionId) return;
    this.submitting.set(true);
    this.errorMsg.set('');

    this.quotationService.declineQuotation(
      this.selectedQuotationId,
      this.selectedVersionId,
      trimmed
    ).subscribe({
      next: (res: any) => {
        this.submitting.set(false);
        this.closeDeclineModal();
        this.successMsg.set('Quotation declined. Your feedback has been sent to our administration team.');

        // Update local active quotation state
        const updated = {
          ...this.activeQuotation(),
          status: 'Declined',
          canRespond: false,
          customerNote: trimmed,
          respondedDate: new Date().toISOString()
        };
        this.activeQuotation.set(updated);
        this.quotations.update(list => list.map(item => item.id === updated.id ? updated : item));

        setTimeout(() => this.successMsg.set(''), 5000);
      },
      error: (err: any) => {
        this.submitting.set(false);
        const msg = err?.error?.message || err?.error?.detail || err?.message || 'Failed to decline quotation.';
        this.errorMsg.set(msg);
        setTimeout(() => this.errorMsg.set(''), 5000);
      }
    });
  }

  getStatusBadgeClass(status: string): string {
    const st = (status || '').toLowerCase();
    if (st === 'accepted') return 'badge-accepted';
    if (st === 'declined') return 'badge-declined';
    if (st === 'sent') return 'badge-sent';
    return 'badge-draft';
  }

  getSpaceType(item: any): string {
    if (!item) return 'MeetingRoom';
    if (item.spaceType) return item.spaceType;
    const name = String(item.spaceTypeName || item.SpaceTypeName || item.spaceCategory || item.SpaceCategory || '').toLowerCase();
    if (name.includes('meeting') || name.includes('conference')) return 'MeetingRoom';
    if (name.includes('shared') || name.includes('coworking') || name.includes('desk')) return 'SharedSpace';
    if (name.includes('private') || name.includes('office') || name.includes('room')) return 'PrivateRoom';
    if ((item.billingPeriodMonths <= 0 || !item.billingPeriodMonths) && (!item.totalContractAmount || item.totalContractAmount <= 0)) return 'MeetingRoom';
    return 'SharedSpace';
  }

  isMeetingRoom(item: any): boolean {
    return this.getSpaceType(item) === 'MeetingRoom';
  }

  isSharedSpace(item: any): boolean {
    return this.getSpaceType(item) === 'SharedSpace';
  }

  isPrivateRoom(item: any): boolean {
    return this.getSpaceType(item) === 'PrivateRoom';
  }
}
