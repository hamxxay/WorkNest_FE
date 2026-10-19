// ============================================================
// Global tooltip
// ============================================================
// One styled tooltip for the whole app, with no per-component imports.
// Started once from app.config.ts (provideEnvironmentInitializer).
//
// It listens on the document and, when a button / link / [role=button] /
// [data-tooltip] is hovered with a mouse or pen, or focused from the keyboard,
// shows its label in a small bubble near it (above; below or to the side at the
// viewport edges). The label is data-tooltip, else title, else aria-label.
//
// - While the pointer is over an element its title attribute is set aside (and
//   put back when the pointer leaves), so the browser's own slow tooltip does not
//   show as well. If that title was the element's only name, it is copied to
//   aria-label for that time, so screen readers keep the name. Putting the title
//   back keeps Angular's [title] / [attr.title] bindings in charge of it.
// - Shown for icon-only elements (no text, or one symbol such as × or ‹) and for
//   any element with an explicit title / data-tooltip, but not when the visible
//   text already says the same thing (such an element keeps its title untouched).
//   aria-label alone only shows on icon-only ones.
// - Not on touch. Hidden on pointer down / click, Escape, scroll, resize, route
//   change, or when the element leaves the page.
// - data-tooltip-placement="right" (or top / bottom / left) on an element or a
//   container makes that side the first choice, e.g. for the collapsed sidebar.
//
// It works on the DOM only (no signals, no change detection), so it is fine
// with zoneless Angular, and it sits above modals and drawers.
// ============================================================

import { DOCUMENT, Injectable, OnDestroy, inject } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { Subscription } from 'rxjs';

/** Elements that can carry a tooltip. */
const TRIGGER_SELECTOR = 'button, a, [role="button"], [data-tooltip]';
/** Hover delay before the bubble shows. */
const SHOW_DELAY_MS = 150;
/** Moving from one button to the next within this time shows the next tooltip at once. */
const WARM_MS = 400;
/** Space between the element and the bubble, and between the bubble and the viewport edge. */
const GAP = 8;
const EDGE = 8;

type Placement = 'top' | 'bottom' | 'left' | 'right';

/** A hovered element whose title is set aside until the pointer leaves it. */
interface HeldTitle {
  title: string;
  /** aria-label was added by this service (the title was the element's only name). */
  addedAria: boolean;
  /** Picks up a new title that Angular writes while the element is hovered. */
  observer: MutationObserver;
}

