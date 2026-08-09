import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import { getStore } from "@edgeone/pages-blob"


const ACCESS_KEY_MIN_LENGTH = 12
const AUTH_STORE_NAME = "kitesim-auth"
const TOKEN_OBJECT_PREFIX = "managed-token/v2"
const MAINTENANCE_OBJECT_KEY = "automation/v1/status.json"
const TOKEN_RECORD_VERSION = 2
const MAINTENANCE_RECORD_VERSION = 1
const MAX_LOGIN_ACCOUNTS = 20
const MAX_BRIDGE_PAYLOAD_BYTES = 16 * 1024
const MAX_REQUEST_BODY_BYTES = 2 * 1024
const MAX_UPSTREAM_BODY_BYTES = 2 * 1024 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_AI_TIMEOUT_MS = 12_000
const DEFAULT_MAINTENANCE_INTERVAL_MS = 20 * 60 * 60 * 1000
const DEFAULT_FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000
const DEFAULT_MAINTENANCE_DEADLINE_MS = 50_000
const DEFAULT_AI_GATEWAY_BASE_URL = "https://ai.opxqo.com/compat/v1"
const DEFAULT_CAPTCHA_MODEL = "google-ai-studio/gemini-3.1-flash-lite-preview"
const SCHEDULE_SOURCE = "edgeone-schedule"
const CAPTCHA_ENDPOINT = "https://api.kitesim.co/index/captcha-image-base64"
const LOGIN_ENDPOINT = "https://api.kitesim.co/index/sign-in"
const USER_INFO_ENDPOINT = "https://api.kitesim.co/user/info"
const KITESIM_REFERER = "https://h5.kitesim.co/"
const KITESIM_ORIGIN = "https://h5.kitesim.co"

let maintenanceInFlight = null


function environmentValue(context, name) {
  const contextValue = context?.env?.[name]
  const processValue = typeof process !== "undefined" ? process.env?.[name] : undefined
  return String(contextValue ?? processValue ?? "").trim()
}


function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}


function normalizedHttpsBaseUrl(value) {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return ""
    return url.toString().replace(/\/+$/, "")
  } catch {
    return ""
  }
}


function apiHeaders() {
  return new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  })
}


function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: apiHeaders(),
  })
}


function errorResponse(message, status, kind) {
  return jsonResponse({ error: message, kind }, status)
}


function providedAccessKey(request) {
  const authorization = request.headers.get("Authorization") || ""
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim()
  }
  return (request.headers.get("X-Dashboard-Key") || "").trim()
}


function secretsEqual(left, right) {
  const leftBytes = Buffer.from(left, "utf8")
  const rightBytes = Buffer.from(right, "utf8")
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}


function authorizeRequest(context, request) {
  const expected = environmentValue(context, "DASHBOARD_ACCESS_KEY")
  if (expected.length < ACCESS_KEY_MIN_LENGTH) {
    return errorResponse("服务端尚未配置安全访问口令", 503, "configuration")
  }
  const supplied = providedAccessKey(request)
  if (!supplied || !secretsEqual(supplied, expected)) {
    return errorResponse("访问口令无效", 401, "dashboard_auth")
  }
  return null
}


function decodeEncryptionKey(context) {
  const encoded = environmentValue(context, "KITESIM_AUTH_ENCRYPTION_KEY").replace(/\s+/g, "")
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
  const decoded = Buffer.from(encoded, "base64")
  return decoded.length === 32 ? decoded : null
}


function emailHint(email) {
  const [local, domain] = email.split("@", 2)
  if (!local || !domain) return ""
  if (local.length <= 2) return `${local[0] || "*"}***@${domain}`
  return `${local[0]}***${local.at(-1)}@${domain}`
}


function tokenObjectKey(accountId) {
  return `${TOKEN_OBJECT_PREFIX}/${accountId}.json`
}


function loginAccounts(context) {
  const accounts = []
  for (let index = 1; index <= MAX_LOGIN_ACCOUNTS; index += 1) {
    const email = environmentValue(context, `KITESIM_LOGIN_EMAIL_${index}`).toLowerCase()
    if (!email) continue
    accounts.push({
      accountId: `login_${index}`,
      email,
      emailHint: emailHint(email),
      valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    })
  }
  return accounts
}


function authConfiguration(context) {
  const accounts = loginAccounts(context)
  const password = environmentValue(context, "KITESIM_LOGIN_PASSWORD")
  const encryptionKey = decodeEncryptionKey(context)
  const bridgeSecret = environmentValue(context, "KITESIM_AUTH_BRIDGE_SECRET")
  const credentialsConfigured = accounts.length > 0
    && accounts.every((account) => account.valid)
    && password.length >= 8
    && password.length <= 256
  const storageConfigured = Boolean(encryptionKey) && bridgeSecret.length >= 24
  return {
    accounts,
    password,
    encryptionKey,
    bridgeSecret,
    credentialsConfigured,
    storageConfigured,
    configured: credentialsConfigured && storageConfigured,
  }
}


