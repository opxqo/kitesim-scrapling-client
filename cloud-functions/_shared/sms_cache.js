import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import { getStore } from "@edgeone/pages-blob"


const ACCESS_KEY_MIN_LENGTH = 12
const CACHE_RECORD_VERSION = 1
const CACHE_ENVELOPE_VERSION = 1
const CACHE_STORE_NAME = "kitesim-sms-cache"
const DEFAULT_CACHE_TTL_SECONDS = 20
const MIN_CACHE_TTL_SECONDS = 5
const MAX_CACHE_TTL_SECONDS = 300
const MAX_REQUEST_BODY_BYTES = 8 * 1024
const ORIGIN_PATH = "/api/messages-origin"
const PHONE_PATTERN = /^\+?\d{6,20}$/


function environmentValue(context, name) {
  const contextValue = context?.env?.[name]
  const processValue = typeof process !== "undefined" ? process.env?.[name] : undefined
  return String(contextValue ?? processValue ?? "").trim()
}


function apiHeaders(cacheStatus = "") {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  })
  if (cacheStatus) headers.set("X-SMS-Cache", cacheStatus)
  return headers
}


function jsonResponse(payload, status = 200, cacheStatus = "") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: apiHeaders(cacheStatus),
  })
}


function errorResponse(message, status, kind, cacheStatus = "") {
  return jsonResponse({ error: message, kind }, status, cacheStatus)
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


function cacheTtlSeconds(context) {
  const rawValue = environmentValue(context, "SMS_CACHE_TTL_SECONDS")
  const parsed = Number.parseInt(rawValue || String(DEFAULT_CACHE_TTL_SECONDS), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_CACHE_TTL_SECONDS
  return Math.min(Math.max(parsed, MIN_CACHE_TTL_SECONDS), MAX_CACHE_TTL_SECONDS)
}


function encryptionKey(context) {
  const encoded = environmentValue(context, "SMS_CACHE_ENCRYPTION_KEY").replace(/\s+/g, "")
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
  const decoded = Buffer.from(encoded, "base64")
  return decoded.length === 32 ? decoded : null
}


function cacheablePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  const accountId = String(payload.accountId || "").trim()
  const messageHandle = String(payload.messageHandle || "").trim()
  const orderId = String(payload.orderId || "").trim()
  const phoneNumber = String(payload.phoneNumber || "").trim()
  return Boolean(
    accountId
      && accountId.length <= 64
      && messageHandle
      && messageHandle.length <= 128
      && orderId
      && orderId.length <= 64
      && PHONE_PATTERN.test(phoneNumber),
  )
}


export function createSmsCacheKey(payload) {
  const identity = JSON.stringify([
    String(payload.accountId || "").trim(),
    String(payload.messageHandle || "").trim(),
    String(payload.orderId || "").trim(),
    String(payload.phoneNumber || "").trim(),
    payload.revealCode === true,
    payload.showSms === true,
  ])
  const digest = createHash("sha256").update(identity, "utf8").digest("hex")
  return `sms/v1/${digest}.json`
}


function encryptRecord(record, key, objectKey, randomBytesImpl) {
  const iv = randomBytesImpl(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(objectKey, "utf8"))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), "utf8"),
    cipher.final(),
  ])
  return {
    version: CACHE_ENVELOPE_VERSION,
    algorithm: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }
}


function decryptRecord(envelope, key, objectKey) {
  if (
    !envelope
    || typeof envelope !== "object"
    || envelope.version !== CACHE_ENVELOPE_VERSION
    || envelope.algorithm !== "A256GCM"
  ) {
    throw new Error("invalid cache envelope")
  }
  const iv = Buffer.from(String(envelope.iv || ""), "base64")
  const tag = Buffer.from(String(envelope.tag || ""), "base64")
  const ciphertext = Buffer.from(String(envelope.ciphertext || ""), "base64")
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
    throw new Error("invalid cache envelope fields")
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAAD(Buffer.from(objectKey, "utf8"))
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString("utf8"))
}


