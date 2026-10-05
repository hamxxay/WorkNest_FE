export interface HikDevice {
  id: number;
  name: string;
  grp?: string | null;
  code?: string | null;
  location?: string | null;
  online?: number | boolean;
  last_seen?: string | null;
}

export interface HikDeviceUserValid {
  enable?: boolean;
  beginTime?: string;
  endTime?: string;
  timeType?: string;
}

export interface HikDeviceUser {
  employeeNo: string;
  name?: string;
  userType?: string;
  closeDelay?: number;
  localUIRight?: boolean | number;
  maxOpenDoorTime?: number;
  Valid?: HikDeviceUserValid;
  belongGroup?: string;
  password?: string;
  doorRight?: string;
  RightPlan?: any[];
  numOfCard?: number;
  numOfFP?: number;
  numOfFace?: number;
}

export interface HikDeviceRosterItem {
  device_id: number;
  ok: boolean;
  error?: string;
  users?: HikDeviceUser[];
}

export interface HikBookedRoom {
  space: string;
  space_code?: string | null;
  customer?: string | null;
  booking_end?: string | null;
}

export interface HikRosterResponse {
  ok: boolean;
  rosters: HikDeviceRosterItem[];
  cnics: Record<string, string>;
  /** employeeNo → active booked rooms (attendants enrolled from Attendants & Access). */
  bookings?: Record<string, HikBookedRoom[]>;
  /** employeeNo → job tag (staff). */
  tags?: Record<string, string>;
}

export interface MergedBiometricUser {
  key: string;
  employeeNo: string;
  name: string;
  cnic: string;
  isAdmin: boolean;
  rooms: string[];
  /** Active bookings this person is enrolled against (from Attendants & Access). */
  bookedRooms: HikBookedRoom[];
  /** Job tag for staff (Janitor, Office Boy, …). */
  tag: string | null;
  /** Labels used by the room filter: booked space names, else "Room <code>" of their room machines. */
  roomLabels: string[];
  devices: HikDevice[];
  validUntil: string | null;
  isExpired: boolean;
  isBlocked: boolean;
  numOfCard: number;
  numOfFP: number;
  numOfFace: number;
  rawUser: HikDeviceUser;
}

// ── Access Dashboard / Activity Log / Analytics ──────────────────────────────
// Times are the terminal's local wall-clock ("YYYY-MM-DDTHH:mm:ss", no timezone).

export type HikAccessMethod = 'fingerprint' | 'face' | 'card' | 'door' | 'remote' | 'other';

export interface HikAccessEvent {
  id: number;
  deviceId: number;
  device?: string | null;
  employeeNo?: string | null;
  name?: string | null;
  cardNo?: string | null;
  eventCode?: number | null;
  label: string;
  isDenied: boolean;
  method: HikAccessMethod;
  time?: string | null;
}

export interface HikSyncActivity {
  id: number;
  action?: string | null;
  ok: boolean;
  detail?: string | null;
  time?: string | null;
  employeeName?: string | null;
  deviceName?: string | null;
}

export interface HikExpiringMember {
  employeeNo?: string | null;
  name?: string | null;
  validEnd?: string | null;
  status: 'expired' | 'expiring';
  devices: string[];
}

export interface HikAccessStats {
  devices: number;
  devicesOnline: number;
  activeMembers: number;
  expiredMembers: number;
  cards: number;
  pendingSync: number;
  todayScans: number;
  yesterdayScans: number;
  trendPct: number;
  uniqueToday: number;
  deniedToday: number;
}

export interface HikAccessDashboard {
  stats: HikAccessStats;
  devices: HikDevice[];
  hourlyToday: number[];
  peakHourLabel: string;
  peakHourCount: number;
  lastEvent?: HikAccessEvent | null;
  recentEvents: HikAccessEvent[];
  expiring: HikExpiringMember[];
  expiringHorizonDays: number;
}

export interface HikCountItem {
  name: string;
  employeeNo?: string | null;
  count: number;
  percent: number;
}

export interface HikAccessAnalytics {
  from: string;
  to: string;
  totalEvents: number;
  uniquePeople: number;
  denied: number;
  hourly: number[];
  peakHourLabel: string;
  peakHourCount: number;
  daily: { date: string; count: number }[];
  doors: HikCountItem[];
  topUsers: HikCountItem[];
  methods: { fingerprint: number; face: number; card: number; door: number; other: number };
  devicesCount: number;
  devicesOnline: number;
}

export interface HikUserAnalytics {
  employeeNo?: string | null;
  name?: string | null;
  room?: string | null;
  cardNo?: string | null;
  status?: string | null;
  validEnd?: string | null;
  totalScans: number;
  allTimeScans: number;
  firstScan?: string | null;
  lastScan?: string | null;
  peakHourLabel: string;
  hourly: number[];
  doors: HikCountItem[];
  recentEvents: HikAccessEvent[];
}

// ── Staff Access (janitors, office boys, … — machine users with a job tag, no booking) ──

export interface HikStaffMachine {
  deviceId: number;
  name: string;
  grp?: string | null;
  code?: string | null;
  online: boolean;
}

export interface HikStaff {
  employeeNo: string;
  name: string;
  cnic?: string | null;
  tagId?: number | null;
  tag?: string | null;
  enabled: boolean;
  validEnd?: string | null;
  cards: number;
  fingerprints: number;
  faces: number;
  pendingOps: number;
  machines: HikStaffMachine[];
}

export interface HikTag {
  id: number;
  name: string;
}

export interface HikDeviceResult {
  deviceId: number;
  device: string;
  ok: boolean;
  queued: boolean;
  error?: string | null;
}

export interface HikStaffResult {
  ok: boolean;
  /** Machine ID — the person's number on the machines. */
  machineId?: string | null;
  error?: string | null;
  devices: HikDeviceResult[];
}
