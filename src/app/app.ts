// ============================================================
// Root Application Component
// ============================================================
// This is the main App component that serves as the root of the application.
// It conditionally renders the navbar and footer based on the current route.

import { Component } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd, ActivatedRoute, Data } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { Navbar } from './components/navbar/navbar';
import { Footer } from './components/footer/footer';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Navbar, Footer],
  template: `
    @if (showChrome()) {
      <app-navbar />
    }
    <main>
      <router-outlet />
    </main>
    @if (showChrome()) {
      <app-footer />
    }
    <div class="whatsapp-wrap">
      @if (waOpen) {
        <div class="whatsapp-bubble">Hello! How can I assist you today?</div>
      }
      <div class="whatsapp-btn-row">
        @if (waOpen) {
          <a class="whatsapp-float" href="https://wa.me/923008025600" target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp">
            <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          </a>
        }
        <button class="whatsapp-toggle" (click)="waOpen = !waOpen" [attr.aria-label]="waOpen ? 'Close WhatsApp chat' : 'Open WhatsApp chat'">
          @if (waOpen) {
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          } @else {
            <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          }
        </button>
      </div>
    </div>
  `,
  styles: [`
    main { min-height: 100vh; }
    .whatsapp-wrap {
      position: fixed;
      bottom: 28px;
      right: 28px;
      z-index: 999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
    }
    .whatsapp-bubble {
      background: #fff;
      color: #111;
      font-size: 0.85rem;
      font-weight: 500;
      padding: 10px 14px;
      border-radius: 16px 16px 4px 16px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      max-width: 220px;
      line-height: 1.4;
      position: relative;
      animation: fadeSlideUp 0.2s ease;
    }
    .whatsapp-bubble::after {
      content: '';
      position: absolute;
      bottom: -8px;
      right: 18px;
      border: 8px solid transparent;
      border-top-color: #fff;
      border-bottom: none;
    }
    .whatsapp-btn-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .whatsapp-float {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #25D366;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(37,211,102,0.4);
      text-decoration: none;
      transition: transform 0.2s ease;
    }
    .whatsapp-float:hover { transform: translateY(-2px); }
    .whatsapp-toggle {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #25D366;
      color: #fff;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(37,211,102,0.4);
      cursor: pointer;
      transition: transform 0.2s ease, background 0.2s ease;
    }
    .whatsapp-toggle:hover { transform: translateY(-2px); background: #1ebe5d; }
    @keyframes fadeSlideUp {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `]
})
export class App {
  waOpen = false;
  // keep track of the active route's data
  private currentData: Data = {};

  constructor(private router: Router, private activated: ActivatedRoute) {
    // update currentData after each successful navigation
    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd),
        map(() => this.getDeepestData(this.activated.root))
      )
      .subscribe(data => {
        this.currentData = data;
      });
  }

  // recursively traverse route tree to find final child with data
  private getDeepestData(route: ActivatedRoute): Data {
    let res: Data = route.snapshot.data || {};
    if (route.firstChild) {
      const childData = this.getDeepestData(route.firstChild);
      res = { ...res, ...childData };
    }
    return res;
  }

  /**
   * Helper used in template to decide whether to render navbar/footer.
   * If route data explicitly says layout: 'admin', hide public chrome.
   * Auth pages now show the navbar.
   */
  showChrome(): boolean {
    const layout = this.currentData['layout'];
    return layout !== 'admin';
  }
}
