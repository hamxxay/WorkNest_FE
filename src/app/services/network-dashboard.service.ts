import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DashError, DashErrorWording, arr, describeDashboardError, getDashboardData, num, numOrNull, obj, str, strOrNull
} from './dashboard-api';

// ============================================================
// Network (UniFi) section of the CEO and Sales Manager dashboards: GET api/ceo/network and
// GET api/sales-manager/network (same shape). Read-only. The API decides which UniFi sites the caller sees (a Sales
// Manager only those of their locations). UniFi not set up or not reachable: available = false and a plain message.
// ============================================================

/** Which dashboard asks: the CEO (api/ceo/network) or the Sales Manager (api/sales-manager/network). */
export type NetworkSource = 'ceo' | 'sales-manager';

export interface NetSite {
  id: string;
  name: string;
  /** WorkNest locations the site serves (empty with everyLocation = all). */
  locationIds: number[];
  everyLocation: boolean;
  /** site = its own setting, network = the whole network's setting, every = nothing saved. */
  source: 'site' | 'network' | 'every';
}

export interface NetClients { total: number; wifi: number; wired: number; guest: number; }

export interface NetDeviceType { type: string; label: string; online: number; offline: number; offlineNames: string[]; }
export interface NetDevices { total: number; online: number; offline: number; notInstalled: number; byType: NetDeviceType[]; }

export interface NetClientType { kind: string; label: string; count: number; wifi: number; wired: number; }
export interface NetClientTypes { available: boolean; message: string | null; total: number; items: NetClientType[]; }

/** One step of the client history: average clients in it (null = no sample, a gap) and the most at once. */
export interface NetHistoryPoint { t: string; wifi: number | null; wired: number | null; guest: number | null; peak: number | null; }
export interface NetHistory { day: NetHistoryPoint[]; week: NetHistoryPoint[]; dayStepMinutes: number; weekStepMinutes: number; }

/** A line's latest speed test (Mbps, ms; at = when it ran, UTC). */
export interface NetSpeedtest { downMbps: number | null; upMbps: number | null; pingMs: number | null; at: string | null; }
/** 15-minute average traffic of a line (Mbps). */
export interface NetTrafficPoint { t: string; down: number | null; up: number | null; }
export interface NetWan {
  site: string; label: string; isp: string; up: boolean; role: string; uptimePct: number | null; issues: number;
  /** The gateway's own figures were read for this line (the main console's gateway). */
  live: boolean;
  /** Speed right now (Mbps); null = unknown or the line is down (shown as a dash, never 0). */
  downMbps: number | null;
  upMbps: number | null;
  /** Link (port) speed in Mbps, 1000 = 1 Gbps; null = unknown. */
  linkMbps: number | null;
  speedtest: NetSpeedtest | null;
  /** Data carried in the last 24 hours (bytes); null = unknown. */
  down24hBytes: number | null;
  up24hBytes: number | null;
  traffic: NetTrafficPoint[];
}
export interface NetLatencyPoint { t: string; avg: number | null; peak: number | null; loss: number | null; }
export interface NetLatencySeries { siteId: string; name: string; points: NetLatencyPoint[]; }
export interface NetInternet {
  linesUp: number; linesTotal: number; uptimePct: number | null;
  latencyMs: number | null; latencyAvgMs: number | null; lossMaxPct: number | null;
  lines: NetWan[]; latency: NetLatencySeries[];
  /** Why some or all lines have no live speed figures; null = they all have them. */
  speedsMessage: string | null;
}

export interface NetAlert { level: 'critical' | 'serious' | string; text: string; where: string; }

export interface NetDashboard {
  available: boolean;
  message: string | null;
  updatedAt: string | null;
  stale: boolean;
  locationId: number | null;
  sites: NetSite[];
  clients: NetClients | null;
  devices: NetDevices | null;
  clientTypes: NetClientTypes | null;
  history: NetHistory;
  internet: NetInternet | null;
  alerts: NetAlert[];
}

const NETWORK_WORDING: DashErrorWording = {
  name: 'network figures',
  dbMessage: 'The network figures need a database update. Ask the WorkNest team to run the latest database script, then refresh this page.'
};

