import { createCipheriv, createHash, createHmac } from "node:crypto"

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
  items: [FULL_MESSAGE],
  updatedAt: "2026-08-01T10:00:00Z",
}
const LEGACY_MESSAGE_SNAPSHOT = {
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
    this.reads = []
    this.writes = []
  }

  async get(key) {
    this.reads.push(key)
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


function legacyEnvelope(record, encodedKey, objectKey) {
  const iv = Buffer.alloc(12, 3)
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(encodedKey, "base64"), iv)
  cipher.setAAD(Buffer.from(objectKey, "utf8"))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ])
  return {
    version: 1,
    algorithm: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }
}


function managedTokenEnvelope(token, encodedKey, accountId, email) {
  const objectKey = `managed-token/v2/${accountId}.json`
  const iv = Buffer.alloc(12, 4)
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(encodedKey, "base64"), iv)
  cipher.setAAD(Buffer.from(objectKey, "utf8"))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ token }), "utf8"),
    cipher.final(),
  ])
  return {
    version: 2,
    algorithm: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    emailHash: createHash("sha256").update(email, "utf8").digest("hex"),
    verifiedAt: "2026-08-08T10:00:00.000Z",
  }
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

  it("writes one plaintext full-message snapshot without an encryption key", async () => {
    const store = new FakeStore()
    const fetchImpl = messageOriginFetch()
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => 1_000_000,
    })
    const env = { ...BASE_ENV, SMS_CACHE_ENCRYPTION_KEY: "" }

    const response = await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env,
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
    expect(store.writes[0].value).toMatchObject({
      version: 2,
      payload: MESSAGE_SNAPSHOT,
    })
    expect(store.writes[0].value.payload.variants).toBeUndefined()
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

  it("derives all display variants from one Blob snapshot without another origin request", async () => {
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
    const masked = await handler({ request: messageRequest(), env: BASE_ENV })
    const code = await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, revealCode: true }),
      env: BASE_ENV,
    })
    const sms = await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, showSms: true }),
      env: BASE_ENV,
    })
    const full = await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, revealCode: true, showSms: true }),
      env: BASE_ENV,
    })

    expect(masked.headers.get("X-SMS-Cache")).toBe("hit")
    expect(code.headers.get("X-SMS-Cache")).toBe("hit")
    expect(sms.headers.get("X-SMS-Cache")).toBe("hit")
    expect(full.headers.get("X-SMS-Cache")).toBe("hit")
    expect((await masked.json()).items).toEqual([MASKED_MESSAGE])
    expect((await code.json()).items).toEqual([{ ...MASKED_MESSAGE, code: ["438921"] }])
    expect((await sms.json()).items).toEqual([{ ...FULL_MESSAGE, code: ["4****1"] }])
    expect((await full.json()).items).toEqual([FULL_MESSAGE])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.reads).toHaveLength(0)
  })

  it("masks segmented codes and long phone numbers from a compact snapshot", async () => {
    const store = new FakeStore()
    const snapshot = {
      ...MESSAGE_SNAPSHOT,
      items: [{
        ...FULL_MESSAGE,
        code: ["123456", "𝟙𝟚𝟛𝟜𝟝𝟞"],
        content: "Use 123-456, fullwidth １２３４５６, Arabic ١٢٣٤٥٦ and phone 15551234567",
      }],
    }
    const handler = createSmsCacheHandler({
      fetchImpl: messageOriginFetch(snapshot),
      getStoreImpl: () => store,
      nowImpl: () => 2_250_000,
    })

    const response = await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })

    expect((await response.json()).items).toEqual([{
      ...FULL_MESSAGE,
      code: ["1****6", "𝟙****𝟞"],
      content: "Use ***-***, fullwidth ******, Arabic ****** and phone ***********",
    }])
  })

  it("coalesces concurrent reads for the same snapshot on a cold handler", async () => {
    const store = new FakeStore()
    const writer = createSmsCacheHandler({
      fetchImpl: messageOriginFetch(),
      getStoreImpl: () => store,
      nowImpl: () => 2_500_000,
    })
    await writer({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })
    store.reads = []

    const reader = createSmsCacheHandler({
      fetchImpl: messageOriginFetch(),
      getStoreImpl: () => store,
      nowImpl: () => 2_500_000,
    })
    const responses = await Promise.all([
      reader({ request: messageRequest(), env: BASE_ENV }),
      reader({
        request: messageRequest({ ...REQUEST_PAYLOAD, revealCode: true }),
        env: BASE_ENV,
      }),
      reader({
        request: messageRequest({ ...REQUEST_PAYLOAD, showSms: true }),
        env: BASE_ENV,
      }),
      reader({
        request: messageRequest({ ...REQUEST_PAYLOAD, revealCode: true, showSms: true }),
        env: BASE_ENV,
      }),
    ])

    expect(responses.every((response) => response.headers.get("X-SMS-Cache") === "hit")).toBe(true)
    expect(store.reads).toHaveLength(1)
  })

  it("revalidates a hot snapshot from Blob after the short memory window", async () => {
    const store = new FakeStore()
    let now = 2_700_000
    const handler = createSmsCacheHandler({
      fetchImpl: messageOriginFetch(),
      getStoreImpl: () => store,
      nowImpl: () => now,
    })
    await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })
    const updatedSnapshot = {
      ...MESSAGE_SNAPSHOT,
      items: [{ ...FULL_MESSAGE, sender: "Updated sender" }],
    }
    store.objects.set(createSmsCacheKey(REQUEST_PAYLOAD), {
      version: 2,
      cachedAt: now,
      expiresAt: now + 20_000,
      payload: updatedSnapshot,
    })
    store.reads = []
    now += 5_001

    const response = await handler({ request: messageRequest(), env: BASE_ENV })

    expect((await response.json()).items[0].sender).toBe("Updated sender")
    expect(store.reads).toHaveLength(1)
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

  it("starts the refreshed TTL after a slow origin request completes", async () => {
    const store = new FakeStore()
    let now = 0
    const fetchImpl = vi.fn(async () => {
      now = 30_000
      return new Response(JSON.stringify(MESSAGE_SNAPSHOT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => now,
    })

    await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })
    const cached = await handler({ request: messageRequest(), env: BASE_ENV })

    expect(cached.headers.get("X-SMS-Cache")).toBe("hit")
    expect(store.writes[0].value).toMatchObject({
      cachedAt: 30_000,
      expiresAt: 50_000,
    })
  })

  it("does not let an older in-flight Blob read overwrite a refreshed L1 record", async () => {
    const store = new FakeStore()
    const objectKey = createSmsCacheKey(REQUEST_PAYLOAD)
    const oldRecord = {
      version: 2,
      cachedAt: 40_000,
      expiresAt: 60_000,
      payload: {
        ...MESSAGE_SNAPSHOT,
        items: [{ ...FULL_MESSAGE, sender: "Old sender" }],
      },
    }
    let resolveRead
    store.get = vi.fn(() => new Promise((resolve) => {
      resolveRead = () => resolve(oldRecord)
    }))
    const handler = createSmsCacheHandler({
      fetchImpl: messageOriginFetch({
        ...MESSAGE_SNAPSHOT,
        items: [{ ...FULL_MESSAGE, sender: "New sender" }],
      }),
      getStoreImpl: () => store,
      nowImpl: () => 45_000,
    })

    const olderRead = handler({ request: messageRequest(), env: BASE_ENV })
    await vi.waitFor(() => expect(store.get).toHaveBeenCalledOnce())
    await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })
    resolveRead()
    await olderRead

    const current = await handler({ request: messageRequest(), env: BASE_ENV })

    expect(store.objects.get(objectKey).payload.items[0].sender).toBe("New sender")
    expect((await current.json()).items[0].sender).toBe("New sender")
  })

  it("serves a concurrent refresh when an older in-flight Blob read returns missing", async () => {
    const store = new FakeStore()
    let resolveRead
    store.get = vi.fn(() => new Promise((resolve) => {
      resolveRead = () => resolve(null)
    }))
    const handler = createSmsCacheHandler({
      fetchImpl: messageOriginFetch(MESSAGE_SNAPSHOT),
      getStoreImpl: () => store,
      nowImpl: () => 47_000,
    })

    const olderRead = handler({ request: messageRequest(), env: BASE_ENV })
    await vi.waitFor(() => expect(store.get).toHaveBeenCalledOnce())
    await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })
    resolveRead()
    const response = await olderRead

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("hit")
    expect((await response.json()).items).toEqual([MASKED_MESSAGE])
  })

  it("serves a concurrent refresh when an older in-flight Blob read fails", async () => {
    const store = new FakeStore()
    let rejectRead
    store.get = vi.fn(() => new Promise((_resolve, reject) => {
      rejectRead = () => reject(Object.assign(new Error("unavailable"), {
        code: "BLOB_UNAVAILABLE",
      }))
    }))
    const handler = createSmsCacheHandler({
      fetchImpl: messageOriginFetch(MESSAGE_SNAPSHOT),
      getStoreImpl: () => store,
      logger: vi.fn(),
      nowImpl: () => 48_000,
    })

    const olderRead = handler({ request: messageRequest(), env: BASE_ENV })
    await vi.waitFor(() => expect(store.get).toHaveBeenCalledOnce())
    await handler({
      request: messageRequest({ ...REQUEST_PAYLOAD, refresh: true }),
      env: BASE_ENV,
    })
    rejectRead()
    const response = await olderRead

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("hit")
    expect((await response.json()).items).toEqual([MASKED_MESSAGE])
  })

  it("reads plaintext snapshots without an encryption key", async () => {
    const fetchImpl = messageOriginFetch()
    const store = new FakeStore()
    store.objects.set(createSmsCacheKey(REQUEST_PAYLOAD), {
      version: 2,
      cachedAt: 3_500_000,
      expiresAt: 3_520_000,
      payload: MESSAGE_SNAPSHOT,
    })
    const getStoreImpl = vi.fn(() => store)
    const handler = createSmsCacheHandler({
      fetchImpl,
      getStoreImpl,
      nowImpl: () => 3_510_000,
    })
    const env = { ...BASE_ENV, SMS_CACHE_ENCRYPTION_KEY: "" }

    const response = await handler({ request: messageRequest(), env })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("hit")
    expect((await response.json()).items).toEqual([MASKED_MESSAGE])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(getStoreImpl).toHaveBeenCalledTimes(1)
  })

  it("keeps reading legacy encrypted snapshots during migration", async () => {
    const store = new FakeStore()
    const objectKey = createSmsCacheKey(REQUEST_PAYLOAD)
    store.objects.set(objectKey, legacyEnvelope({
      version: 2,
      cachedAt: 3_600_000,
      expiresAt: 3_620_000,
      payload: LEGACY_MESSAGE_SNAPSHOT,
    }, ENCRYPTION_KEY, objectKey))
    const handler = createSmsCacheHandler({
      fetchImpl: messageOriginFetch(),
      getStoreImpl: () => store,
      nowImpl: () => 3_610_000,
    })

    const response = await handler({ request: messageRequest(), env: BASE_ENV })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("hit")
    expect((await response.json()).items).toEqual([MASKED_MESSAGE])
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

  it("retries Store initialization after a transient failure", async () => {
    const store = new FakeStore()
    const getStoreImpl = vi.fn(() => {
      if (getStoreImpl.mock.calls.length === 1) {
        throw Object.assign(new Error("unavailable"), { code: "BLOB_UNAVAILABLE" })
      }
      return store
    })
    const handler = createSmsCacheHandler({
      fetchImpl: messageOriginFetch(),
      getStoreImpl,
      logger: vi.fn(),
    })

    const failed = await handler({ request: messageRequest(), env: BASE_ENV })
    const recovered = await handler({ request: messageRequest(), env: BASE_ENV })

    expect(failed.status).toBe(503)
    expect(recovered.status).toBe(200)
    expect(recovered.headers.get("X-SMS-Cache")).toBe("empty")
    expect(getStoreImpl).toHaveBeenCalledTimes(2)
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
  it("does not read the managed-token Blob during an ordinary cache-only request", async () => {
    const store = new FakeStore()
    const getAuthStoreImpl = vi.fn(() => new FakeStore())
    const handler = createOrdersCacheHandler({
      fetchImpl: ordersOriginFetch(),
      getStoreImpl: () => store,
      getAuthStoreImpl,
      nowImpl: () => 4_000_000,
    })
    const env = {
      ...BASE_ENV,
      KITESIM_AUTH_ENCRYPTION_KEY: ENCRYPTION_KEY,
      KITESIM_AUTH_BRIDGE_SECRET: "bridge-secret-at-least-24-characters",
    }

    const response = await handler({ request: ordersRequest(false), env })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("empty")
    expect(getAuthStoreImpl).not.toHaveBeenCalled()
  })

  it("forwards decrypted managed accounts with an HMAC signature only on refresh", async () => {
    const cacheStore = new FakeStore()
    const authStore = new FakeStore()
    const managedToken = "managed-kitesim-token-1234567890"
    const loginEmail = "admin@example.com"
    const bridgeSecret = "bridge-secret-at-least-24-characters"
    const now = 5_000_000
    authStore.objects.set(
      "managed-token/v2/login_1.json",
      managedTokenEnvelope(managedToken, ENCRYPTION_KEY, "login_1", loginEmail),
    )
    const fetchImpl = vi.fn(async (_url, options) => {
      const headers = new Headers(options.headers)
      const timestamp = String(Math.floor(now / 1000))
      const encoded = headers.get("X-Kitesim-Managed-Accounts")
      expect(encoded).toBeTruthy()
      expect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).toEqual({
        version: 1,
        accounts: [{
          accountId: "login_1",
          label: "a***n@example.com",
          token: managedToken,
        }],
      })
      expect(headers.get("X-Kitesim-Managed-Timestamp")).toBe(timestamp)
      expect(headers.get("X-Kitesim-Managed-Signature")).toBe(
        createHmac("sha256", bridgeSecret)
          .update(`${timestamp}\n${encoded}`, "utf8")
          .digest("hex"),
      )
      return new Response(JSON.stringify(ORDERS_SNAPSHOT), { status: 200 })
    })
    const getAuthStoreImpl = vi.fn(() => authStore)
    const handler = createOrdersCacheHandler({
      fetchImpl,
      getStoreImpl: () => cacheStore,
      getAuthStoreImpl,
      nowImpl: () => now,
    })
    const env = {
      ...BASE_ENV,
      KITESIM_LOGIN_EMAIL_1: loginEmail,
      KITESIM_LOGIN_PASSWORD: "fake-password-123",
      KITESIM_AUTH_ENCRYPTION_KEY: ENCRYPTION_KEY,
      KITESIM_AUTH_BRIDGE_SECRET: bridgeSecret,
    }

    const response = await handler({ request: ordersRequest(true), env })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("refreshed")
    expect(getAuthStoreImpl).toHaveBeenCalledTimes(1)
    expect(authStore.reads).toHaveLength(1)
  })

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
    const getStoreImpl = vi.fn(() => store)
    const handler = createOrdersCacheHandler({
      fetchImpl,
      getStoreImpl,
      nowImpl: () => 5_000_000,
    })
    const env = { ...BASE_ENV, SMS_CACHE_ENCRYPTION_KEY: "" }

    const refreshed = await handler({ request: ordersRequest(true), env })
    const cached = await handler({ request: ordersRequest(), env })

    expect(refreshed.headers.get("X-SMS-Cache")).toBe("refreshed")
    expect(cached.headers.get("X-SMS-Cache")).toBe("hit")
    expect((await cached.json()).items).toEqual(ORDERS_SNAPSHOT.items)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.writes).toHaveLength(1)
    expect(store.reads).toHaveLength(0)
    expect(getStoreImpl).toHaveBeenCalledTimes(1)
  })

  it("starts the orders TTL after a slow origin request completes", async () => {
    const store = new FakeStore()
    let now = 0
    const fetchImpl = vi.fn(async () => {
      now = 30_000
      return new Response(JSON.stringify(ORDERS_SNAPSHOT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    const handler = createOrdersCacheHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => now,
    })

    await handler({ request: ordersRequest(true), env: BASE_ENV })
    const cached = await handler({ request: ordersRequest(), env: BASE_ENV })

    expect(cached.headers.get("X-SMS-Cache")).toBe("hit")
    expect(store.writes[0].value).toMatchObject({
      cachedAt: 30_000,
      expiresAt: 50_000,
    })
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

  it("routes local Makers refreshes from the Node worker back through the public dev port", async () => {
    const store = new FakeStore()
    const fetchImpl = vi.fn(async (url) => {
      expect(String(url)).toBe(
        "http://127.0.0.1:8088/origin/orders-origin?status=2&limit=20",
      )
      return new Response(JSON.stringify(ORDERS_SNAPSHOT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    const handler = createOrdersCacheHandler({ fetchImpl, getStoreImpl: () => store })
    const request = new Request(
      "http://localhost:9000/api/orders?status=2&limit=20&refresh=1",
      {
        headers: {
          "Authorization": `Bearer ${ACCESS_KEY}`,
          "x-forwarded-host": "127.0.0.1:8088",
          "x-forwarded-port": "8088",
          "x-forwarded-proto": "http",
        },
      },
    )

    const response = await handler({ request, env: BASE_ENV })

    expect(response.status).toBe(200)
    expect(response.headers.get("X-SMS-Cache")).toBe("refreshed")
  })

  it("does not forward dashboard credentials to an arbitrary eo-pages-host", async () => {
    const store = new FakeStore()
    const fetchImpl = vi.fn(async (url) => {
      expect(String(url)).toBe(
        "https://internal.function.example/origin/orders-origin?status=2&limit=20",
      )
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
          "eo-pages-host": "169.254.169.254",
          "x-forwarded-proto": "https",
        },
      },
    )

    const response = await handler({ request, env: BASE_ENV })

    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("forwards only validated status and limit parameters to the orders origin", async () => {
    const store = new FakeStore()
    const fetchImpl = vi.fn(async (url) => {
      expect(String(url)).toBe("https://example.com/origin/orders-origin?status=2&limit=20")
      return new Response(JSON.stringify(ORDERS_SNAPSHOT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    const handler = createOrdersCacheHandler({ fetchImpl, getStoreImpl: () => store })
    const request = new Request(
      "https://example.com/api/orders?status=2&limit=20&refresh=1&phone=%2B15551234567&unexpected=value",
      { headers: { "Authorization": `Bearer ${ACCESS_KEY}` } },
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
