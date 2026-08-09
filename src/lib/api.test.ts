import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  completeKitesimAuth,
  getKitesimAuthChallenge,
  getKitesimAuthStatus,
  getMessages,
  getOrders,
  maintainKitesimAuth,
} from "./api"
import type { KitesimOrder } from "@/types"

const order: KitesimOrder = {
  id: "order-42",
  phoneNumber: "+15551234567",
  statusLabel: "使用中",
  accountId: "acct_test",
  accountLabel: "测试账户",
  messageHandle: "msg_signed_test_handle",
}

const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", {
  status: 200,
  headers: { "Content-Type": "application/json" },
}))

describe("dashboard cache request intent", () => {
  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("does not ask the orders endpoint to refresh during a normal read", async () => {
    await getOrders("dashboard-test-key", "2")
    await getOrders("dashboard-test-key", "2", { refresh: true })

    expect(fetchMock.mock.calls[0][0]).toBe("/api/orders?status=2&limit=20")
    expect(fetchMock.mock.calls[1][0]).toBe("/api/orders?status=2&limit=20&refresh=1")
  })

  it("sets the message refresh flag only for an explicit refresh", async () => {
    await getMessages("dashboard-test-key", order, { revealCode: false, showSms: false })
    await getMessages("dashboard-test-key", order, {
      revealCode: false,
      showSms: false,
      refresh: true,
    })

    const normalBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const refreshBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(normalBody.refresh).toBe(false)
    expect(refreshBody.refresh).toBe(true)
  })

  it("requests only fully masked or fully visible message variants", async () => {
    await getMessages("dashboard-test-key", order, { revealCode: false, showSms: false })
    await getMessages("dashboard-test-key", order, { revealCode: true, showSms: true })

    const maskedBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const visibleBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(maskedBody).toMatchObject({ revealCode: false, showSms: false, refresh: false })
    expect(visibleBody).toMatchObject({ revealCode: true, showSms: true, refresh: false })
  })

  it("uses protected same-origin routes for the managed Kitesim login", async () => {
    await getKitesimAuthStatus("dashboard-test-key")
    await getKitesimAuthChallenge("dashboard-test-key", "login_2")
    await completeKitesimAuth("dashboard-test-key", {
      accountId: "login_2",
      captchaCode: "A7B9",
      captchaKey: "captcha:0123456789abcdef",
    })
    await maintainKitesimAuth("dashboard-test-key")

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/auth/status",
      "/api/auth/challenge?accountId=login_2",
      "/api/auth/complete",
      "/api/auth/maintain",
    ])
    for (const [, options] of fetchMock.mock.calls) {
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer dashboard-test-key")
    }
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
    expect(fetchMock.mock.calls[1][1]?.method).toBeUndefined()
    expect(fetchMock.mock.calls[2][1]?.method).toBe("POST")
    expect(fetchMock.mock.calls[3][1]?.method).toBe("POST")
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      accountId: "login_2",
      captchaCode: "A7B9",
      captchaKey: "captcha:0123456789abcdef",
    })
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({ force: true })
  })
})
