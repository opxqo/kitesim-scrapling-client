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
const TOKEN_OBJECT_KEY = "managed-token/v1.json"
const TOKEN_RECORD_VERSION = 1
const MAX_REQUEST_BODY_BYTES = 2 * 1024
const MAX_UPSTREAM_BODY_BYTES = 2 * 1024 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const CAPTCHA_ENDPOINT = "https://api.kitesim.co/index/captcha-image-base64"
const LOGIN_ENDPOINT = "https://api.kitesim.co/index/sign-in"
const USER_INFO_ENDPOINT = "https://api.kitesim.co/user/info"
const KITESIM_REFERER = "https://h5.kitesim.co/"
const KITESIM_ORIGIN = "https://h5.kitesim.co"


function environmentValue(context, name) {
  const contextValue = context?.env?.[name]
  const processValue = typeof process !== "undefined" ? process.env?.[name] : undefined
  return String(contextValue ?? processValue ?? "").trim()
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


function authConfiguration(context) {
  const email = environmentValue(context, "KITESIM_LOGIN_EMAIL").toLowerCase()
  const password = environmentValue(context, "KITESIM_LOGIN_PASSWORD")
  const encryptionKey = decodeEncryptionKey(context)
  const bridgeSecret = environmentValue(context, "KITESIM_AUTH_BRIDGE_SECRET")
  const credentialsConfigured = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && password.length >= 8
    && password.length <= 256
  const storageConfigured = Boolean(encryptionKey) && bridgeSecret.length >= 24
  return {
    email,
    password,
    encryptionKey,
    bridgeSecret,
    credentialsConfigured,
    storageConfigured,
    configured: credentialsConfigured && storageConfigured,
    emailHint: emailHint(email),
  }
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

  const text = await response.text()
  if (Buffer.byteLength(text, "utf8") > MAX_UPSTREAM_BODY_BYTES) {
    return { ok: false, status: 502, payload: null, kind: "payload" }
  }
  let payload = null
  try {
    payload = JSON.parse(text)
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
      && /^[A-Za-z0-9]{4}$/.test(String(payload.captchaCode || "").trim())
      && /^captcha:[A-Za-z0-9_-]{8,96}$/.test(String(payload.captchaKey || "").trim()),
  )
}


async function requestObject(request) {
  const declaredLength = Number.parseInt(request.headers.get("Content-Length") || "0", 10)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) return null
  const text = await request.text()
  if (Buffer.byteLength(text, "utf8") > MAX_REQUEST_BODY_BYTES) return null
  try {
    const payload = JSON.parse(text)
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null
  } catch {
    return null
  }
}


function encryptTokenRecord(token, configuration, verifiedAt, randomBytesImpl) {
  const iv = randomBytesImpl(12)
  const cipher = createCipheriv("aes-256-gcm", configuration.encryptionKey, iv)
  cipher.setAAD(Buffer.from(TOKEN_OBJECT_KEY, "utf8"))
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
    emailHash: createHash("sha256").update(configuration.email, "utf8").digest("hex"),
    verifiedAt,
  }
}


function decryptTokenRecord(record, encryptionKey) {
  if (
    !record
    || typeof record !== "object"
    || record.version !== TOKEN_RECORD_VERSION
    || record.algorithm !== "A256GCM"
  ) {
    return null
  }
  try {
    const iv = Buffer.from(String(record.iv || ""), "base64")
    const tag = Buffer.from(String(record.tag || ""), "base64")
    const ciphertext = Buffer.from(String(record.ciphertext || ""), "base64")
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) return null
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv)
    decipher.setAAD(Buffer.from(TOKEN_OBJECT_KEY, "utf8"))
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


async function readManagedToken(context, dependencies = {}) {
  const configuration = authConfiguration(context)
  if (!configuration.storageConfigured) {
    return { configuration, token: null, verifiedAt: "", unavailable: false }
  }
  const getStoreImpl = dependencies.getStoreImpl || getStore
  const logger = dependencies.logger || console.warn
  let store
  try {
    store = getStoreImpl(AUTH_STORE_NAME)
  } catch (error) {
    storeWarning(logger, "initialization", error)
    return { configuration, token: null, verifiedAt: "", unavailable: true }
  }
  try {
    const record = await store.get(TOKEN_OBJECT_KEY, { type: "json", consistency: "strong" })
    const decrypted = decryptTokenRecord(record, configuration.encryptionKey)
    return {
      configuration,
      token: decrypted?.token || null,
      verifiedAt: decrypted?.verifiedAt || "",
      unavailable: false,
    }
  } catch (error) {
    storeWarning(logger, "read", error)
    return { configuration, token: null, verifiedAt: "", unavailable: true }
  }
}


