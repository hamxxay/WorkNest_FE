import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PricingService } from '../../services/pricing.service';

interface Plan {
  id: number;
  name: string;
  price: number;
  description: string;
  features: string[];
  popular: boolean;
  cta: string;
}

interface Faq {
  question: string;
  answer: string;
  open: boolean;
}

@Component({
  selector: 'app-pricing',
  imports: [RouterLink],
  templateUrl: './pricing.html',
  styleUrl: './pricing.css'
})
export class Pricing implements OnInit {
  plans: Plan[] = [];
  loading = true;

  faqs: Faq[] = [
    {
      question: 'Can I switch plans at any time?',
      answer: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle.',
      open: false
    },
    {
      question: 'Are there any long-term commitments?',
      answer: 'No, all our plans are month-to-month with no long-term contracts. You can cancel anytime.',
      open: false
    },
    {
      question: 'Can I bring guests to the workspace?',
      answer: 'Standard and Premium members can bring guests for a day pass fee. Executive members receive 5 complimentary guest passes per month.',
      open: false
    },
    {
      question: 'Do you offer team or enterprise pricing?',
      answer: 'Yes, we offer custom pricing for teams of 5 or more. Contact our sales team to discuss your needs.',
      open: false
    }
  ];

  constructor(private pricingService: PricingService) {}

  ngOnInit() {
    this.pricingService.getActivePlans().subscribe({
      next: (res) => {
        if (res.isSuccessful && res.data) {
          this.plans = res.data.map((plan: any) => ({
            id: plan.id,
            name: plan.name,
            price: plan.price,
            description: plan.description,
            features: plan.features?.map((f: any) => f.featureName) || [],
            popular: plan.name === 'Premium',
            cta: plan.name === 'Premium' ? 'Start Free Trial' : plan.name === 'Executive' ? 'Contact Sales' : 'Get Started'
          }));
        }
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  toggleFaq(index: number) {
    this.faqs[index].open = !this.faqs[index].open;
  }
}
