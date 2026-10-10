import { ErrorHandler, Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ToastService } from '../services/toast.service';

/**
 * Last stop for errors no page handled. Logs the details for developers; for a failed request nobody caught,
 * or a page that can't load after a new deploy, shows one short readable notice (never raw error text).
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toast = inject(ToastService);
  private lastToastAt = 0;

  handleError(error: unknown): void {
    console.error(error);
    const err = (error as any)?.rejection ?? error; // unwrap unhandled promise rejections

    // 401s are already handled (sign-in redirect); nothing more to tell the user.
    if (err instanceof HttpErrorResponse && err.status === 401) return;

    let message: string;
    let title = 'Something went wrong';
    if (err instanceof HttpErrorResponse) {
      // Already made readable by errorInterceptor.
      message = err.message;
    } else if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(String((err as any)?.message ?? err))) {
      // A new version was deployed while this tab was open.
      title = 'Update available';
      message = 'A new version of WorkNest is available. Please refresh the page.';
    } else {
      // Other script errors are logged above only: a popup for every background glitch would be noise.
      return;
    }

    const now = Date.now();
    if (now - this.lastToastAt < 4000) return;
    this.lastToastAt = now;
    this.toast.show(message, 'error', title);
  }
}
