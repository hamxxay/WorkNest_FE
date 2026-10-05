import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { HikDeviceService } from '../../../services/hik-device.service';
import { ToastService } from '../../../services/toast.service';
import { AuthService } from '../../../services/auth.service';
import { HikDevice, MergedBiometricUser, HikDeviceUser } from '../../../models/hik-device.model';

@Component({
  selector: 'app-biometric-users',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './biometric-users.html',
  styleUrl: './biometric-users.css'
})
export class BiometricUsers implements OnInit {
  private hikService = inject(HikDeviceService);
  private toastService = inject(ToastService);
  private auth = inject(AuthService);

  /** Machine-admin users are only shown to admin / super admin (the API also withholds them). */
  readonly canSeeMachineAdmins = this.auth.hasRole('admin') || this.auth.hasRole('super_admin');

  loading = signal<boolean>(true);
  refreshing = signal<boolean>(false);
  errorMessage = signal<string>('');

  devices = signal<HikDevice[]>([]);
  allMembers = signal<MergedBiometricUser[]>([]);
  nextEmployeeNo = signal<number | null>(null);

  // Filters
  searchQuery = signal<string>('');
  selectedMachineId = signal<string>('all');
  selectedStatus = signal<string>('all'); // all | active | expired | admin
  selectedRoom = signal<string>('all');

  // Pagination
  currentPage = signal<number>(1);
  pageSize = signal<number>(25);
  pageSizeOptions = [15, 25, 50, 100];

  // User details modal
  selectedUserModal = signal<MergedBiometricUser | null>(null);
  showDetailsModal = signal<boolean>(false);

  // Computed KPIs
  totalMembersCount = computed(() => this.allMembers().length);
  
  onlineDevicesCount = computed(() => {
    return this.devices().filter(d => d.online === 1 || d.online === true).length;
  });

  totalDevicesCount = computed(() => this.devices().length);

  adminMembersCount = computed(() => {
    return this.allMembers().filter(m => m.isAdmin).length;
  });

  expiredMembersCount = computed(() => {
    return this.allMembers().filter(m => m.isExpired || m.isBlocked).length;
  });

  // Distinct room list for dropdown: booked spaces (e.g. "Office 336") and machine rooms ("Room 336")
  distinctRooms = computed(() => {
    const set = new Set<string>();
    for (const m of this.allMembers()) {
      for (const r of m.roomLabels) {
        if (r) set.add(r);
      }
    }
    const num = (s: string) => Number((s.match(/\d+/) || [''])[0]) || Infinity;
    return Array.from(set).sort((a, b) => num(a) - num(b) || a.localeCompare(b));
  });

  distinctTags = computed(() =>
    Array.from(new Set(this.allMembers().map(m => m.tag).filter((t): t is string => !!t))).sort());

  // Filtered members
  filteredMembers = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const machineId = this.selectedMachineId();
    const status = this.selectedStatus();
    const room = this.selectedRoom();

