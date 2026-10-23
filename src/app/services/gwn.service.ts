import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, shareReplay, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

// ============================================================
// Grandstream GWN Cloud network (F-7), proxied and cached by the API (api/gwn/*, GwnController).
// Every answer is the API's usual wrapper { isSuccessful, message, data }; this service returns `data`.
// Times are ISO-8601 UTC strings, MACs "AA:BB:CC:DD:EE:FF", bytes are numbers, bandwidth series are bits/s.
// ============================================================

export type GwnRange = '2h' | '1d' | '1w' | '1m';

export interface GwnNetwork { id: number; name: string; locationIds: number[] }

export interface GwnDevice {
  mac: string;
  name: string;
  model: string;
  /** "Router" | "Access point" | … */
  type: string;
  /** "online" | "offline" */
  status: string;
  ip: string | null;
  publicIp: string | null;
  ipv6: string | null;
  firmware: string | null;
  /** Non-empty = a firmware update is available. */
  latestFirmware: string | null;
  uptimeSeconds: number | null;
  clients: number;
  download: number;
  upload: number;
  total: number;
  today: { download: number; upload: number; total: number } | null;
  temperature: number | null;
  memory: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  channel24?: number | null;
  channel5?: number | null;
}

export interface GwnClient {
  mac: string;
  name: string;
  alias: string | null;
  ip: string | null;
  ssid: string | null;
  ssidId: string | number | null;
  apMac: string | null;
  /** "2.4G" | "5G" | "6G" | "Wired" */
  band: string | null;
  channel: number | null;
  rssi: number | null;
  /** e.g. "18h21m" */
  connectedFor: string | null;
  connectedSeconds: number | null;
  download: number;
  upload: number;
  total: number;
  online: boolean;
  wired: boolean;
  blocked: boolean;
  manufacturer: string | null;
  os: string | null;
  host: string | null;
  firstSeen: string | null;
}

export interface GwnClientDetail extends GwnClient { raw: Record<string, unknown> }

export interface GwnHistoryClient {
  mac: string; name: string; alias: string | null; ip: string | null; ssid: string | null;
  download: number; upload: number; total: number; firstSeen: string | null; lastSeen: string | null;
}

export interface GwnSsid {
  id: string | number;
  name: string;
  enabled: boolean;
  clients: number;
  security: string | null;
  schedule: boolean;
  portal: boolean;
  isolation: boolean;
  vlan: number | null;
  /** "Off" | "Whitelist" | "Blacklist" */
  macFiltering: string | null;
  /** Clients per band ({ "2.4G": 3, "5G": 9 }) or the bands it broadcasts on (["2.4 GHz", "5 GHz"]). */
  bands: Record<string, number> | string[] | null;
  weak?: number;
  download?: number;
  upload?: number;
  devices?: number;
}

export interface GwnAlert { level: 'critical' | 'serious' | 'warning' | string; text: string; where?: string }

export interface GwnOverview {
  available: boolean;
  message: string | null;
  updatedAt: string | null;
  network: { id: number; name: string; country: string | null; timezone: string | null; locationIds: number[] } | null;
  devices: { total: number; online: number; offline: number; list: GwnDevice[] };
  clients: { total: number; band24: number; band5: number; band6: number; wired: number; weak: number; deviceReported: number | null };
  usage: { since: string | null; download: number; upload: number; total: number };
  trafficNow: { downloadBps: number | null; uploadBps: number | null } | null;
  ssids: GwnSsid[];
  alerts: GwnAlert[];
}

export interface GwnDeviceDetail extends GwnDevice {
  info: { key: string; label: string; value: string }[];
  clientList: GwnClient[];
  radios?: { band: string; channel: number | null; clients: number | null; power: string | number | null }[];
}

export interface GwnSeries { times: string[] }
export interface GwnClientCounts extends GwnSeries { counts: number[] }
export interface GwnBandwidth extends GwnSeries {
  /** Bytes per interval. */
  download: number[];
  upload: number[];
  /** Bits per second per point. */
  downloadBps: number[];
  uploadBps: number[];
  downloadTotal: number;
  uploadTotal: number;
}
export interface GwnClientUsage extends GwnSeries { download: number[]; upload: number[]; downloadTotal: number; uploadTotal: number }
export interface GwnDeviceStats extends GwnBandwidth { clients: number[] }
export interface GwnSsidStats extends GwnClientCounts { series: { name: string; counts: number[] }[] }