function automationConfiguration(context) {
  const enabled = environmentValue(context, "KITESIM_AUTH_AUTOMATION_ENABLED").toLowerCase() === "true"
  const baseUrl = normalizedHttpsBaseUrl(
    environmentValue(context, "KITESIM_AI_BASE_URL") || DEFAULT_AI_GATEWAY_BASE_URL,
  )
  const apiKey = environmentValue(context, "KITESIM_AI_API_KEY")
  const model = environmentValue(context, "KITESIM_AI_MODEL") || DEFAULT_CAPTCHA_MODEL
  const modelValid = /^[A-Za-z0-9._:/-]{3,160}$/.test(model)
  const requestTimeoutMs = boundedInteger(
    environmentValue(context, "KITESIM_REQUEST_TIMEOUT"),
    5,
    20,
    Math.floor(DEFAULT_REQUEST_TIMEOUT_MS / 1000),
  ) * 1000
  const aiTimeoutMs = boundedInteger(
    environmentValue(context, "KITESIM_AI_TIMEOUT_SECONDS"),
    5,
    20,
    Math.floor(DEFAULT_AI_TIMEOUT_MS / 1000),
  ) * 1000
  const maxAttempts = boundedInteger(
    environmentValue(context, "KITESIM_AUTH_MAX_CAPTCHA_ATTEMPTS"),
    1,
    3,
    3,
  )
  const intervalMs = boundedInteger(
    environmentValue(context, "KITESIM_AUTH_MAINTENANCE_INTERVAL_HOURS"),
    6,
    168,
    Math.floor(DEFAULT_MAINTENANCE_INTERVAL_MS / 3_600_000),
  ) * 3_600_000
  return {
    enabled,
    baseUrl,
    apiKey,
    model,
    requestTimeoutMs,
    aiTimeoutMs,
    maxAttempts,
    intervalMs,
    configured: Boolean(baseUrl && apiKey.length >= 16 && apiKey.length <= 2048 && modelValid),
  }
}


function configuredAccount(configuration, accountId) {
  return configuration.accounts.find((account) => account.accountId === accountId) || null
}


function upstreamHeaders(contentType = false, token = "") {
  const headers = new Headers({
    "Accept": "application/json",
    "Origin": KITESIM_ORIGIN,
    "Referer": KITESIM_REFERER,
    "User-Agent": "Mozilla/5.0 (compatible; KitesimRelay/1.0)",
  })
  if (contentType) headers.set("Content-Type", "application/json")
  if (token) headers.set("token", token)
  return headers
}


async function fetchJson(fetchImpl, url, options, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(url, { ...options, signal: controller.signal })
  } catch {
    return { ok: false, status: 502, payload: null, kind: "network" }
  } finally {
    clearTimeout(timeout)
  }

  const body = await response.text()
  if (Buffer.byteLength(body, "utf8") > MAX_UPSTREAM_BODY_BYTES) {
    return { ok: false, status: 502, payload: null, kind: "payload" }
  }
  let payload = null
  try {
    payload = JSON.parse(body)
  } catch {
    // Upstream format failures are converted to a redacted gateway response.
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, status: 502, payload: null, kind: "format" }
  }
  return { ok: response.ok, status: response.status, payload, kind: "" }
}


function validCaptchaPayload(payload) {
  const key = String(payload?.captchaKey || "")
  const image = String(payload?.captchaImageBase64 || "")
  if (
    !/^captcha:[A-Za-z0-9_-]{8,96}$/.test(key)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)
    || image.length < 100
    || image.length > 1_500_000
  ) {
    return false
  }
  const imageBytes = Buffer.from(image, "base64")
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return imageBytes.length >= 8 && imageBytes.subarray(0, 8).equals(pngSignature)
}


function validCompletePayload(payload) {
  return Boolean(
    payload
      && typeof payload === "object"
      && !Array.isArray(payload)
      && /^login_(?:[1-9]|1\d|20)$/.test(String(payload.accountId || "").trim())
      && /^[A-Za-z0-9]{4}$/.test(String(payload.captchaCode || "").trim())
      && /^captcha:[A-Za-z0-9_-]{8,96}$/.test(String(payload.captchaKey || "").trim()),
  )
}


async function requestObject(request) {
  const declaredLength = Number.parseInt(request.headers.get("Content-Length") || "0", 10)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) return null
  const body = await request.text()
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BODY_BYTES) return null
  try {
    const payload = JSON.parse(body)
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null
  } catch {
    return null
  }
}


