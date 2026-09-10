import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../services/admin.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-attendant-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './attendant-management.html',
  styleUrl: './attendant-management.css'
})
export class AttendantManagement implements OnInit {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  customers = signal<any[]>([]);
  selectedCustomerId = '';

  activeSpaces = signal<any[]>([]);
  selectedBookingDetailId: number | null = null;
  selectedSpace: any = null;

  capacityInfo = signal<any>(null);
  attendants = signal<any[]>([]);
  loadingAttendants = false;

  // Add Attendant Modal
  showAddModal = false;
  addMode: 'new' | 'existing' = 'new';
  existingCompanyAttendants = signal<any[]>([]);
  selectedExistingPersonId: number | null = null;

  // Form Fields
  newName = '';
  newEmail = '';
  newPhone = '';
  newIdType = 'CNIC';
  newIdNumber = '';

  // Warning Modal
  showWarningModal = false;
  pendingAssignmentPayload: any = null;
  warningModalText = '';
  estimatedSurcharge = 0;
  seatPrice = 0;

  // Export Modal
  showExportModal = false;
  exportDataJson = '';

  ngOnInit() {
    this.loadCustomers();
  }

  loadCustomers() {
    this.admin.getCustomers(1, 1000, '').subscribe({
      next: (res: any) => {
        const raw = res?.data ?? res?.rows ?? res?.items ?? (Array.isArray(res) ? res : []);
        this.customers.set(raw);
      },
      error: (err) => console.error('Failed to load customers', err)
    });
  }

  onCustomerChange() {
    this.selectedBookingDetailId = null;
    this.selectedSpace = null;
    this.capacityInfo.set(null);
    this.attendants.set([]);

    if (!this.selectedCustomerId) {
      this.activeSpaces.set([]);
      return;
    }

    const cid = parseInt(this.selectedCustomerId, 10);
    this.admin.getCustomerActiveSpaces(cid).subscribe({
      next: (res: any) => {
        this.activeSpaces.set(res || []);
      },
      error: (err) => this.toast.error('Failed to load active spaces for customer: ' + (err.error?.message || err.message))
    });

    this.admin.getCustomerAttendants(cid).subscribe({
      next: (res: any) => {
        this.existingCompanyAttendants.set(res || []);
      }
    });
  }

  selectSpace(space: any) {
    this.selectedBookingDetailId = space.bookingDetailId;
    this.selectedSpace = space;
    this.loadAttendantsForSpace();
  }

  loadAttendantsForSpace() {
    if (!this.selectedBookingDetailId) return;
    this.loadingAttendants = true;

    this.admin.checkAttendantCapacity(this.selectedBookingDetailId).subscribe({
      next: (cap: any) => this.capacityInfo.set(cap)
    });

    this.admin.getBookingAttendants(this.selectedBookingDetailId).subscribe({
      next: (res: any) => {
        this.attendants.set(res || []);
        this.loadingAttendants = false;
      },
      error: () => this.loadingAttendants = false
    });
  }

  openAddModal() {
    this.addMode = 'new';
    this.newName = '';
    this.newEmail = '';
    this.newPhone = '';
    this.newIdType = 'CNIC';
    this.newIdNumber = '';
    this.selectedExistingPersonId = null;
    this.showAddModal = true;
  }

  closeAddModal() {
    this.showAddModal = false;
  }

  submitAddAttendant() {
    if (!this.selectedCustomerId || !this.selectedBookingDetailId) return;

    if (this.addMode === 'new') {
      if (!this.newName || !this.newEmail || !this.newPhone || !this.newIdNumber) {
        this.toast.error('Please fill in all required person identity fields.');
        return;
      }

      const body = {
        customerId: parseInt(this.selectedCustomerId, 10),
        name: this.newName.trim(),
        email: this.newEmail.trim(),
        phone: this.newPhone.trim(),
        idType: this.newIdType,
        idNumber: this.newIdNumber.trim()
      };

      this.admin.addAttendant(body).subscribe({
        next: (res: any) => {
          this.closeAddModal();
          this.processBookingAssignment(res.personId);
        },
        error: (err) => this.toast.error('Failed to create person: ' + (err.error?.message || err.message))
      });
    } else {
      if (!this.selectedExistingPersonId) {
        this.toast.error('Please select an existing company attendant.');
        return;
      }
      this.closeAddModal();
      this.processBookingAssignment(this.selectedExistingPersonId);
    }
  }

