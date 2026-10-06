import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  UnifiSummary, UnifiClientsResponse, UnifiTopology, UnifiWansResponse, UnifiIspResponse, UnifiWifiResponse,
  UnifiClientUsage, UnifiTopUsage, UnifiSpeedtestStart, UnifiSpeedtestStatus, UnifiDeviceHistory,
  UnifiConfig, UnifiAliasResult, UnifiLog, UnifiDeviceDetail
} from '../models/unifi.model';

/** UniFi network monitoring (proxied by the API from the UniFi Site Manager / console). */
@Injectable({
  providedIn: 'root'
})
export class UnifiService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/unifi`;

  /** Sites, devices, ISP metrics, client-count history and alerts (cached by the API). */
  getSummary(): Observable<UnifiSummary> {
    return this.http.get<UnifiSummary>(`${this.api}/summary`);
  }

  /** Forces the API to re-poll UniFi, then returns a fresh summary. */
  refresh(): Observable<UnifiSummary> {
    return this.http.post<UnifiSummary>(`${this.api}/refresh`, {});
  }

  getClients(): Observable<UnifiClientsResponse> {
    return this.http.get<UnifiClientsResponse>(`${this.api}/clients`);
  }

  getTopology(): Observable<UnifiTopology> {
    return this.http.get<UnifiTopology>(`${this.api}/topology`);
  }

  /** Live per-WAN rates, latency, last speed test and 24h traffic. */
  getWans(): Observable<UnifiWansResponse> {
    return this.http.get<UnifiWansResponse>(`${this.api}/wans`);
  }

  /** ISP comparison, speed-test history and failover history. */
  getIsp(): Observable<UnifiIspResponse> {
    return this.http.get<UnifiIspResponse>(`${this.api}/isp`);
  }

  getWifi(): Observable<UnifiWifiResponse> {
    return this.http.get<UnifiWifiResponse>(`${this.api}/wifi`);
  }

  /** Daily (30 days) and hourly (48h) usage for one client. */
  getClientUsage(mac: string): Observable<UnifiClientUsage> {
    return this.http.get<UnifiClientUsage>(`${this.api}/client-usage`, { params: { mac } });
  }

  /** Top data users over the last `days` (1–30). */
  getUsage(days: number): Observable<UnifiTopUsage> {
    return this.http.get<UnifiTopUsage>(`${this.api}/usage`, { params: { days } });
  }

  /** Starts a speed test on one WAN (e.g. "WAN1"). */
  startSpeedtest(wan: string): Observable<UnifiSpeedtestStart> {
    return this.http.post<UnifiSpeedtestStart>(`${this.api}/speedtest`, {}, { params: { wan } });
  }

  getSpeedtestStatus(): Observable<UnifiSpeedtestStatus> {
    return this.http.get<UnifiSpeedtestStatus>(`${this.api}/speedtest`);
  }

  /** Gateway WAN traffic; range in hours (1–168). */
  getWanTraffic(range: number): Observable<UnifiDeviceHistory> {
    return this.http.get<UnifiDeviceHistory>(`${this.api}/wan-traffic`, { params: { range } });
  }

  getConfig(): Observable<UnifiConfig> {
    return this.http.get<UnifiConfig>(`${this.api}/config`);
  }

  /** Sets a dashboard-only name for a client; an empty name resets it. */
  setAlias(mac: string, name: string): Observable<UnifiAliasResult> {
    return this.http.post<UnifiAliasResult>(`${this.api}/alias`, { mac, name });
  }

  /** Event log (last 24h, device alerts 30 days); filtered to one MAC when given. */
  getLogs(mac?: string): Observable<{ logs: UnifiLog[] }> {
    const params: Record<string, string> = {};
    if (mac) params['mac'] = mac;
    return this.http.get<{ logs: UnifiLog[] }>(`${this.api}/logs`, { params });
  }

  /** One UniFi device with its clients and logs. */
  getDevice(mac: string): Observable<UnifiDeviceDetail> {
    return this.http.get<UnifiDeviceDetail>(`${this.api}/device/${encodeURIComponent(mac)}`);
  }

  /** CPU / memory / traffic / clients history for one device; range in hours (1–168). */
  getDeviceHistory(mac: string, range: number): Observable<UnifiDeviceHistory> {
    return this.http.get<UnifiDeviceHistory>(`${this.api}/device/${encodeURIComponent(mac)}/history`, { params: { range } });
  }
}
