import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ContactService {
  private apiUrl = `${environment.apiUrl}/book-tour`;
  private contactUrl = `${environment.apiUrl}/contact`;

  constructor(private http: HttpClient) {}

  submit(data: any): Observable<any> {
    // Use /contact for contact messages, /book-tour for tour requests
    const url = data.subject === 'Book a Tour Request' ? this.apiUrl : this.contactUrl;
    return this.http.post<any>(url, data);
  }
}
