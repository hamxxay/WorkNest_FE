import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { GwnClient, GwnRange, GwnService, GwnSsid, GwnSsidStats, gwnErrorText } from '../../../../services/gwn.service';
import { ChartBag, ExportKind, NET_SHARED, ago, baseOptions, exportCard, exportPagePdf, fmt, hbar, hbarOptions, line, thin } from '../network-shared';
import { NetworkSwitch } from '../gwn-switch/gwn-switch';
import { GWN_RANGES, SERIES, bandLabel, rangeLabel, rangeText } from '../gwn-shared/gwn-shared';

/** Clients on one SSID per band, from the API's `bands` map or (when it only lists the bands) from the live clients. */
interface BandSplit { b24: number; b5: number; b6: number }

interface SsidCard {
  s: GwnSsid;
  split: BandSplit;
  /** Bands the SSID broadcasts on, when the API lists them. */
  broadcast: string[];
  open: boolean;
  color: string;
}

const isOpen = (sec: string | null | undefined) => !sec || /^(open|none|off)$/i.test(sec.trim());

/**
 * Grandstream (F-7) Wi-Fi: one card per SSID (clients, band split, security, VLAN, portal, isolation, MAC filtering,
 * schedule) and clients per SSID over time. Read only.
 */
@Component({
  selector: 'app-gwn-wifi',
  standalone: true,
  imports: [...NET_SHARED, NetworkSwitch],
  templateUrl: './gwn-wifi.html',
  styleUrls: ['../network-shared.css', '../gwn-shared/gwn.css', './gwn-wifi.css']
})
export class GwnWifiPage implements OnInit, OnDestroy {
  private gwn = inject(GwnService);

  page = viewChild<ElementRef<HTMLElement>>('page');
  trendCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cTrend');
  nowCanvas = viewChild<ElementRef<HTMLCanvasElement>>('cNow');
  ssidTable = viewChild<ElementRef<HTMLTableElement>>('ssidTable');
  trendTable = viewChild<ElementRef<HTMLTableElement>>('trendTable');

  private charts = new ChartBag();
  private timers: ReturnType<typeof setInterval>[] = [];

  ssids = signal<GwnSsid[] | null>(null);
  clients = signal<GwnClient[] | null>(null);
  stats = signal<GwnSsidStats | null>(null);
  statsError = signal<string | null>(null);
  range = signal<GwnRange>('1d');
  loadedAt = signal<number | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  exporting = signal(false);
  error = signal<string | null>(null);
  unavailable = signal<string | null>(null);
  now = signal(Date.now());

  readonly ranges = GWN_RANGES;
  readonly fmt = fmt;

  updatedText = computed(() => { this.now(); const t = this.loadedAt(); return t ? `Updated ${ago(t)}` : ''; });
  rangeName = computed(() => rangeText(this.range()));

  /** Colour per SSID name, the same in the cards and both charts. */
  private colors = computed(() => {
    const names = [...new Set([...(this.ssids() || []).map(s => s.name), ...(this.stats()?.series || []).map(s => s.name)])];
    return new Map(names.map((n, i) => [n, SERIES[i % SERIES.length]] as [string, string]));
  });

