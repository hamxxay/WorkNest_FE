import { Component } from '@angular/core';

@Component({
  selector: 'app-about',
  imports: [],
  templateUrl: './about.html',
  styleUrl: './about.css'
})
export class About {
  stats = [
    { value: '50+', label: 'Locations', icon: 'location' },
    { value: '10K+', label: 'Members', icon: 'members' },
    { value: '15', label: 'Cities', icon: 'globe' },
    { value: '98%', label: 'Satisfaction', icon: 'satisfaction' }
  ];

  values = [
    {
      icon: 'star',
      title: 'Excellence',
      description: 'We strive for excellence in every detail, from workspace design to customer service, ensuring our members have the best possible experience.'
    },
    {
      icon: 'users',
      title: 'Community',
      description: 'We believe in the power of community. Our spaces are designed to foster connections, collaboration, and meaningful professional relationships.'
    },
    {
      icon: 'heart',
      title: 'Care',
      description: 'We genuinely care about our members success. Every decision we make is guided by what will help our community thrive and grow.'
    }
  ];

  team = [
    { name: 'Adil Ameen', role: 'CEO & Founder', initials: 'AA' },
    { name: 'Shahzeb Mahmood', role: 'COO', initials: 'SM' },
  ];

  openFaq: number | null = null;

  faqs = [
    {
      q: 'What types of workspaces does WorkNest offer?',
      a: 'WorkNest offers private offices, hot desks, meeting rooms, and event spaces — all fully equipped with high-speed internet, ergonomic furniture, and premium amenities.'
    },
    {
      q: 'How do I book a workspace?',
      a: 'Simply create an account, browse available spaces, select your preferred dates and times, and confirm your booking in just a few clicks. You can also book a free tour first.'
    },
    {
      q: 'Are there flexible membership plans?',
      a: 'Yes! We offer monthly, quarterly, and yearly plans to suit every need — from freelancers who need a desk a few days a week to teams requiring dedicated offices full-time.'
    },
    {
      q: 'What amenities are included?',
      a: 'All spaces include high-speed Wi-Fi, printing access, complimentary tea/coffee, 24/7 security, reception services, and access to shared lounges and breakout areas.'
    },
    {
      q: 'Can I book a meeting room for a few hours?',
      a: 'Absolutely. Meeting rooms can be booked by the hour and are equipped with audio/visual setups, whiteboards, and seating for up to 10 people.'
    },
    {
      q: 'Where are your locations?',
      a: 'Our primary location is at 3rd Floor, EOBI Building-II, I-8 Markaz, Islamabad. We are actively expanding to more cities across Pakistan.'
    },
    {
      q: 'Is there a cancellation policy?',
      a: 'Yes. Bookings can be cancelled up to 24 hours before the start time for a full refund. Cancellations within 24 hours may be subject to a fee depending on the booking type.'
    }
  ];

  toggleFaq(index: number) {
    this.openFaq = this.openFaq === index ? null : index;
  }
}
