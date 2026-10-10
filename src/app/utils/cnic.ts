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

/** Reactive-forms validator; empty passes (combine with Validators.required when needed). */
export const cnicValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = String(control.value ?? '').trim();
  if (!v || isValidCnic(v)) return null;
  return { cnic: CNIC_ERROR };
};
