import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  HikDevice, HikRosterResponse, HikDeviceUser,
  HikAccessDashboard, HikAccessEvent, HikSyncActivity, HikAccessAnalytics, HikUserAnalytics,
  HikStaff, HikTag, HikStaffResult
} from '../models/hik-device.model';

@Injectable({
  providedIn: 'root'
})
export class HikDeviceService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /**
   * Fetch list of biometric access devices / machines
   */
  /** "Test" button: connects to the machine now and saves online / offline (admin, super admin). */
  testDevice(id: number): Observable<any> {
    return this.http.post<any>(`${this.api}/hik/devices/${id}/test`, {});
  }

  /** "Test all": tests every machine and saves online / offline. */
  testAllDevices(): Observable<any> {
    return this.http.post<any>(`${this.api}/hik/devices/test-all`, {});
  }

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

  // ============= ACCESS DASHBOARD / ACTIVITY LOG / ANALYTICS (admin only) =============

  getAccessDashboard(expiringDays = 7): Observable<HikAccessDashboard> {
    return this.http.get<HikAccessDashboard>(`${this.api}/hik/access/dashboard`, { params: { expiringDays } });
  }

  /** from/to: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss' (terminal local time); to is exclusive. */
  getAccessEvents(filter: { from?: string; to?: string; deviceId?: number | null; employeeNo?: string; name?: string; limit?: number } = {}): Observable<HikAccessEvent[]> {
    const params: Record<string, string> = {};
    if (filter.from) params['from'] = filter.from;
    if (filter.to) params['to'] = filter.to;
    if (filter.deviceId) params['deviceId'] = String(filter.deviceId);
    if (filter.employeeNo) params['employeeNo'] = filter.employeeNo;
    if (filter.name) params['name'] = filter.name;
    if (filter.limit) params['limit'] = String(filter.limit);
    return this.http.get<HikAccessEvent[]>(`${this.api}/hik/access/events`, { params });
  }

  getAccessActivity(limit = 200): Observable<HikSyncActivity[]> {
    return this.http.get<HikSyncActivity[]>(`${this.api}/hik/access/activity`, { params: { limit } });
  }

  /** from/to: inclusive 'YYYY-MM-DD' dates. */
  getAccessAnalytics(from: string, to: string): Observable<HikAccessAnalytics> {
    return this.http.get<HikAccessAnalytics>(`${this.api}/hik/access/analytics`, { params: { from, to } });
  }

  getAccessUserAnalytics(employeeNo: string | null | undefined, name: string | null | undefined, from: string, to: string): Observable<HikUserAnalytics> {
    const params: Record<string, string> = { from, to };
    if (employeeNo) params['employeeNo'] = employeeNo;
    if (name) params['name'] = name;
    return this.http.get<HikUserAnalytics>(`${this.api}/hik/access/analytics/user`, { params });
  }

  // ============= STAFF ACCESS (janitors, office boys, … — no booking) =============

  getStaff(): Observable<HikStaff[]> {
    return this.http.get<HikStaff[]>(`${this.api}/hik/staff`);
  }

  getStaffTags(): Observable<HikTag[]> {
    return this.http.get<HikTag[]>(`${this.api}/hik/staff/tags`);
  }

  addStaffTag(name: string): Observable<HikTag> {
    return this.http.post<HikTag>(`${this.api}/hik/staff/tags`, { name });
  }

  createStaff(body: { name: string; cnic: string; tagId: number | null; roomDeviceIds: number[]; validUntil: string | null }): Observable<HikStaffResult> {
    return this.http.post<HikStaffResult>(`${this.api}/hik/staff`, body);
  }

  updateStaffMachines(employeeNo: string, body: { roomDeviceIds: number[]; validUntil: string | null }): Observable<HikStaffResult> {
    return this.http.put<HikStaffResult>(`${this.api}/hik/staff/${encodeURIComponent(employeeNo)}/machines`, body);
  }

  setStaffAccess(employeeNo: string, isEnabled: boolean): Observable<any> {
    return this.http.patch<any>(`${this.api}/hik/staff/${encodeURIComponent(employeeNo)}/access`, { isEnabled });
  }

  /** Long-running: the machine waits for the finger / card / face before the request returns. */
  enrollStaff(employeeNo: string, type: 'fingerprint' | 'card' | 'face', body: { captureDeviceId: number; fingerNo?: number; cardNo?: string }): Observable<any> {
    return this.http.post<any>(`${this.api}/hik/staff/${encodeURIComponent(employeeNo)}/${type}`, body);
  }

  deleteStaff(employeeNo: string): Observable<HikStaffResult> {
    return this.http.delete<HikStaffResult>(`${this.api}/hik/staff/${encodeURIComponent(employeeNo)}`);
  }
}
