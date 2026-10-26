import { Component, EventEmitter, Input, Output, Signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Signed agreement received popup of the Manage page (Manage.signAgreementItem). Markup moved from manage.html;
 *  the file / date / note state signals, the checks and the save (booking, then the first-invoice preview)
 *  stay in Manage. */
@Component({
  selector: 'app-manage-agreement-sign-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-agreement-sign-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-agreement-sign-modal.css']
})
export class ManageAgreementSignModal {
  /** The agreement (Manage.signAgreementItem()). */
  @Input({ required: true }) ag!: any;
  /** Manage.customerCopyOnFile (through Manage.customerCopyOnFileFn). */
  @Input({ required: true }) customerCopyOnFile!: (ag: any) => boolean;
  /** Manage.eSignedAt (through Manage.eSignedAtFn). */
  @Input({ required: true }) eSignedAt!: (ag: any) => string | null;
  /** Manage.eSignedBy (through Manage.eSignedByFn). */
  @Input({ required: true }) eSignedBy!: (ag: any) => string;
  @Input({ required: true }) signDate!: WritableSignal<string>;
  /** Manage.todayIso (through Manage.todayIsoFn). */
  @Input({ required: true }) todayIso!: () => string;
  /** Manage.signMinDate (through Manage.signMinDateFn). */
  @Input({ required: true }) signMinDate!: (ag: any) => string;
  /** Manage.signChallanAlreadyExpired (through Manage.signChallanAlreadyExpiredFn). */
  @Input({ required: true }) signChallanAlreadyExpired!: () => boolean;
  @Input({ required: true }) signNote!: WritableSignal<string>;
  @Input({ required: true }) signingAgreement!: Signal<boolean>;
  @Input({ required: true }) signFile!: Signal<File | null>;
  /** Manage.closeSignAgreement. */
  @Output() closeSignAgreement = new EventEmitter<void>();
  /** Manage.downloadSignedAgreementPdf. */
  @Output() downloadSignedAgreementPdf = new EventEmitter<any>();
  /** Manage.onSignFileChosen. */
  @Output() onSignFileChosen = new EventEmitter<any>();
  /** Manage.submitSignAgreement. */
  @Output() submitSignAgreement = new EventEmitter<void>();
}