  cards = computed<SsidCard[] | null>(() => {
    const list = this.ssids();
    if (!list) return null;
    const live = (this.clients() || []).filter(c => !c.wired && c.online !== false);
    const colors = this.colors();
    return [...list]
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.clients - a.clients || a.name.localeCompare(b.name))
      .map(s => {
        const split: BandSplit = { b24: 0, b5: 0, b6: 0 };
        let broadcast: string[] = [];
        const add = (band: string, n: number) => {
          const b = bandLabel(band);
          if (b === '2.4 GHz') split.b24 += n; else if (b === '5 GHz') split.b5 += n; else if (b === '6 GHz') split.b6 += n;
        };
        if (s.bands && !Array.isArray(s.bands)) {
          for (const [k, n] of Object.entries(s.bands)) add(k, Number(n) || 0);
        } else {
          broadcast = (s.bands || []).map(b => bandLabel(b));
          for (const c of live.filter(c => (c.ssidId != null && String(c.ssidId) === String(s.id)) || c.ssid === s.name)) add(c.band || '', 1);
        }
        return { s, split, broadcast, open: isOpen(s.security), color: colors.get(s.name) || SERIES[0] };
      });
  });

  tiles = computed(() => {
    const c = this.cards();
    if (!c) return null;
    const on = c.filter(x => x.s.enabled);
    const sum = (f: (x: SsidCard) => number) => on.reduce((a, x) => a + f(x), 0);
    const busiest = [...on].sort((a, b) => b.s.clients - a.s.clients)[0];
    return {
      on: on.length, total: c.length,
      clients: sum(x => x.s.clients || 0),
      b24: sum(x => x.split.b24), b5: sum(x => x.split.b5), b6: sum(x => x.split.b6),
      busiest: busiest && busiest.s.clients ? busiest.s : null,
      openCount: on.filter(x => x.open).length,
      portal: on.filter(x => x.s.portal).length
    };
  });

  /** Lines in the trend chart: one per SSID, or the total when the API gives no per-SSID series. */
  trend = computed(() => {
    const st = this.stats();
    if (!st) return null;
    const colors = this.colors();
    const series = (st.series || []).filter(s => s.counts?.some(v => v != null));
    const lines = series.length
      ? series.map(s => ({ name: s.name, counts: s.counts, color: colors.get(s.name) || SERIES[0] }))
      : st.counts?.length ? [{ name: 'All SSIDs', counts: st.counts, color: SERIES[0] }] : [];
    const total = st.times.map((_, i) => (st.counts?.[i] != null ? st.counts[i] : series.reduce((a, s) => a + (s.counts[i] || 0), 0)));
    const peak = total.length ? Math.max(...total) : 0;
    const vals = total.filter(v => v != null);
    return { times: st.times, lines, total, peak, avg: vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0 };
  });

  constructor() {
    effect(() => this.renderTrend());
    effect(() => this.renderNow());
    // Load again when the chosen Grandstream network changes (the location switch).
    effect(() => { this.gwn.net(); untracked(() => this.reloadAll()); });
  }

  ngOnInit() {
    this.timers.push(
      setInterval(() => this.load(true), 60000),
      setInterval(() => this.loadStats(), 5 * 60000),
      setInterval(() => this.now.set(Date.now()), 5000)
    );
  }

  ngOnDestroy() {
    this.timers.forEach(t => clearInterval(t));
    this.charts.destroyAll();
  }

  // ---------- Data ----------

  private reloadAll() {
    this.ssids.set(null);
    this.clients.set(null);
    this.stats.set(null);
    this.load();
    this.loadStats();
  }

  load(silent = false, done?: () => void) {
    if (!silent) this.loading.set(true);
    this.gwn.getSsids().subscribe({
      next: res => { this.ssids.set(res); this.loadedAt.set(Date.now()); this.error.set(null); this.unavailable.set(null); this.loading.set(false); done?.(); },
      error: err => {
        this.loading.set(false);
        if (err?.unavailable) this.unavailable.set(gwnErrorText(err));
        else if (!silent || !this.ssids()) this.error.set(`Couldn't load the Wi-Fi networks: ${gwnErrorText(err)}`);
        done?.();
      }
    });
    // Only used for the band split when the API lists the bands an SSID broadcasts on instead of clients per band.
    this.gwn.getClients().subscribe({ next: c => this.clients.set(c), error: () => { if (!this.clients()) this.clients.set([]); } });
  }

  loadStats() {
    const range = this.range();
    this.statsError.set(null);
    this.gwn.getSsidStats(range).subscribe({
      next: s => { if (range === this.range()) this.stats.set({ times: s?.times || [], counts: s?.counts || [], series: s?.series || [] }); },
      error: err => { if (range === this.range()) { this.stats.set({ times: [], counts: [], series: [] }); this.statsError.set(gwnErrorText(err)); } }
    });
  }

  refresh() {
    this.refreshing.set(true);
    this.load(true, () => { this.refreshing.set(false); this.now.set(Date.now()); });
    this.loadStats();
  }

  setRange(r: GwnRange) {
    if (r === this.range()) return;
    this.range.set(r);
    this.stats.set(null);
    this.loadStats();
  }

  // ---------- Labels ----------

  splitTotal(x: BandSplit) { return x.b24 + x.b5 + x.b6; }
  pctOf(n: number, x: BandSplit) { const t = this.splitTotal(x); return t ? (n / t) * 100 : 0; }
  security(s: GwnSsid) { return isOpen(s.security) ? 'Open (no password)' : s.security!; }
  macFilter(s: GwnSsid) {
    const m = (s.macFiltering || '').trim();
    if (!m || /^off$/i.test(m)) return 'Off';
    if (/white|allow/i.test(m)) return 'Allow list';
    if (/black|block|deny/i.test(m)) return 'Block list';
    return m;
  }
  macFilterOn(s: GwnSsid) { return this.macFilter(s) !== 'Off'; }
  bandsText(x: SsidCard) {
    const parts = [x.split.b24 || x.broadcast.includes('2.4 GHz') ? '2.4' : '', x.split.b5 || x.broadcast.includes('5 GHz') ? '5' : '', x.split.b6 || x.broadcast.includes('6 GHz') ? '6' : ''].filter(Boolean);
    return parts.length ? `${parts.join(' / ')} GHz` : '–';
  }
  when(t: string) { return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

  // ---------- Charts ----------

  private renderTrend() {
    const tr = this.trend();
    const canvas = this.trendCanvas()?.nativeElement;
    if (!tr || !canvas) return;
    const range = this.range();
    const idx = thin(tr.times.map((_, i) => i));
    this.charts.upsert('trend', canvas, {
      type: 'line',
      data: {
        labels: idx.map(i => rangeLabel(tr.times[i], range)),
        datasets: tr.lines.map(l => line(l.name, idx.map(i => l.counts[i] ?? null), l.color))
      },
      options: baseOptions({ unit: 'clients', legend: tr.lines.length > 1 })
    });
  }

  private renderNow() {
    const c = this.cards();
    const canvas = this.nowCanvas()?.nativeElement;
    if (!c || !canvas) return;
    const list = c.filter(x => x.s.enabled).sort((a, b) => b.s.clients - a.s.clients);
    // Clients not placed on a band (API total higher than the split) show as "Other" so the bar adds up.
    const other = list.map(x => Math.max(0, (x.s.clients || 0) - this.splitTotal(x.split)));
    const datasets = [hbar('2.4 GHz', list.map(x => x.split.b24), SERIES[0]), hbar('5 GHz', list.map(x => x.split.b5), SERIES[1])];
    if (list.some(x => x.split.b6)) datasets.push(hbar('6 GHz', list.map(x => x.split.b6), SERIES[2]));
    if (other.some(v => v)) datasets.push(hbar('Band unknown', other, '#cbd5e1'));
    this.charts.upsert('now', canvas, { type: 'bar', data: { labels: list.map(x => x.s.name), datasets }, options: hbarOptions('clients') });
  }

  // ---------- Export ----------

  exportSsids(kind: ExportKind) { exportCard(kind, 'F-7 Wi-Fi networks', { table: this.ssidTable()?.nativeElement }); }
  exportTrend(kind: ExportKind, canvas: HTMLCanvasElement) {
    exportCard(kind, `F-7 clients per SSID ${this.range()}`, { canvas, table: this.trendTable()?.nativeElement });
  }
  exportNow(kind: ExportKind, canvas: HTMLCanvasElement) { exportCard(kind, 'F-7 clients per SSID now', { canvas, table: this.ssidTable()?.nativeElement }); }

  async exportPdf() {
    const el = this.page()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try { await exportPagePdf(el, 'F-7 Wi-Fi'); } finally { this.exporting.set(false); }
  }
}
