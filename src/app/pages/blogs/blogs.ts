import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-blogs',
  imports: [RouterLink],
  templateUrl: './blogs.html',
  styleUrl: './blogs.css'
})
export class Blogs {
  featuredPost = {
    category: 'Workspace Strategy',
    date: 'Apr 18, 2026',
    title: 'How to choose the right coworking plan for your work rhythm',
    excerpt: 'A practical guide to matching your schedule, meeting needs, and collaboration style with the workspace plan that actually fits.',
    image: 'images/spaces/creative-cowork.jpg',
    readTime: '6 min read'
  };

  posts = [
    {
      category: 'Productivity',
      date: 'Apr 10, 2026',
      title: 'Designing a workday that protects deep focus',
      excerpt: 'Simple routines for using shared spaces without losing the quiet blocks that move important work forward.',
      image: 'images/spaces/modern-office.jpg',
      readTime: '4 min read'
    },
    {
      category: 'Teams',
      date: 'Mar 28, 2026',
      title: 'When remote teams should meet in person',
      excerpt: 'The moments that deserve a room, a whiteboard, and a few hours of shared attention.',
      image: 'images/spaces/meeting-room.jpg',
      readTime: '5 min read'
    },
    {
      category: 'Community',
      date: 'Mar 16, 2026',
      title: 'Making useful connections in a coworking space',
      excerpt: 'A low-pressure approach to meeting people, trading ideas, and finding collaborators.',
      image: 'images/spaces/lounge.jpg',
      readTime: '3 min read'
    },
    {
      category: 'Startups',
      date: 'Mar 04, 2026',
      title: 'Why flexible offices help early teams stay nimble',
      excerpt: 'How founders can avoid fixed overhead while still giving the team a polished place to build.',
      image: 'images/spaces/board-room.jpg',
      readTime: '5 min read'
    },
    {
      category: 'Meetings',
      date: 'Feb 20, 2026',
      title: 'Better client meetings start before the invite',
      excerpt: 'Room setup, timing, and hospitality details that make client sessions feel calm and prepared.',
      image: 'images/gallery/meeting-pod.jpg',
      readTime: '4 min read'
    },
    {
      category: 'Wellbeing',
      date: 'Feb 08, 2026',
      title: 'Small workspace habits that prevent burnout',
      excerpt: 'Tiny changes to movement, breaks, and environment that make long workweeks easier to sustain.',
      image: 'images/gallery/cafe-break.jpg',
      readTime: '4 min read'
    }
  ];
}