  processBookingAssignment(personId: number) {
    const bId = this.selectedBookingDetailId!;
    const cId = parseInt(this.selectedCustomerId, 10);

    this.admin.checkAttendantCapacity(bId).subscribe({
      next: (cap: any) => {
        this.pendingAssignmentPayload = {
          bookingDetailId: bId,
          personId: personId,
          customerId: cId,
          assignedFrom: new Date().toISOString()
        };

        if (cap.wouldExceedCapacity) {
          if (!cap.allowsOverCapacity) {
            this.toast.error(`Over-capacity assignment is strictly not allowed for ${cap.spaceCategory} (${cap.spaceName}). Capacity limit is ${cap.roomCapacity}.`);
            return;
          }

          this.estimatedSurcharge = cap.estimatedSurcharge;
          this.seatPrice = cap.seatPrice;
          this.warningModalText = `Adding this attendant to ${cap.spaceName} exceeds the seat capacity (${cap.roomCapacity} seats). An over-capacity surcharge of PKR ${cap.estimatedSurcharge} will be applied.`;
          this.showWarningModal = true;
        } else {
          this.executeAssignment();
        }
      }
    });
  }

  confirmOverCapacityAssignment() {
    this.showWarningModal = false;
    this.executeAssignment();
  }

  executeAssignment() {
    if (!this.pendingAssignmentPayload) return;
    this.admin.assignAttendantToBooking(this.pendingAssignmentPayload.bookingDetailId, this.pendingAssignmentPayload).subscribe({
      next: () => {
        this.pendingAssignmentPayload = null;
        this.onCustomerChange();
      },
      error: (err) => this.toast.error('Assignment failed: ' + (err.error?.message || err.message))
    });
  }

  toggleIndividualAccess(attendant: any, event: any) {
    const isEnabled = event.target.checked;
    const body = {
      bookingDetailId: this.selectedBookingDetailId,
      customerId: parseInt(this.selectedCustomerId, 10),
      personId: attendant.personId,
      isEnabled: isEnabled
    };
    this.admin.toggleAccessStatus(body).subscribe({
      error: () => {
        this.toast.error('Failed to update access status');
        this.loadAttendantsForSpace();
      }
    });
  }

  toggleBatchAccess(event: any) {
    const isEnabled = event.target.checked;
    const body = {
      bookingDetailId: this.selectedBookingDetailId,
      customerId: parseInt(this.selectedCustomerId, 10),
      personId: null,
      isEnabled: isEnabled
    };
    this.admin.toggleAccessStatus(body).subscribe({
      next: () => this.loadAttendantsForSpace(),
      error: () => this.toast.error('Failed to update batch access status')
    });
  }

  removeAttendant(personId: number) {
    if (!confirm('Are you sure you want to remove this attendant from this booking assignment?')) return;
    this.admin.removeAttendantFromBooking(this.selectedBookingDetailId!, personId).subscribe({
      next: () => this.loadAttendantsForSpace(),
      error: (err) => this.toast.error('Failed to remove attendant: ' + (err.error?.message || err.message))
    });
  }

  openExportModal() {
    this.admin.getHikvisionExport().subscribe({
      next: (res: any) => {
        this.exportDataJson = JSON.stringify(res, null, 2);
        this.showExportModal = true;
      },
      error: (err) => this.toast.error('Failed to fetch export: ' + (err.error?.message || err.message))
    });
  }

  get allAttendantsEnabled(): boolean {
    const list = this.attendants();
    return list.length > 0 && list.every(a => a.isEnabled);
  }
}