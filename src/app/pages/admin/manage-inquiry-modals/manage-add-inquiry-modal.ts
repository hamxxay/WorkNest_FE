import { Component, EventEmitter, Input, Output, Signal, TemplateRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Add tour inquiry popup of the Manage page (Manage.showAddInquiry). Markup moved from manage.html; the form
 *  state (addInquiry is Manage's own object, edited in place), validation and saving stay in Manage. */
@Component({
  selector: 'app-manage-add-inquiry-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-add-inquiry-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-add-inquiry-modal.css']
})
export class ManageAddInquiryModal {
  /** Manage's #inqIcon template (also used by the list and the other popups). */
  @Input({ required: true }) inqIcon!: TemplateRef<any>;
  @Input({ required: true }) addInquiry!: { type: 'WalkIn' | 'Reference'; referenceName: string; fullName: string; phone: string; email: string; notes: string; locationId: number | null };
  @Input() fixedItemBranch: { id: number; name: string } | null = null;
  @Input({ required: true }) itemBranchesState!: Signal<'idle' | 'loading' | 'ready'>;
  @Input({ required: true }) itemBranches!: Signal<{ id: number; name: string }[]>;
  @Input() itemBranchesMissing = false;
  @Input({ required: true }) itemBranchesMissingText!: string;
  @Input({ required: true }) phoneMaxLength!: number;
  @Input({ required: true }) addInquiryError!: Signal<string>;
  @Input({ required: true }) addInquirySaving!: Signal<boolean>;
  /** Manage: showAddInquiry.set(false). */
  @Output() closeAddInquiry = new EventEmitter<void>();
  /** Manage.saveAddInquiry. */
  @Output() saveAddInquiry = new EventEmitter<void>();
}
