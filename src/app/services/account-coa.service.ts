import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface AccountCoa {
  accountId: number;
  description: string;
}

@Injectable({ providedIn: 'root' })
export class AccountCoaService {
  private readonly url = `${environment.apiUrl}/account-coa`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<AccountCoa[]> {
    return this.http.get<any>(this.url).pipe(
      map(res => {
        const data = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        return (data as any[]).map(r => ({
          accountId:   r.accountId   ?? r.AccountId   ?? r.Id ?? r.id ?? 0,
          description: r.description ?? r.Description ?? '',
        }));
      })
    );
  }

  getById(accountId: number): Observable<AccountCoa> {
    return this.http.get<any>(`${this.url}/${accountId}`).pipe(
      map(res => res?.data ?? res)
    );
  }
}