@Injectable({ providedIn: 'root' })
export class GlobalTooltipService implements OnDestroy {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router, { optional: true });

  private started = false;
  private listeners: AbortController | null = null;
  private routerSub: Subscription | null = null;
  /** While a tooltip is pending or shown: watches for its element leaving the page or its label changing. */
  private targetObserver: MutationObserver | null = null;

  private bubble: HTMLDivElement | null = null;
  private bubbleText: HTMLSpanElement | null = null;

  /** Element the bubble is shown for (or about to be shown for). */
  private target: HTMLElement | null = null;
  private visible = false;
  private viaKeyboard = false;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHiddenAt = 0;
  /** Element just clicked / dismissed with Escape: no tooltip on it until the pointer or focus leaves. */
  private suppressed: HTMLElement | null = null;

  private readonly held = new Map<HTMLElement, HeldTitle>();

  /** Attach the document listeners. Safe to call more than once. */
  start(): void {
    const win = this.doc.defaultView;
    if (this.started || !win || typeof MutationObserver === 'undefined') return;
    this.started = true;

    this.listeners = new AbortController();
    const signal = this.listeners.signal;
    const capture = { capture: true, signal };
    const passiveCapture = { capture: true, passive: true, signal };

    this.doc.addEventListener('pointerover', (e) => this.onPointerOver(e), passiveCapture);
    this.doc.addEventListener('pointerout', (e) => this.onPointerOut(e), passiveCapture);
    this.doc.addEventListener('pointerdown', (e) => this.onPress(e), passiveCapture);
    this.doc.addEventListener('click', (e) => this.onPress(e), passiveCapture);
    this.doc.addEventListener('focusin', (e) => this.onFocusIn(e), capture);
    this.doc.addEventListener('focusout', (e) => this.onFocusOut(e), capture);
    this.doc.addEventListener('keydown', (e) => this.onKeyDown(e), capture);
    // Scroll events do not bubble; capturing on the document also catches scrolled tables, modals and drawers.
    this.doc.addEventListener('scroll', () => this.onScroll(), passiveCapture);
    win.addEventListener('resize', () => this.hide(), { passive: true, signal });
    win.addEventListener('blur', () => this.hide(), { signal });

    this.routerSub =
      this.router?.events.subscribe((e) => {
        if (e instanceof NavigationStart) this.hide();
      }) ?? null;

    this.targetObserver = new MutationObserver((records) => this.onTargetMutations(records));
  }

  ngOnDestroy(): void {
    this.hide();
    for (const el of [...this.held.keys()]) this.release(el);
    this.listeners?.abort();
    this.listeners = null;
    this.routerSub?.unsubscribe();
    this.routerSub = null;
    this.targetObserver?.disconnect();
    this.targetObserver = null;
    this.bubble?.remove();
    this.bubble = null;
    this.bubbleText = null;
    this.suppressed = null;
    this.started = false;
  }

  // ------------------------------------------------------------
  // Events
  // ------------------------------------------------------------

  private onPointerOver(e: PointerEvent): void {
    this.pruneHeld(e.target as Node | null);
    if (e.pointerType === 'touch') {
      this.hide();
      return;
    }
    const el = this.findTrigger(e.target);
    if (!el || (el === this.target && !this.viaKeyboard)) return; // nothing to do, or moving inside the element
    // Elements that get no tooltip from us (e.g. the text already says it) keep their title as it was.
    if (!this.labelFor(el)) return;
    this.hold(el); // set the title aside before the browser's own tooltip can show
    if (el === this.target || el === this.suppressed) return;
    this.request(el, false);
  }

  private onPointerOut(e: PointerEvent): void {
    const from = this.findTrigger(e.target);
    if (!from) return;
    const to = e.relatedTarget as Node | null;
    if (to && from.contains(to)) return; // still inside the element
    this.release(from);
    if (from === this.suppressed) this.suppressed = null;
    if (from === this.target && !this.viaKeyboard) this.hide();
  }

  private onPress(e: Event): void {
    this.hide();
    // A mouse / pen press also keeps it hidden until the pointer leaves. A tap (no hover to come back to)
    // or a click from the keyboard (Enter / Space) only hides it.
    if ((e as PointerEvent).pointerType === 'touch') return;
    if (e.type === 'click' && (e as MouseEvent).detail === 0) return;
    this.suppressed = this.findTrigger(e.target);
  }

  private onFocusIn(e: FocusEvent): void {
    const el = this.findTrigger(e.target);
    if (!el || el !== e.target) return; // only the focused control itself, not a focused child
    if (!this.isKeyboardFocus(el)) return; // focus from a click or tap shows nothing
    this.suppressed = null;
    this.request(el, true);
  }

  private onFocusOut(e: FocusEvent): void {
    const el = e.target as HTMLElement | null;
    if (!el) return;
    if (el === this.suppressed && !el.matches(':hover')) this.suppressed = null; // not under the pointer any more
    if (el === this.target && this.viaKeyboard) this.hide();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (!this.target) return;
    this.suppressed = this.target;
    this.hide(); // the Escape key still reaches modals and drawers
  }

  private onScroll(): void {
    if (!this.target) return;
    if (this.viaKeyboard) {
      // Moving focus can scroll the page: keep the bubble next to the focused element.
      if (this.visible && !this.position()) this.hide();
      return;
    }
    this.hide();
  }

  private onTargetMutations(records: MutationRecord[]): void {
    const el = this.target;
    if (!el) return;
    if (!el.isConnected) {
      this.hide();
      return;
    }
    if (records.some((r) => r.type === 'attributes' && r.target === el)) this.refreshLabel();
  }

  // ------------------------------------------------------------
  // Show / hide
  // ------------------------------------------------------------

  private request(el: HTMLElement, viaKeyboard: boolean): void {
    if (!this.labelFor(el)) {
      if (this.target && this.target !== el) this.hide();
      return;
    }
    const warm = this.visible || Date.now() - this.lastHiddenAt < WARM_MS;
    this.hide();
    this.target = el;
    this.viaKeyboard = viaKeyboard;
    this.watchTarget(el);
    if (warm) {
      this.show();
    } else {
      this.showTimer = setTimeout(() => {
        this.showTimer = null;
        this.show();
      }, SHOW_DELAY_MS);
    }
  }

  private show(): void {
    const el = this.target;
    const label = el && el.isConnected ? this.labelFor(el) : null;
    const bubble = label ? this.ensureBubble() : null;
    if (!el || !label || !bubble || !this.bubbleText) {
      this.hide();
      return;
    }
    this.bubbleText.textContent = label;
    bubble.classList.remove('is-visible');
    bubble.hidden = false;
    if (!this.position()) {
      this.hide();
      return;
    }
    bubble.getBoundingClientRect(); // apply the new position before fading in
    bubble.classList.add('is-visible');
    this.visible = true;
  }

  private hide(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.visible) this.lastHiddenAt = Date.now();
    this.visible = false;
    this.target = null;
    this.viaKeyboard = false;
    this.targetObserver?.disconnect();
    this.bubble?.classList.remove('is-visible');
  }

  /** The label of the current element changed while its tooltip is up. */
  private refreshLabel(): void {
    const el = this.target;
    if (!el) return;
    const label = this.labelFor(el);
    if (!label) {
      this.hide();
    } else if (this.visible && this.bubbleText) {
      if (this.bubbleText.textContent !== label) this.bubbleText.textContent = label;
      if (!this.position()) this.hide();
    }
  }

  private watchTarget(el: HTMLElement): void {
    const obs = this.targetObserver;
    if (!obs) return;
    obs.disconnect();
    if (this.doc.body) obs.observe(this.doc.body, { childList: true, subtree: true });
    obs.observe(el, { attributes: true, attributeFilter: ['title', 'data-tooltip', 'aria-label', 'hidden'] });
  }

  private ensureBubble(): HTMLDivElement | null {
    if (this.bubble && this.bubble.isConnected) return this.bubble;
    const body = this.doc.body;
    if (!body) return null;
    const bubble = this.doc.createElement('div');
    bubble.className = 'wn-tooltip';
    // Screen readers already get the label from the element (aria-label / title); do not read it twice.
    bubble.setAttribute('aria-hidden', 'true');
    bubble.hidden = true;
    const text = this.doc.createElement('span');
    text.className = 'wn-tooltip__text';
    const arrow = this.doc.createElement('span');
    arrow.className = 'wn-tooltip__arrow';
    bubble.append(text, arrow);
    body.appendChild(bubble);
    this.bubble = bubble;
    this.bubbleText = text;
    return bubble;
  }

  /** Place the bubble next to the element. Returns false when the element is not on screen. */
  private position(): boolean {
    const el = this.target;
    const bubble = this.bubble;
    const win = this.doc.defaultView;
    if (!el || !bubble || !win) return false;
    const r = el.getBoundingClientRect();
    const vw = this.doc.documentElement.clientWidth || win.innerWidth;
    const vh = this.doc.documentElement.clientHeight || win.innerHeight;
    if ((r.width === 0 && r.height === 0) || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;

    // Measure at the top-left corner so the width is not squeezed by the viewport edge.
    bubble.style.left = '0px';
    bubble.style.top = '0px';
    const tw = bubble.offsetWidth;
    const th = bubble.offsetHeight;

    const fits: Record<Placement, boolean> = {
      top: r.top - GAP - th >= EDGE,
      bottom: r.bottom + GAP + th <= vh - EDGE,
      right: r.right + GAP + tw <= vw - EDGE,
      left: r.left - GAP - tw >= EDGE,
    };
    // A container can ask for a side first, e.g. data-tooltip-placement="right" on the sidebar.
    const wanted = el.closest('[data-tooltip-placement]')?.getAttribute('data-tooltip-placement') as Placement | null;
    const order: Placement[] = ['top', 'bottom', 'right', 'left'];
    if (wanted && order.includes(wanted)) order.unshift(wanted);
    const placement = order.find((p) => fits[p]) ?? 'top';

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));
    let x: number;
    let y: number;
    let arrow: number;
    if (placement === 'top' || placement === 'bottom') {
      const cx = r.left + r.width / 2;
      x = clamp(cx - tw / 2, EDGE, vw - EDGE - tw);
      y = placement === 'top' ? r.top - GAP - th : r.bottom + GAP;
      arrow = clamp(cx - x, 10, tw - 10);
    } else {
      const cy = r.top + r.height / 2;
      y = clamp(cy - th / 2, EDGE, vh - EDGE - th);
      x = placement === 'right' ? r.right + GAP : r.left - GAP - tw;
      arrow = clamp(cy - y, 8, th - 8);
    }

    bubble.dataset['placement'] = placement;
    bubble.style.left = `${Math.round(x)}px`;
    bubble.style.top = `${Math.round(y)}px`;
    bubble.style.setProperty('--wn-tooltip-arrow', `${Math.round(arrow)}px`);
    return true;
  }

  // ------------------------------------------------------------
  // Titles set aside while hovered
  // ------------------------------------------------------------

  private hold(el: HTMLElement): void {
    if (this.held.has(el) || !el.hasAttribute('title')) return;
    const entry: HeldTitle = {
      title: '',
      addedAria: false,
      observer: new MutationObserver(() => {
        // Angular wrote a new title while the element is hovered: take that one instead.
        if (el.hasAttribute('title')) {
          this.takeTitle(el, entry);
          if (el === this.target) this.refreshLabel();
        }
      }),
    };
    this.held.set(el, entry);
    this.takeTitle(el, entry);
    entry.observer.observe(el, { attributes: true, attributeFilter: ['title'] });
  }

  private takeTitle(el: HTMLElement, entry: HeldTitle): void {
    const title = el.getAttribute('title');
    if (title === null) return;
    entry.title = title;
    el.removeAttribute('title');
    const name = title.trim();
    if (entry.addedAria) {
      if (name) el.setAttribute('aria-label', name);
      else {
        el.removeAttribute('aria-label');
        entry.addedAria = false;
      }
    } else if (name && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby') && this.isIconOnly(this.visibleText(el))) {
      // The title was this element's only name: keep it for screen readers while it is set aside.
      el.setAttribute('aria-label', name);
      entry.addedAria = true;
    }
  }

  /** Put the title back once the pointer has left the element. */
  private release(el: HTMLElement): void {
    const entry = this.held.get(el);
    if (!entry) return;
    entry.observer.disconnect();
    this.held.delete(el);
    if (!el.hasAttribute('title')) el.setAttribute('title', entry.title);
    if (entry.addedAria) el.removeAttribute('aria-label');
  }

  /** Give back titles of elements the pointer is no longer over (a missed pointerout, or removed from the page). */
  private pruneHeld(over: Node | null): void {
    for (const el of [...this.held.keys()]) {
      if (!el.isConnected || !over || !el.contains(over)) this.release(el);
    }
  }

  // ------------------------------------------------------------
  // Labels
  // ------------------------------------------------------------

  private findTrigger(node: EventTarget | null): HTMLElement | null {
    if (!node || !(node as Node).nodeType) return null;
    const start = (node as Node).nodeType === 1 ? (node as Element) : (node as Node).parentElement;
    const el = start?.closest(TRIGGER_SELECTOR) ?? null;
    if (!el || (this.bubble && this.bubble.contains(el))) return null;
    return el as HTMLElement;
  }

  /** The text to show for this element, or null when it needs no tooltip. */
  private labelFor(el: HTMLElement): string | null {
    const explicit = (el.getAttribute('data-tooltip') ?? el.getAttribute('title') ?? this.held.get(el)?.title ?? '').trim();
    const text = this.visibleText(el);
    if (explicit) return this.sameMeaning(text, explicit) ? null : explicit;
    if (!this.isIconOnly(text)) return null;
    return (el.getAttribute('aria-label') ?? '').trim() || null;
  }

  /** Text a sighted user sees on the element (icons, hidden and screen-reader-only text left out). */
  private visibleText(el: Element): string {
    const win = this.doc.defaultView;
    let out = '';
    const walk = (parent: Node) => {
      for (let n = parent.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          out += n.nodeValue ?? '';
        } else if (n.nodeType === 1) {
          const child = n as Element;
          const tag = child.tagName.toLowerCase();
          if (tag === 'svg' || tag === 'style' || tag === 'script' || tag === 'template') continue;
          if (child.getAttribute('aria-hidden') === 'true') continue;
          if (child.classList.contains('sr-only') || child.classList.contains('visually-hidden')) continue;
          const style = win?.getComputedStyle(child);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
          walk(child);
        }
      }
    };
    walk(el);
    return out.replace(/\s+/g, ' ').trim();
  }

  /** No text, or a single symbol such as ×, ‹, ⋮ or a one-letter editor button. */
  private isIconOnly(text: string): boolean {
    if (!text) return true;
    return [...text].length <= 2 && !/[\p{L}\p{N}]{2}/u.test(text);
  }

  /** True when the visible text already says what the label says. */
  private sameMeaning(text: string, label: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const t = norm(text);
    const l = norm(label);
    return !!t && !!l && (t === l || t.includes(l));
  }

  /** Focus from the keyboard (Tab, arrow keys, or set by code after a key press), not from a click or tap. */
  private isKeyboardFocus(el: HTMLElement): boolean {
    try {
      return el.matches(':focus-visible');
    } catch {
      return false;
    }
  }
}
