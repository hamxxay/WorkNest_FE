import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DashError, DashErrorWording, DashRange, arr, describeDashboardError, getDashboardData, num, numOrNull, obj, periodQuery, serverMessageOf, str, strOrNull
} from './dashboard-api';

// ============================================================
// Network (UniFi) section of the CEO and Sales Manager dashboards: GET api/ceo/network and
// GET api/sales-manager/network (same shape). Read-only, except that the CEO can run a speed test on a line
// (api/ceo/network/speedtest). The API decides which UniFi sites the caller sees (a Sales
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
  /** The line speeds were still being read when the API stopped waiting: the section reloads itself shortly. */
  speedsPending: boolean;
}

export interface NetAlert { level: 'critical' | 'serious' | string; text: string; where: string; }

/**
 * One of the top data users (the Clients page's "Top data users", same names and kinds). Bytes; lastSeen UTC ISO
 * (null = unknown). Empty strings / null port = not reported.
 */
export interface NetTopClient {
  rank: number; name: string; kind: string; kindLabel: string; mac: string; ip: string; hostname: string; vendor: string;
  downloadBytes: number; uploadBytes: number; totalBytes: number;
  online: boolean; lastSeen: string | null; wired: boolean; guest: boolean;
  network: string; ssid: string; uplink: string; port: string | null;
  /** One line: "WorkNest via AP Lobby", "Wired · USW 24 port 5". */
  connection: string;
}

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
  /** The 5 clients that used the most data, most first; [] = none recorded yet; null = not available (see topClientsMessage). */
  topClients: NetTopClient[] | null;
  /** The range behind them, e.g. "Today"; null from an API without the list. */
  topClientsRangeLabel: string | null;
  topClientsRangeDays: number | null;
  /** Why topClients is null (another console's site, still loading, could not be read). */
  topClientsMessage: string | null;
}

/** A speed test started from the CEO dashboard (POST api/ceo/network/speedtest): the line and its port. */
export interface NetSpeedtestRun { wan: string; ifname: string; }

/**
 * The running speed test (GET api/ceo/network/speedtest), as the Network pages poll it: running, the line, seconds
 * since it started, and once it is done the result (Mbps, ms; interface = the port UniFi actually tested) or timedOut.
 */
export interface NetSpeedtestStatus {
  running: boolean;
  wan: string;
  elapsed: number;
  result: { down: number | null; up: number | null; ping: number | null; interface: string } | null;
  timedOut: boolean;
}

/** A failed speed-test request: its status (409 = a test is already running) and a plain message for the card. */
export interface NetSpeedtestError { status: number; message: string; }

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
      speedsPending: i.speedsPending === true,
      latency: arr(i.latency, (s: any): NetLatencySeries => ({
        siteId: str(s.siteId), name: str(s.name),
        points: arr(s.points, (p: any): NetLatencyPoint => ({ t: str(p.t), avg: numOrNull(p.avg), peak: numOrNull(p.peak), loss: numOrNull(p.loss) }))
      }))
    },
    alerts: arr(d.alerts, (a: any): NetAlert => ({ level: str(a.level), text: str(a.text), where: str(a.where) })),
    topClients: Array.isArray(d.topClients)
      ? arr(d.topClients, (c: any, i = 0): NetTopClient => {
        const down = Math.max(0, num(c.downloadBytes)), up = Math.max(0, num(c.uploadBytes));
        return {
          rank: num(c.rank) || i + 1, name: str(c.name) || str(c.mac) || 'Unknown device', kind: str(c.kind) || 'other',
          kindLabel: str(c.kindLabel) || 'Unknown', mac: str(c.mac), ip: str(c.ip), hostname: str(c.hostname), vendor: str(c.vendor),
          downloadBytes: down, uploadBytes: up, totalBytes: num(c.totalBytes) || down + up,
          online: c.online === true, lastSeen: strOrNull(c.lastSeen), wired: c.wired === true, guest: c.guest === true,
          network: str(c.network), ssid: str(c.ssid), uplink: str(c.uplink), port: strOrNull(c.port), connection: str(c.connection)
        };
      })
      : null,
    topClientsRangeLabel: strOrNull(d.topClientsRangeLabel),
    topClientsRangeDays: numOrNull(d.topClientsRangeDays),
    topClientsMessage: strOrNull(d.topClientsMessage)
  };
}

