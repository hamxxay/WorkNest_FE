// CNIC (Pakistani national ID) validation shared by every form that takes a CNIC.
// Rule (same as the API and the mobile app): strip spaces and dashes; what is left must be
// exactly 13 digits. "3520212345671" and "35202-1234567-1" are valid; letters never are.
// Search / filter boxes must NOT use this — partial CNIC search has to keep working.

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const CNIC_ERROR = 'CNIC must be 13 digits (numbers only), e.g. 35202-1234567-1.';
/** "35202-1234567-1" is 15 characters. */
export const CNIC_MAX_LENGTH = 15;

/** True when the value, without spaces/dashes, is exactly 13 digits. */
export function isValidCnic(value: string | null | undefined): boolean {
  return /^\d{13}$/.test(String(value ?? '').replace(/[\s-]/g, ''));
}

/**
 * Error message for a CNIC value, or null when it's fine.
 * Empty is allowed unless `required` (an optional field may be left blank).
 */
export function cnicError(value: string | null | undefined, required = false): string | null {
  const v = String(value ?? '').trim();
  if (!v) return required ? CNIC_ERROR : null;
  return isValidCnic(v) ? null : CNIC_ERROR;
}

/** As-you-type cleanup: keep only digits and '-', capped to 15 characters. */
export function sanitizeCnicInput(value: string | null | undefined): string {
  return String(value ?? '').replace(/[^\d-]/g, '').slice(0, CNIC_MAX_LENGTH);
}

/**
 * (input) handler helper: sanitizes the element's value in place and returns it,
 * so the caller can write it back to its model, e.g.
 * `(input)="formCnic = onCnicInput($event)"`.
 */
export function onCnicInput(event: Event): string {
  const input = event.target as HTMLInputElement;
  const clean = sanitizeCnicInput(input.value);
  if (input.value !== clean) input.value = clean;
  return clean;
}

/** Strictly formatted CNIC: 12345-1234567-1 (what formatCnicMask produces once 13 digits are typed). */
export const CNIC_FORMAT_PATTERN = /^\d{5}-\d{7}-\d$/;

/**
 * Input mask: keeps digits only (max 13) and inserts the dashes as 5-7-1,
 * e.g. "3520212" -> "35202-12", "3520212345671" -> "35202-1234567-1".
 * A dash is added only once the next digit is typed, so backspace is never blocked.
 */
export function formatCnicMask(value: string | null | undefined): string {
  const d = String(value ?? '').replace(/\D/g, '').slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

/**
 * (input) handler helper for a masked CNIC field: formats the element's value in place
 * (keeping the caret after the same digit) and returns it, e.g.
 * `(input)="cnic.set(onCnicMaskInput($event))"`.
 */
export function onCnicMaskInput(event: Event): string {
  const input = event.target as HTMLInputElement;
  const raw = input.value;
  const masked = formatCnicMask(raw);
  if (raw !== masked) {
    const caret = input.selectionStart ?? raw.length;
    const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length;
    input.value = masked;
    // Put the caret back after the same number of digits.
    let pos = 0;
    for (let seen = 0; pos < masked.length && seen < digitsBeforeCaret; pos++) {
      if (/\d/.test(masked[pos])) seen++;
    }
    try { input.setSelectionRange(pos, pos); } catch { /* input type without selection support */ }
  }
  return masked;
}

/** Reactive-forms validator; empty passes (combine with Validators.required when needed). */
export const cnicValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = String(control.value ?? '').trim();
  if (!v || isValidCnic(v)) return null;
  return { cnic: CNIC_ERROR };
};
