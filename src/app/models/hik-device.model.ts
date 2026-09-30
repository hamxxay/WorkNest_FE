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

export interface HikRosterResponse {
  ok: boolean;
  rosters: HikDeviceRosterItem[];
  cnics: Record<string, string>;
}

export interface MergedBiometricUser {
  key: string;
  employeeNo: string;
  name: string;
  cnic: string;
  isAdmin: boolean;
  rooms: string[];
  devices: HikDevice[];
  validUntil: string | null;
  isExpired: boolean;
  isBlocked: boolean;
  numOfCard: number;
  numOfFP: number;
  numOfFace: number;
  rawUser: HikDeviceUser;
}
