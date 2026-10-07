import { Routes } from '@angular/router';
import { adminGuard } from './guards/admin.guard';
import { superAdminGuard } from './guards/super-admin.guard';

export const routes: Routes = [

  { path: '', loadChildren: () => import('./pages/public.routes').then(m => m.PUBLIC_ROUTES) },

  { path: '', loadChildren: () => import('./pages/auth.routes').then(m => m.AUTH_ROUTES) },

  { path: '', loadChildren: () => import('./pages/user.routes').then(m => m.USER_ROUTES) },

  {
    path: 'admin',
    loadComponent: () => import('./pages/admin/layout/admin-layout').then(m => m.AdminLayout),
    canActivate: [adminGuard],
    canActivateChild: [adminGuard],
    data: { layout: 'admin' },
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', loadComponent: () => import('./pages/admin/dashboard/dashboard').then(m => m.Dashboard) },
      { path: 'profile',   loadComponent: () => import('./pages/admin/profile/profile').then(m => m.AdminProfile) },
      { path: 'customers',   loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'customers' } },
      { path: 'kyc',         loadComponent: () => import('./pages/admin/kyc/kyc').then(m => m.KycComponent), canActivate: [adminGuard] },
      { path: 'kyc/:id',     loadComponent: () => import('./pages/admin/kyc/kyc').then(m => m.KycComponent), canActivate: [adminGuard] },
      { path: 'users',       loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'users' } },
      { path: 'locations',   loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'locations' } },
      { path: 'spacetypes',  loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'spacetypes' } },
      { path: 'spaces',      loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'spaces' } },
      { path: 'bookings',    loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'bookings' } },
      { path: 'pricing',     loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'pricing' } },
      { path: 'quotations',  loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'quotations' } },
      { path: 'payments',    loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'payments' } },
      { path: 'agreements',  loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'agreements' } },
      { path: 'lease-templates', loadComponent: () => import('./pages/admin/lease-template-editor/lease-template-editor').then(m => m.LeaseTemplateEditor), canActivate: [adminGuard] },
      { path: 'invoices',    loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'invoices' } },

      { path: 'contacts',    loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'contacts' } },
      { path: 'gallery',      loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'gallery' } },
      { path: 'space-configuration', loadComponent: () => import('./pages/admin/space-config/space-config').then(m => m.SpaceConfig), canActivate: [superAdminGuard] },
      { path: 'manage-spaces',       loadComponent: () => import('./pages/admin/manage-spaces/manage-spaces').then(m => m.ManageSpaces), canActivate: [adminGuard] },
      { path: 'attendants', loadComponent: () => import('./pages/admin/attendant-management/attendant-management').then(m => m.AttendantManagement), canActivate: [adminGuard] },
      { path: 'biometric-users', loadComponent: () => import('./pages/admin/biometric-users/biometric-users').then(m => m.BiometricUsers), canActivate: [adminGuard] },
      { path: 'machine-users', redirectTo: 'biometric-users' },
      { path: 'staff-access', loadComponent: () => import('./pages/admin/staff-access/staff-access').then(m => m.StaffAccess), canActivate: [adminGuard] },
      { path: 'access-dashboard', loadComponent: () => import('./pages/admin/access/access-dashboard/access-dashboard').then(m => m.AccessDashboard), canActivate: [adminGuard] },
      { path: 'access-activity-log', loadComponent: () => import('./pages/admin/access/access-activity-log/access-activity-log').then(m => m.AccessActivityLog), canActivate: [adminGuard] },
      { path: 'access-analytics', loadComponent: () => import('./pages/admin/access/access-analytics/access-analytics').then(m => m.AccessAnalytics), canActivate: [adminGuard] },
      { path: 'network', loadComponent: () => import('./pages/admin/network/network-overview/network-overview').then(m => m.NetworkOverview), canActivate: [adminGuard] },
      { path: 'network/clients', loadComponent: () => import('./pages/admin/network/network-clients/network-clients').then(m => m.NetworkClients), canActivate: [adminGuard] },
      { path: 'network/devices', loadComponent: () => import('./pages/admin/network/network-devices/network-devices').then(m => m.NetworkDevices), canActivate: [adminGuard] },
      { path: 'network/device/:mac', loadComponent: () => import('./pages/admin/network/network-device/network-device').then(m => m.NetworkDevice), canActivate: [adminGuard] },
      { path: 'network/internet', loadComponent: () => import('./pages/admin/network/network-internet/network-internet').then(m => m.NetworkInternet), canActivate: [adminGuard] },
      { path: 'network/wifi', loadComponent: () => import('./pages/admin/network/network-wifi/network-wifi').then(m => m.NetworkWifi), canActivate: [adminGuard] },
      { path: 'challan-validity', loadComponent: () => import('./pages/admin/challan-validity/challan-validity').then(m => m.ChallanValidity), canActivate: [superAdminGuard] },
      { path: 'reports/security-deposits', loadComponent: () => import('./pages/admin/reports/security-deposit-report/security-deposit-report').then(m => m.SecurityDepositReportComponent), canActivate: [adminGuard] },
    ]
  },

  { path: 'unauthorized', loadComponent: () => import('./pages/unauthorized/unauthorized').then(m => m.Unauthorized) },

  { path: '**', redirectTo: '' }

];