export interface GwnAction {
  id: number; networkId: number; action: string; target: string; byEmail: string | null; byUserId: number | null;
  ok: boolean; message: string | null; createdAt: string;
}

export interface GwnNetworkLocation { networkId: number; networkName: string | null; locationIds: number[] }

/** Error thrown by GwnService: a readable message, the HTTP status and whether Grandstream is simply not set up. */
export class GwnError extends Error {
  constructor(message: string, readonly status: number, readonly unavailable = false) {
    super(message);
    this.name = 'GwnError';
  }
}

interface ApiResponse<T> { isSuccessful?: boolean; success?: boolean; message?: string | null; data: T }

const NOT_SET_UP = 'Grandstream is not set up on this server.';

/** Readable message for a failed GWN call (403, 503, not set up, offline …). */
export function gwnErrorText(err: unknown): string {
  if (err instanceof GwnError) return err.message;
  const e = err as HttpErrorResponse;
  const body = e?.error as any;
  const own = typeof body === 'string' && body.length < 300 && !/<html|<!doctype/i.test(body) ? body
    : body?.message || body?.error || body?.title || null;
  switch (e?.status) {
    case 0: return 'The server is not reachable.';
    case 401: return 'Your session has expired. Please sign in again.';
    case 403: return own || 'You do not have access to this Grandstream network.';
    case 404: return own || 'The Grandstream pages are not available on this server yet.';
    case 503: return own || NOT_SET_UP;
    case 502: case 504: return own || 'Grandstream GWN Cloud did not answer. Please try again in a minute.';
  }
  return own || (e as any)?.message || 'The request failed.';
}

