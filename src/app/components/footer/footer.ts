import { Component, AfterViewInit } from '@angular/core';
import { RouterLink } from '@angular/router';

declare var L: any;

@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  templateUrl: './footer.html',
  styleUrl: './footer.css'
})
export class Footer implements AfterViewInit {
  year = new Date().getFullYear();

  ngAfterViewInit() {
    if (typeof L === 'undefined') return;

    // Centre between F-7 and I-8
    const map = L.map('footer-map', {
      center: [33.694, 73.062],
      zoom: 12,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
    });

    // CartoDB Voyager — same clean look as Google Maps, no API key needed
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);

    // Reusable custom pin factory
    const pin = (color: string) =>
      L.divIcon({
        className: '',
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
          <path d="M14 0C6.27 0 0 6.27 0 14c0 9.8 14 26 14 26S28 23.8 28 14C28 6.27 21.73 0 14 0z"
            fill="${color}" stroke="#fff" stroke-width="1.5"
            style="filter:drop-shadow(0 2px 5px rgba(0,0,0,.35))"/>
          <circle cx="14" cy="14" r="6" fill="#fff"/>
        </svg>`,
        iconSize: [28, 40],
        iconAnchor: [14, 40],
        popupAnchor: [0, -42],
      });

    // ── F-7 Markaz ──────────────────────────────────────────────
    L.marker([33.7192312, 73.0544084], { icon: pin('#4f46e5') })
      .addTo(map)
      .bindPopup(
        `<div style="font-family:Inter,sans-serif;line-height:1.5">
          <b style="color:#4f46e5">WorkNest — F-7 Markaz</b><br>
          <span style="font-size:12px;color:#666">F-7 Markaz, Islamabad</span><br>
          <a href="https://www.google.com/maps/@33.7192312,73.0544084,21z"
             target="_blank" style="font-size:11px;color:#4f46e5;text-decoration:none">
            Open in Google Maps ↗
          </a>
        </div>`,
        { maxWidth: 180 }
      );

    // ── I-8 Markaz — EOBI Building 2 ───────────────────────────
    L.marker([33.668563, 73.0737923], { icon: pin('#e11d48') })
      .addTo(map)
      .bindPopup(
        `<div style="font-family:Inter,sans-serif;line-height:1.5">
          <b style="color:#e11d48">WorkNest — I-8 Markaz</b><br>
          <span style="font-size:12px;color:#666">EOBI Building 2, I-8 Markaz</span><br>
          <a href="https://www.google.com/maps/place/EOBI+Building+2/@33.6684549,73.0732797,19z"
             target="_blank" style="font-size:11px;color:#e11d48;text-decoration:none">
            Open in Google Maps ↗
          </a>
        </div>`,
        { maxWidth: 180 }
      );

    // Auto-fit to show both pins with padding
    map.fitBounds(
      [[33.7192312, 73.0544084], [33.668563, 73.0737923]],
      { padding: [32, 32] }
    );
  }
}
