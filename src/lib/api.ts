import type {
  ApiFailure,
  DashboardStatus,
  HealthResponse,
  KitesimOrder,
  MessagesResponse,
  OrdersResponse,
  SessionResponse,
} from "@/types"

const REQUEST_TIMEOUT_MS = 58_000

export class ApiError extends Error {
  status: number
  kind: string

  constructor(message: string, status = 0, kind = "network") {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.kind = kind
  }
}

async function apiRequest<T>(path: string, accessKey = "", options: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const headers = new Headers(options.headers)
  headers.set("Accept", "application/json")
  if (accessKey) headers.set("Authorization", `Bearer ${accessKey}`)

  try {
    const response = await fetch(path, { ...options, headers, signal: controller.signal })
    const payload = (await response.json().catch(() => ({}))) as T & ApiFailure
    if (!response.ok) {
      throw new ApiError(
        payload.error || `请求失败（${response.status}）`,
        response.status,
        payload.kind || "http",
      )
    }
    return payload
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("请求超时，请再次刷新", 0, "timeout")
    }
    throw new ApiError("无法连接本地或 EdgeOne 服务", 0, "network")
  } finally {
    window.clearTimeout(timeout)
  }
}

export function getHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/api/health")
}

export function verifySession(accessKey: string): Promise<SessionResponse> {
  return apiRequest<SessionResponse>("/api/session", accessKey, { method: "POST" })
}

export function getOrders(accessKey: string, status: DashboardStatus): Promise<OrdersResponse> {
  const query = new URLSearchParams({ status, limit: "20" })
  return apiRequest<OrdersResponse>(`/api/orders?${query.toString()}`, accessKey)
}

export function getMessages(
  accessKey: string,
  order: KitesimOrder,
  options: { revealCode: boolean; showSms: boolean },
): Promise<MessagesResponse> {
  return apiRequest<MessagesResponse>("/api/messages", accessKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: order.accountId,
      messageHandle: order.messageHandle,
      orderId: order.id ?? order.orderNo,
      phoneNumber: order.phoneNumber,
      revealCode: options.revealCode,
      showSms: options.showSms,
    }),
  })
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const fallback = document.createElement("textarea")
  fallback.value = value
  fallback.readOnly = true
  fallback.style.position = "fixed"
  fallback.style.opacity = "0"
  document.body.append(fallback)
  fallback.select()
  const copied = document.execCommand("copy")
  fallback.remove()
  if (!copied) throw new Error("copy failed")
}
