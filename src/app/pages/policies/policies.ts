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
      },
      {
        heading: 'Guest Policy',
        content: 'Members may bring guests into the workspace for meetings. Guests must be registered at reception. WorkNest is not liable for any loss, damage, or injury caused by or to guests. Guests must comply with all workspace rules.'
      },
      {
        heading: 'Liability',
        content: 'WorkNest is not responsible for loss or damage to personal property. Members are encouraged to secure their belongings at all times. WorkNest\'s liability is limited to the amount paid for the current booking period in accordance with Pakistani contract law.'
      },
      {
        heading: 'Compliance with Pakistani Law',
        content: 'All members must comply with applicable Pakistani laws including but not limited to the Pakistan Electronic Crimes Act (PECA) 2016, the Companies Act 2017, and all relevant federal and provincial legislation while using WorkNest facilities.'
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
        content: 'WorkNest offers hourly, daily, and monthly pricing plans. Prices are displayed on the platform and are subject to change with 30 days\' prior notice to existing members. New pricing applies to new bookings made after the effective date.'
      },
      {
        heading: 'Discounts & Promotions',
        content: 'Loyalty discounts are applied automatically based on total booked days. Promotional offers are time-limited and cannot be combined with other discounts unless explicitly stated. WorkNest reserves the right to modify or withdraw promotions at any time.'
      },
      {
        heading: 'Payment Methods',
        content: 'WorkNest accepts payment via debit/credit card, bank transfer, 1Bill voucher, and cash at counter. All electronic payments are processed securely. WorkNest does not store card information on its servers.'
      },
      {
        heading: 'Invoicing',
        content: 'Invoices are generated upon confirmed payment and are available in your account dashboard. For corporate billing requirements under Pakistan\'s tax laws, please contact our accounts team at sales@worknestpk.com.'
      },
      {
        heading: 'Price Disputes',
        content: 'Any pricing disputes must be raised within 7 days of the transaction. WorkNest will investigate and respond within 5 business days. Disputes are governed by Pakistani consumer protection laws.'
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
        content: 'Bookings cancelled at least 48 hours before the start time are eligible for a full refund. Cancellations made 24–48 hours prior are eligible for a 50% refund. Cancellations within 24 hours of the booking start time are non-refundable.'
      },
      {
        heading: 'No-Show Policy',
        content: 'If a member fails to arrive for a confirmed booking without prior cancellation, the booking amount is forfeited. WorkNest may, at its discretion, offer a credit for future bookings in exceptional circumstances.'
      },
      {
        heading: 'Service Failure Refunds',
        content: 'If WorkNest is unable to provide the booked space due to reasons within its control (e.g., facility closure, maintenance), a full refund or complimentary rescheduling will be offered at the member\'s choice.'
      },
      {
        heading: 'Refund Processing',
        content: 'Approved refunds are processed within 7–10 business days. Bank transfers and card refunds are subject to the processing timelines of the respective financial institutions operating under the State Bank of Pakistan (SBP) regulations.'
      },
      {
        heading: 'Non-Refundable Items',
        content: 'Administrative fees, membership activation fees, and promotional discount amounts are non-refundable. Partial use of a booked period does not entitle the member to a partial refund.'
      },
      {
        heading: 'Consumer Rights',
        content: 'This policy does not limit your statutory rights under the Consumer Protection Act applicable in your province (Punjab Consumer Protection Act 2005, KP Consumer Protection Act 2015, etc.).'
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
        content: 'We collect information you provide during registration including name, email address, phone number, and payment details. We also collect usage data such as booking history, login times, and device information to improve our services.'
      },
      {
        heading: 'How We Use Your Information',
        content: 'Your information is used to process bookings, send booking confirmations and invoices, provide customer support, improve our platform, and send relevant promotional communications (with your consent). We do not sell your data to third parties.'
      },
      {
        heading: 'Data Storage & Security',
        content: 'Your data is stored on secure servers. We implement industry-standard security measures including SSL encryption. However, no method of transmission over the internet is 100% secure. WorkNest complies with the Prevention of Electronic Crimes Act (PECA) 2016 regarding data security.'
      },
      {
        heading: 'CCTV & Surveillance',
        content: 'WorkNest premises are monitored by CCTV for security purposes as permitted under Pakistani law. Footage is retained for 30 days and may be shared with law enforcement authorities upon lawful request.'
      },
      {
        heading: 'Third-Party Services',
        content: 'We use third-party services including Firebase (Google) for authentication and payment processors for transactions. These services have their own privacy policies. We ensure all third parties comply with applicable data protection standards.'
      },
      {
        heading: 'Your Rights',
        content: 'You have the right to access, correct, or request deletion of your personal data. To exercise these rights, contact us at sales@worknestpk.com. We will respond within 14 business days.'
      },
      {
        heading: 'Cookies',
        content: 'Our platform uses cookies to maintain your session and improve user experience. You may disable cookies in your browser settings, though this may affect platform functionality.'
      }
    ]
  },
  'terms-and-conditions': {
    title: 'Terms & Conditions',
    lastUpdated: 'January 2025',
    intro: 'These Terms & Conditions govern your use of the WorkNest platform and workspace services. By creating an account or making a booking, you agree to these terms. These terms are governed by the laws of the Islamic Republic of Pakistan.',
    sections: [
      {
        heading: 'Acceptance of Terms',
        content: 'By accessing or using WorkNest services, you confirm that you are at least 18 years of age, have the legal capacity to enter into a binding agreement under Pakistani law, and accept these Terms & Conditions in full.'
      },
      {
        heading: 'Account Responsibility',
        content: 'You are responsible for maintaining the confidentiality of your account credentials. Any activity conducted through your account is your responsibility. Report any unauthorised access immediately to sales@worknestpk.com.'
      },
      {
        heading: 'Prohibited Conduct',
        content: 'Members must not use WorkNest facilities for any unlawful activity including activities prohibited under the Pakistan Penal Code, PECA 2016, or Anti-Money Laundering Act 2010. Any such activity will result in immediate termination and reporting to relevant authorities.'
      },
      {
        heading: 'Intellectual Property',
        content: 'All content on the WorkNest platform including logos, text, and software is the intellectual property of WorkNest and is protected under Pakistani copyright law. Unauthorised use is strictly prohibited.'
      },
      {
        heading: 'Limitation of Liability',
        content: 'WorkNest\'s total liability to any member for any claim arising from use of the service shall not exceed the amount paid by that member in the 30 days preceding the claim, to the extent permitted by Pakistani law.'
      },
      {
        heading: 'Termination',
        content: 'WorkNest reserves the right to suspend or terminate any account that violates these terms without prior notice. Members may terminate their account at any time by contacting support. Outstanding obligations survive termination.'
      },
      {
        heading: 'Amendments',
        content: 'WorkNest may update these Terms & Conditions at any time. Continued use of the platform after changes constitutes acceptance. Material changes will be communicated via email or platform notification with 15 days\' notice.'
      },
      {
        heading: 'Governing Law & Dispute Resolution',
        content: 'These terms are governed by the laws of Pakistan. Any disputes shall first be attempted to be resolved amicably. If unresolved, disputes shall be subject to the exclusive jurisdiction of the courts of Islamabad, Pakistan.'
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
            <p>Questions? Contact us at <a href="mailto:sales@worknestpk.com">sales&#64;worknestpk.com</a> or call <a href="tel:+92 309 9771774">+92 309 977 1774</a>.</p>
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
export class Policies implements OnInit {
  policy: Policy | null = null;

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.route.data.subscribe(data => {
      this.policy = POLICIES[data['slug']] ?? null;
    });
  }
}
