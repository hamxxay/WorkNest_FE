import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class GalleryService {
  private apiUrl = `${environment.apiUrl}/gallery`;

  constructor(private http: HttpClient) {}

  private images$?: Observable<any>;

  getAll(forceRefresh: boolean = false): Observable<any> {
    if (forceRefresh || !this.images$) {
      this.images$ = this.http.get<any>(this.apiUrl).pipe(
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }
    return this.images$;
  }

  clearCache() {
    this.images$ = undefined;
  }
}
