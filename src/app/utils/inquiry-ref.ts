// Tour inquiries come from two tables: the old website bookings still kept in WN_BookTour ("booktour") and
// WN_Contacts ("contact"). Both number their rows themselves, so the same id can be on two rows of the Tour Inquiries
// list (an old booking and a newer inquiry). Rows are tracked by the API's key, and every write is sent by the
// inquiry's public id, or by id + ?source= when an old row has no public id (before the database update QA_05).

export type InquirySource = 'contact' | 'booktour';

/** What a write needs to find the one inquiry meant. */
export interface InquiryRef {
  publicId?: string | null;
  id?: number | null;
  source?: InquirySource | null;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** "contact" / "booktour" from the API's source; an older API: the "Book Tour" type it gives the WN_BookTour rows. */
export function inquirySource(raw: any): InquirySource {
  const source = text(raw?.source ?? raw?.Source).toLowerCase().replace(/[^a-z]/g, '');
  if (source === 'booktour') return 'booktour';
  if (source === 'contact') return 'contact';
  return text(raw?.contactType ?? raw?.ContactType).toLowerCase() === 'book tour' ? 'booktour' : 'contact';
}

/** Unique row key ("contact-12" / "booktour-12"): the API's key, else source + id. */
export function inquiryKey(raw: any): string {
  const key = text(raw?.key ?? raw?.Key);
  if (key) return key;
  const id = Number(raw?.id ?? raw?.Id) || text(raw?.publicId ?? raw?.PublicId);
  return `${inquirySource(raw)}-${id}`;
}

/** The ref of a list row (public id first). */
export function inquiryRef(item: any): InquiryRef {
  const publicId = text(item?.publicId ?? item?.PublicId) || null;
  const id = Number(item?.id ?? item?.Id) || null;
  return { publicId, id, source: item?.source === 'booktour' || item?.source === 'contact' ? item.source : inquirySource(item) };
}

/**
 * The path after /api of an inquiry action: contact/{publicId}/{action} or contact/{id}/{action}?source=...
 * ('' action = the inquiry itself, e.g. delete). Null when the inquiry can't be identified.
 */
export function inquiryPath(ref: InquiryRef | null | undefined, action: '' | 'feedback' | 'status'): string | null {
  const suffix = action ? `/${action}` : '';
  if (ref?.publicId) return `contact/${encodeURIComponent(ref.publicId)}${suffix}`;
  // Without a source (an old link) the API answers 409 when two inquiries have the id, instead of guessing.
  if (ref?.id && ref.id > 0) return `contact/${ref.id}${suffix}${ref.source ? `?source=${ref.source}` : ''}`;
  return null;
}

/** A ref passed in a URL (Quotations ?fromInquiry=): the public id, or "booktour:12" / "contact:12". */
export function inquiryRefParam(ref: InquiryRef): string | null {
  if (ref.publicId) return ref.publicId;
  return ref.id && ref.id > 0 ? `${ref.source ?? 'contact'}:${ref.id}` : null;
}

/** Back from inquiryRefParam (an old link with only a number: that id, source unknown). */
export function parseInquiryRefParam(value: string | null | undefined): InquiryRef | null {
  const v = text(value);
  if (!v) return null;
  const m = /^(contact|booktour):(\d+)$/.exec(v);
  if (m) return { id: Number(m[2]), source: m[1] as InquirySource };
  if (/^\d+$/.test(v)) return Number(v) > 0 ? { id: Number(v) } : null;
  return /^[0-9a-f-]{36}$/i.test(v) ? { publicId: v } : null;
}
