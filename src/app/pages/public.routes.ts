import { toPublicSiteGuard } from '../utils/public-site';
import { Routes } from '@angular/router';

export const PUBLIC_ROUTES: Routes = [

  // The CMS is staff-only: its root opens the staff login; public pages open on worknestpk.com.
  { path: '', pathMatch: 'full', redirectTo: '/login' },

  

  { path: 'gallery', loadComponent: () => import('./gallery/gallery').then(m => m.Gallery), canActivate: [toPublicSiteGuard] },

  // { path: 'blogs', loadComponent: () => import('./blogs/blogs').then(m => m.Blogs) },

  { path: 'about', loadComponent: () => import('./about/about').then(m => m.About), canActivate: [toPublicSiteGuard] },

  { path: 'contact', loadComponent: () => import('./contact/contact').then(m => m.Contact), canActivate: [toPublicSiteGuard] },

  // { path: 'booking', loadComponent: () => import('./booking/booking').then(m => m.Booking) },

  { path: 'book-a-tour', loadComponent: () => import('./book-a-tour/book-a-tour').then(m => m.BookATour), canActivate: [toPublicSiteGuard] },

  { path: 'service-policy', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'service-policy' }, canActivate: [toPublicSiteGuard] },
  { path: 'pricing-policy', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'pricing-policy' }, canActivate: [toPublicSiteGuard] },
  { path: 'refund-policy', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'refund-policy' }, canActivate: [toPublicSiteGuard] },
  { path: 'privacy-policy', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'privacy-policy' }, canActivate: [toPublicSiteGuard] },
  { path: 'terms-and-conditions', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'terms-and-conditions' }, canActivate: [toPublicSiteGuard] },
  { path: 'quotation/:id', loadComponent: () => import('./my-quotations/my-quotations').then(m => m.MyQuotations) }

];

