// Number formats of the Network section (dashboard and Export Excel). An unknown figure is always a dash, never 0.

/** A speed in Mbps without the unit: "0", "<0.1", "4.2", "285", "1,250"; null for unknown. */
function mbpsNumber(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return null;
  if (v === 0) return '0';
  if (v < 0.1) return '<0.1';
  if (v < 10) return (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return Math.round(v).toLocaleString();
}

/** "100 Mbps", "4.2 Mbps", "<0.1 Mbps", "0 Mbps" (idle), "1.2 Gbps"; "-" when unknown. */
export function mbpsText(v: number | null | undefined): string {
  if (v !== null && v !== undefined && v >= 1000) return `${(Math.round(v / 100) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} Gbps`;
  const n = mbpsNumber(v);
  return n === null ? '-' : `${n} Mbps`;
}

/** Download / upload as one figure: "285 / 48 Mbps" ("-" for a part that is unknown); "-" when both are. */
export function pairText(down: number | null | undefined, up: number | null | undefined): string {
  const d = mbpsNumber(down), u = mbpsNumber(up);
  return d === null && u === null ? '-' : `${d ?? '-'} / ${u ?? '-'} Mbps`;
}

/** A link speed: "1 Gbps", "2.5 Gbps", "100 Mbps"; "-" when unknown. */
export function linkText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return '-';
  return v >= 1000 ? `${(Math.round(v / 100) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} Gbps` : `${Math.round(v)} Mbps`;
}

/** Data: "1.2 GB", "350 MB", "12 KB", "0 MB"; "-" when unknown. */
export function bytesText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return '-';
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)} TB`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} GB`;
  if (v >= 1e6) return `${Math.round(v / 1e6)} MB`;
  if (v === 0) return '0 MB';
  return `${Math.max(1, Math.round(v / 1e3))} KB`;
}

/** When a speed test ran: "35 min ago", "5 h ago", "yesterday", "3 days ago"; "" when unknown. */
export function whenText(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** "19 Oct 2026, 14:05" in the viewer's time; "" when unknown. */
export function stampText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
