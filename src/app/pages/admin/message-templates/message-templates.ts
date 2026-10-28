import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, Subscription, catchError, debounceTime, map, of, switchMap } from 'rxjs';
import {
  DEFAULT_PLACEHOLDERS, MessageTemplate, MessageTemplateService, TemplatePlaceholder
} from '../../../services/message-template.service';
import { ToastService } from '../../../services/toast.service';

/** Longest wording the API stores (WN_MessageTemplates.Template NVARCHAR(2000)). */
const MAX_LENGTH = 2000;
/** Wait this long after the last key press before asking the API for a new preview. */
const PREVIEW_DEBOUNCE_MS = 400;

type PreviewResult = { kind: 'ok'; text: string } | { kind: 'invalid'; message: string } | { kind: 'error'; message: string };

/** Message from a failed call (the error interceptor puts a plain-language one in err.error.message). */
function errorMessage(err: any, fallback: string): string {
  const m = err?.error?.message ?? err?.message;
  return typeof m === 'string' && m.trim() ? m.trim() : fallback;
}

/** The API refused to save because the database update WT_01 has not been run yet. */
function isMissingDatabaseUpdate(err: any): boolean {
  const body = err?.error;
  const parts = [body?.message, ...(Array.isArray(body?.errors) ? body.errors : [])];
  return parts.some(p => typeof p === 'string' && /WT_01/i.test(p));
}

/**
 * Message templates (/admin/message-templates), admin and super admin only. One card for now: the WhatsApp message
 * staff send to a tour inquiry (Tour Inquiries row button in the CMS, Inquiries in the staff app). The API stores the
 * wording (dbo.WN_MessageTemplates, database update WT_01) and fills it in for each inquiry; this page edits it with a
 * live preview for a sample inquiry.
 */
