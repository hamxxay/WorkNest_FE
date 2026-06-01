import { Routes } from '@angular/router';

export const PUBLIC_ROUTES: Routes = [

  { path: '', loadComponent: () => import('./home/home').then(m => m.Home) },

  { path: 'contact', loadComponent: () => import('./contact/contact').then(m => m.Contact) },

  { path: 'book-a-tour', loadComponent: () => import('./book-a-tour/book-a-tour').then(m => m.BookATour) }

];
