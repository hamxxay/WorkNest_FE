import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManageBase } from '../manage-base/manage-base';

/** /admin/gallery: the Manage list for entity 'gallery' (route data entity, read by ManageBase.ngOnInit),
 * with only the markup and popups this entity can show. */
@Component({
  selector: 'app-gallery-page',
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './gallery-page.html',
  // Shared popup look first, so the page's own colour classes (.src-*, .out-*) override its defaults.
  styleUrls: ['../../../styles/form-popup.css', '../manage/manage.css']
})
export class GalleryPage extends ManageBase {}
