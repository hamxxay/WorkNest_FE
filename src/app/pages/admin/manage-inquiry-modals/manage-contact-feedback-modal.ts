import { Component, EventEmitter, Input, Output, Signal, TemplateRef, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Inquiry feedback popup of the Manage page (Manage.showContactFeedback). Markup moved from manage.html; the
 *  answers stay Manage's own fields (two-way), and opening and saving (incl. Convert to quotation, which calls
 *  Manage.startQuotationFromInquiry) stay in Manage. */
@Component({
  selector: 'app-manage-contact-feedback-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-contact-feedback-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-contact-feedback-modal.css']
})
export class ManageContactFeedbackModal {
  /** Manage's #inqIcon template (also used by the list and the other popups). */
  @Input({ required: true }) inqIcon!: TemplateRef<any>;
  /** The inquiry (Manage.contactFeedbackItem). */
  @Input({ required: true }) fi!: any;
  /** Manage.inquiryContactLine (through Manage.inquiryContactLineFn). */
  @Input({ required: true }) inquiryContactLine!: (item: any) => string;
  /** Manage.contactFeedbackOutcome, two-way. The template reads and writes it as a plain value (contactFeedbackOutcome). */
  readonly contactFeedbackOutcomeModel = model<'' | 'not_interested' | 'future_prospect' | 'converted'>('');
  get contactFeedbackOutcome(): '' | 'not_interested' | 'future_prospect' | 'converted' { return this.contactFeedbackOutcomeModel(); }
  set contactFeedbackOutcome(value: '' | 'not_interested' | 'future_prospect' | 'converted') { this.contactFeedbackOutcomeModel.set(value); }
  readonly contactFeedbackReason = model<string>('');
  @Input({ required: true }) today!: string;
  readonly contactFeedbackDate = model<string>('');
  readonly contactFeedbackEmail = model<string>('');
  @Input({ required: true }) contactFeedbackError!: Signal<string>;
  @Input({ required: true }) contactFeedbackSaving!: Signal<boolean>;
  /** Manage: showContactFeedback.set(false). */
  @Output() closeContactFeedback = new EventEmitter<void>();
  /** Manage.saveContactFeedback. */
  @Output() saveContactFeedback = new EventEmitter<void>();
}