function encryptTokenRecord(token, account, encryptionKey, verifiedAt, randomBytesImpl) {
  const objectKey = tokenObjectKey(account.accountId)
  const iv = randomBytesImpl(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv)
  cipher.setAAD(Buffer.from(objectKey, "utf8"))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ token }), "utf8"),
    cipher.final(),
  ])
  return {
    version: TOKEN_RECORD_VERSION,
    algorithm: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    emailHash: createHash("sha256").update(account.email, "utf8").digest("hex"),
    verifiedAt,
  }
}


function decryptTokenRecord(record, account, encryptionKey) {
  if (
    !record
    || typeof record !== "object"
    || record.version !== TOKEN_RECORD_VERSION
    || record.algorithm !== "A256GCM"
    || record.emailHash !== createHash("sha256").update(account.email, "utf8").digest("hex")
  ) {
    return null
  }
  try {
    const iv = Buffer.from(String(record.iv || ""), "base64")
    const tag = Buffer.from(String(record.tag || ""), "base64")
    const ciphertext = Buffer.from(String(record.ciphertext || ""), "base64")
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) return null
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv)
    decipher.setAAD(Buffer.from(tokenObjectKey(account.accountId), "utf8"))
    decipher.setAuthTag(tag)
    const payload = JSON.parse(Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8"))
    const token = String(payload?.token || "").trim()
    if (token.length < 16 || token.length > 512) return null
    return { token, verifiedAt: String(record.verifiedAt || "") }
  } catch {
    return null
  }
}


function storeWarning(logger, operation, error) {
  logger(`Kitesim auth store ${operation} failed`, {
    name: error instanceof Error ? error.name : "UnknownError",
    code: error && typeof error === "object" && "code" in error ? String(error.code) : "",
  })
}


function validIsoTimestamp(value) {
  const text = String(value || "")
  return text && Number.isFinite(Date.parse(text)) ? text : ""
}


function publicMaintenanceRecord(record) {
  if (!record || typeof record !== "object" || record.version !== MAINTENANCE_RECORD_VERSION) {
    return null
  }
  const accounts = Array.isArray(record.accounts)
    ? record.accounts
      .filter((account) => account && typeof account === "object")
      .slice(0, MAX_LOGIN_ACCOUNTS)
      .map((account) => ({
        accountId: /^login_(?:[1-9]|1\d|20)$/.test(String(account.accountId || ""))
          ? String(account.accountId)
          : "",
        emailHint: String(account.emailHint || "").slice(0, 160),
        state: ["healthy", "relogged", "attention"].includes(account.state)
          ? account.state
          : "attention",
        checkedAt: validIsoTimestamp(account.checkedAt),
        message: String(account.message || "").slice(0, 160),
      }))
      .filter((account) => account.accountId)
    : []
  return {
    state: ["running", "success", "attention"].includes(record.state)
      ? record.state
      : "attention",
    source: ["dashboard", "schedule", "refresh"].includes(record.source)
      ? record.source
      : "schedule",
    lastStartedAt: validIsoTimestamp(record.lastStartedAt),
    lastCompletedAt: validIsoTimestamp(record.lastCompletedAt),
    nextAllowedAt: validIsoTimestamp(record.nextAllowedAt),
    accountCount: boundedInteger(record.accountCount, 0, MAX_LOGIN_ACCOUNTS, accounts.length),
    healthyCount: boundedInteger(record.healthyCount, 0, MAX_LOGIN_ACCOUNTS, 0),
    reloggedCount: boundedInteger(record.reloggedCount, 0, MAX_LOGIN_ACCOUNTS, 0),
    failedCount: boundedInteger(record.failedCount, 0, MAX_LOGIN_ACCOUNTS, 0),
    accounts,
  }
}


async function readMaintenanceRecord(store, logger) {
  try {
    const record = await store.get(MAINTENANCE_OBJECT_KEY, {
      type: "json",
      consistency: "strong",
    })
    return publicMaintenanceRecord(record)
  } catch (error) {
    storeWarning(logger, "maintenance read", error)
    return null
  }
}


async function writeMaintenanceRecord(store, record, logger) {
  try {
    await store.setJSON(MAINTENANCE_OBJECT_KEY, record, { cacheControl: "no-store" })
    return true
  } catch (error) {
    storeWarning(logger, "maintenance write", error)
    return false
  }
}


