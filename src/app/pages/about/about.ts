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
}
