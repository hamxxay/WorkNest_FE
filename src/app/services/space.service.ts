// ============================================================
// Space Service
// ============================================================
// This service handles all space-related API calls.
// Spaces are the coworking/office areas available for booking.
// It provides methods to retrieve spaces with various filters.

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// Injectable service provided at the root level (singleton)
@Injectable({
  providedIn: 'root'
})
export class SpaceService {
  // Base API URL for space endpoints
  private apiUrl = `${environment.apiUrl}/space`;

  constructor(private http: HttpClient) {}

  /**
   * Get all available spaces
   * @returns Observable of array of all spaces
   */
  getAll(): Observable<any> {
    return this.http.get<any>(this.apiUrl);
  }

  /**
   * Get all available spaces
   * @returns Observable of array of available spaces
   */
  getAvailable(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/available`);
  }

  /**
   * Get available spaces by type and time range
   * @param spaceType - Type of space
   * @param startDateTime - Start date/time
   * @param endDateTime - End date/time
   * @returns Observable of available spaces for the time period
   */
  getAvailableByType(spaceType: string, startDateTime?: string, endDateTime?: string): Observable<any> {
    const params = new URLSearchParams({ spaceType });
    if (startDateTime) params.set('startDateTime', startDateTime);
    if (endDateTime) params.set('endDateTime', endDateTime);
    return this.http.get<any>(`${this.apiUrl}/available-by-type?${params.toString()}`);
  }

  /**
   * Get live availability count for each space type
   * @returns Observable with availability counts per space type
   */
  getAvailabilityCounts(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/availability-counts`);
  }

  /**
   * Get details of a specific space by ID
   * @param id - Space ID
   * @returns Observable of space details
   */
  getById(id: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }
}
