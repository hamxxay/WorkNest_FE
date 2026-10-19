// ============================================================
// Quiet auto refresh for a dashboard: reloads every `everyMs` (default 5 minutes, as the main dashboard) while the
// browser tab is visible; a hidden tab is not refreshed, and when it comes back with figures older than `everyMs` they
// reload at once. While `paused()` is true (e.g. a drill-down drawer is open) the refresh waits and runs when the page
// calls resume(). The page tells it when fresh figures arrived (markFresh), so a manual refresh restarts the clock.
// ============================================================

export const AUTO_REFRESH_MS = 5 * 60 * 1000;

export interface AutoRefreshOptions {
  /** Reload the data quietly (keep what is on screen). */
  run: () => void;
  /** True while a refresh must wait (drawer open, a load already running...). */
  paused?: () => boolean;
  everyMs?: number;
}

export class AutoRefresh {
  private timer?: ReturnType<typeof setInterval>;
  private lastFresh = Date.now();
  private readonly every: number;
  private readonly onVisibility = () => { if (!document.hidden) this.tick(); };

  constructor(private opts: AutoRefreshOptions) {
    this.every = opts.everyMs ?? AUTO_REFRESH_MS;
    // Checks every minute, so a refresh that had to wait runs soon after it can.
    this.timer = setInterval(() => this.tick(), Math.min(this.every, 60_000));
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Fresh figures are on screen (first load, manual refresh, auto refresh). */
  markFresh() { this.lastFresh = Date.now(); }

  /** Whether the figures on screen are older than the refresh interval. */
  get stale(): boolean { return Date.now() - this.lastFresh >= this.every; }

  /** The pause is over (e.g. the drawer closed): refresh now if the figures went stale meanwhile. */
  resume() { this.tick(); }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private tick() {
    if (!this.timer || document.hidden || !this.stale || this.opts.paused?.()) return;
    // Counted from now, so a failing server is asked again only after the next interval.
    this.lastFresh = Date.now();
    this.opts.run();
  }
}
