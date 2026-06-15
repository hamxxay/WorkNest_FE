import { Component, signal, OnDestroy, OnInit, AfterViewInit, ElementRef } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GalleryService } from '../../services/gallery.service';
import { animate, stagger } from 'animejs';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home implements OnInit, AfterViewInit, OnDestroy {

  activeHeroSlide = signal(0);
  private heroIntervalId = 0;
  private observer!: IntersectionObserver;

  stats = [
    { value: '500+', label: 'Professionals' },
    { value: '3',    label: 'Locations'     },
    { value: '98%',  label: 'Satisfaction'  },
    { value: '24/7', label: 'Support'       },
  ];

  marqueeItems = [
    'Private Offices', 'Co-Working Desks', 'Meeting Rooms',
    'High-Speed Internet', 'Premium Amenities', 'Flexible Hours',
    'Professional Community', 'Instant Booking', 'Islamabad'
  ];

  particles = Array.from({ length: 18 }, () => ({
    x:     `${Math.random() * 100}%`,
    y:     `${Math.random() * 100}%`,
    size:  `${2 + Math.random() * 4}px`,
    delay: `${Math.random() * 6}s`
  }));

  features = [
    // { icon: 'clock',    title: 'Real-Time Availability',  description: 'See live workspace availability and book instantly — no conflicts, no double-bookings.' },
    { icon: 'layout', title: 'Flexible Workspace',       description: 'Connect with entrepreneurs, freelancers, startups, and industry leaders through a collaborative community designed for networking and growth.' },
    { icon: 'wifi',     title: 'High-Speed Internet',      description: 'Dedicated enterprise-grade fibre connectivity across all locations.' },
    { icon: 'shield',   title: 'Secure & Private',         description: '24/7 security, keycard access, CCTV monitoring, and private offices provide a safe and professional environment for your business.' },
    { icon: 'users',    title: 'Vibrant Community',        description: 'Connect with entrepreneurs, freelancers, startups, and industry leaders through a collaborative community designed for networking and growth.' },
    { icon: 'building', title: 'Premium Workspaces',       description: 'Ergonomic furniture, natural lighting, fully-equipped meeting rooms and lounges.' },
  ];

  galleryImages = signal<{ title: string; url: string }[]>([
    { title: 'Collaborative workspace', url: 'images/spaces/collaborative.jpg' },
    { title: 'Modern office lounge',    url: 'images/spaces/lounge.jpg'        },
    { title: 'Focused work area',       url: 'images/spaces/modern-office.jpg' },
    { title: 'Meeting room setup',      url: 'images/spaces/meeting-room.jpg'  },
  ]);

  offerings = signal<{ name: string; description: string; features: string[]; popular: boolean }[]>([
    {
      name: 'Private Office',
      description: 'A dedicated office suite for focused work or small teams.',
      features: ['Secure keycard access', 'Premium desk & chair', 'High-speed internet', 'Daily cleaning'],
      popular: false
    },
    {
      name: 'Hot Desk',
      description: 'Flexible desk access for remote workers and freelancers.',
      features: ['Flexible hours', 'Community lounge', 'Printer & scanner', 'Locker storage'],
      popular: false
    },
    {
      name: 'Meeting Room',
      description: 'Fully equipped rooms for presentations and team sessions.',
      features: ['AV & display setup', 'Whiteboard & supplies', 'Up to 10 people', 'Catering available'],
      popular: false
    },
  ]);

  heroSlides = [
    { title: 'Collaborative workspace', url: 'images/slideshow/Slideshow1.jpg' },
    { title: 'Modern office lounge',    url: 'images/slideshow/Slideshow2.jpg' },
    { title: 'Focused work area',       url: 'images/slideshow/Slideshow3.jpg' },
    { title: 'Meeting room setup',      url: 'images/slideshow/Slideshow4.jpg' },
  ];

  constructor(private galleryService: GalleryService, private el: ElementRef) {}

  ngOnInit() {
    this.galleryService.getAll().subscribe({
      next: (res) => {
        const source = Array.isArray(res) ? res
          : Array.isArray(res?.data) ? res.data
          : Array.isArray(res?.data?.items) ? res.data.items
          : Array.isArray(res?.data?.results) ? res.data.results
          : Array.isArray(res?.items) ? res.items
          : Array.isArray(res?.results) ? res.results
          : [];
        const images = source
          .map((img: any, i: number) => ({
            title: img.title || img.name || `Image ${i + 1}`,
            url:   img.imageUrl || img.url || img.image || img.path || img.imagePath || ''
          }))
          .filter((img: any) => !!img.url)
          .slice(0, 4);
        if (images.length > 0) this.galleryImages.set(images);
      }
    });
    this.heroIntervalId = window.setInterval(() => {
      this.activeHeroSlide.update(i => (i + 1) % this.heroSlides.length);
    }, 6000);
  }

  ngAfterViewInit() {
    this.runHeroAnimation();
    this.setupScrollAnimations();
  }

  ngOnDestroy() {
    window.clearInterval(this.heroIntervalId);
    this.observer?.disconnect();
  }

  setSlide(i: number) {
    this.activeHeroSlide.set(i);
  }

  private runHeroAnimation() {
    animate('.hero-kicker',       { opacity: [0, 1], translateY: [24, 0], duration: 700, ease: 'outExpo', delay: 100 });
    animate('.hero-heading',      { opacity: [0, 1], translateY: [40, 0], duration: 800, ease: 'outExpo', delay: 300 });
    animate('.hero-text',         { opacity: [0, 1], translateY: [24, 0], duration: 700, ease: 'outExpo', delay: 550 });
    animate('.hero-actions .btn', { opacity: [0, 1], translateY: [20, 0], duration: 600, ease: 'outExpo', delay: stagger(130, { start: 750 }) });
  }

  private setupScrollAnimations() {
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLElement;
        const type = el.dataset['anim'];

        if (type === 'stagger') {
          const children = Array.from(el.children) as HTMLElement[];
          children.forEach(c => { c.style.opacity = '0'; });
          animate(children, {
            opacity: [0, 1], translateY: [50, 0], duration: 700, ease: 'outExpo', delay: stagger(100)
          });
        } else if (type === 'scale') {
          animate(el, { opacity: [0, 1], scale: [0.88, 1], duration: 700, ease: 'outExpo' });
        } else {
          animate(el, { opacity: [0, 1], translateY: [40, 0], duration: 700, ease: 'outExpo' });
        }
        this.observer.unobserve(el);
      });
    }, { threshold: 0 });

    const staggerEls = ['.features-grid', '.gallery-grid', '.offerings-grid'];
    const fadeEls    = ['.section-header', '.cta-inner'];

    staggerEls.forEach(sel => {
      this.el.nativeElement.querySelectorAll(sel).forEach((el: Element) => {
        const h = el as HTMLElement;
        h.dataset['anim'] = 'stagger';
        this.observer.observe(h);
      });
    });

    fadeEls.forEach(sel => {
      this.el.nativeElement.querySelectorAll(sel).forEach((el: Element) => {
        const h = el as HTMLElement;
        h.style.opacity = '0';
        h.dataset['anim'] = sel === '.cta-inner' ? 'scale' : 'fade';
        this.observer.observe(h);
      });
    });
  }
}
