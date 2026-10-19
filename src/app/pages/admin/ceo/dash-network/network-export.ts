import type { NetDashboard } from '../../../../services/network-dashboard.service';
import type { XlsxCell, XlsxSheet } from '../../../../utils/xlsx';

/** "2026-10-19 14:15" in the viewer's time (Excel reads it as text, as the other sheets' dates). */
function localStamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The Network section for Export Excel (CEO and Sales Manager dashboards): one sheet with the figures on screen
 * (clients, devices by type, client types, internet lines, issues) and one with the client history (24 hours, 15-minute
 * steps, and 7 days, hourly). None when the section shows no figures (not set up, not reachable, no site).
 */
export function networkSheets(d: NetDashboard | null): XlsxSheet[] {
  if (!d || !d.available || !d.sites.length || !d.clients) return [];
  const c = d.clients;
  const rows: XlsxCell[][] = [
    ['Network (UniFi)', ''],
    ['Sites', d.sites.map(s => s.name).join(', ')],
    ['Figures read', localStamp(d.updatedAt)],
    [],
    ['Clients', 'Value'],
    ['Online now', c.total],
    ['Wi-Fi', c.wifi],
    ['Wired', c.wired],
    ['Guest', c.guest]
  ];
  if (d.devices) {
    rows.push([], ['Network devices', 'Online', 'Offline', 'Offline devices']);
    d.devices.byType.forEach(t => rows.push([t.label, t.online, t.offline, t.offlineNames.join(', ')]));
    rows.push(['All', d.devices.online, d.devices.offline, d.devices.notInstalled ? `${d.devices.notInstalled} not installed, not counted` : '']);
  }
  if (d.clientTypes?.available) {
    rows.push([], ['Clients by type', 'Clients', 'Wi-Fi', 'Wired']);
    d.clientTypes.items.forEach(t => rows.push([t.label, t.count, t.wifi, t.wired]));
  }
  if (d.internet) {
    const i = d.internet;
    // Speeds in Mbps and data in GB as numbers; an unknown figure is an empty cell, never 0.
    const gb = (b: number | null) => (b === null ? null : Math.round((b / 1e9) * 100) / 100);
    rows.push([], [
      'Internet line', 'Provider', 'Role', 'Up', 'Uptime 24 h (%)', 'Issues', 'Site',
      'Download now (Mbps)', 'Upload now (Mbps)', 'Link speed (Mbps)',
      'Last speed test, download (Mbps)', 'Last speed test, upload (Mbps)', 'Last speed test, ping (ms)', 'Last speed test, at',
      'Downloaded 24 h (GB)', 'Uploaded 24 h (GB)'
    ]);
    i.lines.forEach(w => rows.push([
      w.label, w.isp, w.role, w.up ? 'Yes' : 'No', w.uptimePct, w.issues, w.site,
      w.downMbps, w.upMbps, w.linkMbps,
      w.speedtest?.downMbps ?? null, w.speedtest?.upMbps ?? null, w.speedtest?.pingMs ?? null, localStamp(w.speedtest?.at ?? null),
      gb(w.down24hBytes), gb(w.up24hBytes)
    ]));
    if (i.speedsMessage) rows.push([i.speedsMessage]);
    rows.push([], ['Internet health', 'Value'],
      ['Latency now (ms)', i.latencyMs], ['Average latency, 24 hours (ms)', i.latencyAvgMs], ['Most packet loss, 24 hours (%)', i.lossMaxPct],
      ['WAN uptime (%)', i.uptimePct]);
  }
  if (d.alerts.length) {
    rows.push([], ['Needs attention', 'Level', 'Where']);
    d.alerts.forEach(a => rows.push([a.text, a.level, a.where]));
  }

  const history: XlsxCell[][] = [['Range', 'Step starts', 'Wi-Fi (average)', 'Wired (average)', 'Guest (average)', 'Most at once']];
  d.history.day.forEach(p => history.push(['24 hours', localStamp(p.t), p.wifi, p.wired, p.guest, p.peak]));
  d.history.week.forEach(p => history.push(['7 days', localStamp(p.t), p.wifi, p.wired, p.guest, p.peak]));

  return [{ name: 'Network', header: 1, rows }, { name: 'Network history', header: 1, rows: history }];
}
