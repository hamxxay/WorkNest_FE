import { Routes } from '@angular/router';

export const PUBLIC_ROUTES: Routes = [

  { path: '', loadComponent: () => import('./home/home').then(m => m.Home) },

  { path: 'pricing', loadComponent: () => import('./pricing/pricing').then(m => m.Pricing) },

  { path: 'gallery', loadComponent: () => import('./gallery/gallery').then(m => m.Gallery) },

  { path: 'blogs', loadComponent: () => import('./blogs/blogs').then(m => m.Blogs) },

  { path: 'about', loadComponent: () => import('./about/about').then(m => m.About) },

  { path: 'contact', loadComponent: () => import('./contact/contact').then(m => m.Contact) }

];
