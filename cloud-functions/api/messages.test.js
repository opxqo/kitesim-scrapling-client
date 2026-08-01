import { describe, expect, it, vi } from "vitest"

import {
  createSmsCacheHandler,
  createSmsCacheKey,
} from "../_shared/sms_cache.js"


const ACCESS_KEY = "dashboard-test-key"
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
const BASE_ENV = {
  DASHBOARD_ACCESS_KEY: ACCESS_KEY,
  SMS_CACHE_ENCRYPTION_KEY: ENCRYPTION_KEY,
  SMS_CACHE_TTL_SECONDS: "20",
}
const REQUEST_PAYLOAD = {
  accountId: "acct_test",
  messageHandle: "msg_signed_test_handle",
  orderId: "order-42",
  phoneNumber: "+15551234567",
  revealCode: false,
  showSms: false,
}
const ORIGIN_PAYLOAD = {
  items: [
    {
      id: 1,
      sender: "WhatsApp",
      recipient: "+15551234567",
      time: "2026-08-01T10:00:00Z",
      code: ["4****1"],
      content: "Your verification code is ******",
    },
  ],
  count: 1,
  accountId: "acct_test",
  accountLabel: "测试账户",
  revealCode: false,
  showSms: false,
  updatedAt: "2026-08-01T10:00:00Z",
}


class FakeStore {
  constructor() {
    this.objects = new Map()
    this.writes = []
  }

  async get(key) {
    return this.objects.get(key) ?? null
  }

  async setJSON(key, value, options) {
    this.objects.set(key, value)
    this.writes.push({ key, value, options })
  }
}


function requestFor(payload = REQUEST_PAYLOAD, accessKey = ACCESS_KEY) {
  return new Request("https://example.com/api/messages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
}


function originFetch(payload = ORIGIN_PAYLOAD) {
  return vi.fn(async (url) => {
    expect(String(url)).toBe("https://example.com/api/messages-origin")
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })
}


describe("EdgeOne SMS Blob cache", () => {
  it("rejects an invalid dashboard key before touching Blob or the origin", async () => {
    const fetchImpl = originFetch()
    const getStoreImpl = vi.fn(() => new FakeStore())
    const handler = createSmsCacheHandler({ fetchImpl, getStoreImpl })

    const response = await handler({
      request: requestFor(REQUEST_PAYLOAD, "wrong-dashboard-key"),
      env: BASE_ENV,
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ kind: "dashboard_auth" })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(getStoreImpl).not.toHaveBeenCalled()
  })

  it("writes an encrypted response on a cache miss", async () => {
    const store = new FakeStore()
    const fetchImpl = originFetch()
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => 1_000_000,
      randomBytesImpl: () => Buffer.alloc(12, 3),
    })

    const response = await handler({ request: requestFor(), env: BASE_ENV })
    const responsePayload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("miss")
    expect(responsePayload).toEqual(ORIGIN_PAYLOAD)
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0].key).toBe(createSmsCacheKey(REQUEST_PAYLOAD))
    expect(store.writes[0].options.cacheControl).toBe("max-age=20, stale-while-revalidate=20")
    expect(JSON.stringify(store.writes[0].value)).not.toContain("WhatsApp")
    expect(JSON.stringify(store.writes[0].value)).not.toContain("verification code")
  })

  it("serves a fresh encrypted cache hit without calling the origin again", async () => {
    const store = new FakeStore()
    const fetchImpl = originFetch()
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => 2_000_000,
    })

    const first = await handler({ request: requestFor(), env: BASE_ENV })
    expect(first.headers.get("X-SMS-Cache")).toBe("miss")

    const second = await handler({ request: requestFor(), env: BASE_ENV })
    expect(second.headers.get("X-SMS-Cache")).toBe("hit")
    expect(await second.json()).toEqual(ORIGIN_PAYLOAD)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("refreshes an expired cache record", async () => {
    const store = new FakeStore()
    const fetchImpl = originFetch()
    let now = 3_000_000
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => now,
    })

    await handler({ request: requestFor(), env: BASE_ENV })
    now += 21_000
    const refreshed = await handler({ request: requestFor(), env: BASE_ENV })

    expect(refreshed.headers.get("X-SMS-Cache")).toBe("miss")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(store.writes).toHaveLength(2)
  })

  it("bypasses Blob safely when the encryption key is not configured", async () => {
    const fetchImpl = originFetch()
    const getStoreImpl = vi.fn(() => new FakeStore())
    const handler = createSmsCacheHandler({ fetchImpl, getStoreImpl })
    const env = { ...BASE_ENV, SMS_CACHE_ENCRYPTION_KEY: "" }

    const response = await handler({ request: requestFor(), env })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("bypass")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(getStoreImpl).not.toHaveBeenCalled()
  })

  it("falls back to the Python origin when Blob cannot be read", async () => {
    const fetchImpl = originFetch()
    const logger = vi.fn()
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => ({
        get: vi.fn(async () => {
          throw Object.assign(new Error("unavailable"), { code: "BLOB_UNAVAILABLE" })
        }),
      }),
      logger,
    })

    const response = await handler({ request: requestFor(), env: BASE_ENV })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("bypass")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(logger).toHaveBeenCalledWith("SMS cache read failed", {
      name: "Error",
      code: "BLOB_UNAVAILABLE",
    })
  })

  it("treats a damaged cache envelope as a miss and replaces it", async () => {
    const store = new FakeStore()
    store.objects.set(createSmsCacheKey(REQUEST_PAYLOAD), {
      version: 1,
      algorithm: "A256GCM",
      iv: "broken",
      tag: "broken",
      ciphertext: "broken",
    })
    const fetchImpl = originFetch()
    const logger = vi.fn()
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      logger,
    })

    const response = await handler({ request: requestFor(), env: BASE_ENV })

    expect(response.headers.get("X-SMS-Cache")).toBe("miss")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.writes).toHaveLength(1)
    expect(logger).toHaveBeenCalledTimes(1)
  })
})
