import { Component, EventEmitter, Input, Output, Signal, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Send Coworking Space Agreement popup of the Manage page (Manage.showSendAgreementModal). Markup moved from
 *  manage.html; the form data (sendAgreementData is Manage's own object, edited in place), opening with its
 *  customer / quotation look-ups, the discard-confirm close and sending stay in Manage. */
@Component({
  selector: 'app-manage-agreement-send-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-agreement-send-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-agreement-send-modal.css']
})
export class ManageAgreementSendModal {
  @Input({ required: true }) sendAgreementData!: any;
  @Input() selectedAgreementItem: any = null;
  /** Manage.sendAgreementTab, two-way. The template reads and writes it as a plain value (sendAgreementTab). */
  readonly sendAgreementTabModel = model<'Individual' | 'Company'>('Individual');
  get sendAgreementTab(): 'Individual' | 'Company' { return this.sendAgreementTabModel(); }
  set sendAgreementTab(value: 'Individual' | 'Company') { this.sendAgreementTabModel.set(value); }
  @Input({ required: true }) sendAgreementError!: Signal<string>;
  @Input({ required: true }) cnicMaxLength!: number;
  /** Manage.cnicError (utils/cnic cnicError). */
  @Input({ required: true }) cnicError!: (value: string | null | undefined, required?: boolean) => string | null;
  @Input({ required: true }) phoneMaxLength!: number;
  /** Manage.phoneError (utils/phone phoneError). */
  @Input({ required: true }) phoneError!: (value: string | null | undefined, required?: boolean) => string | null;
  /** Manage.filteredAgreementOfferingTypes (through Manage.filteredAgreementOfferingTypesFn). */
  @Input({ required: true }) filteredAgreementOfferingTypes!: () => { id: number; description: string; discountCap: number; locationId?: number | null }[];
  /** Manage.sendAgreementDepositText (getter, read by Manage's binding). */
  @Input({ required: true }) sendAgreementDepositText!: string;
  @Input({ required: true }) sendAgreementSaving!: Signal<boolean>;
  /** Manage.closeSendAgreementModal. */
  @Output() closeSendAgreementModal = new EventEmitter<void>();
  /** Manage.submitSendAgreement. */
  @Output() submitSendAgreement = new EventEmitter<void>();
  @Output() cnicFieldInput = new EventEmitter<{ event: Event; target: any; key: string }>();
  @Output() phoneFieldInput = new EventEmitter<{ event: Event; target: any; key: string }>();

  /** The template's calls, handed to Manage's onCnicFieldInput / onPhoneFieldInput. */
  onCnicFieldInput(event: Event, target: any, key: string) { this.cnicFieldInput.emit({ event, target, key }); }
  onPhoneFieldInput(event: Event, target: any, key: string) { this.phoneFieldInput.emit({ event, target, key }); }
}
