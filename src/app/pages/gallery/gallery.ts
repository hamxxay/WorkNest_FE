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
        const images = this.normalizeImages(res);
        this.images.set(images);
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

  private normalizeImages(res: any): GalleryItem[] {
    const source = Array.isArray(res?.data)
      ? res.data
      : Array.isArray(res?.data?.items)
        ? res.data.items
        : Array.isArray(res?.data?.results)
          ? res.data.results
          : Array.isArray(res?.items)
            ? res.items
            : Array.isArray(res?.results)
              ? res.results
              : [];

    return source
      .map((img: any, index: number) => {
        const imageUrl = img.imageUrl || img.url || img.image || img.path || img.imagePath;
        if (!imageUrl) return null;

        const title = img.title || img.name || `Gallery Image ${index + 1}`;

        return {
          id: Number(img.id ?? index + 1),
          title,
          description: img.description || '',
          imageUrl,
          locationName: img.locationName || img.location?.name || '',
          category: this.assignCategory(title)
        };
      })
      .filter((img: GalleryItem | null): img is GalleryItem => img !== null);
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
