// Filters of the admin lists Customers, Bookings, Quotations, Invoices and Payments (API script LST_01_list_filters).
// They are applied on the server, so they stay correct with paging; the API only uses its new procedures when one
// of them is set, so an unfiltered list is requested exactly as before.
// The Invoices page opens on this month's invoices (Period below), so it sends from / to unless All dates is chosen.

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

/**
 * Period of a list's date filter (the Invoices page): a calendar period in Pakistan dates, every date, or a custom
 * From / To. The page opens on DEFAULT_LIST_PERIOD; the API gets the period's From / To like the custom dates.
 */
export type ListPeriod = 'month' | 'lastMonth' | 'last3Months' | 'year' | 'all' | 'custom';
export const DEFAULT_LIST_PERIOD: ListPeriod = 'month';
export const LIST_PERIOD_OPTIONS: readonly { value: ListPeriod; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'last3Months', label: 'Last 3 months' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom range' },
];

/**
 * From / To (YYYY-MM-DD, both included) of a calendar period around `today` (YYYY-MM-DD, Pakistan date): this month,
 * last month, the last 3 months (this month and the two before it) or this year, each to its last day (an invoice
 * issued later in the period is included). Null for 'all' and 'custom' (their dates are not a calendar period).
 */
export function listPeriodRange(period: ListPeriod, today: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) return null;
  const y = Number(m[1]), mon = Number(m[2]) - 1; // 0-based month
  const day = (year: number, month: number, d: number) => {
    const dt = new Date(Date.UTC(year, month, d)); // normalises month overflow (e.g. month -1 = December before)
    return dt.toISOString().slice(0, 10);
  };
  const monthEnd = (year: number, month: number) => day(year, month + 1, 0);
  switch (period) {
    case 'month': return { from: day(y, mon, 1), to: monthEnd(y, mon) };
    case 'lastMonth': return { from: day(y, mon - 1, 1), to: monthEnd(y, mon - 1) };
    case 'last3Months': return { from: day(y, mon - 2, 1), to: monthEnd(y, mon) };
    case 'year': return { from: day(y, 0, 1), to: day(y, 11, 31) };
    default: return null;
  }
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
