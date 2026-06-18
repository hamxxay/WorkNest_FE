import { Routes } from '@angular/router';

export const PUBLIC_ROUTES: Routes = [

  { path: '', loadComponent: () => import('./home/home').then(m => m.Home) },

  { path: 'contact', loadComponent: () => import('./contact/contact').then(m => m.Contact) },

  { path: 'book-a-tour', loadComponent: () => import('./book-a-tour/book-a-tour').then(m => m.BookATour) },

  { path: 'about', loadComponent: () => import('./about/about').then(m => m.About) },

  { path: 'service-policy', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'service-policy' } },
  { path: 'pricing-policy', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'pricing-policy' } },
  { path: 'refund-policy', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'refund-policy' } },
  { path: 'privacy-policy', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'privacy-policy' } },
  { path: 'terms-and-conditions', loadComponent: () => import('./policies/policies').then(m => m.Policies), data: { slug: 'terms-and-conditions' } }

];