function validCachedRecord(record) {
  return Boolean(
    record
      && typeof record === "object"
      && record.version === CACHE_RECORD_VERSION
      && Number.isFinite(record.cachedAt)
      && Number.isFinite(record.expiresAt)
      && record.payload
      && typeof record.payload === "object"
      && Array.isArray(record.payload.items),
  )
}


function cacheWarning(logger, operation, error) {
  logger(`SMS cache ${operation} failed`, {
    name: error instanceof Error ? error.name : "UnknownError",
    code: error && typeof error === "object" && "code" in error ? String(error.code) : "",
  })
}


async function fetchOrigin(request, bodyText, fetchImpl, cacheStatus) {
  const originUrl = new URL(ORIGIN_PATH, request.url)
  const headers = new Headers({
    "Accept": "application/json",
    "Content-Type": "application/json",
  })
  const authorization = request.headers.get("Authorization")
  const dashboardKey = request.headers.get("X-Dashboard-Key")
  if (authorization) headers.set("Authorization", authorization)
  if (dashboardKey) headers.set("X-Dashboard-Key", dashboardKey)

  let originResponse
  try {
    originResponse = await fetchImpl(originUrl, {
      method: "POST",
      headers,
      body: bodyText,
    })
  } catch {
    return {
      response: errorResponse("短信服务暂时不可用", 502, "upstream", cacheStatus),
      payload: null,
      text: "",
      ok: false,
    }
  }

  const text = await originResponse.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    // The Python origin normally returns JSON. Preserve its redacted response if it does not.
  }
  return {
    response: new Response(text, {
      status: originResponse.status,
      headers: apiHeaders(cacheStatus),
    }),
    payload,
    text,
    ok: originResponse.ok,
  }
}


export function createSmsCacheHandler(dependencies = {}) {
  const getStoreImpl = dependencies.getStoreImpl || getStore
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
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

    const declaredLength = Number.parseInt(request.headers.get("Content-Length") || "0", 10)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
      return errorResponse("请求体过大", 413, "validation")
    }

    const bodyText = await request.text()
    if (Buffer.byteLength(bodyText, "utf8") > MAX_REQUEST_BODY_BYTES) {
      return errorResponse("请求体过大", 413, "validation")
    }

    let payload
    try {
      payload = JSON.parse(bodyText)
    } catch {
      return errorResponse("请求体必须是 JSON 对象", 400, "validation")
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return errorResponse("请求体必须是 JSON 对象", 400, "validation")
    }

    const key = encryptionKey(context)
    if (!key || !cacheablePayload(payload)) {
      const origin = await fetchOrigin(request, bodyText, fetchImpl, "bypass")
      return origin.response
    }

    const objectKey = createSmsCacheKey(payload)
    const now = nowImpl()
    const ttlSeconds = cacheTtlSeconds(context)
    let store = null
    let envelope = null

    try {
      store = getStoreImpl(CACHE_STORE_NAME)
      envelope = await store.get(objectKey, { type: "json" })
    } catch (error) {
      cacheWarning(logger, "read", error)
      store = null
    }

    if (store && envelope) {
      try {
        const record = decryptRecord(envelope, key, objectKey)
        if (validCachedRecord(record) && record.expiresAt > now) {
          return jsonResponse(record.payload, 200, "hit")
        }
      } catch (error) {
        cacheWarning(logger, "decrypt", error)
      }
    }

    const cacheStatus = store ? "miss" : "bypass"
    const origin = await fetchOrigin(request, bodyText, fetchImpl, cacheStatus)
    if (!origin.ok || !origin.payload || !Array.isArray(origin.payload.items)) {
      return origin.response
    }

    if (store) {
      const record = {
        version: CACHE_RECORD_VERSION,
        cachedAt: now,
        expiresAt: now + ttlSeconds * 1000,
        payload: origin.payload,
      }
      const encryptedEnvelope = encryptRecord(record, key, objectKey, randomBytesImpl)
      try {
        await store.setJSON(objectKey, encryptedEnvelope, {
          cacheControl: `max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds}`,
        })
      } catch (error) {
        cacheWarning(logger, "write", error)
      }
    }

    return origin.response
  }
}
