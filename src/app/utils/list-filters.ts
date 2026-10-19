// Filters of the admin lists Customers, Bookings, Quotations, Invoices and Payments (API script LST_01_list_filters).
// They are applied on the server, so they stay correct with paging; the API only uses its new procedures when one
// of them is set, so an unfiltered list is requested exactly as before.

/** The lists that have the Location / Status / date filters and the Excel export. */
export const FILTERED_LISTS = ['customers', 'bookings', 'quotations', 'invoices', 'payments'] as const;
export type FilteredList = typeof FILTERED_LISTS[number];

export function isFilteredList(entity: string): entity is FilteredList {
  return (FILTERED_LISTS as readonly string[]).includes(entity);
}

/** API path of each list (GET api/{path} and its choices at GET api/{path}/statuses). */
export const LIST_API_PATH: Record<FilteredList, string> = {
  customers: 'customer', bookings: 'booking', quotations: 'quotation', invoices: 'invoice', payments: 'payment',
};

/** What the date range filters on, as the column header calls it. */
export const LIST_DATE_LABEL: Record<FilteredList, string> = {
  customers: 'Created', bookings: 'Start date', quotations: 'Created', invoices: 'Issued', payments: 'Payment date',
};

export interface ListFilterParams {
  /** WN_Locations id; empty = every location the user may see. */
  locationId?: number;
  /** The value of a choice from GET api/{list}/statuses. */
  status?: string;
  /** YYYY-MM-DD, both ends included. */
  from?: string;
  to?: string;
}

/** One choice of a list's Status filter. */
export interface ListStatusOption { value: string; label: string; }

/** Adds the filters that are set (and only those) to a list's query string. */
export function appendListFilters(params: URLSearchParams, f?: ListFilterParams | null): void {
  if (!f) return;
  if (f.locationId != null && f.locationId > 0 && !params.has('locationId')) params.set('locationId', String(f.locationId));
  if (f.status) params.set('status', f.status);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
}

/** The rows of a list answer, whichever shape the endpoint uses ({ data }, { data: { items } }, a plain array ...). */
export function listRows(res: any): any[] {
  if (Array.isArray(res)) return res;
  for (const r of [res?.data, res?.data?.items, res?.items, res?.data?.bookings, res?.bookings, res?.data?.quotations, res?.quotations]) {
    if (Array.isArray(r)) return r;
  }
  return [];
}

/** The total row count of a list answer; null when the endpoint does not send one. */
export function listTotal(res: any): number | null {
  const t = res?.total ?? res?.totalCount ?? res?.data?.total ?? res?.data?.totalCount;
  const n = Number(t);
  return t != null && Number.isFinite(n) ? n : null;
}
