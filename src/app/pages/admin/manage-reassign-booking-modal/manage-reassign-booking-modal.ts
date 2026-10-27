import { Component, EventEmitter, Input, Output, Signal, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Reassign Booking popup of the Manage page (Manage.showReassignModal). Markup moved from manage.html;
 *  loading the free spaces, the discard-confirm close (requestDiscardableClose / isReassignFormDirty) and the
 *  reassignment stay in Manage. */
@Component({
  selector: 'app-manage-reassign-booking-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-reassign-booking-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-reassign-booking-modal.css']
})
export class ManageReassignBookingModal {
  @Input({ required: true }) reassignBooking!: any;
  @Input({ required: true }) reassignError!: Signal<string>;
  @Input({ required: true }) reassignLoading!: Signal<boolean>;
  @Input({ required: true }) availableSpacesForReassign!: Signal<any[]>;
  /** Manage.selectedNewSpace, two-way. The template reads and writes it as a plain value (selectedNewSpace). */
  readonly selectedNewSpaceModel = model<string>('');
  get selectedNewSpace(): string { return this.selectedNewSpaceModel(); }
  set selectedNewSpace(value: string) { this.selectedNewSpaceModel.set(value); }
  /** Manage.closeReassignModal. */
  @Output() closeReassignModal = new EventEmitter<void>();
  /** Manage.submitReassignment. */
  @Output() submitReassignment = new EventEmitter<void>();
}
