import { describe, expect, it, vi } from "vitest"

import {
  createOrdersCacheHandler,
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
const MASKED_MESSAGE = {
  id: 1,
  sender: "WhatsApp",
  recipient: "+15551234567",
  time: "2026-08-01T10:00:00Z",
  code: ["4****1"],
  content: "Your verification code is ******",
}
const FULL_MESSAGE = {
  ...MASKED_MESSAGE,
  code: ["438921"],
  content: "Your verification code is 438921",
}
const MESSAGE_SNAPSHOT = {
  accountId: "acct_test",
  accountLabel: "测试账户",
  variants: {
    masked: [MASKED_MESSAGE],
    code: [{ ...MASKED_MESSAGE, code: ["438921"] }],
    sms: [{ ...FULL_MESSAGE, code: ["4****1"] }],
    full: [FULL_MESSAGE],
  },
  updatedAt: "2026-08-01T10:00:00Z",
}
const ORDERS_SNAPSHOT = {
  items: [
    {
      id: "order-42",
      phoneNumber: "+15551234567",
      statusLabel: "使用中",
      accountId: "acct_test",
      accountLabel: "测试账户",
      messageHandle: "msg_signed_test_handle",
    },
  ],
  count: 1,
  hasMore: false,
  accountCount: 1,
  failedAccountCount: 0,
  partial: false,
  warnings: [],
  status: 2,
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


function messageRequest(payload = REQUEST_PAYLOAD, accessKey = ACCESS_KEY) {
  return new Request("https://example.com/api/messages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
}


function ordersRequest(refresh = false, accessKey = ACCESS_KEY) {
  const url = new URL("https://example.com/api/orders?status=2&limit=20")
  if (refresh) url.searchParams.set("refresh", "1")
  return new Request(url, {
    headers: { "Authorization": `Bearer ${accessKey}` },
  })
}


function messageOriginFetch(snapshot = MESSAGE_SNAPSHOT) {
  return vi.fn(async (url, options) => {
    expect(String(url)).toBe("https://example.com/origin/messages-origin")
    const body = JSON.parse(String(options.body))
    expect(body.cacheSnapshot).toBe(true)
    expect(body.refresh).toBeUndefined()
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })
}


function ordersOriginFetch(snapshot = ORDERS_SNAPSHOT) {
  return vi.fn(async (url, options) => {
    expect(String(url)).toBe("https://example.com/origin/orders-origin?status=2&limit=20")
    expect(options.method).toBe("GET")
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })
}


describe("EdgeOne message Blob snapshot", () => {
  it("does not contact the Python origin during a cache-only miss", async () => {
    const store = new FakeStore()
    const fetchImpl = messageOriginFetch()
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => 900_000,
    })

    const response = await handler({ request: messageRequest(), env: BASE_ENV })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("empty")
    expect(payload).toMatchObject({ items: [], count: 0, cacheStatus: "empty" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects an invalid dashboard key before touching Blob or the origin", async () => {
    const fetchImpl = messageOriginFetch()
    const getStoreImpl = vi.fn(() => new FakeStore())
    const handler = createSmsCacheHandler({ fetchImpl, getStoreImpl })

    const response = await handler({
      request: messageRequest(REQUEST_PAYLOAD, "wrong-dashboard-key"),
      env: BASE_ENV,
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ kind: "dashboard_auth" })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(getStoreImpl).not.toHaveBeenCalled()
  })

  it("calls the origin and writes one encrypted multi-variant snapshot on explicit refresh", async () => {
    const store = new FakeStore()
    const fetchImpl = messageOriginFetch()
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => 1_000_000,
      randomBytesImpl: () => Buffer.alloc(12, 3),
    })

    const response = await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("refreshed")
    expect(payload).toMatchObject({
      items: [MASKED_MESSAGE],
      cacheStatus: "refreshed",
      revealCode: false,
      showSms: false,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0].key).toBe(createSmsCacheKey(REQUEST_PAYLOAD))
    expect(store.writes[0].options.cacheControl).toBe("max-age=20, stale-while-revalidate=20")
    expect(JSON.stringify(store.writes[0].value)).not.toContain("WhatsApp")
    expect(JSON.stringify(store.writes[0].value)).not.toContain("438921")
  })

  it("uses the public EdgeOne host when the runtime request URL points at an internal endpoint", async () => {
    const store = new FakeStore()
    const fetchImpl = vi.fn(async (url) => {
      expect(String(url)).toBe("https://esim.opxqo.cn/origin/messages-origin")
      return new Response(JSON.stringify(MESSAGE_SNAPSHOT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    const handler = createSmsCacheHandler({ fetchImpl, getStoreImpl: () => store })
    const request = new Request("https://internal.function.example/api/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_KEY}`,
        "Content-Type": "application/json",
        "eo-pages-host": "esim.opxqo.cn",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ ...REQUEST_PAYLOAD, refresh: true }),
    })

    const response = await handler({ request, env: BASE_ENV })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("refreshed")
  })

  it("serves all display variants from one Blob snapshot without another origin request", async () => {
    const store = new FakeStore()
    const fetchImpl = messageOriginFetch()
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => 2_000_000,
    })

    await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })
    const cached = await handler({ request: messageRequest(), env: BASE_ENV })
    const revealed = await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, revealCode: true, showSms: true }),
      env: BASE_ENV,
    })

    expect(cached.headers.get("X-SMS-Cache")).toBe("hit")
    expect(revealed.headers.get("X-SMS-Cache")).toBe("hit")
    expect((await revealed.json()).items).toEqual([FULL_MESSAGE])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("returns an expired snapshot as stale without refreshing the backend", async () => {
    const store = new FakeStore()
    const fetchImpl = messageOriginFetch()
    let now = 3_000_000
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => now,
    })

    await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })
    now += 21_000
    const stale = await handler({ request: messageRequest(), env: BASE_ENV })

    expect(stale.headers.get("X-SMS-Cache")).toBe("stale")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.writes).toHaveLength(1)
  })

  it("never contacts the origin on a normal read when cache configuration is missing", async () => {
    const fetchImpl = messageOriginFetch()
    const getStoreImpl = vi.fn(() => new FakeStore())
    const handler = createSmsCacheHandler({ fetchImpl, getStoreImpl })
    const env = { ...BASE_ENV, SMS_CACHE_ENCRYPTION_KEY: "" }

    const response = await handler({ request: messageRequest(), env })

    expect(response.status).toBe(503)
    expect((await response.json()).kind).toBe("configuration")
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(getStoreImpl).not.toHaveBeenCalled()
  })

  it("allows an explicit refresh to bypass unavailable Blob storage", async () => {
    const fetchImpl = messageOriginFetch()
    const logger = vi.fn()
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => {
        throw Object.assign(new Error("unavailable"), { code: "BLOB_UNAVAILABLE" })
      },
      logger,
    })

    const response = await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("bypass")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(logger).toHaveBeenCalledWith("Dashboard cache initialization failed", {
      name: "Error",
      code: "BLOB_UNAVAILABLE",
    })
  })

  it("reports bypass only when an explicit Blob write really fails", async () => {
    const fetchImpl = messageOriginFetch()
    const logger = vi.fn()
    const store = new FakeStore()
    store.setJSON = vi.fn(async () => {
      throw Object.assign(new Error("write failed"), { code: "BLOB_WRITE_FAILED" })
    })
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      logger,
    })

    const response = await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("bypass")
    expect((await response.json()).cacheStatus).toBe("bypass")
    expect(logger).toHaveBeenCalledWith("Dashboard cache write failed", {
      name: "Error",
      code: "BLOB_WRITE_FAILED",
    })
  })

  it("does not fall through to the origin when a cache-only Blob read fails", async () => {
    const fetchImpl = messageOriginFetch()
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

    const response = await handler({ request: messageRequest(), env: BASE_ENV })

    expect(response.status).toBe(503)
    expect((await response.json()).kind).toBe("storage")
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})


