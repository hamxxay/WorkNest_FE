import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

// ============================================================
// Message templates (GET / PUT / POST preview api/message-templates/{key}). Shared contract with the API and the
// mobile app (whatsapp-template contract, 15 Oct 2026). The wording is stored in dbo.WN_MessageTemplates; before the
// database update WT_01 is run the API uses the default wording from code and refuses to save.
// One template so far: 'inquiry_whatsapp', the WhatsApp message staff send to a tour inquiry. The API fills it in
// (one renderer, used by the preview and by GET api/contact/{publicId}/whatsapp-message).
// Responses arrive as { isSuccessful, message, data }; every field is normalised here.
// ============================================================

export const INQUIRY_WHATSAPP_TEMPLATE = 'inquiry_whatsapp';

export interface TemplatePlaceholder {
  /** Without braces, lower case: "name". */
  name: string;
  description: string;
}

export interface MessageTemplate {
  key: string;
  template: string;
  defaultTemplate: string;
  placeholders: TemplatePlaceholder[];
  /** ISO date-time (UTC) of the last save; null when the default wording has never been changed. */
  updatedOn: string | null;
  /** Name of the person who saved it last. */
  updatedBy: string | null;
  /** True when the API says the database update WT_01 has not been run yet (optional field). */
  needsDatabaseUpdate: boolean;
}

/** The ready-to-send WhatsApp message for one tour inquiry. */
export interface InquiryWhatsAppMessage {
  /** International digits for wa.me, e.g. "923001234567". */
  phone: string;
  text: string;
  /** https://wa.me/<phone>?text=... */
  url: string;
}

/** The placeholders the API understands (used when a response does not list them). */
export const DEFAULT_PLACEHOLDERS: TemplatePlaceholder[] = [
  { name: 'name', description: "The customer's first name (\"there\" when the inquiry has no name)" },
  { name: 'staff', description: 'Your first name (the staff member sending the message)' },
  { name: 'branch', description: 'The branch the inquiry is for' },
  { name: 'date', description: 'The day the inquiry came in, e.g. 9 Oct' },
  { name: 'source', description: 'How it came in, e.g. our website, WhatsApp, a walk-in visit' },
  { name: 'workspace', description: 'The workspace they asked about, e.g. Private Office' },
  { name: 'seats', description: 'How many people (seats) they asked for' },
];

const unwrap = (res: any): any => (res && typeof res === 'object' && 'data' in res ? res.data : res) ?? {};
const text = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const textOrNull = (v: any): string | null => {
  const s = text(v).trim();
  return s ? s : null;
};

function toTemplate(res: any, key: string): MessageTemplate {
  const d = unwrap(res);
  const raw = Array.isArray(d.placeholders ?? d.Placeholders) ? (d.placeholders ?? d.Placeholders) : [];
  const placeholders: TemplatePlaceholder[] = raw
    .map((p: any) => typeof p === 'string'
      ? { name: p, description: '' }
      : { name: text(p?.name ?? p?.Name), description: text(p?.description ?? p?.Description) })
    .map((p: TemplatePlaceholder) => ({ ...p, name: p.name.replace(/[{}]/g, '').trim().toLowerCase() }))
    .filter((p: TemplatePlaceholder) => !!p.name);
  const by = d.updatedBy ?? d.UpdatedBy ?? d.updatedByName ?? d.UpdatedByName;
  return {
    key: text(d.key ?? d.Key) || key,
    template: text(d.template ?? d.Template),
    defaultTemplate: text(d.defaultTemplate ?? d.DefaultTemplate),
    placeholders: placeholders.length ? placeholders : DEFAULT_PLACEHOLDERS,
    updatedOn: textOrNull(d.updatedOn ?? d.UpdatedOn),
    updatedBy: textOrNull(by && typeof by === 'object' ? (by.name ?? by.Name ?? by.email ?? by.Email) : by),
    needsDatabaseUpdate: (d.needsDatabaseUpdate ?? d.NeedsDatabaseUpdate) === true,
  };
}

@Injectable({ providedIn: 'root' })
export class MessageTemplateService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  private url(key: string): string {
    return `${this.api}/message-templates/${encodeURIComponent(key)}`;
  }

  get(key: string = INQUIRY_WHATSAPP_TEMPLATE): Observable<MessageTemplate> {
    return this.http.get<any>(this.url(key)).pipe(map(res => toTemplate(res, key)));
  }

  /** Admin / super admin only. 400 with a plain-language message when the wording is not valid (or WT_01 is missing). */
  save(template: string, key: string = INQUIRY_WHATSAPP_TEMPLATE): Observable<MessageTemplate> {
    return this.http.put<any>(this.url(key), { template }).pipe(map(res => toTemplate(res, key)));
  }

  /** The wording filled in for a sample inquiry; 400 with a plain-language message when it is not valid. */
  preview(template: string, key: string = INQUIRY_WHATSAPP_TEMPLATE): Observable<string> {
    return this.http.post<any>(`${this.url(key)}/preview`, { template }).pipe(map(res => {
      const d = unwrap(res);
      return typeof d === 'string' ? d : text(d.text ?? d.Text);
    }));
  }

  /** The WhatsApp message for one tour inquiry, filled in by the API for the signed-in staff member. */
  inquiryMessage(publicId: string): Observable<InquiryWhatsAppMessage> {
    return this.http.get<any>(`${this.api}/contact/${encodeURIComponent(publicId)}/whatsapp-message`).pipe(map(res => {
      const d = unwrap(res);
      return { phone: text(d.phone ?? d.Phone), text: text(d.text ?? d.Text), url: text(d.url ?? d.Url) };
    }));
  }
}