@Injectable({ providedIn: 'root' })
export class GwnService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/gwn`;

  /** The GWN network the pages show (null = the API's default, the first one the caller may see). Kept per browser. */
  readonly net = signal<number | null>(GwnService.readNet());

  private networks$?: Observable<GwnNetwork[]>;

  private static readNet(): number | null {
    try {
      const v = Number(localStorage.getItem('wn.gwn.net'));
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch { return null; }
  }

  setNet(id: number | null) {
    this.net.set(id);
    try { if (id) localStorage.setItem('wn.gwn.net', String(id)); else localStorage.removeItem('wn.gwn.net'); } catch { /* private window */ }
  }

  // ---------- plumbing ----------

  private params(extra: Record<string, string | number | null | undefined> = {}, withNet = true): HttpParams {
    let p = new HttpParams();
    const all: Record<string, string | number | null | undefined> = withNet ? { net: this.net(), ...extra } : extra;
    for (const [k, v] of Object.entries(all)) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
    return p;
  }

  /** Unwraps { isSuccessful, message, data }; `available: false` (not set up) and failures become a GwnError. */
  private unwrap<T>(src: Observable<ApiResponse<T> | T>, allowUnavailable = false): Observable<T> {
    return src.pipe(
      map(res => {
        const r = res as ApiResponse<T>;
        const wrapped = r && typeof r === 'object' && 'data' in (r as object) && ('isSuccessful' in (r as object) || 'success' in (r as object) || 'message' in (r as object));
        if (wrapped && (r.isSuccessful === false || r.success === false)) {
          throw new GwnError(r.message || 'The request failed.', 400, /not set up/i.test(r.message || ''));
        }
        const data = (wrapped ? r.data : res) as T;
        const d = data as any;
        if (!allowUnavailable && d && typeof d === 'object' && !Array.isArray(d) && d.available === false) {
          throw new GwnError(d.message || NOT_SET_UP, 503, true);
        }
        return data;
      }),
      catchError(err => throwError(() => err instanceof GwnError ? err : new GwnError(gwnErrorText(err), err?.status ?? 0, err?.status === 503)))
    );
  }

  private get<T>(path: string, extra: Record<string, string | number | null | undefined> = {}, allowUnavailable = false): Observable<T> {
    return this.unwrap<T>(this.http.get<ApiResponse<T>>(`${this.api}/${path}`, { params: this.params(extra) }), allowUnavailable);
  }

  private post<T>(path: string, body: unknown): Observable<T> {
    return this.unwrap<T>(this.http.post<ApiResponse<T>>(`${this.api}/${path}`, body));
  }

  // ---------- read ----------

  /** GWN networks this user may see (empty for staff of other locations). Cached for the session; `fresh` re-reads. */
  getNetworks(fresh = false): Observable<GwnNetwork[]> {
    if (fresh || !this.networks$) {
      this.networks$ = this.unwrap<GwnNetwork[]>(this.http.get<ApiResponse<GwnNetwork[]>>(`${this.api}/networks`)).pipe(
        map(list => Array.isArray(list) ? list : []),
        shareReplay({ bufferSize: 1, refCount: false })
      );
      // A failed read is not cached.
      const cached = this.networks$;
      cached.subscribe({ error: () => { if (this.networks$ === cached) this.networks$ = undefined; } });
    }
    return this.networks$;
  }

  /** Health, KPIs, devices, SSIDs and alerts. Answers `available: false` (not an error) when GWN is not set up. */
  getOverview(): Observable<GwnOverview> { return this.get<GwnOverview>('overview', {}, true); }

  getClients(): Observable<GwnClient[]> { return this.get<GwnClient[]>('clients').pipe(map(asArray)); }

  /** Clients seen between `from` and `to` (ISO strings or epoch ms; optional). */
  getClientHistory(from?: string | number | null, to?: string | number | null): Observable<GwnHistoryClient[]> {
    return this.get<GwnHistoryClient[]>('clients/history', { from: isoOf(from), to: isoOf(to) }).pipe(map(asArray));
  }

  getClient(mac: string): Observable<GwnClientDetail> { return this.get<GwnClientDetail>('client', { mac }); }

  getClientUsage(mac: string, range: GwnRange): Observable<GwnClientUsage> { return this.get<GwnClientUsage>('client/usage', { mac, range }); }

  getDevices(): Observable<GwnDevice[]> { return this.get<GwnDevice[]>('devices').pipe(map(asArray)); }

  getDevice(mac: string): Observable<GwnDeviceDetail> { return this.get<GwnDeviceDetail>('device', { mac }); }

  getDeviceStats(mac: string, range: GwnRange): Observable<GwnDeviceStats> { return this.get<GwnDeviceStats>('device/stats', { mac, range }); }

  getSsids(): Observable<GwnSsid[]> { return this.get<GwnSsid[]>('ssids').pipe(map(asArray)); }

  getClientStats(range: GwnRange): Observable<GwnClientCounts> { return this.get<GwnClientCounts>('stats/clients', { range }); }

  getBandwidth(range: GwnRange): Observable<GwnBandwidth> { return this.get<GwnBandwidth>('stats/bandwidth', { range }); }

  getSsidStats(range: GwnRange): Observable<GwnSsidStats> { return this.get<GwnSsidStats>('stats/ssid', { range }); }

  /** Super admin: recent block / unblock / reboot actions. */
  getActions(top = 50): Observable<GwnAction[]> { return this.get<GwnAction[]>('actions', { top }).pipe(map(asArray)); }

  getNetworkLocations(): Observable<GwnNetworkLocation[]> {
    return this.unwrap<GwnNetworkLocation[]>(this.http.get<ApiResponse<GwnNetworkLocation[]>>(`${this.api}/network-locations`)).pipe(map(asArray));
  }

  // ---------- write ----------

  /** Dashboard-only name for a client; an empty name removes it. */
  setAlias(mac: string, name: string): Observable<{ mac: string; alias: string | null }> {
    return this.post('alias', { mac, name });
  }

  /** Super admin: blocks (true) or unblocks (false) a client on the network. */
  blockClient(mac: string, block: boolean): Observable<{ mac: string; blocked: boolean }> {
    return this.post('client/block', { net: this.net(), mac, block });
  }

  /** Super admin: reboots an access point / router. */
  rebootDevice(mac: string): Observable<{ mac: string; rebooting: boolean }> {
    return this.post('device/reboot', { net: this.net(), mac });
  }

  /** Super admin: the WorkNest locations a GWN network belongs to. */
  setNetworkLocations(networkId: number, locationIds: number[]): Observable<GwnNetworkLocation> {
    return this.unwrap<GwnNetworkLocation>(this.http.put<ApiResponse<GwnNetworkLocation>>(`${this.api}/network-locations/${networkId}`, { locationIds }));
  }
}

function asArray<T>(v: T[] | null | undefined): T[] { return Array.isArray(v) ? v : []; }

function isoOf(v: string | number | null | undefined): string | null {
  if (v == null || v === '') return null;
  return typeof v === 'number' ? new Date(v).toISOString() : v;
}
