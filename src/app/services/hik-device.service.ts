import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { HikDevice, HikRosterResponse, HikDeviceUser } from '../models/hik-device.model';

@Injectable({
  providedIn: 'root'
})
export class HikDeviceService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /**
   * Fetch list of biometric access devices / machines
   */
  getDevices(location?: string): Observable<HikDevice[]> {
    const params: Record<string, string> = {};
    if (location) params['location'] = location;
    return this.http.get<HikDevice[]>(`${this.api}/devices`, { params });
  }

  /**
   * Fetch aggregated rosters across all machines and CNIC lookup map
   */
  getRoster(location?: string): Observable<HikRosterResponse> {
    const params: Record<string, string> = {};
    if (location) params['location'] = location;
    return this.http.get<HikRosterResponse>(`${this.api}/roster`, { params });
  }

  /**
   * Fetch specific device users snapshot
   */
  getDeviceUsers(deviceId: number): Observable<{ ok: boolean; total: number; users: HikDeviceUser[]; error?: string }> {
    return this.http.get<{ ok: boolean; total: number; users: HikDeviceUser[]; error?: string }>(
      `${this.api}/devices/${deviceId}/users`
    );
  }

  /**
   * Suggest next available member employee number
   */
  getNextEmployeeNo(): Observable<{ ok: boolean; next: number }> {
    return this.http.get<{ ok: boolean; next: number }>(`${this.api}/next-employee-no`);
  }
}
