import { AfterViewInit, Directive, ElementRef, HostListener, inject, input } from '@angular/core';

/**
 * Keeps a dropdown / popover (an absolutely positioned menu) inside the visible area: when it would stick out of
 * the screen, or out of a parent that clips sideways (e.g. a page with overflow-x: hidden), it is moved sideways
 * (CSS `translate`, so the menu's own transform animation still works) and, if it is wider than the space, narrowed.
 * Used on menus that open from a button whose position changes with the screen width (phone layouts wrap the
 * header buttons, so a right-aligned menu can end up off the left edge).
 *
 *   <div class="wr-menu" role="menu" appKeepInView>…</div>
 */
@Directive({
  selector: '[appKeepInView]',
  standalone: true
})
export class KeepInView implements AfterViewInit {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Space kept free between the menu and the edge, in px. */
  readonly keepInViewMargin = input(8);

  ngAfterViewInit() {
    this.fit();
  }

  @HostListener('window:resize')
  fit() {
    const el = this.host.nativeElement;
    if (typeof window === 'undefined' || !el.isConnected) return;
    el.style.translate = '';
    el.style.maxWidth = '';
    const margin = this.keepInViewMargin();
    const { left, right } = KeepInView.visibleBounds(el);
    const room = right - left - margin * 2;
    if (room <= 0) return;
    if (el.getBoundingClientRect().width > room) el.style.maxWidth = `${room}px`;
    const r = el.getBoundingClientRect();
    let dx = 0;
    if (r.right > right - margin) dx = right - margin - r.right;
    if (r.left + dx < left + margin) dx = left + margin - r.left;
    if (Math.abs(dx) >= 1) el.style.translate = `${Math.round(dx)}px 0`;
  }

  /** Left / right edges the menu must stay within: the window, narrowed by every ancestor that clips sideways. */
  private static visibleBounds(el: HTMLElement): { left: number; right: number } {
    let left = 0;
    let right = document.documentElement.clientWidth || window.innerWidth;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox === 'visible') continue;
      // the clipping edge is the padding box (inside the border, without a vertical scrollbar)
      const inner = a.getBoundingClientRect().left + a.clientLeft;
      left = Math.max(left, inner);
      right = Math.min(right, inner + a.clientWidth);
    }
    return { left, right };
  }
}
