import { Injectable } from '@angular/core';
import { BehaviorSubject, interval, Observable } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { SpaceService } from './space.service';

export interface AvailabilityData {
  spaceType: string;
  totalSpaces: number;
  availableSpaces: number;
}

@Injectable({
  providedIn: 'root'
})
export class AvailabilityService {
  private availabilitySubject = new BehaviorSubject<AvailabilityData[]>([]);
  private refreshInterval = 30000; // 30 seconds
  private isPolling = false;

  constructor(private spaceService: SpaceService) {}

  /**
   * Get current availability data as observable
   */
  getAvailability(): Observable<AvailabilityData[]> {
    return this.availabilitySubject.asObservable();
  }

  /**
   * Start polling for availability updates
   */
  startPolling(): void {
    if (this.isPolling) return;

    this.isPolling = true;
    
    // Initial fetch
    this.fetchAvailability();

    // Set up interval polling
    interval(this.refreshInterval)
      .pipe(
        switchMap(() => this.spaceService.getAvailabilityCounts()),
        catchError(error => {
          console.error('Availability polling error:', error);
          return [];
        })
      )
      .subscribe(data => {
        const availability = Array.isArray(data) ? data : (data?.data || []);
        this.availabilitySubject.next(availability);
      });
  }

  /**
   * Stop polling for updates
   */
  stopPolling(): void {
    this.isPolling = false;
  }

  /**
   * Manually refresh availability data
   */
  refreshAvailability(): void {
    this.fetchAvailability();
  }

  /**
   * Get availability for specific space type
   */
  getAvailabilityForType(spaceType: string): Observable<number> {
    return new Observable(observer => {
      this.availabilitySubject.subscribe(availability => {
        const typeData = availability.find(a => a.spaceType === spaceType);
        observer.next(typeData?.availableSpaces || 0);
      });
    });
  }

  /**
   * Check if any space type is full
   */
  isAnySpaceTypeFull(): Observable<boolean> {
    return new Observable(observer => {
      this.availabilitySubject.subscribe(availability => {
        const hasFull = availability.some(a => a.availableSpaces === 0);
        observer.next(hasFull);
      });
    });
  }

  private fetchAvailability(): void {
    this.spaceService.getAvailabilityCounts().subscribe({
      next: (data) => {
        const availability = Array.isArray(data) ? data : (data?.data || []);
        this.availabilitySubject.next(availability);
      },
      error: (error) => {
        console.error('Failed to fetch availability:', error);
      }
    });
  }
}