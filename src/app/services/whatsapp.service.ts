import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface WaConversation {
  id: number;
  contactId: number;
  phoneNumber: string;
  name?: string | null;
  tags?: string | null;
  adminNotes?: string | null;
  status: string;
  lastMessageAt?: string | null;
  lastMessageText?: string | null;
  lastIncomingAt?: string | null;
  unreadCount: number;
  /** WhatsApp's 24-hour window is open: replies go as plain messages (otherwise as the approved template). */
  inReplyWindow: boolean;
}

export interface WaMessage {
  id: number;
  conversationId: number;
  direction: 'incoming' | 'outgoing';
  messageType: string;
  messageText?: string | null;
  sentByUserId?: number | null;
  createdOn: string;
}

/** WhatsApp Inbox (WN_APIs api/whatsapp/*). */
@Injectable({ providedIn: 'root' })
export class WhatsAppService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/whatsapp`;

  getConversations(page = 1, limit = 30, search = ''): Observable<{ data: WaConversation[]; total: number }> {
    const params: any = { page, limit };
    if (search) params.search = search;
    return this.http.get<any>(`${this.api}/conversations`, { params });
  }
  getMessages(conversationId: number, beforeId?: number): Observable<{ data: WaMessage[] }> {
    const params: any = {};
    if (beforeId) params.beforeId = beforeId;
    return this.http.get<any>(`${this.api}/conversations/${conversationId}/messages`, { params });
  }
  reply(conversationId: number, message: string): Observable<any> {
    return this.http.post<any>(`${this.api}/conversations/${conversationId}/messages`, { message });
  }
  start(phone: string, name: string, message: string): Observable<any> {
    return this.http.post<any>(`${this.api}/conversations/start`, { phone, name, message });
  }
  updateContact(contactId: number, data: { name?: string; tags?: string; adminNotes?: string }): Observable<any> {
    return this.http.patch<any>(`${this.api}/contacts/${contactId}`, data);
  }
  broadcast(message: string, tag: string): Observable<any> {
    return this.http.post<any>(`${this.api}/broadcast`, { message, tag });
  }
}
