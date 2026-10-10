import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

/** Plain-language message per HTTP status, used when the API sent no message of its own. */
const STATUS_MESSAGES: Record<number, string> = {
  0: "Can't reach the server. Check your internet connection and try again.",
  400: "Some of the details aren't valid. Please check them and try again.",
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do this.",
  404: "This isn't available right now. Please try again later.",
  405: "This isn't available right now. Please try again later.",
  408: 'The server took too long to respond. Please try again.',
  409: 'This was changed by someone else. Refresh the page and try again.',
  413: 'The file is too large. Please choose a smaller file.',
  415: "This file type isn't supported.",
  422: "Some of the details aren't valid. Please check them and try again.",
  429: 'Too many requests. Please wait a minute and try again.',
  500: 'Something went wrong on our side. Please try again in a moment.',
  502: 'The service is temporarily unavailable. Please try again in a few minutes.',
  503: 'The service is temporarily unavailable. Please try again in a few minutes.',
  504: 'The server took too long to respond. Please try again.',
};

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

/** Text that must never reach the screen: framework errors, stack traces, SQL, HTML pages, URLs. */
const TECHNICAL_TEXT = /http failure|exception|stack ?trace|\bat [A-Z][\w.]+\(|\bsql\b|object reference|timeout expired|<!doctype|<html|https?:\/\/|\bnull\b|undefined/i;

function isShowable(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= 300 && !TECHNICAL_TEXT.test(text);
}

/** The API's own message, if it sent a readable one ({ message }, ProblemDetails, validation errors, plain text). */
function serverMessage(body: unknown): string | null {
  if (isShowable(body)) return body.trim();
  if (!body || typeof body !== 'object' || body instanceof Blob || body instanceof ArrayBuffer) return null;
  const b = body as Record<string, any>;
  for (const key of ['message', 'Message', 'errorMessage', 'ErrorMessage', 'error', 'detail', 'title']) {
    if (isShowable(b[key])) return b[key].trim();
  }
  // ASP.NET validation: { errors: { Field: ["msg"] } }
  if (b['errors'] && typeof b['errors'] === 'object') {
    for (const value of Object.values(b['errors'])) {
      const first = Array.isArray(value) ? value[0] : value;
      if (isShowable(first)) return first.trim();
    }
  }
  return null;
}

/** A message that is safe and useful to show the user for this failed request. */
export function friendlyHttpMessage(error: HttpErrorResponse): string {
  // The API's own wording first ("Booking not found", "Your access is turned off"); an endpoint that doesn't
  // exist on this server (404 with an empty body) falls through to the plain status message.
  const fromServer = serverMessage(error.error);
  if (fromServer) return fromServer;
  if (error.status >= 500 && !STATUS_MESSAGES[error.status]) return STATUS_MESSAGES[500];
  return STATUS_MESSAGES[error.status] ?? FALLBACK_MESSAGE;
}

/**
 * Every failed API call reaches the page with a readable message: both `err.message` and `err.error.message`
 * hold it, so existing `err?.error?.message ?? err?.message` code never shows "Http failure response for …".
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return throwError(() => error);
      const message = friendlyHttpMessage(error);
      if (!environmentIsProduction()) console.warn(`[API ${error.status}] ${req.method} ${req.urlWithParams}`, error.error);

      const original = error.error;
      // Keep binary bodies (file downloads) as they are; otherwise carry the friendly message in the body.
      const body = original instanceof Blob || original instanceof ArrayBuffer
        ? original
        : original && typeof original === 'object'
          ? { ...original, message }
          : { message };

      const friendly = new HttpErrorResponse({
        error: body,
        headers: error.headers,
        status: error.status,
        statusText: error.statusText,
        url: error.url ?? undefined,
      });
      Object.defineProperty(friendly, 'message', { value: message, enumerable: true });
      return throwError(() => friendly);
    }),
  );

function environmentIsProduction(): boolean {
  return typeof location !== 'undefined' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
}
