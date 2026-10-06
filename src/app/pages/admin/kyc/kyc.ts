import { Component, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { KycService, KycCustomerListItem, CustomerKycPortalData, CustomerKycDocument, KycDocumentTypeOption } from '../../../services/kyc.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-kyc',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe, RouterLink],
  templateUrl: './kyc.html',
  styleUrl: './kyc.css'
})
export class KycComponent implements OnInit {
  private kycService = inject(KycService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // Permissions
  isSuperAdmin = computed(() => this.auth.hasRole('super_admin'));
  isAdmin = computed(() => this.auth.hasRole('admin'));
  isSalesExecutive = computed(() => this.auth.hasRole('sales_executive'));
  canVerify = computed(() => this.isSuperAdmin() || this.isAdmin());

  // Mode: 'list' or 'detail'
  currentCustomerId = signal<string | null>(null);

  // --- List Mode State ---
  loadingList = signal(false);
  customers = signal<KycCustomerListItem[]>([]);
  totalCount = signal(0);
  page = signal(1);
  limit = 20;
  searchQuery = '';
  private searchDebounce: any;

  totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.limit)));

  // --- Detail Mode State ---
  loadingDetail = signal(false);
  portalData = signal<CustomerKycPortalData | null>(null);

  // Upload Form State
  selectedDocTypeId: number | null = null;
  selectedDocType: KycDocumentTypeOption | null = null;
  selectedSlotNo: string = '1';
  holderName: string = '';
  expiryDate: string = '';
  selectedFile: File | null = null;
  uploading = signal(false);

  // History Modal State
  showHistoryModal = signal(false);
  historyDocs = signal<CustomerKycDocument[]>([]);
  historyLoading = signal(false);

  // Rejection Modal State
  showRejectModal = signal(false);
  rejectDocId: number | null = null;
  rejectRemarks: string = '';
  rejecting = signal(false);

  ngOnInit() {
    this.route.params.subscribe(params => {
      const id = params['id'];
      if (id) {
        this.currentCustomerId.set(id);
        this.loadCustomerKyc(id);
      } else {
        this.currentCustomerId.set(null);
        this.loadCustomerList();
      }
    });
  }

  // --- Customer Directory Methods ---
  loadCustomerList() {
    this.loadingList.set(true);
    this.kycService.getCustomers(this.page(), this.limit, this.searchQuery).subscribe({
      next: (res) => {
        this.customers.set(res.items || []);
        this.totalCount.set(res.total || 0);
        this.loadingList.set(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Failed to load KYC customer list');
        this.loadingList.set(false);
      }
    });
  }

  onSearchChange() {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page.set(1);
      this.loadCustomerList();
    }, 350);
  }

  goToPage(p: number) {
    if (p >= 1 && p <= this.totalPages()) {
      this.page.set(p);
      this.loadCustomerList();
    }
  }

  openCustomer(id: number | string) {
    this.router.navigate(['/admin/kyc', id]);
  }

  backToList() {
    this.router.navigate(['/admin/kyc']);
  }

  // --- Customer Detail Methods ---
  loadCustomerKyc(id: string) {
    this.loadingDetail.set(true);
    this.kycService.getCustomerKyc(id).subscribe({
      next: (data) => {
        this.portalData.set(data);
        this.resetUploadForm();
        this.loadingDetail.set(false);
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Failed to load customer KYC details');
        this.loadingDetail.set(false);
      }
    });
  }

  onDocTypeSelected() {
    const data = this.portalData();
    if (!data || !this.selectedDocTypeId) {
      this.selectedDocType = null;
      return;
    }

    const found = data.availableDocumentTypes.find(t => t.id === Number(this.selectedDocTypeId));
    this.selectedDocType = found || null;

    if (this.selectedDocType?.allowMultiple) {
      this.selectedSlotNo = 'new';
      this.holderName = '';
    } else {
      this.selectedSlotNo = '1';
      this.holderName = '';
    }
  }

  onPersonSlotChanged() {
    const data = this.portalData();
    if (!data) return;

    if (this.selectedSlotNo === 'new') {
      this.holderName = '';
    } else {
      const slot = data.existingPersonSlots.find(s => s.slotNo === Number(this.selectedSlotNo));
      this.holderName = slot?.holderName || '';
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        this.toast.error('Maximum allowed file size is 5 MB.', 'File Too Large');
        event.target.value = '';
        this.selectedFile = null;
        return;
      }
      this.selectedFile = file;
    }
  }

  triggerReplace(docTypeId: number, slotNo: number, holderName?: string) {
    this.selectedDocTypeId = docTypeId;
    this.onDocTypeSelected();
    if (this.selectedDocType?.allowMultiple) {
      this.selectedSlotNo = String(slotNo);
    }
    if (holderName) {
      this.holderName = holderName;
    }
    window.scrollTo({ top: 300, behavior: 'smooth' });
  }

  handleUpload(e: Event) {
    e.preventDefault();
    const data = this.portalData();
    if (!data || !this.selectedDocType || !this.selectedFile) {
      this.toast.warning('Please select a document type and a valid file.', 'Validation');
      return;
    }

    if ((this.selectedDocType.requiresHolderName || this.selectedDocType.allowMultiple) && !this.holderName.trim()) {
      this.toast.warning('Holder Name is required for this document.', 'Validation');
      return;
    }

    if (this.selectedDocType.requiresExpiry && !this.expiryDate) {
      this.toast.warning('Expiry Date is required for this document.', 'Validation');
      return;
    }

    const formData = new FormData();
    formData.append('CustomerId', String(data.customerId));
    formData.append('DocumentTypeId', String(this.selectedDocType.id));
    
    // Resolve SlotNo
    let slot = 1;
    if (this.selectedDocType.allowMultiple) {
      if (this.selectedSlotNo === 'new') {
        const maxSlot = data.existingPersonSlots.reduce((m, s) => Math.max(m, s.slotNo), 0);
        slot = maxSlot + 1;
      } else {
        slot = Number(this.selectedSlotNo) || 1;
      }
    }
    formData.append('SlotNo', String(slot));

    if (this.holderName.trim()) {
      formData.append('HolderName', this.holderName.trim());
    }
    if (this.expiryDate) {
      formData.append('ExpiryDate', this.expiryDate);
    }
    formData.append('File', this.selectedFile);

    this.uploading.set(true);
    this.kycService.uploadDocument(formData).subscribe({
      next: (res) => {
        this.uploading.set(false);
        this.toast.success(res.message || 'Document uploaded successfully.', 'Uploaded');
        this.loadCustomerKyc(String(data.customerId));
      },
      error: (err) => {
        this.uploading.set(false);
        this.toast.error(err?.error?.message || 'Error uploading KYC document.', 'Upload Failed');
      }
    });
  }

  resetUploadForm() {
    this.selectedDocTypeId = null;
    this.selectedDocType = null;
    this.selectedSlotNo = '1';
    this.holderName = '';
    this.expiryDate = '';
    this.selectedFile = null;
  }

  // --- Verification Actions ---
  verifyDoc(docId: number) {
    if (!this.canVerify()) return;
    if (!confirm('Are you sure you want to mark this document as Verified?')) return;

    this.kycService.verifyDocument(docId).subscribe({
      next: (res) => {
        this.toast.success(res.message || 'Document marked as verified.', 'Verified');
        const id = this.currentCustomerId();
        if (id) this.loadCustomerKyc(id);
      },
      error: (err) => {
        this.toast.error(err?.error?.message || 'Failed to verify document.', 'Verification Failed');
      }
    });
  }

  openRejectModal(docId: number) {
    if (!this.canVerify()) return;
    this.rejectDocId = docId;
    this.rejectRemarks = '';
    this.showRejectModal.set(true);
  }

  closeRejectModal() {
    this.showRejectModal.set(false);
    this.rejectDocId = null;
    this.rejectRemarks = '';
  }

  submitRejection() {
    if (!this.rejectDocId || !this.rejectRemarks.trim()) {
      this.toast.warning('Rejection remarks are mandatory.', 'Validation');
      return;
    }

    this.rejecting.set(true);
    this.kycService.rejectDocument(this.rejectDocId, this.rejectRemarks.trim()).subscribe({
      next: (res) => {
        this.rejecting.set(false);
        this.closeRejectModal();
        this.toast.warning(res.message || 'Document marked as rejected.', 'Rejected');
        const id = this.currentCustomerId();
        if (id) this.loadCustomerKyc(id);
      },
      error: (err) => {
        this.rejecting.set(false);
        this.toast.error(err?.error?.message || 'Failed to reject document.', 'Rejection Failed');
      }
    });
  }

  // --- Document Version History ---
  openHistoryModal(doc: CustomerKycDocument) {
    this.historyLoading.set(true);
    this.showHistoryModal.set(true);
    this.kycService.getDocumentHistory(doc.customerId, doc.documentTypeId, doc.slotNo).subscribe({
      next: (list) => {
        this.historyDocs.set(list || []);
        this.historyLoading.set(false);
      },
      error: (err) => {
        this.toast.error('Failed to load document version history.');
        this.historyLoading.set(false);
      }
    });
  }

  closeHistoryModal() {
    this.showHistoryModal.set(false);
    this.historyDocs.set([]);
  }

  /** Download (or open in a new tab) a KYC document through the logged-in connection. */
  openDocument(docId: number, inline: boolean = false, fileName?: string) {
    // Open the tab now (inside the click) so pop-up blockers allow it; fill it once the file arrives.
    const tab = inline ? window.open('', '_blank') : null;
    this.kycService.getDocumentBlob(docId, inline).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        if (tab) {
          tab.location.href = url;
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName || `kyc-document-${docId}`;
          a.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: (err) => {
        tab?.close();
        this.toast.error(err?.status === 404 ? 'Document not found or not available for your location.' : 'Could not open the document.');
      }
    });
  }
}
