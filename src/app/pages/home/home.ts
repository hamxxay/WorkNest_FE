import { Component, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy, OnInit, NgZone } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PricingService } from '../../services/pricing.service';
import { GalleryService } from '../../services/gallery.service';


@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home implements AfterViewInit, OnDestroy, OnInit {
  @ViewChild('waveCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  public readonly heroSlideOffset = signal(0);
  public readonly activeHeroSlide = signal(0);

  private animId = 0;
  private heroSlideIntervalId = 0;
  private time = 0;

  constructor(
    private ngZone: NgZone,
    private pricingService: PricingService,
    private galleryService: GalleryService
  ) {}

  private setHeroSlide(index: number) {
    const slideCount = Math.max(this.galleryImages.length, 1);
    const nextIndex = index % slideCount;

    this.activeHeroSlide.set(nextIndex);
    this.heroSlideOffset.set(nextIndex * -100);
  }

  private startHeroSlideshow() {
    window.clearInterval(this.heroSlideIntervalId);
    this.heroSlideIntervalId = window.setInterval(() => {
      this.setHeroSlide(this.activeHeroSlide() + 1);
    }, 3000);
  }

  ngOnInit() {
    // Load pricing plans from API
    this.pricingService.getActivePlans().subscribe({
      next: (res) => {
        if (res.isSuccessful && res.data) {
          const plans = Array.isArray(res.data)
            ? res.data
            : Array.isArray(res.data?.items)
              ? res.data.items
              : Array.isArray(res.data?.results)
                ? res.data.results
                : [];
          this.plans = plans.map((plan: any) => ({
            name: plan.name,
            price: plan.price,
            description: plan.description,
            features: plan.features?.map((f: any) => f.featureName) || [],
            popular: plan.name === 'Premium'
          }));
        }
      }
    });

    // Load gallery images from API
    this.galleryService.getAll().subscribe({
      next: (res) => {
        if (res.isSuccessful && res.data) {
          const images = Array.isArray(res.data)
            ? res.data
            : Array.isArray(res.data?.items)
              ? res.data.items
              : Array.isArray(res.data?.results)
                ? res.data.results
                : [];
          this.galleryImages = images.slice(0, 4).map((img: any) => ({
            title: img.title,
            url: img.imageUrl
          }));
          this.setHeroSlide(0);
        }
      }
    });

    this.startHeroSlideshow();
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => this.animate());
    window.addEventListener('resize', this.resizeCanvas);
    this.resizeCanvas();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.animId);
    window.clearInterval(this.heroSlideIntervalId);
    window.removeEventListener('resize', this.resizeCanvas);
  }

  private resizeCanvas = () => {
    const canvas = this.canvasRef.nativeElement;
    canvas.width = canvas.parentElement!.clientWidth;
    canvas.height = canvas.parentElement!.clientHeight;
  };

  private animate = () => {
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    this.time += 0.015;

    // Back wave — teal
    this.drawWave(ctx, w, h, [0.0122, 0.018, 0.005], 'rgba(40, 167, 164, 0.1)', 0.6, this.time);
    // Front wave — dark
    this.drawWave(ctx, w, h, [0.0211, 0.028, 0.015], 'rgba(17, 24, 40, 0.1)', 0.65, this.time * 1.2);

    this.animId = requestAnimationFrame(this.animate);
  };

  private drawWave(ctx: CanvasRenderingContext2D, w: number, h: number, freqs: number[], color: string, baseline: number, t: number) {
    ctx.beginPath();
    ctx.moveTo(0, h);

    for (let x = 0; x <= w; x++) {
      let y = 0;
      for (const f of freqs) {
        y += Math.sin(x * f + t) * (h * 0.18);
      }
      ctx.lineTo(x, h * baseline + y);
    }

    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  features = [
    {
      icon: 'clock',
      title: 'Real-Time Availability',
      description: 'View live workspace availability and book instantly without conflicts or double-bookings.'
    },
    {
      icon: 'calendar',
      title: 'Easy Booking Process',
      description: 'Simple three-click booking process with calendar integration and instant confirmations.'
    },
    {
      icon: 'building',
      title: 'Premium Workspaces',
      description: 'Access fully-equipped workspaces with high-speed internet, meeting rooms, and premium amenities.'
    }
  ];

  galleryImages: { title: string; url: string }[] = [
    { title: 'Collaborative workspace', url: 'images/spaces/collaborative.jpg' },
    { title: 'Modern office lounge', url: 'images/spaces/lounge.jpg' },
    { title: 'Focused work area', url: 'images/spaces/modern-office.jpg' },
    { title: 'Meeting room setup', url: 'images/spaces/meeting-room.jpg' }
  ];

  plans: { name: string; price: number; description: string; features: string[]; popular: boolean }[] = [
    {
      name: 'Standard',
      price: 29,
      description: 'Flexible access for freelancers and solo founders.',
      features: ['5 hours / month', 'High-speed WiFi', 'Community events'],
      popular: false
    },
    {
      name: 'Premium',
      price: 79,
      description: 'Unlimited access for remote teams and power users.',
      features: ['Unlimited access', 'Meeting rooms', '24/7 entry'],
      popular: true
    },
    {
      name: 'Executive',
      price: 199,
      description: 'Private offices with premium services included.',
      features: ['Private office', 'Concierge support', 'Guest passes'],
      popular: false
    }
  ];
}

