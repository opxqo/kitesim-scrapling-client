import { createHmac } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import {
  createAuthChallengeHandler,
  createAuthCompleteHandler,
  createAuthStatusHandler,
  createManagedTokenBridgeHeaders,
} from "../_shared/kitesim_auth.js"


const ACCESS_KEY = "dashboard-test-key"
const LOGIN_EMAIL = "admin@example.com"
const LOGIN_PASSWORD = "fake-password-123"
const TOKEN = "managed-kitesim-token-1234567890"
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64")
const BRIDGE_SECRET = "bridge-secret-at-least-24-characters"
const NOW = Date.parse("2026-08-08T10:00:00.000Z")
const BASE_ENV = {
  DASHBOARD_ACCESS_KEY: ACCESS_KEY,
  KITESIM_LOGIN_EMAIL: LOGIN_EMAIL,
  KITESIM_LOGIN_PASSWORD: LOGIN_PASSWORD,
  KITESIM_AUTH_ENCRYPTION_KEY: ENCRYPTION_KEY,
  KITESIM_AUTH_BRIDGE_SECRET: BRIDGE_SECRET,
}


class FakeStore {
  constructor() {
    this.objects = new Map()
    this.reads = []
    this.writes = []
  }

  async get(key, options) {
    this.reads.push({ key, options })
    return this.objects.get(key) ?? null
  }

  async setJSON(key, value, options) {
    this.objects.set(key, value)
    this.writes.push({ key, value, options })
  }
}


function request(path, options = {}) {
  return new Request(`https://example.com/api/auth/${path}`, {
    ...options,
    headers: { "Authorization": `Bearer ${ACCESS_KEY}`, ...options.headers },
  })
}


function challengeResponse() {
  const image = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(120, 7),
  ])
  return new Response(JSON.stringify({
    captchaKey: "captcha:0123456789abcdef",
    captchaImageBase64: image.toString("base64"),
  }), { status: 200 })
}


function successfulLoginFetch() {
  return vi.fn(async (url, options) => {
    if (String(url).endsWith("/index/sign-in")) {
      expect(options.method).toBe("POST")
      const payload = JSON.parse(String(options.body))
      expect(payload).toEqual({
        email: LOGIN_EMAIL,
        pass: LOGIN_PASSWORD,
        captchaCode: "A7B9",
        captchaKey: "captcha:0123456789abcdef",
      })
      return new Response(JSON.stringify({ code: 200, message: "ok", data: TOKEN }), {
        status: 200,
      })
    }
    if (String(url).endsWith("/user/info")) {
      expect(new Headers(options.headers).get("token")).toBe(TOKEN)
      return new Response(JSON.stringify({ code: 200, data: { email: LOGIN_EMAIL } }), {
        status: 200,
      })
    }
    throw new Error(`unexpected URL: ${url}`)
  })
}


