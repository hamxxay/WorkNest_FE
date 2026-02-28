// ============================================================
// Application Configuration
// ============================================================
// This file contains the main app configuration including providers
// for routing, HTTP client setup, global interceptors,
// scroll behavior configuration, and app initialization logic.

import { 
  ApplicationConfig, 
  provideBrowserGlobalErrorListeners, 
  APP_INITIALIZER 
} from '@angular/core';

import { 
  provideRouter, 
  withInMemoryScrolling   // ✅ Enables router scroll control
} from '@angular/router';

import { 
  provideHttpClient, 
  withInterceptors 
} from '@angular/common/http';

import { 
  lastValueFrom, 
  timeout, 
  catchError, 
  of 
} from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { AuthService } from './services/auth.service';

// ============================================================
// Main Application Configuration
// Bootstrapped in main.ts
// ============================================================

export const appConfig: ApplicationConfig = {
  providers: [

    // --------------------------------------------------------
    // Global Error Handling
    // Enables better browser-level error tracking
    // --------------------------------------------------------
    provideBrowserGlobalErrorListeners(),

    // --------------------------------------------------------
    // Router Configuration
    // --------------------------------------------------------
    provideRouter(
      routes,

      // ✅ Scroll behavior configuration
      withInMemoryScrolling({
        // Always scroll to TOP on route change
        // Fixes issue where pricing page opens at bottom
        scrollPositionRestoration: 'top',

        // Disable automatic anchor fragment scrolling
        anchorScrolling: 'disabled'
      })
    ),

    // --------------------------------------------------------
    // HTTP Client Configuration
    // Adds JWT token automatically to API requests
    // --------------------------------------------------------
    provideHttpClient(
      withInterceptors([authInterceptor])
    ),

    // --------------------------------------------------------
    // App Initialization (Auth Session Bootstrap)
    // Ensures authentication state is restored before app loads
    // --------------------------------------------------------
    {
      provide: APP_INITIALIZER,
      useFactory: (auth: AuthService) => {
        return () => {
          return lastValueFrom(
            auth.loadSession().pipe(
              // Prevent app from hanging if API is slow
              timeout(7000),

              // Prevent initializer crash on error
              catchError(() => of(null))
            )
          ).catch(() => null);
        };
      },
      deps: [AuthService],
      multi: true
    }
  ]
};