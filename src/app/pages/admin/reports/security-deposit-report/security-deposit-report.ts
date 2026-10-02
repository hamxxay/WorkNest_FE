import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  SecurityDepositReportService,
  SecurityDepositSummary,
  SecurityDepositDetail,
  CustomerLookup
} from '../../../../services/security-deposit-report.service';

@Component({
  selector: 'app-security-deposit-report',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe, DatePipe],
  templateUrl: './security-deposit-report.html',
  styleUrl: './security-deposit-report.css'
})
export class SecurityDepositReportComponent implements OnInit {
  private reportService = inject(SecurityDepositReportService);

  selectedCustomerId: number | null = null;
  fromDate: string = '';
  toDate: string = '';
  dateError: string = '';

  loading = signal<boolean>(false);
  exporting = signal<boolean>(false);
  exportingDetail = signal<boolean>(false);
  customers = signal<CustomerLookup[]>([]);
  summaries = signal<SecurityDepositSummary[]>([]);

  selectedCustomerCode: string = '';
  selectedCustomerIdForDetail: number = 0;
  selectedCustomerName: string = '';
  customerDetails = signal<SecurityDepositDetail[]>([]);
  detailLoading = signal<boolean>(false);
  showDetailModal = signal<boolean>(false);

  ngOnInit(): void {
    this.loadCustomerDropdown();
    this.generateReport();
  }

  loadCustomerDropdown(): void {
    this.reportService.getCustomerLookup().subscribe({
      next: (res) => {
        if (res.isSuccessful || res.success) {
          this.customers.set(res.data || []);
        }
      }
    });
  }

  generateReport(): void {
    this.dateError = '';
    if (this.fromDate && this.toDate && this.fromDate > this.toDate) {
      this.dateError = 'From Date cannot be later than To Date.';
      return;
    }

    this.loading.set(true);
    this.reportService.getSummary({
      customerId: this.selectedCustomerId || undefined,
      fromDate: this.fromDate || undefined,
      toDate: this.toDate || undefined
    }).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.isSuccessful || res.success) {
          this.summaries.set(res.data || []);
        }
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  viewDetails(summary: SecurityDepositSummary): void {
    this.selectedCustomerIdForDetail = summary.customerId;
    this.selectedCustomerCode = summary.customerCode;
    this.selectedCustomerName = `${summary.customerCode} - ${summary.customerName}`;
    this.showDetailModal.set(true);
    this.detailLoading.set(true);

    this.reportService.getDetail(summary.customerId, this.fromDate || undefined, this.toDate || undefined).subscribe({
      next: (res) => {
        this.detailLoading.set(false);
        if (res.isSuccessful || res.success) {
          this.customerDetails.set(res.data || []);
        }
      },
      error: () => {
        this.detailLoading.set(false);
      }
    });
  }

  closeModal(): void {
    this.showDetailModal.set(false);
    this.customerDetails.set([]);
  }

  exportToExcel(): void {
    this.exporting.set(true);
    this.reportService.exportExcel({
      customerId: this.selectedCustomerId || undefined,
      fromDate: this.fromDate || undefined,
      toDate: this.toDate || undefined
    }).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Security_Deposit_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        this.exporting.set(false);
      }
    });
  }

  exportCustomerDetailExcel(): void {
    if (!this.selectedCustomerIdForDetail) return;

    this.exportingDetail.set(true);
    this.reportService.exportCustomerDetailExcel(
      this.selectedCustomerIdForDetail,
      this.fromDate || undefined,
      this.toDate || undefined
    ).subscribe({
      next: (blob) => {
        this.exportingDetail.set(false);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const code = this.selectedCustomerCode || `Customer_${this.selectedCustomerIdForDetail}`;
        a.download = `Deposit_History_${code}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        this.exportingDetail.set(false);
      }
    });
  }

  get totalCount(): number {
    return this.summaries().reduce((acc, curr) => acc + curr.depositCount, 0);
  }

  get totalReceived(): number {
    return this.summaries().reduce((acc, curr) => acc + curr.totalReceived, 0);
  }

  get totalReleased(): number {
    return this.summaries().reduce((acc, curr) => acc + curr.totalReleased, 0);
  }

  get totalForfeited(): number {
    return this.summaries().reduce((acc, curr) => acc + curr.totalForfeited, 0);
  }

  get totalBalanceHeld(): number {
    return this.summaries().reduce((acc, curr) => acc + curr.balanceHeld, 0);
  }
}