export async function createManagedTokenBridgeHeaders(context, dependencies = {}) {
  const tokenState = await readManagedToken(context, dependencies)
  if (!tokenState.token || tokenState.configuration.bridgeSecret.length < 24) return {}
  const nowImpl = dependencies.nowImpl || Date.now
  const timestamp = String(Math.floor(nowImpl() / 1000))
  const signature = createHmac("sha256", tokenState.configuration.bridgeSecret)
    .update(`${timestamp}\n${tokenState.token}`, "utf8")
    .digest("hex")
  return {
    "X-Kitesim-Managed-Token": tokenState.token,
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

    const state = await readManagedToken(context, dependencies)
    if (state.unavailable) return errorResponse("Token 存储暂时不可用", 503, "storage")
    return jsonResponse({
      ok: true,
      configured: state.configuration.configured,
      credentialsConfigured: state.configuration.credentialsConfigured,
      storageConfigured: state.configuration.storageConfigured,
      tokenAvailable: Boolean(state.token),
      verifiedAt: state.verifiedAt,
      emailHint: state.configuration.emailHint,
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
      return errorResponse("Kitesim 半自动登录环境变量尚未完整配置", 503, "configuration")
    }

    const result = await fetchJson(fetchImpl, CAPTCHA_ENDPOINT, {
      method: "GET",
      headers: upstreamHeaders(),
    })
    if (!result.ok || !validCaptchaPayload(result.payload)) {
      return errorResponse("Kitesim 验证码暂时无法获取", 502, "upstream")
    }
    return jsonResponse({
      captchaKey: result.payload.captchaKey,
      captchaImageBase64: result.payload.captchaImageBase64,
      emailHint: configuration.emailHint,
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
      return errorResponse("Kitesim 半自动登录环境变量尚未完整配置", 503, "configuration")
    }

    const payload = await requestObject(request)
    if (!validCompletePayload(payload)) {
      return errorResponse("验证码请求参数无效", 400, "validation")
    }

    const login = await fetchJson(fetchImpl, LOGIN_ENDPOINT, {
      method: "POST",
      headers: upstreamHeaders(true),
      body: JSON.stringify({
        email: configuration.email,
        pass: configuration.password,
        captchaCode: String(payload.captchaCode).trim(),
        captchaKey: String(payload.captchaKey).trim(),
      }),
    })
    if (!login.ok || login.payload?.code !== 200) return loginFailureResponse(login.payload)
    const token = String(login.payload?.data || "").trim()
    if (token.length < 16 || token.length > 512) {
      return errorResponse("Kitesim 登录响应未包含有效 Token", 502, "upstream")
    }

    const userInfo = await fetchJson(fetchImpl, USER_INFO_ENDPOINT, {
      method: "GET",
      headers: upstreamHeaders(false, token),
    })
    const accountEmail = String(
      userInfo.payload?.data?.email
      || userInfo.payload?.data?.passport
      || "",
    ).trim().toLowerCase()
    if (!userInfo.ok || userInfo.payload?.code !== 200 || accountEmail !== configuration.email) {
      return errorResponse("Token 账户验证失败，未写入存储", 502, "upstream_auth")
    }

    const verifiedAt = new Date(nowImpl()).toISOString()
    const record = encryptTokenRecord(token, configuration, verifiedAt, randomBytesImpl)
    try {
      const store = getStoreImpl(AUTH_STORE_NAME)
      await store.setJSON(TOKEN_OBJECT_KEY, record, { cacheControl: "no-store" })
    } catch (error) {
      storeWarning(logger, "write", error)
      return errorResponse("Token 已获取但安全存储失败，请重试", 503, "storage")
    }

    return jsonResponse({
      ok: true,
      tokenAvailable: true,
      verifiedAt,
      emailHint: configuration.emailHint,
    })
  }
}
