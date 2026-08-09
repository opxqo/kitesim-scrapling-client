export type DashboardStatus = "0" | "1" | "2" | "3" | "4" | "all"

export type CacheStatus = "hit" | "stale" | "empty" | "refreshed" | "bypass"

export type AccountWarning = {
  accountId: string
  accountLabel: string
  kind: string
  message: string
}

export type KitesimOrder = {
  id?: string | number
  orderNo?: string
  phoneNumber: string
  countryCode?: string
  phoneCode?: string
  packageId?: string | number
  durationType?: string | number
  durationValue?: string | number
  packagePrice?: string | number
  paidAmount?: string | number
  currency?: string
  orderStatus?: number
  statusLabel: string
  autoRenew?: string | number | boolean
  createTime?: string
  paymentTime?: string
  expireTime?: string
  nextRenewalDate?: string
  accountId: string
  accountLabel: string
  messageHandle: string
}

export type KitesimMessage = {
  id?: string | number
  sender?: string
  recipient?: string
  time?: string
  code: string[]
  content: string
}

export type HealthResponse = {
  ok: boolean
  service: string
  runtime: string
  authConfigured: boolean
}

export type SessionResponse = {
  ok: boolean
  scope: string
  verifiedAt: string
}

export type KitesimAuthAccount = {
  accountId: string
  emailHint: string
  credentialsConfigured: boolean
  tokenAvailable: boolean
  verifiedAt: string
}

export type KitesimAuthMaintenanceAccount = {
  accountId: string
  emailHint: string
  state: "healthy" | "relogged" | "attention"
  checkedAt: string
  message: string
}

export type KitesimAuthMaintenance = {
  state: "running" | "success" | "attention"
  source: "dashboard" | "schedule" | "refresh"
  lastStartedAt: string
  lastCompletedAt: string
  nextAllowedAt: string
  accountCount: number
  healthyCount: number
  reloggedCount: number
  failedCount: number
  accounts: KitesimAuthMaintenanceAccount[]
}

export type KitesimAuthAutomation = {
  enabled: boolean
  configured: boolean
  gatewayConfigured: boolean
  model: string
  maintenance: KitesimAuthMaintenance | null
}

export type KitesimAuthStatus = {
  ok: boolean
  configured: boolean
  credentialsConfigured: boolean
  storageConfigured: boolean
  automation: KitesimAuthAutomation
  accountCount: number
  readyCount: number
  accounts: KitesimAuthAccount[]
}

export type KitesimAuthMaintainResult = KitesimAuthMaintenance & {
  ok: boolean
  skipped: boolean
}

export type KitesimAuthChallenge = {
  accountId: string
  captchaKey: string
  captchaImageBase64: string
  emailHint: string
}

export type KitesimAuthComplete = {
  ok: boolean
  accountId: string
  tokenAvailable: boolean
  verifiedAt: string
  emailHint: string
}

export type OrdersResponse = {
  items: KitesimOrder[]
  count: number
  hasMore: boolean
  accountCount: number
  failedAccountCount: number
  partial: boolean
  warnings: AccountWarning[]
  status: DashboardStatus | number
  updatedAt: string
  cacheStatus?: CacheStatus
}

export type MessagesResponse = {
  items: KitesimMessage[]
  count: number
  totalCount: number
  hasMore: boolean
  accountId: string
  accountLabel: string
  revealCode: boolean
  showSms: boolean
  updatedAt: string
  cacheStatus?: CacheStatus
}

export type ApiFailure = {
  error?: string
  kind?: string
}

export type AccountGroup = {
  accountId: string
  accountLabel: string
  orders: KitesimOrder[]
}
