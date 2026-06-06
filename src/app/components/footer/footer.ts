import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgFor } from '@angular/common';
import { AdminService } from '../../services/admin.service';

@Component({
  selector: 'app-footer',
  imports: [RouterLink, NgFor],
  templateUrl: './footer.html',
  styleUrl: './footer.css'
})
export class Footer implements OnInit {
  year = new Date().getFullYear();
  spaceTypes = signal<string[]>([]);

  constructor(private adminService: AdminService) {}

  ngOnInit() {
    this.adminService.getSpaceTypes(1, 200).subscribe({
      next: (res) => {
        const items = Array.isArray(res) ? res : (res?.data as any[] ?? []);
        this.spaceTypes.set(items.map((t: any) => t.name).filter(Boolean));
      }
    });
  }
}
