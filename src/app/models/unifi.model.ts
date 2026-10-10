// UniFi network dashboard — response shapes of the `${apiUrl}/unifi/*` endpoints.
// Timestamps: ISO strings where the API reports them that way (summary, ISP metrics),
// epoch milliseconds everywhere else (console reports, logs).

// ============= /unifi/summary, /unifi/refresh =============

export interface UnifiSiteWan {
  key: string;
  label: string;            // WAN1 / WAN2 …
  isp: string;
  organization: string;
  externalIp: string;
  up: boolean;
  uptime: number | null;    // % over 24h
  priority: number | null;  // 1 = primary
  issues: number;
  port: number | null;
  speed: string;
  enabled: boolean;
}

export interface UnifiSite {
  id: string;
  hostId: string;
  name: string;
  console: string;
  consoleVersion: string;
  wifiClients: number;
  wiredClients: number;
  guestClients: number;
  totalDevices: number;
  offlineDevices: number;
  pendingUpdates: number;
  criticalNotifications: number;
  wanUptime: number | null;
  txRetry: number | null;
  isp: string;
  gateway: string;
  ipsMode: string;
  loadBalancing: string;
  wans: UnifiSiteWan[];
}

export interface UnifiDevice {
  id: string;
  name: string;
  model: string;
  productLine: string;
  type: string;             // 'Access point' | 'Switch' | 'Console / Gateway' | …
  ip: string;
  mac: string;
  status: string;           // 'online' | 'offline' | 'not installed' | …
  placeholder: boolean;
  version: string;
  updateAvailable: string | boolean | null;
  hostId: string;
  host: string;
  isConsole: boolean;
  startupTime: string | null;
}

export interface UnifiIspPoint {
  t: string;
  latency: number | null;
  maxLatency: number | null;
  down: number | null;      // Mbps
  up: number | null;
  loss: number | null;
  uptime: number | null;
  isp: string;
}

export interface UnifiIspSeries {
  siteId: string;
  hostId: string;
  name: string;
  points: UnifiIspPoint[];
}

export interface UnifiHistoryPoint {
  t: string;
  wifi: number;
  wired: number;
  guest: number;
  online: number;
  offline: number;
  sites?: Record<string, [number, number, number]>;
}

export type UnifiAlertLevel = 'critical' | 'serious' | 'warning';

export interface UnifiAlert {
  level: UnifiAlertLevel;
  text: string;
  where: string;
}

export interface UnifiSummary {
  updatedAt: string | null;
  ispUpdatedAt: string | null;
  refreshSeconds: number;
  error: string | null;
  sites: UnifiSite[];
  devices: UnifiDevice[];
  isp: UnifiIspSeries[];
  history: UnifiHistoryPoint[];
  alerts: UnifiAlert[];
}

// ============= /unifi/clients =============

export type UnifiClientKind = 'phone' | 'computer' | 'tablet' | 'printer' | 'tv' | 'camera' | 'access' | 'network' | 'iot' | 'other';

export interface UnifiClient {
  mac: string;
  macDisplay: string;
  name: string;
  alias: string;
  unifiName: string;
  kind: UnifiClientKind;
  kindLabel: string;
  privateMac: boolean;
  hostname: string;
  vendor: string;
  ip: string;
  wired: boolean;
  guest: boolean;
  network: string;
  vlan: number | null;
  ssid: string;
  uplinkMac: string;
  uplinkName: string;
  port: number | null;
  signal: number | null;    // dBm
  band: string;
  channel: number | null;
  txRate: number | null;    // Mbps
  rxRate: number | null;
  experience: number | null;
  uptime: number | null;    // seconds
  dataBytes: number;
  firstSeen: number | null;
}

export interface UnifiClientsResponse {
  clients: UnifiClient[];
  devices: { mac: string; name: string; type: string }[];
}

// ============= /unifi/topology =============

export interface UnifiTopologyNode {
  mac: string;
  name: string;
  model: string;
  type: string;
  kind: string;
  status: string;
  placeholder?: boolean;
  virtual?: boolean;
  clients: number;
  uplinkMac: string;
  uplinkPort?: number | null;
  uplinkUnknown?: boolean;
  speed?: number | null;
}

