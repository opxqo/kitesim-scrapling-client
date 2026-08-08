import { createHmac } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import {
  createAuthChallengeHandler,
  createAuthCompleteHandler,
  createAuthStatusHandler,
  createManagedTokenBridgeHeaders,
} from "../_shared/kitesim_auth.js"


const ACCESS_KEY = "dashboard-test-key"
const LOGIN_PASSWORD = "fake-password-123"
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64")
const BRIDGE_SECRET = "bridge-secret-at-least-24-characters"
const NOW = Date.parse("2026-08-08T10:00:00.000Z")
const ACCOUNTS = [
  { accountId: "login_1", email: "admin@example.com", hint: "a***n@example.com", token: "managed-primary-token-1234567890" },
  { accountId: "login_2", email: "backup@example.com", hint: "b***p@example.com", token: "managed-backup-token-1234567890" },
]
const BASE_ENV = {
  DASHBOARD_ACCESS_KEY: ACCESS_KEY,
  KITESIM_LOGIN_EMAIL_1: ACCOUNTS[0].email,
  KITESIM_LOGIN_EMAIL_2: ACCOUNTS[1].email,
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


function successfulLoginFetch(account) {
  return vi.fn(async (url, options) => {
    if (String(url).endsWith("/index/sign-in")) {
      expect(options.method).toBe("POST")
      expect(JSON.parse(String(options.body))).toEqual({
        email: account.email,
        pass: LOGIN_PASSWORD,
        captchaCode: "A7B9",
        captchaKey: "captcha:0123456789abcdef",
      })
      return new Response(JSON.stringify({ code: 200, message: "ok", data: account.token }), {
        status: 200,
      })
    }
    if (String(url).endsWith("/user/info")) {
      expect(new Headers(options.headers).get("token")).toBe(account.token)
      return new Response(JSON.stringify({ code: 200, data: { email: account.email } }), {
        status: 200,
      })
    }
    throw new Error(`unexpected URL: ${url}`)
  })
}


async function loginAccount(store, account) {
  const handler = createAuthCompleteHandler({
    fetchImpl: successfulLoginFetch(account),
    getStoreImpl: () => store,
    nowImpl: () => NOW,
    randomBytesImpl: () => Buffer.alloc(12, account.accountId === "login_1" ? 4 : 5),
  })
  return handler({
    request: request("complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.accountId,
        captchaCode: "A7B9",
        captchaKey: "captcha:0123456789abcdef",
      }),
    }),
    env: BASE_ENV,
  })
}


describe("EdgeOne Kitesim managed multi-account login", () => {
  it("rejects an invalid dashboard key before touching Kitesim or Blob", async () => {
    const fetchImpl = vi.fn()
    const getStoreImpl = vi.fn()
    const handler = createAuthChallengeHandler({ fetchImpl, getStoreImpl })
    const response = await handler({
      request: request("challenge?accountId=login_1", {
        headers: { "Authorization": "Bearer wrong-key-123" },
      }),
      env: BASE_ENV,
    })

    expect(response.status).toBe(401)
    expect((await response.json()).kind).toBe("dashboard_auth")
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(getStoreImpl).not.toHaveBeenCalled()
  })

  it("reports all configured accounts without returning credentials", async () => {
    const store = new FakeStore()
    const handler = createAuthStatusHandler({ getStoreImpl: () => store })
    const response = await handler({ request: request("status"), env: BASE_ENV })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      configured: true,
      credentialsConfigured: true,
      storageConfigured: true,
      accountCount: 2,
      readyCount: 0,
    })
    expect(payload.accounts.map((account) => account.accountId)).toEqual(["login_1", "login_2"])
    expect(payload.accounts.map((account) => account.emailHint)).toEqual(ACCOUNTS.map((account) => account.hint))
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain(LOGIN_PASSWORD)
    expect(serialized).not.toContain(ACCOUNTS[0].email)
    expect(serialized).not.toContain(ACCOUNTS[0].token)
  })

  it("requires a configured account and returns its masked hint with the CAPTCHA", async () => {
    const fetchImpl = vi.fn(async () => challengeResponse())
    const handler = createAuthChallengeHandler({ fetchImpl })
    const invalid = await handler({
      request: request("challenge?accountId=login_3"),
      env: BASE_ENV,
    })
    const response = await handler({
      request: request("challenge?accountId=login_2"),
      env: BASE_ENV,
    })
    const payload = await response.json()

    expect(invalid.status).toBe(400)
    expect(response.status).toBe(200)
    expect(payload.accountId).toBe("login_2")
    expect(payload.captchaKey).toBe("captcha:0123456789abcdef")
    expect(payload.captchaImageBase64.length).toBeGreaterThan(100)
    expect(payload.emailHint).toBe(ACCOUNTS[1].hint)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("logs in one selected account and stores only its encrypted token record", async () => {
    const store = new FakeStore()
    const response = await loginAccount(store, ACCOUNTS[1])
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      ok: true,
      accountId: "login_2",
      tokenAvailable: true,
      verifiedAt: "2026-08-08T10:00:00.000Z",
      emailHint: ACCOUNTS[1].hint,
    })
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0].key).toBe("managed-token/v2/login_2.json")
    expect(store.writes[0].value).toMatchObject({ version: 2, algorithm: "A256GCM" })
    expect(store.writes[0].options).toEqual({ cacheControl: "no-store" })
    const serializedRecord = JSON.stringify(store.writes[0].value)
    expect(serializedRecord).not.toContain(ACCOUNTS[1].token)
    expect(serializedRecord).not.toContain(ACCOUNTS[1].email)
    expect(serializedRecord).not.toContain(LOGIN_PASSWORD)

    const statusHandler = createAuthStatusHandler({ getStoreImpl: () => store })
    const statusResponse = await statusHandler({ request: request("status"), env: BASE_ENV })
    const status = await statusResponse.json()
    expect(status.readyCount).toBe(1)
    expect(status.accounts.find((account) => account.accountId === "login_2")).toMatchObject({
      tokenAvailable: true,
      verifiedAt: "2026-08-08T10:00:00.000Z",
    })
  })

  it("creates one short-lived signed bridge containing all decrypted accounts", async () => {
    const store = new FakeStore()
    await loginAccount(store, ACCOUNTS[0])
    await loginAccount(store, ACCOUNTS[1])

    const headers = await createManagedTokenBridgeHeaders(
      { env: BASE_ENV },
      { getStoreImpl: () => store, nowImpl: () => NOW },
    )
    const timestamp = String(Math.floor(NOW / 1000))
    const encoded = headers["X-Kitesim-Managed-Accounts"]
    const expectedSignature = createHmac("sha256", BRIDGE_SECRET)
      .update(`${timestamp}\n${encoded}`, "utf8")
      .digest("hex")
    const bridge = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))

    expect(headers["X-Kitesim-Managed-Timestamp"]).toBe(timestamp)
    expect(headers["X-Kitesim-Managed-Signature"]).toBe(expectedSignature)
    expect(headers["X-Kitesim-Managed-Token"]).toBeUndefined()
    expect(bridge).toEqual({
      version: 1,
      accounts: ACCOUNTS.map((account) => ({
        accountId: account.accountId,
        label: account.hint,
        token: account.token,
      })),
    })
    expect(store.reads.every((read) => read.options.consistency === "strong")).toBe(true)
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
          accountId: "login_1",
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
        return new Response(JSON.stringify({ code: 200, data: ACCOUNTS[0].token }), { status: 200 })
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
          accountId: "login_1",
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
