import { createHmac } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import {
  createAuthChallengeHandler,
  createAuthCompleteHandler,
  createAuthMaintenanceHandler,
  createAuthStatusHandler,
  createManagedTokenBridgeHeaders,
  maintainManagedAccounts,
  solveCaptchaWithAI,
} from "../_shared/kitesim_auth.js"


const ACCESS_KEY = "dashboard-test-key"
const LOGIN_PASSWORD = "fake-password-123"
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64")
const BRIDGE_SECRET = "bridge-secret-at-least-24-characters"
const AI_API_KEY = "test-ai-gateway-key-without-real-secret"
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
const AUTOMATION_ENV = {
  ...BASE_ENV,
  KITESIM_AUTH_AUTOMATION_ENABLED: "true",
  KITESIM_AI_BASE_URL: "https://ai.example.com/compat/v1",
  KITESIM_AI_API_KEY: AI_API_KEY,
  KITESIM_AI_MODEL: "test/vision-model",
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


function captchaImageBase64() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(120, 7),
  ]).toString("base64")
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
    const response = await handler({ request: request("status"), env: AUTOMATION_ENV })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      configured: true,
      credentialsConfigured: true,
      storageConfigured: true,
      automation: {
        enabled: true,
        configured: true,
        gatewayConfigured: true,
        model: "test/vision-model",
        maintenance: null,
      },
      accountCount: 2,
      readyCount: 0,
    })
    expect(payload.accounts.map((account) => account.accountId)).toEqual(["login_1", "login_2"])
    expect(payload.accounts.map((account) => account.emailHint)).toEqual(ACCOUNTS.map((account) => account.hint))
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain(LOGIN_PASSWORD)
    expect(serialized).not.toContain(ACCOUNTS[0].email)
    expect(serialized).not.toContain(ACCOUNTS[0].token)
    expect(serialized).not.toContain(AI_API_KEY)
  })

  it("does not mistake EdgeOne's reserved AI_GATEWAY variables for the custom Kitesim gateway", async () => {
    const store = new FakeStore()
    const handler = createAuthStatusHandler({ getStoreImpl: () => store })
    const response = await handler({
      request: request("status"),
      env: {
        ...BASE_ENV,
        KITESIM_AUTH_AUTOMATION_ENABLED: "true",
        AI_GATEWAY_BASE_URL: "https://ai-gateway.edgeone.link/v1",
        AI_GATEWAY_API_KEY: "reserved-edgeone-key-not-for-kitesim",
      },
    })
    const payload = await response.json()

    expect(payload.automation).toMatchObject({
      enabled: true,
      configured: false,
      gatewayConfigured: false,
    })
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

  it("sends only the CAPTCHA image to the OpenAI-compatible vision endpoint", async () => {
    const image = captchaImageBase64()
    const fetchImpl = vi.fn(async (url, options) => {
      expect(String(url)).toBe("https://ai.example.com/compat/v1/chat/completions")
      const headers = new Headers(options.headers)
      expect(headers.get("Authorization")).toBe(`Bearer ${AI_API_KEY}`)
      const body = JSON.parse(String(options.body))
      expect(body.model).toBe("test/vision-model")
      expect(body.messages[0].content[1].image_url.url).toBe(`data:image/png;base64,${image}`)
      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain(LOGIN_PASSWORD)
      expect(serialized).not.toContain(ACCOUNTS[0].email)
      expect(serialized).not.toContain(ACCOUNTS[0].token)
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{\"code\":\"a7b9\"}" } }],
      }), { status: 200 })
    })

    const result = await solveCaptchaWithAI(
      { env: AUTOMATION_ENV },
      image,
      { fetchImpl },
    )

    expect(result).toEqual({ ok: true, code: "A7B9" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("rejects explanatory or malformed model output instead of guessing a code", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "The code is A7B9." } }],
    }), { status: 200 }))

    const result = await solveCaptchaWithAI(
      { env: AUTOMATION_ENV },
      captchaImageBase64(),
      { fetchImpl },
    )

    expect(result).toEqual({ ok: false, kind: "output" })
  })

  it("automatically logs in missing accounts, encrypts their tokens, and observes cooldown", async () => {
    const store = new FakeStore()
    const tokenByEmail = new Map(ACCOUNTS.map((account) => [account.email, account.token]))
    const emailByToken = new Map(ACCOUNTS.map((account) => [account.token, account.email]))
    const fetchImpl = vi.fn(async (url, options) => {
      const target = String(url)
      if (target.endsWith("/index/captcha-image-base64")) return challengeResponse()
      if (target.endsWith("/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{\"code\":\"A7B9\"}" } }],
        }), { status: 200 })
      }
      if (target.endsWith("/index/sign-in")) {
        const body = JSON.parse(String(options.body))
        expect(body.pass).toBe(LOGIN_PASSWORD)
        expect(body.captchaCode).toBe("A7B9")
        return new Response(JSON.stringify({ code: 200, data: tokenByEmail.get(body.email) }), {
          status: 200,
        })
      }
      if (target.endsWith("/user/info")) {
        const token = new Headers(options.headers).get("token")
        return new Response(JSON.stringify({ code: 200, data: { email: emailByToken.get(token) } }), {
          status: 200,
        })
      }
      throw new Error(`unexpected URL: ${url}`)
    })

    const first = await maintainManagedAccounts(
      { env: AUTOMATION_ENV },
      {
        fetchImpl,
        getStoreImpl: () => store,
        nowImpl: () => NOW,
        randomBytesImpl: () => Buffer.alloc(12, 6),
        source: "schedule",
      },
    )

    expect(first).toMatchObject({
      ok: true,
      skipped: false,
      state: "success",
      accountCount: 2,
      healthyCount: 0,
      reloggedCount: 2,
      failedCount: 0,
    })
    expect(first.accounts.map((account) => account.state)).toEqual(["relogged", "relogged"])
    expect(store.objects.has("managed-token/v2/login_1.json")).toBe(true)
    expect(store.objects.has("managed-token/v2/login_2.json")).toBe(true)
    expect(store.objects.has("automation/v1/status.json")).toBe(true)
    const stored = JSON.stringify([...store.objects.values()])
    expect(stored).not.toContain(LOGIN_PASSWORD)
    expect(stored).not.toContain(ACCOUNTS[0].token)
    expect(stored).not.toContain(ACCOUNTS[1].token)

    const callCount = fetchImpl.mock.calls.length
    const second = await maintainManagedAccounts(
      { env: AUTOMATION_ENV },
      { fetchImpl, getStoreImpl: () => store, nowImpl: () => NOW, source: "schedule" },
    )
    expect(second).toMatchObject({ ok: true, skipped: true, state: "success" })
    expect(fetchImpl).toHaveBeenCalledTimes(callCount)
  })

  it("does not retry a CAPTCHA request when the custom gateway rejects its API key", async () => {
    const store = new FakeStore()
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("/index/captcha-image-base64")) return challengeResponse()
      if (String(url).endsWith("/chat/completions")) {
        return new Response(JSON.stringify({ error: { message: "unauthorized" } }), { status: 401 })
      }
      throw new Error(`unexpected URL: ${url}`)
    })
    const result = await maintainManagedAccounts(
      {
        env: {
          ...AUTOMATION_ENV,
          KITESIM_LOGIN_EMAIL_2: "",
        },
      },
      { fetchImpl, getStoreImpl: () => store, nowImpl: () => NOW, force: true },
    )

    expect(result).toMatchObject({ ok: true, state: "attention", failedCount: 1 })
    expect(result.accounts[0].message).toBe("AI 网关密钥被拒绝")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("rejects an unmarked public maintenance call before contacting any upstream", async () => {
    const fetchImpl = vi.fn()
    const handler = createAuthMaintenanceHandler({
      fetchImpl,
      getStoreImpl: () => new FakeStore(),
      nowImpl: () => NOW,
    })
    const rejected = await handler({
      request: new Request("https://example.com/api/auth/maintain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "unknown", version: 1 }),
      }),
      env: AUTOMATION_ENV,
    })

    expect(rejected.status).toBe(401)
    expect((await rejected.json()).kind).toBe("dashboard_auth")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("lets the daily schedule validate healthy tokens without invoking the vision model", async () => {
    const store = new FakeStore()
    await loginAccount(store, ACCOUNTS[0])
    await loginAccount(store, ACCOUNTS[1])
    const emailByToken = new Map(ACCOUNTS.map((account) => [account.token, account.email]))
    const fetchImpl = vi.fn(async (url, options) => {
      expect(String(url)).toBe("https://api.kitesim.co/user/info")
      const token = new Headers(options.headers).get("token")
      return new Response(JSON.stringify({ code: 200, data: { email: emailByToken.get(token) } }), {
        status: 200,
      })
    })
    const handler = createAuthMaintenanceHandler({
      fetchImpl,
      getStoreImpl: () => store,
      nowImpl: () => NOW + 1_000,
    })
    const response = await handler({
      request: new Request("https://example.com/api/auth/maintain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "edgeone-schedule", version: 1 }),
      }),
      env: AUTOMATION_ENV,
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ ok: true, skipped: false })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain(ACCOUNTS[0].token)
    expect(serialized).not.toContain(ACCOUNTS[1].token)
    expect(serialized).not.toContain(ACCOUNTS[0].hint)
    expect(serialized).not.toContain(ACCOUNTS[1].hint)
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