export interface UnifiTopology {
  nodes: UnifiTopologyNode[];
}

// ============= /unifi/wans =============

export interface UnifiSpeedtestResult {
  down: number;
  up: number;
  ping: number | null;
  at: number;
  server?: string;
  count?: number;
}

export interface UnifiTrafficPoint {
  t: number;
  down: number | null;      // Mbps
  up: number | null;
}

export interface UnifiWanLive {
  key: string;
  ifname: string;
  up: boolean;
  linkSpeed: number | null; // Mbps
  downRate: number | null;  // bytes/s
  upRate: number | null;
  latency: number | null;
  availability: number | null;
  downTotal: number | null;
  upTotal: number | null;
  speedtest: UnifiSpeedtestResult | null;
  history: UnifiTrafficPoint[];
}

export interface UnifiWansResponse {
  wans: UnifiWanLive[];
}

// ============= /unifi/wan-traffic, /unifi/device/{mac}/history =============

export interface UnifiDeviceHistoryPoint {
  t: number;
  clients: number | null;
  down: number | null;      // Mbps
  up: number | null;
  cpu: number | null;
  mem: number | null;
}

export interface UnifiDeviceHistory {
  kind: 'ap' | 'sw' | 'gw' | '';
  points: UnifiDeviceHistoryPoint[];
}

// ============= /unifi/speedtest =============

export interface UnifiSpeedtestStart {
  wan: string;
  ifname: string;
  startedAt: number;
}

export interface UnifiSpeedtestStatus {
  running: boolean;
  wan?: string;
  elapsed?: number;
  result?: { down: number; up: number; ping: number; server: string; interface: string } | null;
  timedOut?: boolean;
}

// ============= /unifi/isp =============

export interface UnifiWanBuckets {
  t: number;
  secs: number;
  wans: Record<string, { down: number; up: number }>;
}

export interface UnifiIspWan {
  key: string;
  isp: string;
  organization: string;
  priority: number | null;
  up: boolean;
  ifname: string;
  linkSpeed: number | null;
  availability: number | null;
  latency: number | null;
  connectedFor: number | null;
  downtimeSec: number | null;
  tests: {
    count: number;
    latest: { down: number; up: number; ping: number; at: number } | null;
    avgDown: number | null;
    avgUp: number | null;
    avgPing: number | null;
    bestDown: number | null;
    history: { t: number; down: number; up: number; ping: number }[];
  };
  traffic7d: { down: number; up: number };
  traffic30d: { down: number; up: number };
}

export interface UnifiFailoverEpisode {
  from: number;
  to: number;
  via: string[];
}

export interface UnifiIspResponse {
  gatewayUptime: number | null;
  failoverSeconds: number | null;
  mode: string;
  wans: UnifiIspWan[];
  episodes: UnifiFailoverEpisode[];
  hourly: UnifiWanBuckets[];
  daily: UnifiWanBuckets[];
}

// ============= /unifi/wifi =============

export interface UnifiWifiRadio {
  band: string;
  channel: number | null;
  width: number | null;
  txPower: number | null;
  utilization: number | null;
  interference: number | null;
  retries: number | null;
  clients: number;
  satisfaction: number | null;
}

export interface UnifiWifiAp {
  mac: string;
  name: string;
  model: string;
  status: string;
  placeholder: boolean;
  clients: number;
  satisfaction: number | null;
  uptime: number | null;
  radios: UnifiWifiRadio[];
  history: { t: number; clients: number; satisfaction: number | null; retries: number | null; bytes: number }[];
}

export interface UnifiWifiResponse {
  aps: UnifiWifiAp[];
}

// ============= /unifi/client-usage, /unifi/usage =============

export interface UnifiUsageRow {
  t: number;
  down: number;             // bytes
  up: number;
}

export interface UnifiClientUsage {
  daily: UnifiUsageRow[];
  hourly: UnifiUsageRow[];
}

export interface UnifiTopUsageClient {
  mac: string;
  name: string;
  kind: UnifiClientKind;
  kindLabel: string;
  wired: boolean;
  online: boolean;
  down: number;
  up: number;
  total: number;
}

export interface UnifiTopUsage {
  days: number;
  clients: UnifiTopUsageClient[];
}