describe("EdgeOne Kitesim managed login", () => {
  it("rejects an invalid dashboard key before touching Kitesim or Blob", async () => {
    const fetchImpl = vi.fn()
    const getStoreImpl = vi.fn()
    const handler = createAuthChallengeHandler({ fetchImpl, getStoreImpl })
    const response = await handler({
      request: request("challenge", { headers: { "Authorization": "Bearer wrong-key-123" } }),
      env: BASE_ENV,
    })

    expect(response.status).toBe(401)
    expect((await response.json()).kind).toBe("dashboard_auth")
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(getStoreImpl).not.toHaveBeenCalled()
  })

  it("reports configuration status without returning credentials", async () => {
    const handler = createAuthStatusHandler()
    const response = await handler({
      request: request("status"),
      env: { DASHBOARD_ACCESS_KEY: ACCESS_KEY },
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      configured: false,
      credentialsConfigured: false,
      storageConfigured: false,
      tokenAvailable: false,
    })
    expect(JSON.stringify(payload)).not.toContain("password")
    expect(JSON.stringify(payload)).not.toContain("token-123")
  })

  it("returns a validated CAPTCHA image and a masked account hint", async () => {
    const fetchImpl = vi.fn(async () => challengeResponse())
    const handler = createAuthChallengeHandler({ fetchImpl })
    const response = await handler({ request: request("challenge"), env: BASE_ENV })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.captchaKey).toBe("captcha:0123456789abcdef")
    expect(payload.captchaImageBase64.length).toBeGreaterThan(100)
    expect(payload.emailHint).toBe("a***n@example.com")
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kitesim.co/index/captcha-image-base64",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("logs in, verifies the account, and stores only an encrypted token record", async () => {
    const store = new FakeStore()
    const fetchImpl = successfulLoginFetch()
    const handler = createAuthCompleteHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => NOW,
      randomBytesImpl: () => Buffer.alloc(12, 4),
    })
    const response = await handler({
      request: request("complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captchaCode: "A7B9",
          captchaKey: "captcha:0123456789abcdef",
        }),
      }),
      env: BASE_ENV,
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      tokenAvailable: true,
      verifiedAt: "2026-08-08T10:00:00.000Z",
      emailHint: "a***n@example.com",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0].key).toBe("managed-token/v1.json")
    expect(store.writes[0].value).toMatchObject({ version: 1, algorithm: "A256GCM" })
    expect(store.writes[0].options).toEqual({ cacheControl: "no-store" })
    const serializedRecord = JSON.stringify(store.writes[0].value)
    expect(serializedRecord).not.toContain(TOKEN)
    expect(serializedRecord).not.toContain(LOGIN_EMAIL)
    expect(serializedRecord).not.toContain(LOGIN_PASSWORD)

    const statusHandler = createAuthStatusHandler({ getStoreImpl: () => store })
    const statusResponse = await statusHandler({ request: request("status"), env: BASE_ENV })
    expect(await statusResponse.json()).toMatchObject({
      configured: true,
      tokenAvailable: true,
      verifiedAt: "2026-08-08T10:00:00.000Z",
    })
  })

  it("creates a short-lived signed bridge header only after decrypting Blob", async () => {
    const store = new FakeStore()
    const loginHandler = createAuthCompleteHandler({
      fetchImpl: successfulLoginFetch(),
      getStoreImpl: () => store,
      nowImpl: () => NOW,
      randomBytesImpl: () => Buffer.alloc(12, 4),
    })
    await loginHandler({
      request: request("complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captchaCode: "A7B9",
          captchaKey: "captcha:0123456789abcdef",
        }),
      }),
      env: BASE_ENV,
    })

    const headers = await createManagedTokenBridgeHeaders(
      { env: BASE_ENV },
      { getStoreImpl: () => store, nowImpl: () => NOW },
    )
    const timestamp = String(Math.floor(NOW / 1000))
    const expectedSignature = createHmac("sha256", BRIDGE_SECRET)
      .update(`${timestamp}\n${TOKEN}`, "utf8")
      .digest("hex")

    expect(headers).toEqual({
      "X-Kitesim-Managed-Token": TOKEN,
      "X-Kitesim-Managed-Timestamp": timestamp,
      "X-Kitesim-Managed-Signature": expectedSignature,
    })
    expect(store.reads.at(-1)?.options).toMatchObject({ consistency: "strong" })
  })

  it("does not store a token when the CAPTCHA fails", async () => {
    const store = new FakeStore()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 400,
      message: "captcha verification failed",
    }), { status: 200 }))
    const handler = createAuthCompleteHandler({ fetchImpl, getStoreImpl: () => store })
    const response = await handler({
      request: request("complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captchaCode: "A7B9",
          captchaKey: "captcha:0123456789abcdef",
        }),
      }),
      env: BASE_ENV,
    })

    expect(response.status).toBe(400)
    expect((await response.json()).kind).toBe("captcha")
    expect(store.writes).toHaveLength(0)
  })

  it("does not store a token when it belongs to another account", async () => {
    const store = new FakeStore()
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("/index/sign-in")) {
        return new Response(JSON.stringify({ code: 200, data: TOKEN }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 200, data: { email: "other@example.com" } }), {
        status: 200,
      })
    })
    const handler = createAuthCompleteHandler({ fetchImpl, getStoreImpl: () => store })
    const response = await handler({
      request: request("complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captchaCode: "A7B9",
          captchaKey: "captcha:0123456789abcdef",
        }),
      }),
      env: BASE_ENV,
    })

    expect(response.status).toBe(502)
    expect((await response.json()).kind).toBe("upstream_auth")
    expect(store.writes).toHaveLength(0)
  })
})