function toNetDashboard(raw: unknown): NetDashboard {
  const d = obj(raw) ?? {};
  const c = obj(d.clients);
  const dv = obj(d.devices);
  const ct = obj(d.clientTypes);
  const h = obj(d.history);
  const i = obj(d.internet);
  const point = (p: any): NetHistoryPoint => ({
    t: str(p.t), wifi: numOrNull(p.wifi), wired: numOrNull(p.wired), guest: numOrNull(p.guest), peak: numOrNull(p.peak)
  });
  return {
    available: d.available !== false,
    message: strOrNull(d.message),
    updatedAt: strOrNull(d.updatedAt),
    stale: d.stale === true,
    locationId: numOrNull(d.locationId),
    sites: arr(d.sites, (s: any): NetSite => ({
      id: str(s.id), name: str(s.name), locationIds: arr(s.locationIds, num), everyLocation: s.everyLocation === true,
      source: s.source === 'site' || s.source === 'network' ? s.source : 'every'
    })),
    clients: c && { total: num(c.total), wifi: num(c.wifi), wired: num(c.wired), guest: num(c.guest) },
    devices: dv && {
      total: num(dv.total), online: num(dv.online), offline: num(dv.offline), notInstalled: num(dv.notInstalled),
      byType: arr(dv.byType, (t: any): NetDeviceType => ({
        type: str(t.type), label: str(t.label) || str(t.type), online: num(t.online), offline: num(t.offline),
        offlineNames: arr(t.offlineNames, str)
      }))
    },
    clientTypes: ct && {
      available: ct.available === true, message: strOrNull(ct.message), total: num(ct.total),
      items: arr(ct.items, (x: any): NetClientType => ({
        kind: str(x.kind) || 'other', label: str(x.label) || 'Unknown', count: num(x.count), wifi: num(x.wifi), wired: num(x.wired)
      }))
    },
    history: {
      day: arr(h?.day, point), week: arr(h?.week, point),
      dayStepMinutes: num(h?.dayStepMinutes) || 15, weekStepMinutes: num(h?.weekStepMinutes) || 60
    },
    internet: i && {
      linesUp: num(i.linesUp), linesTotal: num(i.linesTotal), uptimePct: numOrNull(i.uptimePct),
      latencyMs: numOrNull(i.latencyMs), latencyAvgMs: numOrNull(i.latencyAvgMs), lossMaxPct: numOrNull(i.lossMaxPct),
      lines: arr(i.lines, (w: any): NetWan => {
        const st = obj(w.speedtest);
        // A speed of 0 from an older or partial answer means "not known" here: shown as a dash, never "0 Mbps".
        const positive = (v: unknown) => { const n = numOrNull(v); return n !== null && n > 0 ? n : null; };
        return {
          site: str(w.site), label: str(w.label), isp: str(w.isp), up: w.up === true, role: str(w.role),
          uptimePct: numOrNull(w.uptimePct), issues: num(w.issues),
          live: w.live === true,
          downMbps: numOrNull(w.downMbps), upMbps: numOrNull(w.upMbps), linkMbps: positive(w.linkMbps),
          speedtest: st && (positive(st.downMbps) !== null || positive(st.upMbps) !== null)
            ? { downMbps: positive(st.downMbps), upMbps: positive(st.upMbps), pingMs: positive(st.pingMs), at: strOrNull(st.at) }
            : null,
          down24hBytes: numOrNull(w.down24hBytes), up24hBytes: numOrNull(w.up24hBytes),
          traffic: arr(w.traffic, (p: any): NetTrafficPoint => ({ t: str(p.t), down: numOrNull(p.down), up: numOrNull(p.up) }))
        };
      }),
      speedsMessage: strOrNull(i.speedsMessage),
      latency: arr(i.latency, (s: any): NetLatencySeries => ({
        siteId: str(s.siteId), name: str(s.name),
        points: arr(s.points, (p: any): NetLatencyPoint => ({ t: str(p.t), avg: numOrNull(p.avg), peak: numOrNull(p.peak), loss: numOrNull(p.loss) }))
      }))
    },
    alerts: arr(d.alerts, (a: any): NetAlert => ({ level: str(a.level), text: str(a.text), where: str(a.where) }))
  };
}

@Injectable({ providedIn: 'root' })
export class NetworkDashboardService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** The network figures for the dashboard's location (null = all the caller's locations). */
  get(source: NetworkSource, locationId: number | null): Observable<NetDashboard> {
    const url = `${this.api}/${source === 'ceo' ? 'ceo' : 'sales-manager'}/network`;
    return getDashboardData(this.http, url, { locationId }, err => NetworkDashboardService.describeError(err)).pipe(map(toNetDashboard));
  }

  static describeError(err: unknown): DashError {
    const e = describeDashboardError(err, NETWORK_WORDING);
    return e.status === 404
      ? { ...e, message: 'The server does not have the network figures yet. They show here once the API update is live.' }
      : e;
  }
}