    return this.allMembers().filter(m => {
      // Machine filter
      if (machineId !== 'all') {
        const matchesMachine = m.devices.some(d => String(d.id) === machineId);
        if (!matchesMachine) return false;
      }

      // Status filter
      if (status === 'admin' && !m.isAdmin) return false;
      if (status === 'expired' && !m.isExpired && !m.isBlocked) return false;
      if (status === 'active' && (m.isExpired || m.isBlocked)) return false;

      // Room filter (booked room / machine room), staff tag, or no booking
      if (room === 'staff' && !m.tag) return false;
      if (room === 'none' && (m.bookedRooms.length || m.tag)) return false;
      if (room.startsWith('tag:') && m.tag !== room.slice(4)) return false;
      if (room !== 'all' && room !== 'staff' && room !== 'none' && !room.startsWith('tag:') && !m.roomLabels.includes(room)) return false;

      // Text search
      if (q) {
        const roomTerms = m.rooms.map(r => `room ${r}`).join(' ');
        const deviceNames = m.devices.map(d => d.name).join(' ');
        const booked = m.bookedRooms.map(b => `${b.space} ${b.customer || ''}`).join(' ');
        const searchPool = `${m.name} ${m.employeeNo} ${m.cnic} ${roomTerms} ${booked} ${m.tag || ''} ${deviceNames}`.toLowerCase();
        if (!searchPool.includes(q)) return false;
      }

      return true;
    });
  });

  // Paginated display
  totalPages = computed(() => Math.max(1, Math.ceil(this.filteredMembers().length / this.pageSize())));
  
  paginatedMembers = computed(() => {
    const filtered = this.filteredMembers();
    const page = this.currentPage();
    const size = this.pageSize();
    const start = (page - 1) * size;
    return filtered.slice(start, start + size);
  });

  ngOnInit() {
    this.loadData();
    this.loadNextEmployeeNo();
  }

  loadData(isRefresh = false) {
    if (isRefresh) {
      this.refreshing.set(true);
    } else {
      this.loading.set(true);
    }
    this.errorMessage.set('');

    forkJoin({
      devices: this.hikService.getDevices(),
      roster: this.hikService.getRoster()
    }).subscribe({
      next: ({ devices, roster }) => {
        this.devices.set(devices || []);
        this.processRosterData(devices || [], roster);
        this.loading.set(false);
        this.refreshing.set(false);
        if (isRefresh) {
          this.toastService.success('Biometric roster refreshed successfully');
        }
      },
      error: (err) => {
        console.error('Error fetching biometric data:', err);
        this.errorMessage.set(err?.error?.message || err?.message || 'Failed to load biometric roster');
        this.loading.set(false);
        this.refreshing.set(false);
        this.toastService.error('Failed to fetch biometric machines and roster');
      }
    });
  }

  loadNextEmployeeNo() {
    this.hikService.getNextEmployeeNo().subscribe({
      next: (res) => {
        if (res?.ok && res.next) {
          this.nextEmployeeNo.set(res.next);
        }
      },
      error: (err) => console.warn('Could not retrieve next employee no', err)
    });
  }

  private isRoomDevice(d: HikDevice): boolean {
    return !!d.code && !String(d.grp || '').trim().toLowerCase().startsWith('entrance');
  }

  private processRosterData(devices: HikDevice[], roster: any) {
    const cnics: Record<string, string> = roster?.cnics || {};
    const bookings: Record<string, any[]> = roster?.bookings || {};
    const tags: Record<string, string> = roster?.tags || {};
    const rostersList = roster?.rosters || [];

    const deviceMap = new Map<number, HikDevice>(devices.map(d => [d.id, d]));
    const memberMap = new Map<string, { u: HikDeviceUser; on: HikDevice[] }>();

    for (const r of rostersList) {
      if (!r.ok || !r.users) continue;
      const dev = deviceMap.get(r.device_id);
      if (!dev) continue;

      const userArray: HikDeviceUser[] = Array.isArray(r.users) ? r.users : [];
      for (const u of userArray) {
        if (!u.employeeNo && !u.name) continue;
        const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
        if (!memberMap.has(key)) {
          memberMap.set(key, { u, on: [] });
        }
        memberMap.get(key)!.on.push(dev);
      }
    }

    const totalDevCount = devices.length;

    const rank = (e: { u: HikDeviceUser; on: HikDevice[] }): number => {
      if (e.u.localUIRight === 1 || e.u.localUIRight === true) return 0;
      if (totalDevCount > 1 && e.on.length >= totalDevCount) return 1;
      return 2;
    };

    const roomScore = (e: { u: HikDeviceUser; on: HikDevice[] }): number => {
      const nums = e.on.filter(d => this.isRoomDevice(d)).map(d => Number(d.code)).filter(Number.isFinite);
      return nums.length ? Math.min(...nums) : Infinity;
    };

    const sortedEntries = [...memberMap.values()].sort((a, b) => {
      const rDiff = rank(a) - rank(b);
      if (rDiff !== 0) return rDiff;

      const roomDiff = roomScore(a) - roomScore(b);
      if (roomDiff !== 0) return roomDiff;

      return (Number(a.u.employeeNo) || 0) - (Number(b.u.employeeNo) || 0);
    });

    const now = new Date();

    const mergedList: MergedBiometricUser[] = sortedEntries.map(({ u, on }) => {
      const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
      const cnic = cnics[key] || '';
      
      const rooms = on
        .filter(d => this.isRoomDevice(d))
        .map(d => String(d.code))
        .filter((val, idx, arr) => arr.indexOf(val) === idx)
        .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));

      const isBlocked = u.Valid?.enable === false;
      const endTimeStr = u.Valid?.endTime ? String(u.Valid.endTime).replace('T', ' ').slice(0, 16) : null;
      const isExpired = !!(u.Valid?.endTime && new Date(u.Valid.endTime) <= now);
      const isAdmin = u.localUIRight === 1 || u.localUIRight === true;
      const bookedRooms = bookings[u.employeeNo || ''] || [];
      const tag = tags[u.employeeNo || ''] || null;
      const roomLabels = bookedRooms.length
        ? bookedRooms.map(b => b.space).filter((v, i, a) => !!v && a.indexOf(v) === i)
        : rooms.map(r => `Room ${r}`);

      return {
        key,
        employeeNo: u.employeeNo || '—',
        name: u.name?.trim() || 'Unknown',
        cnic,
        isAdmin,
        rooms,
        bookedRooms,
        tag,
        roomLabels,
        devices: on,
        validUntil: endTimeStr,
        isExpired,
        isBlocked,
        numOfCard: u.numOfCard || 0,
        numOfFP: u.numOfFP || 0,
        numOfFace: u.numOfFace || 0,
        rawUser: u
      };
    });

    this.allMembers.set(mergedList);
    this.currentPage.set(1);
  }

  onSearchChange() {
    this.currentPage.set(1);
  }

  onFilterChange() {
    this.currentPage.set(1);
  }

  setPage(page: number) {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  onPageSizeChange(event: any) {
    this.pageSize.set(Number(event.target.value));
    this.currentPage.set(1);
  }

  openUserDetails(member: MergedBiometricUser) {
    this.selectedUserModal.set(member);
    this.showDetailsModal.set(true);
  }

  closeUserDetails() {
    this.showDetailsModal.set(false);
    this.selectedUserModal.set(null);
  }

  copyToClipboard(text: string, label: string) {
    if (!text || text === '—') return;
    navigator.clipboard.writeText(text).then(() => {
      this.toastService.success(`Copied ${label} to clipboard`);
    }).catch(() => {
      this.toastService.error('Could not copy to clipboard');
    });
  }

  getInitials(name: string): string {
    if (!name || name === 'Unknown') return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  getDeviceTooltip(devices: HikDevice[]): string {
    return devices.map(d => d.name).join('\n');
  }

  getRoomsTooltip(rooms: string[]): string {
    return rooms.map(r => `Room ${r}`).join(', ');
  }
}
