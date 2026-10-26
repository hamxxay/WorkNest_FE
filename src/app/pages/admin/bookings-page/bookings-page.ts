import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageUserDetailsModal } from '../manage-user-details-modal/manage-user-details-modal';
import { ManageBookingDetailsModal } from '../manage-booking-details-modal/manage-booking-details-modal';
import { ManageReassignBookingModal } from '../manage-reassign-booking-modal/manage-reassign-booking-modal';
import { ManageInitialInvoicePreviewModal } from '../manage-invoice-send-modals/manage-initial-invoice-preview-modal';
import { ManageCustomInvoiceModal } from '../manage-invoice-send-modals/manage-custom-invoice-modal';
import { ManageQuickCustomerModal } from '../manage-quick-customer-modal/manage-quick-customer-modal';
import { ManageBookingChallanModal } from '../manage-booking-challan-modal/manage-booking-challan-modal';
import { ManageBookingFormModal } from '../manage-booking-form-modal/manage-booking-form-modal';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/bookings: the Manage list for entity 'bookings' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-bookings-page',
  imports: [CommonModule, FormsModule, DatePipe, ManageUserDetailsModal, ManageBookingDetailsModal,
    ManageReassignBookingModal, ManageInitialInvoicePreviewModal, ManageCustomInvoiceModal, ManageQuickCustomerModal,
    ManageBookingChallanModal, ManageBookingFormModal],
  templateUrl: './bookings-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage/manage.css']
})
export class BookingsPage extends ManageBase {}
