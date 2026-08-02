import type { AccountGroup, KitesimMessage, KitesimOrder } from "@/types"

export function orderKey(order: KitesimOrder | null | undefined): string {
  if (!order) return ""
  const account = String(order.accountId || "legacy")
  const identifier = String(order.id ?? order.orderNo ?? "")
  return `${account}:${identifier}`
}

export function maskPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "")
  if (digits.length < 7) return value || "—"

  const countryLength = digits.startsWith("1") && digits.length === 11
    ? 1
    : Math.max(1, digits.length - 10)
  const countryCode = digits.slice(0, countryLength)
  const localNumber = digits.slice(countryLength)
  const visiblePrefixLength = countryCode === "1" ? 3 : Math.min(4, localNumber.length - 4)
  const visiblePrefix = localNumber.slice(0, visiblePrefixLength)
  const suffix = localNumber.slice(-3)

  return `+${countryCode} ${visiblePrefix} ••• •${suffix}`
}

export function displaySensitiveIdentifier(value: string, masked: boolean): string {
  const label = String(value || "").trim()
  if (!label) return "—"
  if (!masked) return label

  return label.replace(/\+?\d[\d\s().-]{5,}\d/g, (candidate) => {
    const digits = candidate.replace(/\D/g, "")
    return digits.length >= 7 ? maskPhoneNumber(candidate) : candidate
  })
}

export function displayMessageContent(value: string, masked: boolean): string {
  if (masked) return "短信正文已隐藏"
  return value || "无短信正文"
}

export function privacyMessageOptions(masked: boolean) {
  return {
    revealCode: !masked,
    showSms: !masked,
  }
}

export function buildAccountGroups(orders: KitesimOrder[]): AccountGroup[] {
  const groups = new Map<string, AccountGroup>()

  for (const order of orders) {
    const accountId = order.accountId || "legacy"
    const existing = groups.get(accountId)
    if (existing) {
      existing.orders.push(order)
      continue
    }
    groups.set(accountId, {
      accountId,
      accountLabel: order.accountLabel || "默认账户",
      orders: [order],
    })
  }

  return Array.from(groups.values())
}

export function firstCodeRecord(messages: KitesimMessage[]) {
  for (const message of messages) {
    const code = Array.isArray(message.code) ? message.code[0] : undefined
    if (code) return { code: String(code), message }
  }
  return null
}

export function statusCountsFromOrders(orders: KitesimOrder[]): Record<string, number> {
  const counts: Record<string, number> = { all: orders.length }
  for (const order of orders) {
    if (typeof order.orderStatus !== "number") continue
    const key = String(order.orderStatus)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

export function statusLabel(order: KitesimOrder | null | undefined): string {
  if (!order) return "未同步"
  return order.statusLabel || `状态 ${order.orderStatus ?? "未知"}`
}

export function formatDateTime(value?: string): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.replace("T", " ").slice(0, 16)
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed)
}

export function formatShortTime(value?: string): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.replace("T", " ").slice(11, 16)
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed)
}

export function formatPackage(order: KitesimOrder): string {
  const duration = [order.durationValue, order.durationType].filter((value) => value !== undefined && value !== null)
  const durationLabel = duration.length ? ` · ${duration.join(" ")}` : ""
  return order.packageId !== undefined ? `套餐 ${order.packageId}${durationLabel}` : "套餐信息未提供"
}

export function isCodeRevealed(code: string): boolean {
  return Boolean(code) && !code.includes("*") && !code.includes("•")
}
