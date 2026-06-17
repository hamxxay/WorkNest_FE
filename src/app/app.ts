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
  private currentData: Data = {};

  constructor(
    private router: Router,
    private activated: ActivatedRoute
  ) {
    this.router.events
      .pipe(
        filter(e => e instanceof NavigationEnd),
        map(() => this.getDeepestData(this.activated.root))
      )
      .subscribe(data => {
        this.currentData = data;
      });
  }

  private getDeepestData(route: ActivatedRoute): Data {
    let res: Data = route.snapshot.data || {};
    if (route.firstChild) {
      const childData = this.getDeepestData(route.firstChild);
      res = { ...res, ...childData };
    }
    return res;
  }

  showChrome(): boolean {
    return this.currentData['layout'] !== 'admin';
  }
}
