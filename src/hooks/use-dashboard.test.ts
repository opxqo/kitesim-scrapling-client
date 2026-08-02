import { describe, expect, it, vi } from "vitest"

import { ApiError, getOrders, verifySession } from "@/lib/api"
import type { OrdersResponse } from "@/types"

import {
  accessVerificationFailure,
  normalizeCacheStatus,
  requestAccessOrders,
} from "./use-dashboard"

const ordersPayload: OrdersResponse = {
  items: [],
  count: 0,
  hasMore: false,
  accountCount: 0,
  failedAccountCount: 0,
  partial: false,
  warnings: [],
  status: "2",
  updatedAt: "2026-08-02T00:00:00.000Z",
}

const sessionPayload = {
  ok: true,
  scope: "read-only",
  verifiedAt: "2026-08-02T00:00:00.000Z",
}

describe("dashboard cache status normalization", () => {
  it("does not report a Blob write failure when a legacy or direct response omits cacheStatus", () => {
    expect(normalizeCacheStatus(undefined)).toBeNull()
    expect(normalizeCacheStatus("unknown-status")).toBeNull()
    expect(normalizeCacheStatus("bypass")).toBe("bypass")
  })
})

describe("dashboard access verification failure policy", () => {
  it("clears the tab-scoped access key only when the API explicitly rejects dashboard auth", () => {
    expect(accessVerificationFailure(
      new ApiError("访问口令错误", 401, "dashboard_auth"),
    )).toMatchObject({
      clearAccessKey: true,
      accessInvalid: true,
      connection: { mode: "idle", text: "等待访问口令" },
    })

    for (const error of [
      new ApiError("无法连接服务", 0, "network"),
      new ApiError("请求超时", 0, "timeout"),
      new ApiError("服务暂时不可用", 503, "server"),
      new ApiError("请求失败", 401, "http"),
      new Error("unexpected failure"),
    ]) {
      expect(accessVerificationFailure(error)).toMatchObject({
        clearAccessKey: false,
        accessInvalid: false,
        connection: { mode: "error", text: "验证失败，可重试" },
      })
      expect(accessVerificationFailure(error).feedback).toContain("口令已保留，可重试")
    }
  })
})

describe("dashboard access orders request", () => {
  it("uses the first normal orders read to verify access", async () => {
    const request = vi.fn<typeof getOrders>().mockResolvedValue(ordersPayload)
    const sessionRequest = vi.fn<typeof verifySession>().mockResolvedValue(sessionPayload)

    const result = await requestAccessOrders(
      "dashboard-test-key",
      "2",
      request,
      sessionRequest,
    )

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith("dashboard-test-key", "2", { refresh: false })
    expect(sessionRequest).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, payload: ordersPayload })
  })

  it("falls back to session verification when the first orders read has a non-auth failure", async () => {
    const ordersError = new ApiError("Blob 暂时不可用", 503, "storage")
    const request = vi.fn<typeof getOrders>().mockRejectedValue(
      ordersError,
    )
    const sessionRequest = vi.fn<typeof verifySession>().mockResolvedValue(sessionPayload)

    const result = await requestAccessOrders(
      "dashboard-test-key",
      "2",
      request,
      sessionRequest,
    )

    expect(request).toHaveBeenCalledOnce()
    expect(sessionRequest).toHaveBeenCalledOnce()
    expect(sessionRequest).toHaveBeenCalledWith("dashboard-test-key")
    expect(result).toEqual({
      ok: true,
      payload: null,
      ordersError,
    })
  })

  it("does not fall back to session verification after a 401 orders response", async () => {
    for (const error of [
      new ApiError("访问口令无效", 401, "dashboard_auth"),
      new ApiError("请求被拒绝", 401, "http"),
    ]) {
      const request = vi.fn<typeof getOrders>().mockRejectedValue(error)
      const sessionRequest = vi.fn<typeof verifySession>().mockResolvedValue(sessionPayload)

      const result = await requestAccessOrders(
        "dashboard-test-key",
        "2",
        request,
        sessionRequest,
      )

      expect(sessionRequest).not.toHaveBeenCalled()
      expect(result).toMatchObject({ ok: false })
    }
  })

  it("returns a failed verification when the fallback session request fails", async () => {
    const request = vi.fn<typeof getOrders>().mockRejectedValue(
      new ApiError("Blob 暂时不可用", 503, "storage"),
    )
    const sessionRequest = vi.fn<typeof verifySession>().mockRejectedValue(
      new ApiError("访问口令无效", 401, "dashboard_auth"),
    )

    const result = await requestAccessOrders(
      "dashboard-test-key",
      "2",
      request,
      sessionRequest,
    )

    expect(result).toMatchObject({
      ok: false,
      failure: { clearAccessKey: true, accessInvalid: true },
    })
  })
})
