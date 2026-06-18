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
import { WhatsappFloatComponent } from './components/whatsapp-float/whatsapp-float.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Navbar, Footer, WhatsappFloatComponent],
  template: `
    @if (showChrome()) {
      <app-navbar />
    }
    <main>
      <router-outlet />
    </main>
    @if (showChrome()) {
      <app-footer />
      <app-whatsapp-float />
    }
  `,
  styles: [`
    main { min-height: 100vh; }
  `]
})
export class App {
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
