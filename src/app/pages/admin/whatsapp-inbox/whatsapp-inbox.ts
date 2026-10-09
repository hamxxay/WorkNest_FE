import { Component, DestroyRef, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WaConversation, WaMessage, WhatsAppService } from '../../../services/whatsapp.service';
import { ToastService } from '../../../services/toast.service';
import { AuthService } from '../../../services/auth.service';

/**
 * WhatsApp Inbox: every conversation with the WorkNest WhatsApp number (the bot answers automatically;
 * staff can read and reply here, start a conversation, and broadcast). Refreshes every 15 s.
 */
@Component({
  selector: 'app-whatsapp-inbox',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './whatsapp-inbox.html',
  styleUrls: ['../access/access-shared.css', './whatsapp-inbox.css']
})
export class WhatsAppInbox implements OnInit {
  private wa = inject(WhatsAppService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);

  readonly canBroadcast = this.auth.hasRole('admin') || this.auth.hasRole('super_admin') || this.auth.hasRole('sales_executive');

  conversations = signal<WaConversation[]>([]);
  loadingList = signal(false);
  search = '';
  selected = signal<WaConversation | null>(null);
  messages = signal<WaMessage[]>([]);
  loadingMessages = signal(false);
  replyText = '';
  sending = signal(false);

  // contact editing
  editingContact = signal(false);
  contactForm = { name: '', tags: '', adminNotes: '' };

  // new conversation / broadcast
  showStart = signal(false);
  startForm = { phone: '', name: '', message: '' };
  showBroadcast = signal(false);
  broadcastForm = { tag: '', message: '' };

  readonly unreadTotal = computed(() => this.conversations().filter(c => c.unreadCount > 0).length);
  private thread = viewChild<ElementRef<HTMLDivElement>>('thread');
  private timer: any;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
  }

  ngOnInit() {
    this.loadConversations();
    this.timer = setInterval(() => {
      this.loadConversations(true);
      const c = this.selected();
      if (c) this.loadMessages(c.id, true);
    }, 15000);
  }

  loadConversations(silent = false) {
    if (!silent) this.loadingList.set(true);
    this.wa.getConversations(1, 100, this.search.trim()).subscribe({
      next: res => {
        this.loadingList.set(false);
        const list = res?.data ?? [];
        this.conversations.set(list);
        const sel = this.selected();
        if (sel) { const fresh = list.find(c => c.id === sel.id); if (fresh) this.selected.set({ ...fresh, unreadCount: 0 }); }
      },
      error: err => { this.loadingList.set(false); if (!silent) this.toast.error(err?.error?.message || 'Could not load WhatsApp conversations.'); }
    });
  }

  open(c: WaConversation) {
    this.selected.set(c);
    this.editingContact.set(false);
    this.replyText = '';
    this.messages.set([]);
    this.loadMessages(c.id);
    // opening marks it read on the server
    this.conversations.update(list => list.map(x => x.id === c.id ? { ...x, unreadCount: 0 } : x));
  }

  loadMessages(id: number, silent = false) {
    if (!silent) this.loadingMessages.set(true);
    this.wa.getMessages(id).subscribe({
      next: res => {
        this.loadingMessages.set(false);
        if (this.selected()?.id !== id) return;
        const before = this.messages().length;
        this.messages.set(res?.data ?? []);
        if (!silent || this.messages().length !== before) this.scrollToBottom();
      },
      error: err => { this.loadingMessages.set(false); if (!silent) this.toast.error(err?.error?.message || 'Could not load messages.'); }
    });
  }

  send() {
    const c = this.selected();
    const text = this.replyText.trim();
    if (!c || !text || this.sending()) return;
    this.sending.set(true);
    this.wa.reply(c.id, text).subscribe({
      next: res => {
        this.sending.set(false);
        this.replyText = '';
        if (res?.data?.method === 'template') this.toast.success(res.message || 'Sent as a template.');
        this.loadMessages(c.id, true);
        this.loadConversations(true);
      },
      error: err => { this.sending.set(false); this.toast.error(err?.error?.message || 'The message could not be sent.'); }
    });
  }

  onReplyKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
  }

  editContact() {
    const c = this.selected();
    if (!c) return;
    this.contactForm = { name: c.name || '', tags: c.tags || '', adminNotes: c.adminNotes || '' };
    this.editingContact.set(true);
  }

  saveContact() {
    const c = this.selected();
    if (!c) return;
    this.wa.updateContact(c.contactId, this.contactForm).subscribe({
      next: () => { this.editingContact.set(false); this.toast.success('Contact updated.'); this.loadConversations(true); },
      error: err => this.toast.error(err?.error?.message || 'Could not update the contact.')
    });
  }

  startConversation() {
    const f = this.startForm;
    if (!f.phone.trim() || !f.message.trim()) { this.toast.error('Enter the WhatsApp number and a message.'); return; }
    this.sending.set(true);
    this.wa.start(f.phone.trim(), f.name.trim(), f.message.trim()).subscribe({
      next: res => {
        this.sending.set(false);
        this.showStart.set(false);
        this.startForm = { phone: '', name: '', message: '' };
        this.toast.success(res?.message || 'Sent.');
        this.loadConversations(true);
        const id = res?.data?.conversationId;
        if (id) setTimeout(() => { const c = this.conversations().find(x => x.id === id); if (c) this.open(c); }, 800);
      },
      error: err => { this.sending.set(false); this.toast.error(err?.error?.message || 'The message could not be sent.'); }
    });
  }

  sendBroadcast() {
    const f = this.broadcastForm;
    if (!f.message.trim()) { this.toast.error('Type the broadcast message.'); return; }
    const audience = f.tag.trim() ? `contacts tagged "${f.tag.trim()}"` : 'ALL WhatsApp contacts';
    if (!confirm(`Send this message to ${audience}?`)) return;
    this.sending.set(true);
    this.wa.broadcast(f.message.trim(), f.tag.trim()).subscribe({
      next: res => {
        this.sending.set(false);
        this.showBroadcast.set(false);
        this.broadcastForm = { tag: '', message: '' };
        this.toast.success(res?.message || 'Broadcast sent.');
        this.loadConversations(true);
      },
      error: err => { this.sending.set(false); this.toast.error(err?.error?.message || 'The broadcast could not be sent.'); }
    });
  }

  displayName(c: WaConversation): string { return c.name || ('+' + c.phoneNumber); }
  initials(c: WaConversation): string {
    const n = (c.name || '').trim();
    return n ? n.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() : '#';
  }

  private scrollToBottom() {
    setTimeout(() => { const el = this.thread()?.nativeElement; if (el) el.scrollTop = el.scrollHeight; });
  }
}
