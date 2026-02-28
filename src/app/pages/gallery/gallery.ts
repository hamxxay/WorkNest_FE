import { Component, OnInit, signal, computed } from '@angular/core';
import { GalleryService } from '../../services/gallery.service';

interface GalleryItem {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
  locationName: string;
  category?: string;
}

@Component({
  selector: 'app-gallery',
  imports: [],
  templateUrl: './gallery.html',
  styleUrl: './gallery.css'
})
export class Gallery implements OnInit {
  categories = ['All', 'Offices', 'Meeting Rooms', 'Co-Working', 'Lounges'];
  activeCategory = signal('All');
  lightboxImage: GalleryItem | null = null;
  loading = signal(true);

  images = signal<GalleryItem[]>([]);

  // memoized filtered images based on active category and images array
  filteredImages = computed(() => {
    const cat = this.activeCategory();
    const imgs = this.images();
    if (cat === 'All') return imgs;
    return imgs.filter(img => img.category === cat);
  });

  constructor(private galleryService: GalleryService) {}

  ngOnInit() {
    this.galleryService.getAll().subscribe({
      next: (res) => {
        if (res.isSuccessful && res.data) {
          this.images.set(res.data.map((img: any) => ({
            ...img,
            category: this.assignCategory(img.title)
          })));
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  private assignCategory(title: string): string {
    const t = (title || '').toLowerCase();
    if (t.includes('meeting') || t.includes('board') || t.includes('pod')) return 'Meeting Rooms';
    if (t.includes('office') || t.includes('suite') || t.includes('corner')) return 'Offices';
    if (t.includes('co-working') || t.includes('hot desk') || t.includes('creative') || t.includes('collaboration') || t.includes('team')) return 'Co-Working';
    if (t.includes('lounge') || t.includes('cafe') || t.includes('terrace') || t.includes('break')) return 'Lounges';
    return 'Offices';
  }


  setCategory(cat: string) {
    this.activeCategory.set(cat);
  }

  openLightbox(img: GalleryItem) {
    this.lightboxImage = img;
  }

  closeLightbox() {
    this.lightboxImage = null;
  }
}
