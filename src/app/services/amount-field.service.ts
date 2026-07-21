import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface AmountField {
  id: number;
  entity: string;
  field: string;
  label: string;
  currency: string;
}

@Injectable({ providedIn: 'root' })
export class AmountFieldService {
  private readonly url = `${environment.apiUrl}/amount-fields`;
  private cache$: Observable<AmountField[]> | null = null;

  constructor(private http: HttpClient) {}

  getAll(): Observable<AmountField[]> {
    if (!this.cache$) {
      this.cache$ = this.http.get<any>(this.url).pipe(
        map(res => (Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []) as AmountField[]),
        shareReplay(1)
      );
    }
    return this.cache$;
  }

  /** Returns a label lookup map keyed by 'Entity.field' */
  getLabelMap(): Observable<Record<string, string>> {
    return this.getAll().pipe(
      map(fields => {
        const map: Record<string, string> = {};
        for (const f of fields) map[`${f.entity}.${f.field}`] = f.label;
        return map;
      })
    );
  }
}
