import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, map, of, switchMap, tap } from 'rxjs';
import { CiAccount, CustomInvoiceService, customInvoiceErrorMessage } from '../../../services/custom-invoice.service';

let nextId = 0;

/**
 * Searchable account picker for a ledger line (GET api/custom-invoices/accounts?search=). Shows the chosen account as
 * "code  name"; typing searches by code or name; arrow keys, Enter and Escape work like a select.
 */
@Component({
  selector: 'app-ci-account-picker',
  template: `
    <div class="ap" [class.open]="open()">
      <input #box type="text" class="ap-input" [id]="inputId()" role="combobox" autocomplete="off" spellcheck="false"
        aria-autocomplete="list" [attr.aria-expanded]="open()" [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="open() && active() >= 0 ? listId + '-' + active() : null"
        [attr.aria-label]="label()" [attr.aria-invalid]="invalid() || null" [attr.aria-describedby]="describedBy() || null"
        [class.input-invalid]="invalid()" [disabled]="disabled()"
        [value]="text()" [placeholder]="value() ? '' : 'Search code or name'"
        (input)="onInput($any($event.target).value)" (focus)="onFocus()" (blur)="onBlur()" (keydown)="onKey($event)" />
      @if (value() && !editing() && !disabled()) {
        <button type="button" class="ap-clear" (mousedown)="$event.preventDefault()" (click)="clear()" [attr.aria-label]="'Clear ' + label()">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      }
      @if (open()) {
        <ul class="ap-list" role="listbox" [id]="listId" [attr.aria-label]="label() + ' results'">
          @if (loading()) {
            <li class="ap-note" role="presentation"><span class="ap-spin" aria-hidden="true"></span> Searching accounts</li>
          } @else if (error()) {
            <li class="ap-note err" role="presentation">{{ error() }}</li>
          } @else {
            @for (a of results(); track a.accountId; let i = $index) {
              <li role="option" class="ap-opt" [id]="listId + '-' + i" [class.active]="i === active()"
                [attr.aria-selected]="value()?.accountId === a.accountId"
                (mousedown)="$event.preventDefault()" (click)="pick(a)" (mouseenter)="active.set(i)">
                <span class="ap-code">{{ a.code }}</span><span class="ap-name">{{ a.name }}</span>
              </li>
            } @empty {
              <li class="ap-note" role="presentation">No accounts match "{{ query() }}".</li>
            }
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .ap { position: relative; }
    .ap-input { width: 100%; padding: 0 34px 0 12px; text-overflow: ellipsis; }
    .ap-clear { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); width: 28px; height: 28px; display: grid;
      place-items: center; border: none; border-radius: 6px; background: transparent; color: #94a3b8; cursor: pointer; }
    .ap-clear:hover { background: #f1f5f9; color: #0f172a; }
    .ap-clear:focus-visible { outline: 2px solid #0d9488; outline-offset: 1px; }
    .ap-list { position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; right: 0; min-width: min(320px, 86vw); max-height: 240px;
      overflow-y: auto; margin: 0; padding: 4px; list-style: none; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
      box-shadow: 0 12px 28px -8px rgba(15, 23, 42, .25); }
    .ap-opt { display: flex; gap: 10px; align-items: baseline; padding: 8px 10px; border-radius: 7px; cursor: pointer; font-size: .84rem; }
    .ap-opt.active { background: #f0fdfa; }
    .ap-opt[aria-selected='true'] .ap-name { font-weight: 600; }
    .ap-code { flex: 0 0 auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .78rem; color: #0f766e; }
    .ap-name { color: #0f172a; overflow-wrap: anywhere; }
    .ap-note { display: flex; align-items: center; gap: 8px; padding: 10px; font-size: .82rem; color: #64748b; }
    .ap-note.err { color: #b91c1c; }
    .ap-spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #cbd5e1; border-top-color: #0d9488; animation: ap-spin .7s linear infinite; }
    @keyframes ap-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .ap-spin { animation: none; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CiAccountPicker {
  private readonly api = inject(CustomInvoiceService);

  readonly value = input<CiAccount | null>(null);
  readonly inputId = input<string>(`ci-ap-${++nextId}`);
  readonly label = input<string>('Account');
  readonly invalid = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly describedBy = input<string>('');
  readonly picked = output<CiAccount | null>();

  readonly listId = `ci-ap-list-${++nextId}`;
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  readonly open = signal(false);
  /** True while the user is typing a search (the box shows the search instead of the chosen account). */
  readonly editing = signal(false);
  readonly query = signal('');
  readonly results = signal<CiAccount[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly active = signal(-1);

  readonly text = computed(() => {
    if (this.editing()) return this.query();
    const a = this.value();
    return a ? `${a.code}  ${a.name}`.trim() : '';
  });

  private readonly search$ = new Subject<string>();
  private lastSearch: string | null = null;

  constructor() {
    this.search$.pipe(
      debounceTime(250),
      tap(q => { this.lastSearch = q; this.loading.set(true); this.error.set(''); }),
      switchMap(q => this.api.searchAccounts(q).pipe(
        map(list => ({ list, err: '' })),
        catchError(err => of({ list: [] as CiAccount[], err: customInvoiceErrorMessage(err, "Accounts couldn't be loaded.") }))
      )),
      takeUntilDestroyed(inject(DestroyRef))
    ).subscribe(({ list, err }) => {
      this.loading.set(false);
      this.results.set(list);
      this.error.set(err);
      this.active.set(list.length ? 0 : -1);
    });
  }

  onFocus(): void {
    this.open.set(true);
    if (this.lastSearch === null) this.search$.next(this.editing() ? this.query() : '');
  }

  onBlur(): void {
    this.open.set(false);
    this.editing.set(false);
    this.query.set('');
  }

  onInput(text: string): void {
    this.editing.set(true);
    this.query.set(text);
    this.open.set(true);
    this.search$.next(text);
  }

  onKey(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!this.open()) { this.onFocus(); return; }
      if (n) this.active.set((this.active() + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) this.active.set((this.active() - 1 + n) % n);
    } else if (e.key === 'Enter') {
      if (this.open() && this.active() >= 0 && this.active() < n && !this.loading()) {
        e.preventDefault();
        this.pick(this.results()[this.active()]);
      }
    } else if (e.key === 'Escape') {
      if (this.open()) {
        e.preventDefault();
        e.stopPropagation();
        this.open.set(false);
        this.editing.set(false);
        this.query.set('');
      }
    }
  }

  pick(a: CiAccount): void {
    this.picked.emit(a);
    this.open.set(false);
    this.editing.set(false);
    this.query.set('');
  }

  clear(): void {
    this.picked.emit(null);
    this.editing.set(false);
    this.query.set('');
    this.box()?.nativeElement.focus();
  }
}