describe("EdgeOne orders Blob snapshot", () => {
  it("returns an empty orders snapshot without contacting Python", async () => {
    const store = new FakeStore()
    const fetchImpl = ordersOriginFetch()
    const handler = createOrdersCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => 4_000_000,
    })

    const response = await handler({ request: ordersRequest(), env: BASE_ENV })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("empty")
    expect(payload).toMatchObject({ items: [], accountCount: 0, cacheStatus: "empty" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("refreshes orders explicitly and serves subsequent reads from Blob", async () => {
    const store = new FakeStore()
    const fetchImpl = ordersOriginFetch()
    const handler = createOrdersCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => 5_000_000,
    })

    const refreshed = await handler({ request: ordersRequest(true), env: BASE_ENV })
    const cached = await handler({ request: ordersRequest(), env: BASE_ENV })

    expect(refreshed.headers.get("X-SMS-Cache")).toBe("refreshed")
    expect(cached.headers.get("X-SMS-Cache")).toBe("hit")
    expect((await cached.json()).items).toEqual(ORDERS_SNAPSHOT.items)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.writes).toHaveLength(1)
  })

  it("uses the public EdgeOne host for an orders refresh from an internal runtime URL", async () => {
    const store = new FakeStore()
    const fetchImpl = vi.fn(async (url) => {
      expect(String(url)).toBe("https://esim.opxqo.cn/origin/orders-origin?status=2&limit=20")
      return new Response(JSON.stringify(ORDERS_SNAPSHOT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    const handler = createOrdersCacheHandler({ fetchImpl, getStoreImpl: () => store })
    const request = new Request(
      "https://internal.function.example/api/orders?status=2&limit=20&refresh=1",
      {
        headers: {
          "Authorization": `Bearer ${ACCESS_KEY}`,
          "eo-pages-host": "esim.opxqo.cn",
          "x-forwarded-proto": "https",
        },
      },
    )

    const response = await handler({ request, env: BASE_ENV })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("refreshed")
  })

  it("returns stale orders without an automatic backend refresh", async () => {
    const store = new FakeStore()
    const fetchImpl = ordersOriginFetch()
    let now = 6_000_000
    const handler = createOrdersCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => now,
    })

    await handler({ request: ordersRequest(true), env: BASE_ENV })
    now += 21_000
    const stale = await handler({ request: ordersRequest(), env: BASE_ENV })

    expect(stale.headers.get("X-SMS-Cache")).toBe("stale")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