// ============= /unifi/logs, /unifi/device/{mac} =============

export interface UnifiLog {
  id: string;
  t: number;
  event: string;
  conn: 'up' | 'down' | null;
  title: string;
  message: string;
  severity: string;
  category: string;
  macs: string[];
}

export interface UnifiNetRadio {
  band: string;
  channel: number | null;
  width: number | null;
  txPower: number | null;
  utilization: number | null;
  clients: number;
  retries: number | null;
  satisfaction: number | null;
}

export interface UnifiNetPort {
  idx: number;
  name: string;
  up: boolean;
  enabled: boolean;
  speed: number | null;
  media: string;
  uplink: boolean;
  poe: number | null;
  txRate: number | null;
  rxRate: number | null;
  txBytes: number | null;
  rxBytes: number | null;
  errors: number;
}

export interface UnifiNetDevice {
  mac: string;
  macDisplay: string;
  name: string;
  model: string;
  kind: string;             // uap / usw / udm …
  type: string;
  ip: string;
  version: string;
  upgradeTo: string | null;
  status: string;
  placeholder: boolean;
  uptime: number | null;
  cpu: number | null;
  mem: number | null;
  temps: { name: string; value: number }[];
  clients: number;
  satisfaction: number | null;
  txRate: number | null;    // bytes/s
  rxRate: number | null;
  uplink: { mac: string; name: string; port: number | null; speed: number | null; type: string } | null;
  serial: string;
  lastSeen: number | null;
  radios: UnifiNetRadio[];
  ports: UnifiNetPort[];
}

export interface UnifiDeviceDetail {
  device: UnifiNetDevice;
  clients: UnifiClient[];
  logs: UnifiLog[];
  uplinkMac?: string;
}

// ============= /unifi/config, /unifi/alias =============

export interface UnifiConfig {
  brand: string;
  logo: string;
}

export interface UnifiAliasResult {
  mac: string;
  name: string;
}

/** One Wi-Fi network (UniFi WLAN) with its per-SSID MAC filter and the clients on it right now. */
export interface UnifiSsid {
  id: string;
  name: string;
  enabled: boolean;
  hidden: boolean;
  guest: boolean;
  security: string;
  bands: string[];
  filterEnabled: boolean;
  /** off = no filter; allow = only listed MACs may join; deny = listed MACs are blocked. */
  filterPolicy: 'off' | 'allow' | 'deny';
  macList: string[];
  /** Name / room entered in WorkNest for each MAC on the list. */
  devices: { mac: string; name: string | null; roomNo: string | null }[];
  /** Speed limit for each device on this SSID (Mbps); null = no limit. */
  speedLimit: { downMbps: number | null; upMbps: number | null } | null;
  /** UniFi speed profile the SSID uses; null = Default (no limit). */
  speedProfile: { id: string; name: string } | null;
  clientCount: number;
  clients: UnifiClient[];
  /** Set when UniFi timed out and the change was confirmed by reading the SSID back. */
  confirmedAfterTimeout?: boolean;
}

export interface UnifiSsidsResponse {
  ssids: UnifiSsid[];
  activeCount: number;
  wifiClients: number;
}

export type UnifiMacFilterAction = 'add' | 'remove' | 'block' | 'unblock' | 'mode';
export type UnifiSsidLogAction = UnifiMacFilterAction | 'hide' | 'unhide' | 'speed';

export interface UnifiMacFilterLogEntry {
  id: number;
  at: string | null;
  wlanId: string;
  ssid: string;
  mac: string | null;
  action: UnifiSsidLogAction;
  policy: string | null;
  reason: string | null;
  by: string | null;
}

/** Which WorkNest locations the UniFi network belongs to, and whether the current user may see it. */
export interface UnifiScope {
  locationIds: number[];
  allowed: boolean;
  canEdit: boolean;
}

/** UniFi speed profile (user group): per-device speeds, and the SSIDs using it. */
export interface UnifiSpeedProfile {
  id: string;
  name: string;
  downMbps: number | null;
  upMbps: number | null;
  ssids: string[];
  /** Set when UniFi timed out and the profile was found by reading the list back. */
  confirmedAfterTimeout?: boolean;
}
