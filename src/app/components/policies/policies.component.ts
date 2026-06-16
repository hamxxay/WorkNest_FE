import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

interface PolicySection {
  heading: string;
  content: string;
}

interface Policy {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: PolicySection[];
}

const POLICIES: Record<string, Policy> = {
  'service-policy': {
    title: 'Service Policy',
    lastUpdated: 'January 2025',
    intro: 'This Service Policy outlines the standards, expectations, and responsibilities governing the use of WorkNest coworking spaces and facilities in Pakistan.',
    sections: [
      {
        heading: 'Workspace Usage',
        content: 'All members must use the workspace in a professional and respectful manner. WorkNest reserves the right to revoke access to any member who disrupts other members or violates workplace conduct standards as outlined under the Pakistan Penal Code and professional norms.'
      },
      {
        heading: 'Operating Hours',
        content: 'Standard operating hours are Monday to Saturday, 9:00 AM to 9:00 PM PKT. Access outside these hours may be available for premium members subject to availability and prior arrangement with management.'
      },
      {
        heading: 'Booking & Reservations',
        content: 'Spaces must be booked in advance via the WorkNest platform. Walk-in availability is not guaranteed. Bookings are confirmed only upon receipt of payment. WorkNest reserves the right to cancel unconfirmed bookings.'
      }
    ]
  },
  'pricing-policy': {
    title: 'Pricing Policy',
    lastUpdated: 'January 2025',
    intro: 'This Pricing Policy explains how WorkNest sets, communicates, and applies pricing for its workspace services in Pakistan.',
    sections: [
      {
        heading: 'Currency & Taxes',
        content: 'All prices are listed in Pakistani Rupees (PKR) and are inclusive of applicable taxes including General Sales Tax (GST) as required under the Federal Board of Revenue (FBR) regulations unless stated otherwise.'
      },
      {
        heading: 'Pricing Structure',
        content: 'WorkNest offers hourly, daily, and monthly pricing plans. Prices are displayed on the platform and are subject to change with 30 days\' prior notice to existing members.'
      }
    ]
  },
  'refund-policy': {
    title: 'Refund & Return Policy',
    lastUpdated: 'January 2025',
    intro: 'This Refund & Return Policy outlines the conditions under which WorkNest will process refunds for bookings and services, in compliance with Pakistani consumer protection standards.',
    sections: [
      {
        heading: 'Cancellation & Refund Window',
        content: 'Bookings cancelled at least 48 hours before the start time are eligible for a full refund. Cancellations made 24–48 hours prior are eligible for a 50% refund.'
      }
    ]
  },
  'privacy-policy': {
    title: 'Privacy Policy',
    lastUpdated: 'January 2025',
    intro: 'This Privacy Policy describes how WorkNest collects, uses, and protects your personal information in accordance with Pakistani data protection principles and applicable laws.',
    sections: [
      {
        heading: 'Information We Collect',
        content: 'We collect information you provide during registration including name, email address, phone number, and payment details.'
      }
    ]
  },
  'terms-and-conditions': {
    title: 'Terms & Conditions',
    lastUpdated: 'January 2025',
    intro: 'These Terms & Conditions govern your use of the WorkNest platform and workspace services.',
    sections: [
      {
        heading: 'Acceptance of Terms',
        content: 'By accessing or using WorkNest services, you confirm that you are at least 18 years of age and accept these Terms & Conditions in full.'
      }
    ]
  }
};

@Component({
  selector: 'app-policies',
  imports: [RouterLink],
  template: `
    <section class="page-hero">
      <div class="container text-center">
        <h1>{{ policy?.title }}</h1>
        <p class="hero-sub">Last updated: {{ policy?.lastUpdated }}</p>
      </div>
    </section>

    <section class="section">
      <div class="container policy-container">
        @if (policy) {
          <p class="policy-intro">{{ policy.intro }}</p>
          @for (s of policy.sections; track s.heading) {
            <div class="policy-section">
              <h3>{{ s.heading }}</h3>
              <p>{{ s.content }}</p>
            </div>
          }
          <div class="policy-contact">
            <p>Questions? Contact us at <a href="mailto:sales@worknestpk.com">sales&#64;worknestpk.com</a> or call <a href="tel:+923080256000">+92 308 0256000</a>.</p>
          </div>
        } @else {
          <p>Policy not found.</p>
        }
        <a routerLink="/" class="btn btn-outline" style="margin-top: 2rem;">← Back to Home</a>
      </div>
    </section>
  `,
  styles: [`
    .policy-container { max-width: 800px; margin: 0 auto; }
    .policy-intro { font-size: 1.05rem; color: var(--text-secondary); margin-bottom: 2rem; line-height: 1.7; }
    .policy-section { margin-bottom: 1.75rem; }
    .policy-section h3 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary); }
    .policy-section p { color: var(--text-secondary); line-height: 1.75; }
    .policy-contact { margin-top: 2.5rem; padding: 1.25rem; background: var(--bg-secondary); border-radius: 8px; }
    .policy-contact p { margin: 0; color: var(--text-secondary); }
    .policy-contact a { color: var(--primary); }
  `]
})
export class PoliciesComponent implements OnInit {
  policy: Policy | null = null;

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.route.params.subscribe(params => {
      this.policy = POLICIES[params['slug']] ?? null;
    });
  }
}