'use strict';

// ── Shared types for Fast Tech WA Manager main process ──────────────────────

export interface ValidationResult {
  ok: boolean;
  error?: string;
  data?: any;
}

export interface ServiceDeps {
  db: any;
  waApi: any;
  waSvc: any | null;
  engine: any;
  scraper: any | null;
  scheduler: any;
  aiSvc: any;
  excel: any;
  adapter: any;
  webhookSrv: any | null;
  antiBanSvc: any | null;
  seqSvc: any | null;
  ipcMain: any;
}

export interface HandlerContext extends ServiceDeps {
  handle: (channel: string, fn: (...args: any[]) => any) => void;
  pushAll: (channel: string, data: any) => void;
  secStore: any;
  V: any;
  uuidv4: () => string;
  enableWakeLock: () => void;
  disableWakeLock: () => void;
}

export interface QueueItem {
  id: string;
  session_id: string | null;
  campaign_id: string | null;
  recipient: string;
  body: string | null;
  scripts: string | null;
  media_path: string | null;
  delay_min_ms: number;
  delay_max_ms: number;
  priority: number;
  max_attempts: number;
  scheduled_at: string;
}

export interface TeamUser {
  id: string;
  name: string;
  role: 'admin' | 'agent' | 'viewer';
  email?: string;
  pin?: string;
  color?: string;
  active: number;
}

export interface ResellerClient {
  id: string;
  name: string;
  email?: string;
  license_key?: string;
  plan: 'basic' | 'pro' | 'enterprise';
  max_sessions: number;
  max_msg_per_day: number;
  active: number;
  expires_at?: string;
  notes?: string;
}

export interface BrandingConfig {
  app_name: string;
  logo_path: string;
  primary_color: string;
  footer_text: string;
  show_powered: boolean;
}
