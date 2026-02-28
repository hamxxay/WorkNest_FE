import { Component, OnInit, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SpaceService } from '../../services/space.service';
import { BookingService } from '../../services/booking.service';

interface Workspace {
  id: number;
  name: string;
  locationName: string;
  spaceTypeName: string;
  capacity: number;
  amenities: string;
  pricePerDay: number;
  pricePerHour: number;
  status: string;
  imageUrl: string;
  floor: string;
  code: string;
}

@Component({
  selector: 'app-booking',
  imports: [FormsModule],
  templateUrl: './booking.html',
  styleUrl: './booking.css'
})
export class Booking implements OnInit {
  searchQuery = signal('');
  workspaceType = signal('');
  startDate = signal('');
  endDate = signal('');
  loading = signal(true);
  bookingInProgress = signal(false);
  bookingSuccess = signal('');
  bookingError = signal('');

  workspaces = signal<Workspace[]>([]);
  filteredWorkspaces = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const type = this.workspaceType().toLowerCase();
    return this.workspaces().filter(ws => {
      const matchesQuery = !query ||
        ws.name.toLowerCase().includes(query) ||
        ws.locationName.toLowerCase().includes(query);
      const matchesType = !type ||
        ws.spaceTypeName.toLowerCase().includes(type);
      return matchesQuery && matchesType;
    });
  });

  // Booking modal
  showBookingModal = false;
  selectedSpace: Workspace | null = null;
  bookingNotes = '';
  bookingStartDate = '';
  bookingStartTime = '09:00';
  bookingEndDate = '';
  bookingEndTime = '17:00';

  constructor(
    private spaceService: SpaceService,
    private bookingService: BookingService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadSpaces();
  }

  loadSpaces() {
    this.loading.set(true);
    this.spaceService.getAll().subscribe({
      next: (res) => {
        if (res.isSuccessful && res.data) {
          this.workspaces.set(res.data);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  filterWorkspaces() {
    // filtering is computed automatically by signals; this method exists only
    // for backwards compatibility with the template's search button.
    // accessing computed value triggers evaluation if needed.
    this.filteredWorkspaces();
  }

  getAmenities(amenities: string): string[] {
    if (!amenities) return [];
    return amenities.split(',').map(a => a.trim());
  }

  openBookingModal(ws: Workspace) {
    this.selectedSpace = ws;
    this.showBookingModal = true;
    this.bookingError.set('');
    this.bookingSuccess.set('');
    // Set default dates to today
    const today = new Date().toISOString().split('T')[0];
    this.bookingStartDate = today;
    this.bookingEndDate = today;
  }

  closeBookingModal() {
    this.showBookingModal = false;
    this.selectedSpace = null;
    this.bookingNotes = '';
  }

  submitBooking() {
    if (!this.selectedSpace || !this.bookingStartDate || !this.bookingEndDate) {
      this.bookingError.set('Please select start and end dates.');
      return;
    }

    const startDateTime = `${this.bookingStartDate}T${this.bookingStartTime}:00`;
    const endDateTime = `${this.bookingEndDate}T${this.bookingEndTime}:00`;

    if (new Date(endDateTime) <= new Date(startDateTime)) {
      this.bookingError.set('End date/time must be after start date/time.');
      return;
    }

    this.bookingInProgress.set(true);
    this.bookingError.set('');

    this.bookingService.create({
      spaceId: this.selectedSpace.id,
      startDateTime,
      endDateTime,
      notes: this.bookingNotes || null
    }).subscribe({
      next: (res) => {
        this.bookingInProgress.set(false);
        if (res.isSuccessful) {
          this.bookingSuccess.set('Booking created successfully!');
          setTimeout(() => {
            this.closeBookingModal();
            this.bookingSuccess.set('');
          }, 2000);
        } else {
          this.bookingError.set(res.message || 'Booking failed.');
        }
      },
      error: (err) => {
        this.bookingInProgress.set(false);
        this.bookingError.set(err.error?.message || 'Failed to create booking. Please try again.');
      }
    });
  }
}
