import { Component, EventEmitter, Input, Output, Signal, TemplateRef, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** New complaint popup of the Manage page (Manage.showAddComplaint). Markup moved from manage.html; the form state
 *  (addComplaint is Manage's own object), validation and saving stay in Manage. */
@Component({
  selector: 'app-manage-complaint-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-complaint-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-complaint-modal.css']
})
export class ManageComplaintModal {
  @Input({ required: true }) inqIcon!: TemplateRef<any>;
  @Input({ required: true }) addComplaint!: { customerName: string; phoneNumber: string; email: string; category: string; description: string };
  readonly addComplaintLocationId = model<number | null>(null);
  @Input({ required: true }) addComplaintTried!: Signal<boolean>;
  @Input({ required: true }) addComplaintError!: Signal<string>;
  @Input({ required: true }) addComplaintSaving!: Signal<boolean>;
  @Input({ required: true }) itemBranchesState!: Signal<'idle' | 'loading' | 'ready'>;
  @Input({ required: true }) itemBranches!: Signal<{ id: number; name: string }[]>;
  @Input() fixedItemBranch: { id: number; name: string } | null = null;
  @Input() itemBranchesMissing = false;
  @Input({ required: true }) itemBranchesMissingText!: string;
  @Input({ required: true }) phoneMaxLength!: number;
  /** Manage.complaintFieldError (through Manage.complaintFieldErrorFn). */
  @Input({ required: true }) complaintFieldError!: (key: 'phoneNumber' | 'branch' | 'category' | 'description') => string | null;
  /** Manage.complaintOptions (through Manage.complaintOptionsFn). */
  @Input({ required: true }) complaintOptions!: (key: 'category') => { v: string; l: string }[];
  @Output() addComplaintClose = new EventEmitter<void>();
  @Output() addComplaintSave = new EventEmitter<void>();
  @Output() phoneFieldInput = new EventEmitter<{ event: Event; target: any; key: string }>();

  /** The template's calls, handed to Manage's closeAddComplaint / saveAddComplaint / onPhoneFieldInput. */
  closeAddComplaint() { this.addComplaintClose.emit(); }
  saveAddComplaint() { this.addComplaintSave.emit(); }
  onPhoneFieldInput(event: Event, target: any, key: string) { this.phoneFieldInput.emit({ event, target, key }); }
}
