import { Component, EventEmitter, Input, Output, Signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgreementESignature } from '../../../services/agreement.service';

/** Agreement Details & signed copy popup of the Manage page (Manage.showAgreementDetailsModal). Markup moved from
 *  manage.html; loading the e-signature, the PDF downloads, the signed-copy upload / delete (and refreshing
 *  Manage.selectedAgreementDetails) stay in Manage. */
@Component({
  selector: 'app-manage-agreement-details-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-agreement-details-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-agreement-details-modal.css']
})
export class ManageAgreementDetailsModal {
  /** The agreement (Manage.selectedAgreementDetails()). */
  @Input({ required: true }) agreement!: any;
  /** Manage.eSignedAt (through Manage.eSignedAtFn). */
  @Input({ required: true }) eSignedAt!: (ag: any) => string | null;
  /** Manage.eSignedBy (through Manage.eSignedByFn). */
  @Input({ required: true }) eSignedBy!: (ag: any) => string;
  @Input({ required: true }) loadingAgreementESignature!: Signal<boolean>;
  @Input({ required: true }) selectedAgreementESignature!: Signal<AgreementESignature | null>;
  /** Manage.getSignedAgreementDownloadUrl (through Manage.getSignedAgreementDownloadUrlFn). */
  @Input({ required: true }) getSignedAgreementDownloadUrl!: (agreementId: any) => string;
  @Input({ required: true }) uploadingSignedAgreementId!: Signal<number | null>;
  /** Manage: showAgreementDetailsModal.set(false). */
  @Output() closeAgreementDetails = new EventEmitter<void>();
  /** Manage.downloadAgreementPdf. */
  @Output() downloadAgreementPdf = new EventEmitter<any>();
  /** Manage.downloadSignedAgreementPdf. */
  @Output() downloadSignedAgreementPdf = new EventEmitter<any>();
  /** Manage.deleteSignedAgreementPdf. */
  @Output() deleteSignedAgreementPdf = new EventEmitter<any>();
  @Output() signedAgreementFileSelected = new EventEmitter<{ agreementId: any; event: any }>();

  /** The template's call, handed to Manage.onSignedAgreementFileSelected. */
  onSignedAgreementFileSelected(agreementId: any, event: any) { this.signedAgreementFileSelected.emit({ agreementId, event }); }
}
