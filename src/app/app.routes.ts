// ============================================================
// Application Routes Configuration
// ============================================================
// This file defines all the routes for the application.
// Routes use lazy loading to optimize bundle size.
// Some routes are protected by guards (authGuard and adminGuard).

import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { adminGuard } from './guards/admin.guard';

export const routes: Routes = [
  // ============= PUBLIC ROUTES (NO AUTHENTICATION REQUIRED) =============
  
  // Home page - landing page for all users
  { path: '', loadComponent: () => import('./pages/home/home').then(m => m.Home) },
  
  // Pricing page - displays workspace pricing information
  { path: 'pricing', loadComponent: () => import('./pages/pricing/pricing').then(m => m.Pricing) },
  
  // Gallery page - showcases workspace images
  { path: 'gallery', loadComponent: () => import('./pages/gallery/gallery').then(m => m.Gallery) },
  
  // About page - information about the company
  { path: 'about', loadComponent: () => import('./pages/about/about').then(m => m.About) },
  
  // Contact page - contact form for inquiries
  { path: 'contact', loadComponent: () => import('./pages/contact/contact').then(m => m.Contact) },
  
  // ============= AUTHENTICATION ROUTES =============
  
  // Login page - for existing users
  { path: 'login', loadComponent: () => import('./pages/login/login').then(m => m.Login), data: { layout: 'auth' } },
  
  // Signup page - for new user registration
  { path: 'signup', loadComponent: () => import('./pages/signup/signup').then(m => m.Signup), data: { layout: 'auth' } },

  // ============= PROTECTED ROUTES (REQUIRE AUTHENTICATION) =============
  
  // Booking page - users can create new bookings (requires authGuard)
  { path: 'booking', loadComponent: () => import('./pages/booking/booking').then(m => m.Booking), canActivate: [authGuard] },
  
  // My Bookings page - users view their existing bookings (requires authGuard)
  { path: 'my-bookings', loadComponent: () => import('./pages/my-bookings/my-bookings').then(m => m.MyBookings), canActivate: [authGuard] },
  
  // My Payments page - users view their payment history (requires authGuard)
  { path: 'my-payments', loadComponent: () => import('./pages/my-payments/my-payments').then(m => m.MyPayments), canActivate: [authGuard] },

  // ============= ADMIN ROUTES (REQUIRE ADMIN ROLE) =============
  // All admin routes are protected by adminGuard and wrapped in admin layout
  
  {
    path: 'admin',
    // Load the admin layout component that wraps all admin pages
    loadComponent: () => import('./admin/layout/admin-layout').then(m => m.AdminLayout),
    // Protect all admin routes - only users with 'Admin' role can access
    canActivate: [adminGuard],
    data: { layout: 'admin' },
    children: [
      // Admin Dashboard - main admin overview page
      { path: '', loadComponent: () => import('./admin/dashboard/dashboard').then(m => m.AdminDashboard) },
      
      // Admin Management Pages - reusable manage component with different entities
      // The entity type is passed via route data
      { path: 'users', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'users' } },
      { path: 'locations', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'locations' } },
      { path: 'space-types', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'space-types' } },
      { path: 'spaces', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'spaces' } },
      { path: 'bookings', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'bookings' } },
      { path: 'pricing', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'pricing' } },
      { path: 'memberships', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'memberships' } },
      { path: 'payments', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'payments' } },
      { path: 'contacts', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'contacts' } },
      { path: 'gallery', loadComponent: () => import('./admin/manage/manage').then(m => m.AdminManage), data: { entity: 'gallery' } },
    ]
  },

  // ============= WILDCARD ROUTE =============
  // Catch all undefined routes and redirect to home page
  { path: '**', redirectTo: '' }
];
