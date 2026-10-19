// Calendar-date helpers. The app runs in Pakistan (UTC+5): toISOString() converts to UTC first,
// so between 00:00 and 05:00 PKT `toISOString().split('T')[0]` gives YESTERDAY's date. Use these
// for anything that means a calendar day; keep toISOString() only for real instants.

const pad = (n: number) => String(n).padStart(2, '0');

/** Browser-local date as YYYY-MM-DD (e.g. for <input type="date"> values and "today"). */
export function localDateIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Browser-local date-time as YYYY-MM-DDTHH:mm (for <input type="datetime-local"> values). */
export function localDateTimeIso(d: Date = new Date()): string {
  return `${localDateIso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Today's date in Pakistan (YYYY-MM-DD), whatever time zone the browser is set to. Pakistan time is UTC+5 all year
 * (no daylight saving), the business dates the API uses (e.g. an invoice's issue date).
 */
export function pakistanDateIso(d: Date = new Date()): string {
  return new Date(d.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