async function readManagedAccounts(context, dependencies = {}) {
  const configuration = authConfiguration(context)
  const emptyAccounts = configuration.accounts.map((account) => ({
    ...account,
    token: null,
    verifiedAt: "",
  }))
  if (!configuration.storageConfigured) {
    return { configuration, accounts: emptyAccounts, unavailable: false }
  }
  const getStoreImpl = dependencies.getStoreImpl || getStore
  const logger = dependencies.logger || console.warn
  let store
  try {
    store = getStoreImpl(AUTH_STORE_NAME)
  } catch (error) {
    storeWarning(logger, "initialization", error)
    return { configuration, accounts: emptyAccounts, unavailable: true }
  }
  try {
    const records = await Promise.all(configuration.accounts.map((account) => (
      store.get(tokenObjectKey(account.accountId), { type: "json", consistency: "strong" })
    )))
    const accounts = configuration.accounts.map((account, index) => {
      const decrypted = decryptTokenRecord(records[index], account, configuration.encryptionKey)
      return {
        ...account,
        token: decrypted?.token || null,
        verifiedAt: decrypted?.verifiedAt || "",
      }
    })
    return { configuration, accounts, unavailable: false }
  } catch (error) {
    storeWarning(logger, "read", error)
    return { configuration, accounts: emptyAccounts, unavailable: true }
  }
}


export async function createManagedTokenBridgeHeaders(context, dependencies = {}) {
  const automation = automationConfiguration(context)
  if (automation.enabled && automation.configured) {
    await maintainManagedAccounts(context, {
      ...dependencies,
      source: "refresh",
      force: false,
    })
  }
  const state = await readManagedAccounts(context, dependencies)
  if (state.unavailable || state.configuration.bridgeSecret.length < 24) return {}
  const availableAccounts = state.accounts
    .filter((account) => account.token)
    .map((account) => ({
      accountId: account.accountId,
      label: account.emailHint || account.accountId,
      token: account.token,
    }))
  if (!availableAccounts.length) return {}

  const encodedAccounts = Buffer.from(JSON.stringify({
    version: 1,
    accounts: availableAccounts,
  }), "utf8").toString("base64url")
  if (Buffer.byteLength(encodedAccounts, "utf8") > MAX_BRIDGE_PAYLOAD_BYTES) return {}

  const nowImpl = dependencies.nowImpl || Date.now
  const timestamp = String(Math.floor(nowImpl() / 1000))
  const signature = createHmac("sha256", state.configuration.bridgeSecret)
    .update(`${timestamp}\n${encodedAccounts}`, "utf8")
    .digest("hex")
  return {
    "X-Kitesim-Managed-Accounts": encodedAccounts,
    "X-Kitesim-Managed-Timestamp": timestamp,
    "X-Kitesim-Managed-Signature": signature,
  }
}


export function createAuthStatusHandler(dependencies = {}) {
  return async function onRequest(context) {
    const request = context?.request
    if (!request || request.method !== "GET") {
      return errorResponse("仅支持 GET 请求", 405, "method")
    }
    const authorizationFailure = authorizeRequest(context, request)
    if (authorizationFailure) return authorizationFailure

    const state = await readManagedAccounts(context, dependencies)
    if (state.unavailable) return errorResponse("Token 存储暂时不可用", 503, "storage")
    const automation = automationConfiguration(context)
    let maintenance = null
    if (state.configuration.storageConfigured) {
      const getStoreImpl = dependencies.getStoreImpl || getStore
      const logger = dependencies.logger || console.warn
      try {
        maintenance = await readMaintenanceRecord(getStoreImpl(AUTH_STORE_NAME), logger)
      } catch (error) {
        storeWarning(logger, "maintenance initialization", error)
      }
    }
    const accounts = state.accounts.map((account) => ({
      accountId: account.accountId,
      emailHint: account.emailHint,
      credentialsConfigured: account.valid && state.configuration.password.length >= 8,
      tokenAvailable: Boolean(account.token),
      verifiedAt: account.verifiedAt,
    }))
    return jsonResponse({
      ok: true,
      configured: state.configuration.configured,
      credentialsConfigured: state.configuration.credentialsConfigured,
      storageConfigured: state.configuration.storageConfigured,
      automation: {
        enabled: automation.enabled,
        configured: automation.enabled && automation.configured && state.configuration.configured,
        gatewayConfigured: automation.configured,
        model: automation.model,
        maintenance,
      },
      accountCount: accounts.length,
      readyCount: accounts.filter((account) => account.tokenAvailable).length,
      accounts,
    })
  }
}


export function createAuthChallengeHandler(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  return async function onRequest(context) {
    const request = context?.request
    if (!request || request.method !== "GET") {
      return errorResponse("仅支持 GET 请求", 405, "method")
    }
    const authorizationFailure = authorizeRequest(context, request)
    if (authorizationFailure) return authorizationFailure
    const configuration = authConfiguration(context)
    if (!configuration.configured) {
      return errorResponse("Kitesim 多账户登录环境变量尚未完整配置", 503, "configuration")
    }
    const accountId = new URL(request.url).searchParams.get("accountId") || ""
    const account = configuredAccount(configuration, accountId)
    if (!account) return errorResponse("登录账户无效", 400, "validation")

    const result = await fetchJson(fetchImpl, CAPTCHA_ENDPOINT, {
      method: "GET",
      headers: upstreamHeaders(),
    })
    if (!result.ok || !validCaptchaPayload(result.payload)) {
      return errorResponse("Kitesim 验证码暂时无法获取", 502, "upstream")
    }
    return jsonResponse({
      accountId: account.accountId,
      captchaKey: result.payload.captchaKey,
      captchaImageBase64: result.payload.captchaImageBase64,
      emailHint: account.emailHint,
    })
  }
}