@Component({
  selector: 'app-message-templates',
  imports: [NgTemplateOutlet],
  templateUrl: './message-templates.html',
  styleUrls: ['../../../styles/form-popup.css', './message-templates.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MessageTemplates implements OnInit {
  private svc = inject(MessageTemplateService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly maxLength = MAX_LENGTH;
  /** Example for the help text (curly brackets cannot be written in the template itself). */
  readonly optionalExample = '[ on {date}]';
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('ta');

  // ---------- loading ----------
  readonly phase = signal<'loading' | 'ready' | 'error'>('loading');
  readonly loadError = signal('');
  private loadSub: Subscription | null = null;

  // ---------- the template ----------
  readonly template = signal<MessageTemplate | null>(null);
  /** What is in the editor. */
  readonly text = signal('');
  /** What is saved (the editor is "changed" when it differs). */
  readonly savedText = signal('');
  readonly dirty = computed(() => this.phase() === 'ready' && this.text() !== this.savedText());
  readonly placeholders = computed<TemplatePlaceholder[]>(() => this.template()?.placeholders ?? DEFAULT_PLACEHOLDERS);
  readonly defaultText = computed(() => this.template()?.defaultTemplate ?? '');
  readonly isDefault = computed(() => !!this.defaultText() && this.text() === this.defaultText());
  readonly length = computed(() => this.text().length);
  readonly tooLong = computed(() => this.length() > MAX_LENGTH);
  readonly empty = computed(() => !this.text().trim());

  /** Shown under the editor: checks done here first (empty, too long), then the API's own message (400). */
  readonly apiValidationError = signal('');
  readonly validationError = computed(() => {
    if (this.empty()) return 'Write the message first. It cannot be empty.';
    if (this.tooLong()) return `The message is too long: ${this.length().toLocaleString('en-GB')} characters. The limit is ${MAX_LENGTH.toLocaleString('en-GB')}.`;
    return this.apiValidationError();
  });

  // ---------- preview ----------
  readonly previewText = signal('');
  readonly previewState = signal<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  readonly previewError = signal('');
  private readonly previewRequests = new Subject<string>();

  // ---------- saving ----------
  readonly saving = signal(false);
  readonly saveError = signal('');
  /** The API said saving needs the database update WT_01 (from a refused save, or from GET when it reports it). */
  readonly needsDatabaseUpdate = signal(false);

  /** "Last updated by Luqman Ahmad on 14 Oct 2026, 3:20 pm", or null when the default wording was never changed. */
  readonly lastUpdated = computed(() => {
    const t = this.template();
    if (!t?.updatedOn) return null;
    const raw = t.updatedOn;
    const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw + 'Z');
    const when = isNaN(d.getTime()) ? raw : d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
    return { by: t.updatedBy, when };
  });

  /** Time shown in the preview bubble (like WhatsApp), set once. */
  readonly bubbleTime = new Date().toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });

  constructor() {
    this.previewRequests.pipe(
      debounceTime(PREVIEW_DEBOUNCE_MS),
      // An empty value only cancels the preview that is on its way (the editor shows its own error then).
      switchMap(value => !value ? EMPTY : this.svc.preview(value).pipe(
        map((text): PreviewResult => ({ kind: 'ok', text })),
        catchError((err: HttpErrorResponse) => of<PreviewResult>(err?.status === 400
          ? { kind: 'invalid', message: errorMessage(err, 'This message cannot be used. Check the placeholders and brackets.') }
          : { kind: 'error', message: errorMessage(err, 'The preview is not available right now.') }))
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(result => {
      if (result.kind === 'ok') {
        this.previewText.set(result.text);
        this.previewState.set('ready');
        this.apiValidationError.set('');
      } else if (result.kind === 'invalid') {
        this.previewState.set('invalid');
        this.apiValidationError.set(result.message);
      } else {
        this.previewState.set('error');
        this.previewError.set(result.message);
      }
    });
    this.destroyRef.onDestroy(() => this.loadSub?.unsubscribe());
  }

  ngOnInit() {
    this.load();
  }

  load() {
    this.loadSub?.unsubscribe();
    this.phase.set('loading');
    this.loadError.set('');
    this.loadSub = this.svc.get().subscribe({
      next: t => {
        this.template.set(t);
        this.needsDatabaseUpdate.set(t.needsDatabaseUpdate);
        // No stored wording yet: the API uses the default, so that is what is "saved".
        const current = t.template || t.defaultTemplate;
        this.savedText.set(current);
        this.setText(current);
        this.phase.set('ready');
      },
      error: (err: HttpErrorResponse) => {
        this.loadError.set(err?.status === 404
          ? 'Message templates are not available on the server yet. The API needs to be updated first.'
          : errorMessage(err, 'Could not load the message. Check your connection and try again.'));
        this.phase.set('error');
      }
    });
  }

  onInput(event: Event) {
    this.setText((event.target as HTMLTextAreaElement).value);
  }

  /** Updates the editor and asks for a new preview (unless it is empty or too long: those errors show right away). */
  private setText(value: string) {
    this.text.set(value);
    this.saveError.set('');
    this.apiValidationError.set('');
    if (!value.trim() || value.length > MAX_LENGTH) {
      this.previewState.set('invalid');
      this.previewRequests.next('');   // cancels a preview that is still on its way
      return;
    }
    this.previewState.set('loading');
    this.previewRequests.next(value);
  }

  /** "{name}" for a placeholder name. */
  token(name: string): string {
    return `{${name}}`;
  }

  /** Puts "{name}" where the cursor is (or over the selected text) in the editor. */
  insertPlaceholder(name: string) {
    const token = `{${name}}`;
    const el = this.textarea()?.nativeElement;
    if (!el) { this.setText(this.text() + token); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.focus();
    el.setSelectionRange(start, end);
    // execCommand keeps the browser's undo (Ctrl+Z) working and fires the input event; fall back when it is not supported.
    const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, token);
    if (!inserted) {
      el.setRangeText(token, start, end, 'end');
      this.setText(el.value);
    }
  }

  /** Puts the default wording in the editor. It is saved only with Save. */
  resetToDefault() {
    const def = this.defaultText();
    if (!def || this.text() === def) return;
    this.setText(def);
    this.textarea()?.nativeElement.focus();
  }

  /** Back to the saved wording. */
  discardChanges() {
    if (!this.dirty()) return;
    this.setText(this.savedText());
  }

  save() {
    if (this.saving() || !this.dirty() || this.validationError()) return;
    const value = this.text();
    this.saving.set(true);
    this.saveError.set('');
    this.svc.save(value).subscribe({
      next: t => {
        this.saving.set(false);
        this.needsDatabaseUpdate.set(false);
        // Some APIs answer a save with only a message: keep what was sent.
        const saved = t.template || value;
        this.template.update(prev => ({
          ...(prev ?? t), ...t,
          template: saved,
          defaultTemplate: t.defaultTemplate || prev?.defaultTemplate || '',
          placeholders: t.placeholders?.length ? t.placeholders : (prev?.placeholders ?? DEFAULT_PLACEHOLDERS),
          updatedOn: t.updatedOn ?? new Date().toISOString(),
          updatedBy: t.updatedBy ?? prev?.updatedBy ?? null,
        }));
        this.savedText.set(saved);
        if (this.text() === value && saved !== value) this.setText(saved);
        this.toast.success('Staff will use the new wording from now on.', 'Message saved');
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        if (isMissingDatabaseUpdate(err)) {
          this.needsDatabaseUpdate.set(true);
        } else if (err?.status === 400) {
          this.apiValidationError.set(errorMessage(err, 'This message cannot be used. Check the placeholders and brackets.'));
        } else {
          this.saveError.set(errorMessage(err, 'Could not save the message. Please try again.'));
        }
      }
    });
  }

  /** Ctrl+S / Cmd+S saves while the editor has the focus. */
  onEditorKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.save();
    }
  }

  /** Asked by the route (canDeactivate) before leaving the page with unsaved changes. */
  canLeave(): boolean {
    return !this.dirty() || window.confirm('You have unsaved changes to the message. Leave without saving?');
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
