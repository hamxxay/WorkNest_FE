import { Component, HostListener, input, output } from '@angular/core';
import { DASH, fmt, rate } from '../network-shared';
import { GwnClient, GwnRange } from '../../../../services/gwn.service';

// Helpers shared by the Grandstream (GWN, F-7) network pages. Look and charts come from ../network-shared.

export const GWN_RANGES: { key: GwnRange; label: string; text: string; hours: number }[] = [
  { key: '2h', label: '2H', text: 'last 2 hours', hours: 2 },
  { key: '1d', label: '24H', text: 'last 24 hours', hours: 24 },
  { key: '1w', label: '7D', text: 'last 7 days', hours: 168 },
  { key: '1m', label: '30D', text: 'last 30 days', hours: 720 }
];

export const rangeText = (r: GwnRange) => GWN_RANGES.find(x => x.key === r)?.text || '';

/** Extra series colours after S1 / S2 / S3 (clients per SSID). */
export const SERIES = ['#0d9488', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9', '#84cc16', '#a855f7', '#64748b'];

export const ms = (t: string | number | null | undefined): number | null => {
  if (t == null || t === '') return null;
  const v = typeof t === 'number' ? t : Date.parse(t);
  return Number.isFinite(v) ? v : null;
};

/** Chart axis label for a point in the chosen range. */
export function rangeLabel(t: string | number, range: GwnRange): string {
  const d = new Date(t);
  if (range === '1m') return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return range === '1w' ? `${d.toLocaleDateString([], { weekday: 'short' })} ${hm}` : hm;
}

/** Bits per second (GWN bandwidth) as a rate text. */
export const bitRate = (bits: number | null | undefined) => (bits == null ? DASH : rate(bits / 8));

/** Bits per second as Mbps (chart values). */
export const mbps = (bits: number | null | undefined) => (bits == null ? null : bits / 1e6);

export function bandLabel(band: string | null | undefined): string {
  if (!band) return DASH;
  const b = band.toUpperCase().replace(/\s/g, '');
  return b === '2.4G' || b === '2.4GHZ' ? '2.4 GHz' : b === '5G' || b === '5GHZ' ? '5 GHz' : b === '6G' || b === '6GHZ' ? '6 GHz' : band;
}

export const clientName = (c: Pick<GwnClient, 'alias' | 'name' | 'host' | 'mac'>) => c.alias || c.name || c.host || c.mac;

/** Icon for a GWN client from its OS / manufacturer. */
export function gwnClientIcon(c: Pick<GwnClient, 'wired' | 'os' | 'manufacturer' | 'name'>): string {
  const s = `${c.os || ''} ${c.manufacturer || ''} ${c.name || ''}`.toLowerCase();
  if (/iphone|android|ios|phone|galaxy|redmi|oppo|vivo|huawei|xiaomi|infinix|tecno|realme|oneplus/.test(s)) return 'phone';
  if (/ipad|tablet/.test(s)) return 'tablet';
  if (/windows|mac ?os|macbook|linux|laptop|desktop|dell|lenovo|hp |asus|acer|intel/.test(s)) return 'laptop';
  if (/printer|epson|canon|brother/.test(s)) return 'printer';
  if (/tv|chromecast|roku|fire/.test(s)) return 'tv';
  if (/camera|hikvision|dahua/.test(s)) return 'camera';
  return c.wired ? 'cable' : 'other';
}

export const gwnTypeIcon = (type: string | null | undefined) => (/router|gateway/i.test(type || '') ? 'gateway' : /switch/i.test(type || '') ? 'switch' : 'ap');

export const pctText = (v: number | null | undefined) => (v == null ? DASH : `${fmt(v, v < 10 ? 1 : 0)}%`);

/** Confirmation dialog for super admin actions (block / unblock a client, reboot a device). */
@Component({
  selector: 'gwn-confirm',
  standalone: true,
  template: `
    <div class="cf-bg" (click)="!busy() && cancel.emit()"></div>
    <div class="cf" role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-text">
      <h3 id="cf-title">{{ title() }}</h3>
      <p id="cf-text">{{ text() }}</p>
      @if (note()) { <p class="cf-note">{{ note() }}</p> }
      <div class="cf-actions">
        <button type="button" class="cf-btn" (click)="cancel.emit()" [disabled]="busy()">Cancel</button>
        <button type="button" class="cf-btn" [class.danger]="danger()" [class.primary]="!danger()" (click)="confirm.emit()" [disabled]="busy()">{{ busy() ? busyLabel() : okLabel() }}</button>
      </div>
    </div>`,
  styles: [`
    .cf-bg { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); z-index: 1100; }
    .cf { position: fixed; z-index: 1101; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(420px, calc(100vw - 32px)); box-sizing: border-box;
      background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 22px; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.25); font-family: 'Inter', system-ui, sans-serif; }
    h3 { margin: 0 0 8px; font-size: 1.05rem; font-weight: 800; color: #0f172a; }
    p { margin: 0; font-size: 0.86rem; color: #475569; line-height: 1.5; }
    .cf-note { margin-top: 10px; font-size: 0.78rem; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 8px 10px; }
    .cf-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
    .cf-btn { height: 38px; padding: 0 16px; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; color: #334155; font-weight: 600; font-size: 0.84rem; cursor: pointer; font-family: inherit; }
    .cf-btn:hover:not(:disabled) { border-color: #94a3b8; }
    .cf-btn.primary { background: #0d9488; border-color: #0d9488; color: #fff; }
    .cf-btn.danger { background: #dc2626; border-color: #dc2626; color: #fff; }
    .cf-btn:disabled { opacity: .6; cursor: default; }
    .cf-btn:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
    @media (max-width: 640px) { .cf-btn { height: 44px; flex: 1; } }`]
})
export class GwnConfirm {
  title = input('Are you sure?');
  text = input('');
  note = input('');
  okLabel = input('Confirm');
  busyLabel = input('Working…');
  danger = input(true);
  busy = input(false);
  confirm = output<void>();
  cancel = output<void>();

  @HostListener('document:keydown.escape', ['$event'])
  onEsc(e: Event) {
    e.stopPropagation();
    if (!this.busy()) this.cancel.emit();
  }
}