function loginFailureResponse(payload) {
  const message = String(payload?.message || "").toLowerCase()
  if (/captcha|verification|验证码|验证/.test(message)) {
    return errorResponse("图片验证码无效或已过期，请重新获取", 400, "captcha")
  }
  if (/password|account|email|密码|账号|邮箱/.test(message)) {
    return errorResponse("Kitesim 登录信息无效", 401, "upstream_auth")
  }
  return errorResponse("Kitesim 登录失败，请重新获取验证码后再试", 502, "upstream")
}


function remainingTimeout(runtime, configuredTimeoutMs) {
  if (!runtime?.deadlineAt || !runtime?.clockImpl) return configuredTimeoutMs
  const remaining = runtime.deadlineAt - runtime.clockImpl()
  if (remaining <= 1_000) return 0
  return Math.min(configuredTimeoutMs, Math.max(1_000, remaining - 250))
}


function captchaCodeFromModelContent(content) {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((item) => (
        typeof item === "string" ? item : String(item?.text || item?.content || "")
      )).join("")
      : ""
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  const candidates = []
  try {
    const payload = JSON.parse(cleaned)
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      candidates.push(payload.code, payload.captchaCode)
    }
  } catch {
    candidates.push(cleaned)
  }
  for (const candidate of candidates) {
    const code = String(candidate || "").trim().toUpperCase()
    if (/^[A-Z0-9]{4}$/.test(code)) return code
  }
  return ""
}


