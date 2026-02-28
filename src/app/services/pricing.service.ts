import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class PricingService {
  private apiUrl = `${environment.apiUrl}/pricingplan`;

  constructor(private http: HttpClient) {}

  // cached stream containing latest plans; cleared when data mutates
  private plans$?: Observable<any>;

  getActivePlans(forceRefresh: boolean = false): Observable<any> {
    if (forceRefresh || !this.plans$) {
      this.plans$ = this.http.get<any>(this.apiUrl).pipe(
        // replay latest value to new subscribers
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }
    return this.plans$;
  }

  clearPlansCache() {
    this.plans$ = undefined;
  }

  getPlanFeatures(planId: number): Observable<any> {
    return this.http.get<any>(`${environment.apiUrl}/planfeature/by-plan/${planId}`);
  }
}
