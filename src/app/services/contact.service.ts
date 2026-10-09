import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ContactService {
  private apiUrl = `${environment.apiUrl}/book-tour`;
  private contactUrl = `${environment.apiUrl}/contact`;

  constructor(private http: HttpClient) {}

  submit(data: any): Observable<any> {
    const url = data.subject === 'Book a Tour Request' ? this.apiUrl : this.contactUrl;
    return this.http.post<any>(url, data);
  }

  /** Active WorkNest locations (dbo.WN_Locations) for the public forms' location dropdown. */
  getLocations(): Observable<{ id: number; name: string }[]> {
    return this.http.get<any>(`${environment.apiUrl}/location/all`).pipe(
      map(res => (Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []) as any[]),
      map(rows => rows
        .filter(l => (l.isActive ?? l.IsActive ?? true) && (l.name ?? l.Name))
        .map(l => ({ id: Number(l.id ?? l.Id), name: String(l.name ?? l.Name) }))
        .sort((a, b) => a.name.localeCompare(b.name))),
      catchError(() => of([]))
    );
  }

  sendWhatsApp(message: string): void {
    const number = environment.whatsappNumber;
    const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }
}
