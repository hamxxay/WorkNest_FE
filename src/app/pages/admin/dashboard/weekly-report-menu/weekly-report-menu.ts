import { Component, inject, signal } from '@angular/core';
import { AdminService } from '../../../../services/admin.service';
import { ToastService } from '../../../../services/toast.service';

/**
 * Super admin "Weekly report" button on the dashboard header: Preview opens the e-mail as it would go out now
 * (fetched with the login token, shown from a blob URL in a new tab); Send now e-mails it to the super admins
 * after an in-page confirm. The report also goes out by itself every week (WeeklyReportService on the API).
 */
@Component({
  selector: 'app-weekly-report-menu',
  standalone: true,
  templateUrl: './weekly-report-menu.html',
  styleUrl: './weekly-report-menu.css'
})
export class WeeklyReportMenu {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  open = signal(false);
  confirming = signal(false);
  previewing = signal(false);
  sending = signal(false);

  toggle() {
    this.open.set(!this.open());
    this.confirming.set(false);
  }
  close() {
    this.open.set(false);
    this.confirming.set(false);
  }

  preview() {
    // Open the tab now (inside the click) so pop-up blockers allow it, then point it at the report when it arrives.
    const tab = window.open('', '_blank');
    if (tab) tab.document.title = 'Weekly report…';
    this.previewing.set(true);
    this.close();
    this.admin.getWeeklyReportPreview().subscribe({
      next: (blob) => {
        this.previewing.set(false);
        const url = URL.createObjectURL(new Blob([blob], { type: 'text/html' }));
        if (tab) tab.location.href = url;
        else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: () => {
        this.previewing.set(false);
        tab?.close();
        this.toast.error('The weekly report could not be prepared. Please try again.', 'Weekly report');
      }
    });
  }

  send() {
    this.sending.set(true);
    this.admin.sendWeeklyReportNow().subscribe({
      next: (res) => {
        this.sending.set(false);
        this.close();
        if (res?.isSuccessful) this.toast.success(res.message || 'Weekly report sent.', 'Weekly report');
        else this.toast.error(res?.message || 'The weekly report could not be sent. Please try again.', 'Weekly report');
      },
      error: (e: any) => {
        this.sending.set(false);
        this.toast.error(e?.error?.message || 'The weekly report could not be sent. Please try again.', 'Weekly report');
      }
    });
  }
}
