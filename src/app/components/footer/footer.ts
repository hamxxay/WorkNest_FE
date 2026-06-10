import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgFor } from '@angular/common';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { SpaceService } from '../../services/space.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-footer',
  imports: [RouterLink, NgFor],
  templateUrl: './footer.html',
  styleUrl: './footer.css'
})
export class Footer implements OnInit {
  year = new Date().getFullYear();
  spaceTypes = signal<string[]>([]);
  whatsappUrl: SafeUrl;

  constructor(private spaceService: SpaceService, private sanitizer: DomSanitizer) {
    this.whatsappUrl = this.sanitizer.bypassSecurityTrustUrl(`https://wa.me/${environment.whatsappNumber}`);
  }

  ngOnInit() {
    this.spaceService.getAll().subscribe({
      next: (res: any) => {
        const items: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        const types = [...new Set(items
          .map((s: any) => {
            const t = s.spaceTypeName ?? s.SpaceTypeName ?? s.spaceType?.name ?? s.type ?? 'Workspace';
            return typeof t === 'string' ? t.trim() : String(t);
          })
          .filter(Boolean)
        )] as string[];
        this.spaceTypes.set(types);
      }
    });
  }
}