@Injectable({ providedIn: 'root' })
export class NetworkDashboardService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /**
   * The network figures for the dashboard's location (null = all the caller's locations). period / range: the
   * dashboard's period, for the top data users (none = today).
   */
  get(source: NetworkSource, locationId: number | null, period: string | null = null, range: DashRange | null = null): Observable<NetDashboard> {
    const url = `${this.api}/${source === 'ceo' ? 'ceo' : 'sales-manager'}/network`;
    const params = period ? { locationId, ...periodQuery(period, range) } : { locationId };
    return getDashboardData(this.http, url, params, err => NetworkDashboardService.describeError(err)).pipe(map(toNetDashboard));
  }

  /**
   * CEO only: runs a speed test on one line of the main gateway now (wan = WAN1, WAN2...). The same test as the
   * Network Overview's "Run test"; UniFi runs one at a time. Fails with a NetSpeedtestError.
   */
  startSpeedtest(wan: string): Observable<NetSpeedtestRun> {
    return this.http.post<any>(`${this.api}/ceo/network/speedtest`, {}, { params: { wan } }).pipe(
      map(res => {
        const d = obj(NetworkDashboardService.unwrap(res)) ?? {};
        return { wan: str(d.wan) || wan, ifname: str(d.ifname) };
      }),
      catchError(err => throwError(() => NetworkDashboardService.speedtestError(err)))
    );
  }

  /** CEO only: the running speed test (running = false when there is none). Fails with a NetSpeedtestError. */
  speedtestStatus(): Observable<NetSpeedtestStatus> {
    return this.http.get<any>(`${this.api}/ceo/network/speedtest`).pipe(
      map(res => {
        const d = obj(NetworkDashboardService.unwrap(res)) ?? {};
        const r = obj(d.result);
        const positive = (v: unknown) => { const n = numOrNull(v); return n !== null && n > 0 ? n : null; };
        return {
          running: d.running === true, wan: str(d.wan), elapsed: num(d.elapsed),
          result: r ? { down: positive(r.down), up: positive(r.up), ping: positive(r.ping), interface: str(r.interface) } : null,
          timedOut: d.timedOut === true
        };
      }),
      catchError(err => throwError(() => NetworkDashboardService.speedtestError(err)))
    );
  }

  /** { isSuccessful, data } -> data (a bare body is accepted too); isSuccessful = false throws its message. */
  private static unwrap(res: any): unknown {
    if (res && typeof res === 'object' && 'isSuccessful' in res) {
      if (res.isSuccessful === false) throw { status: 200, message: str(res.message) || 'The speed test could not be run. Please try again.' };
      return res.data ?? null;
    }
    return res ?? null;
  }

  /** A failed speed-test request in plain words: the server's own reason when it gave one. */
  static speedtestError(err: unknown): NetSpeedtestError {
    if (!(err instanceof HttpErrorResponse)) {
      const e = err as Partial<NetSpeedtestError> | null;
      return { status: e?.status ?? -1, message: e?.message || 'Something went wrong. Please try again.' };
    }
    const status = err.status;
    const own = serverMessageOf(err);
    if (own) return { status, message: own };
    const message = status === 0 ? 'Cannot reach the server. Check your internet connection and try again.'
      : status === 403 ? 'Your account cannot run a speed test. Ask a super admin to check your role.'
      : status === 404 ? 'The server cannot run speed tests from here yet. It will work once the API update is live.'
      : status === 409 ? 'A speed test is already running. UniFi runs one at a time: wait about 30 seconds.'
      : 'The speed test could not be run. Please try again in a minute.';
    return { status, message };
  }

  static describeError(err: unknown): DashError {
    const e = describeDashboardError(err, NETWORK_WORDING);
    return e.status === 404
      ? { ...e, message: 'The server does not have the network figures yet. They show here once the API update is live.' }
      : e;
  }
}
