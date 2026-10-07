import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/** A WHT rate from dbo.WN_WHTaxRate: shown by description, applies its rate (%). */
export interface WhtRateOption {
  id: number | null;
  description: string;
  rate: number;
}

@Injectable({ providedIn: 'root' })
export class WhtRateService {
  private readonly url = `${environment.apiUrl}/amount-fields/wht-rates`;
  private cache$: Observable<WhtRateOption[]> | null = null;

  constructor(private http: HttpClient) {}

  getAll(): Observable<WhtRateOption[]> {
    if (!this.cache$) {
      this.cache$ = this.http.get<any>(this.url).pipe(
        map(res => (Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []) as any[]),
        map(rows => rows.map(r => ({
          id: r.id ?? r.Id ?? null,
          description: String(r.description ?? r.Description ?? ''),
          rate: Number(r.rate ?? r.Rate ?? 0)
        })).filter(o => o.description && o.rate > 0)),
        catchError(() => { this.cache$ = null; return of([] as WhtRateOption[]); }),
        shareReplay(1)
      );
    }
    return this.cache$;
  }
}