export async function solveCaptchaWithAI(context, captchaImageBase64, dependencies = {}) {
  const automation = automationConfiguration(context)
  if (!automation.enabled || !automation.configured) {
    return { ok: false, kind: "configuration" }
  }
  const image = String(captchaImageBase64 || "")
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(image)
    || image.length < 100
    || image.length > 1_500_000
  ) {
    return { ok: false, kind: "image" }
  }

  const runtime = dependencies.runtime || null
  const timeoutMs = remainingTimeout(runtime, automation.aiTimeoutMs)
  if (!timeoutMs) return { ok: false, kind: "deadline" }
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  const result = await fetchJson(fetchImpl, `${automation.baseUrl}/chat/completions`, {
    method: "POST",
    headers: new Headers({
      "Accept": "application/json",
      "Authorization": `Bearer ${automation.apiKey}`,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      model: automation.model,
      temperature: 0,
      max_tokens: 32,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Read the four-character CAPTCHA in this image. Use only A-Z and 0-9. Return exactly one JSON object like {\"code\":\"A7B9\"}; do not explain.",
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${image}` },
          },
        ],
      }],
    }),
  }, timeoutMs)
  if (!result.ok) {
    return {
      ok: false,
      kind: result.kind === "network" ? "network" : "provider",
      status: result.status,
    }
  }
  const code = captchaCodeFromModelContent(result.payload?.choices?.[0]?.message?.content)
  return code ? { ok: true, code } : { ok: false, kind: "output" }
}


function loginFailureKind(payload, status) {
  const message = String(payload?.message || "").toLowerCase()
  if (/captcha|verification|验证码|验证/.test(message)) return "captcha"
  if (
    status === 401
    || status === 403
    || /password|account|email|密码|账号|邮箱/.test(message)
  ) return "credentials"
  return "upstream"
}


async function exchangeCaptchaForVerifiedToken(
  fetchImpl,
  configuration,
  account,
  captchaCode,
  captchaKey,
  automation,
  runtime = null,
) {
  const loginTimeoutMs = remainingTimeout(runtime, automation.requestTimeoutMs)
  if (!loginTimeoutMs) return { ok: false, kind: "deadline" }
  const login = await fetchJson(fetchImpl, LOGIN_ENDPOINT, {
    method: "POST",
    headers: upstreamHeaders(true),
    body: JSON.stringify({
      email: account.email,
      pass: configuration.password,
      captchaCode,
      captchaKey,
    }),
  }, loginTimeoutMs)
  if (!login.ok || login.payload?.code !== 200) {
    return { ok: false, kind: loginFailureKind(login.payload, login.status), payload: login.payload }
  }
  const token = String(login.payload?.data || "").trim()
  if (token.length < 16 || token.length > 512) return { ok: false, kind: "token" }

  const userInfoTimeoutMs = remainingTimeout(runtime, automation.requestTimeoutMs)
  if (!userInfoTimeoutMs) return { ok: false, kind: "deadline" }
  const userInfo = await fetchJson(fetchImpl, USER_INFO_ENDPOINT, {
    method: "GET",
    headers: upstreamHeaders(false, token),
  }, userInfoTimeoutMs)
  const accountEmail = String(
    userInfo.payload?.data?.email
    || userInfo.payload?.data?.passport
    || "",
  ).trim().toLowerCase()
  if (!userInfo.ok || userInfo.payload?.code !== 200) {
    return { ok: false, kind: "account" }
  }
  if (accountEmail !== account.email) return { ok: false, kind: "account" }
  return { ok: true, token }
}


async function persistManagedToken(
  store,
  configuration,
  account,
  token,
  nowImpl,
  randomBytesImpl,
  logger,
) {
  const verifiedAt = new Date(nowImpl()).toISOString()
  const record = encryptTokenRecord(
    token,
    account,
    configuration.encryptionKey,
    verifiedAt,
    randomBytesImpl,
  )
  try {
    await store.setJSON(tokenObjectKey(account.accountId), record, { cacheControl: "no-store" })
    return { ok: true, verifiedAt }
  } catch (error) {
    storeWarning(logger, "write", error)
    return { ok: false, verifiedAt: "" }
  }
}


async function validateManagedToken(fetchImpl, account, token, automation, runtime) {
  const timeoutMs = remainingTimeout(runtime, automation.requestTimeoutMs)
  if (!timeoutMs) return "unknown"
  const userInfo = await fetchJson(fetchImpl, USER_INFO_ENDPOINT, {
    method: "GET",
    headers: upstreamHeaders(false, token),
  }, timeoutMs)
  const accountEmail = String(
    userInfo.payload?.data?.email
    || userInfo.payload?.data?.passport
    || "",
  ).trim().toLowerCase()
  if (userInfo.ok && userInfo.payload?.code === 200) {
    return accountEmail === account.email ? "valid" : "invalid"
  }
  const code = Number(userInfo.payload?.code)
  const message = String(userInfo.payload?.message || "").toLowerCase()
  if (
    userInfo.status === 401
    || userInfo.status === 403
    || code === 401
    || code === 403
    || /token|login|sign.?in|unauthor|expired|登录|过期/.test(message)
  ) return "invalid"
  return "unknown"
}


async function automaticallyLoginAccount(
  context,
  store,
  configuration,
  automation,
  account,
  dependencies,
  runtime,
) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  for (let attempt = 1; attempt <= automation.maxAttempts; attempt += 1) {
    const challengeTimeoutMs = remainingTimeout(runtime, automation.requestTimeoutMs)
    if (!challengeTimeoutMs) return { ok: false, kind: "deadline" }
    const challenge = await fetchJson(fetchImpl, CAPTCHA_ENDPOINT, {
      method: "GET",
      headers: upstreamHeaders(),
    }, challengeTimeoutMs)
    if (!challenge.ok || !validCaptchaPayload(challenge.payload)) {
      if (attempt === automation.maxAttempts) return { ok: false, kind: "challenge" }
      continue
    }

    const solved = await solveCaptchaWithAI(context, challenge.payload.captchaImageBase64, {
      fetchImpl,
      runtime,
    })
    if (!solved.ok) {
      const retryable = solved.kind === "output"
        || solved.kind === "network"
        || (solved.kind === "provider" && (solved.status === 429 || solved.status >= 500))
      if (!retryable || solved.kind === "deadline" || attempt === automation.maxAttempts) return solved
      continue
    }

    const login = await exchangeCaptchaForVerifiedToken(
      fetchImpl,
      configuration,
      account,
      solved.code,
      challenge.payload.captchaKey,
      automation,
      runtime,
    )
    if (!login.ok) {
      if (login.kind === "captcha" && attempt < automation.maxAttempts) continue
      return login
    }
    const stored = await persistManagedToken(
      store,
      configuration,
      account,
      login.token,
      dependencies.nowImpl || Date.now,
      dependencies.randomBytesImpl || randomBytes,
      dependencies.logger || console.warn,
    )
    return stored.ok ? { ok: true } : { ok: false, kind: "storage" }
  }
  return { ok: false, kind: "captcha" }
}


function maintenanceFailureMessage(kind, status = 0) {
  if (kind === "credentials") return "账户或密码需要检查"
  if (kind === "configuration") return "AI 自动登录配置不完整"
  if (kind === "storage") return "Token 安全存储失败"
  if (kind === "deadline") return "本轮维护达到执行时限"
  if (kind === "account") return "登录后的账户校验失败"
  if (kind === "output") return "模型输出未通过 4 位验证码校验"
  if (kind === "network") return "AI 网关网络连接失败"
  if (kind === "provider" && (status === 401 || status === 403)) return "AI 网关密钥被拒绝"
  if (kind === "provider" && status === 404) return "AI 网关路由或模型不存在"
  if (kind === "provider" && status === 429) return "AI 网关当前触发限流"
  if (kind === "provider" && status >= 400 && status < 500) return `AI 网关拒绝请求（HTTP ${status}）`
  if (kind === "provider" && status >= 500) return `AI 网关上游异常（HTTP ${status}）`
  if (kind === "provider") return "AI 网关请求暂时失败"
  if (kind === "challenge") return "Kitesim 验证码暂时无法获取"
  if (kind === "captcha") return "模型识别结果被 Kitesim 拒绝"
  if (kind === "token") return "Kitesim 登录响应没有有效 Token"
  return "自动登录未完成，可使用人工验证码接管"
}


async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
  return results
}


async function runManagedAccountMaintenance(context, dependencies = {}) {
  const configuration = authConfiguration(context)
  const automation = automationConfiguration(context)
  if (!configuration.configured) return { ok: false, kind: "configuration_auth" }
  if (!automation.enabled) return { ok: false, kind: "disabled" }
  if (!automation.configured) return { ok: false, kind: "configuration_ai" }

  const getStoreImpl = dependencies.getStoreImpl || getStore
  const logger = dependencies.logger || console.warn
  let store
  try {
    store = getStoreImpl(AUTH_STORE_NAME)
  } catch (error) {
    storeWarning(logger, "initialization", error)
    return { ok: false, kind: "storage" }
  }

  const state = await readManagedAccounts(context, { ...dependencies, getStoreImpl: () => store })
  if (state.unavailable) return { ok: false, kind: "storage" }
  const previous = await readMaintenanceRecord(store, logger)
  const nowImpl = dependencies.nowImpl || Date.now
  const startedAtMs = nowImpl()
  const force = dependencies.force === true
  if (!force && previous?.nextAllowedAt && Date.parse(previous.nextAllowedAt) > startedAtMs) {
    return { ok: true, skipped: true, ...previous }
  }

  const source = ["dashboard", "schedule", "refresh"].includes(dependencies.source)
    ? dependencies.source
    : "schedule"
  const startedAt = new Date(startedAtMs).toISOString()
  const runningRecord = {
    version: MAINTENANCE_RECORD_VERSION,
    state: "running",
    source,
    lastStartedAt: startedAt,
    lastCompletedAt: previous?.lastCompletedAt || "",
    nextAllowedAt: new Date(startedAtMs + DEFAULT_FAILURE_BACKOFF_MS).toISOString(),
    accountCount: state.accounts.length,
    healthyCount: 0,
    reloggedCount: 0,
    failedCount: 0,
    accounts: previous?.accounts || [],
  }
  if (!await writeMaintenanceRecord(store, runningRecord, logger)) {
    return { ok: false, kind: "storage" }
  }

  const clockImpl = dependencies.clockImpl || Date.now
  const runtime = {
    clockImpl,
    deadlineAt: clockImpl() + DEFAULT_MAINTENANCE_DEADLINE_MS,
  }
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  const results = await mapWithConcurrency(state.accounts, 3, async (account) => {
    const checkedAt = new Date(nowImpl()).toISOString()
    if (account.token) {
      const validity = await validateManagedToken(
        fetchImpl,
        account,
        account.token,
        automation,
        runtime,
      )
      if (validity === "valid") {
        return {
          accountId: account.accountId,
          emailHint: account.emailHint,
          state: "healthy",
          checkedAt,
          message: "Token 有效",
        }
      }
      if (validity === "unknown") {
        return {
          accountId: account.accountId,
          emailHint: account.emailHint,
          state: "attention",
          checkedAt,
          message: "上游状态暂时无法确认，已保留原 Token",
        }
      }
    }

    const login = await automaticallyLoginAccount(
      context,
      store,
      configuration,
      automation,
      account,
      dependencies,
      runtime,
    )
    return {
      accountId: account.accountId,
      emailHint: account.emailHint,
      state: login.ok ? "relogged" : "attention",
      checkedAt,
      message: login.ok
        ? "AI 已识别验证码并更新 Token"
        : maintenanceFailureMessage(login.kind, login.status),
    }
  })

  const healthyCount = results.filter((result) => result.state === "healthy").length
  const reloggedCount = results.filter((result) => result.state === "relogged").length
  const failedCount = results.filter((result) => result.state === "attention").length
  const completedAtMs = nowImpl()
  const completedRecord = {
    version: MAINTENANCE_RECORD_VERSION,
    state: failedCount ? "attention" : "success",
    source,
    lastStartedAt: startedAt,
    lastCompletedAt: new Date(completedAtMs).toISOString(),
    nextAllowedAt: new Date(
      completedAtMs + (failedCount ? DEFAULT_FAILURE_BACKOFF_MS : automation.intervalMs),
    ).toISOString(),
    accountCount: results.length,
    healthyCount,
    reloggedCount,
    failedCount,
    accounts: results,
  }
  if (!await writeMaintenanceRecord(store, completedRecord, logger)) {
    return { ok: false, kind: "storage" }
  }
  return { ok: true, skipped: false, ...publicMaintenanceRecord(completedRecord) }
}


export async function maintainManagedAccounts(context, dependencies = {}) {
  if (maintenanceInFlight) return maintenanceInFlight
  const operation = runManagedAccountMaintenance(context, dependencies)
  maintenanceInFlight = operation
  try {
    return await operation
  } finally {
    if (maintenanceInFlight === operation) maintenanceInFlight = null
  }
}


export function createAuthCompleteHandler(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  const getStoreImpl = dependencies.getStoreImpl || getStore
  const nowImpl = dependencies.nowImpl || Date.now
  const randomBytesImpl = dependencies.randomBytesImpl || randomBytes
  const logger = dependencies.logger || console.warn

  return async function onRequest(context) {
    const request = context?.request
    if (!request || request.method !== "POST") {
      return errorResponse("仅支持 POST 请求", 405, "method")
    }
    const authorizationFailure = authorizeRequest(context, request)
    if (authorizationFailure) return authorizationFailure
    const configuration = authConfiguration(context)
    if (!configuration.configured) {
      return errorResponse("Kitesim 多账户登录环境变量尚未完整配置", 503, "configuration")
    }

    const payload = await requestObject(request)
    if (!validCompletePayload(payload)) {
      return errorResponse("验证码请求参数无效", 400, "validation")
    }
    const account = configuredAccount(configuration, String(payload.accountId).trim())
    if (!account) return errorResponse("登录账户无效", 400, "validation")

    const login = await exchangeCaptchaForVerifiedToken(
      fetchImpl,
      configuration,
      account,
      String(payload.captchaCode).trim().toUpperCase(),
      String(payload.captchaKey).trim(),
      automationConfiguration(context),
    )
    if (!login.ok) {
      if (login.kind === "captcha") return loginFailureResponse(login.payload)
      if (login.kind === "credentials") {
        return errorResponse("Kitesim 登录信息无效", 401, "upstream_auth")
      }
      if (login.kind === "account") {
        return errorResponse("Token 账户验证失败，未写入存储", 502, "upstream_auth")
      }
      if (login.kind === "token") {
        return errorResponse("Kitesim 登录响应未包含有效 Token", 502, "upstream")
      }
      return errorResponse("Kitesim 登录服务暂时不可用", 502, "upstream")
    }

    let store
    try {
      store = getStoreImpl(AUTH_STORE_NAME)
    } catch (error) {
      storeWarning(logger, "initialization", error)
      return errorResponse("Token 已获取但安全存储失败，请重试", 503, "storage")
    }
    const stored = await persistManagedToken(
      store,
      configuration,
      account,
      login.token,
      nowImpl,
      randomBytesImpl,
      logger,
    )
    if (!stored.ok) return errorResponse("Token 已获取但安全存储失败，请重试", 503, "storage")

    return jsonResponse({
      ok: true,
      accountId: account.accountId,
      tokenAvailable: true,
      verifiedAt: stored.verifiedAt,
      emailHint: account.emailHint,
    })
  }
}


export function createAuthMaintenanceHandler(dependencies = {}) {
  return async function onRequest(context) {
    const request = context?.request
    if (!request || request.method !== "POST") {
      return errorResponse("仅支持 POST 请求", 405, "method")
    }
    const payload = await requestObject(request)
    if (!payload) return errorResponse("自动维护请求参数无效", 400, "validation")

    let source = "schedule"
    let force = false
    if (providedAccessKey(request)) {
      const authorizationFailure = authorizeRequest(context, request)
      if (authorizationFailure) return authorizationFailure
      source = "dashboard"
      force = payload.force === true
    } else {
      const automation = automationConfiguration(context)
      if (
        !automation.enabled
        || payload.source !== SCHEDULE_SOURCE
        || payload.version !== 1
      ) {
        return errorResponse("自动维护请求未获授权", 401, "dashboard_auth")
      }
    }

    const result = await maintainManagedAccounts(context, {
      ...dependencies,
      source,
      force,
    })
    if (!result.ok) {
      if (result.kind === "storage") {
        return errorResponse("自动维护状态存储暂时不可用", 503, "storage")
      }
      if (result.kind === "disabled") {
        return errorResponse("AI 自动维护尚未启用", 503, "configuration")
      }
      if (result.kind === "configuration_ai") {
        return errorResponse("AI 网关环境变量尚未完整配置", 503, "configuration")
      }
      return errorResponse("Kitesim 登录环境变量尚未完整配置", 503, "configuration")
    }
    if (source === "schedule") {
      return jsonResponse({ ok: true, skipped: result.skipped })
    }
    return jsonResponse(result)
  }
}
