import { Component, EventEmitter, Input, Output, Signal, TemplateRef, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Inquiry type popup of the Manage page (Manage.showContactType). Markup moved from manage.html; the chosen
 *  type / reference stay Manage's own fields (two-way), and opening and saving stay in Manage. */
@Component({
  selector: 'app-manage-contact-type-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-contact-type-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-contact-type-modal.css']
})
export class ManageContactTypeModal {
  /** Manage's #inqIcon template (also used by the list and the other popups). */
  @Input({ required: true }) inqIcon!: TemplateRef<any>;
  /** The inquiry (Manage.contactTypeItem). */
  @Input({ required: true }) ti!: any;
  /** Manage.inquiryContactLine (through Manage.inquiryContactLineFn). */
  @Input({ required: true }) inquiryContactLine!: (item: any) => string;
  @Input({ required: true }) inquiryTypeOptions!: readonly { v: string; l: string }[];
  /** Manage.contactTypeValue, two-way. The template reads and writes it as a plain value (contactTypeValue). */
  readonly contactTypeValueModel = model<string>('WalkIn');
  get contactTypeValue(): string { return this.contactTypeValueModel(); }
  set contactTypeValue(value: string) { this.contactTypeValueModel.set(value); }
  readonly contactTypeReference = model<string>('');
  @Input({ required: true }) contactTypeError!: Signal<string>;
  @Input({ required: true }) contactTypeSaving!: Signal<boolean>;
  /** Manage: showContactType.set(false). */
  @Output() closeContactType = new EventEmitter<void>();
  /** Manage.saveContactType. */
  @Output() saveContactType = new EventEmitter<void>();
}
