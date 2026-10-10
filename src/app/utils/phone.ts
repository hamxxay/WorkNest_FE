// Phone number validation shared by every form that takes a phone number.
// Rule (same as the API and the mobile app): only digits, spaces, dashes, parentheses and a single
// leading '+' are allowed; after keeping only the digits there must be 11 to 15 of them.
// "03001234567", "0300-1234567" and "+92 300 1234567" are valid; letters never are.
// Search / filter boxes must NOT use this — partial phone search has to keep working.

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const PHONE_ERROR = 'Phone number must be at least 11 digits (numbers only), e.g. 03001234567.';
/** "+92 (300) 123-4567" style input fits comfortably; up to 15 digits plus separators. */
export const PHONE_MAX_LENGTH = 20;
export const PHONE_MIN_DIGITS = 11;
export const PHONE_MAX_DIGITS = 15;

/** True when the value uses only allowed characters and has 11–15 digits. */
export function isValidPhone(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim();
  if (!/^\+?[\d\s()-]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, '').length;
  return digits >= PHONE_MIN_DIGITS && digits <= PHONE_MAX_DIGITS;
}

/**
 * Error message for a phone value, or null when it's fine.
 * Empty is allowed unless `required` (an optional field may be left blank).
 */
export function phoneError(value: string | null | undefined, required = false): string | null {
  const v = String(value ?? '').trim();
  if (!v) return required ? PHONE_ERROR : null;
  return isValidPhone(v) ? null : PHONE_ERROR;
}

/**
 * As-you-type cleanup: keep only digits, spaces, '-', '(' and ')', plus a '+' only as the
 * first character; capped to PHONE_MAX_LENGTH characters.
 */
export function sanitizePhoneInput(value: string | null | undefined): string {
  const raw = String(value ?? '');
  const lead = raw.trimStart().startsWith('+') ? '+' : '';
  const rest = raw.replace(/[^\d\s()-]/g, '');
  return (lead + (lead ? rest.trimStart() : rest)).slice(0, PHONE_MAX_LENGTH);
}

/**
 * (input) handler helper: sanitizes the element's value in place and returns it,
 * so the caller can write it back to its model, e.g.
 * `(input)="form.phone = onPhoneInput($event)"`.
 */
export function onPhoneInput(event: Event): string {
  const input = event.target as HTMLInputElement;
  const clean = sanitizePhoneInput(input.value);
  if (input.value !== clean) input.value = clean;
  return clean;
}

/** Reactive-forms validator; empty passes (combine with Validators.required when needed). */
export const phoneValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = String(control.value ?? '').trim();
  if (!v || isValidPhone(v)) return null;
  return { phone: PHONE_ERROR };
};
