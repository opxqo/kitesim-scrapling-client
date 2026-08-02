import {
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto"

import { getStore } from "@edgeone/pages-blob"


const ACCESS_KEY_MIN_LENGTH = 12
const CACHE_ENVELOPE_VERSION = 1
const CACHE_RECORD_VERSION = 2
const CACHE_STORE_NAME = "kitesim-sms-cache"
const DEFAULT_CACHE_TTL_SECONDS = 20
const MIN_CACHE_TTL_SECONDS = 5
const MAX_CACHE_TTL_SECONDS = 300
const HOT_CACHE_MAX_ENTRIES = 64
const HOT_CACHE_TTL_MS = 5_000
const MAX_REQUEST_BODY_BYTES = 8 * 1024
const MESSAGE_ORIGIN_PATH = "/origin/messages-origin"
const ORDERS_ORIGIN_PATH = "/origin/orders-origin"
const PHONE_PATTERN = /^\+?\d{6,20}$/
const PUBLIC_ORIGIN_HOST = "esim.opxqo.cn"


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
  const body = cacheStatus && payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...payload, cacheStatus }
    : payload
  return new Response(JSON.stringify(body), {
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
    return {
      expected,
      failure: errorResponse("服务端尚未配置安全访问口令", 503, "configuration"),
    }
  }
  const supplied = providedAccessKey(request)
  if (!supplied || !secretsEqual(supplied, expected)) {
    return {
      expected,
      failure: errorResponse("访问口令无效", 401, "dashboard_auth"),
    }
  }
  return { expected, failure: null }
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


function cacheWarning(logger, operation, error) {
  logger(`Dashboard cache ${operation} failed`, {
    name: error instanceof Error ? error.name : "UnknownError",
    code: error && typeof error === "object" && "code" in error ? String(error.code) : "",
  })
}


function requestHeaders(request, contentType = false) {
  const headers = new Headers({ "Accept": "application/json" })
  if (contentType) headers.set("Content-Type", "application/json")
  const authorization = request.headers.get("Authorization")
  const dashboardKey = request.headers.get("X-Dashboard-Key")
  if (authorization) headers.set("Authorization", authorization)
  if (dashboardKey) headers.set("X-Dashboard-Key", dashboardKey)
  return headers
}


function publicRequestUrl(request) {
  const url = new URL(request.url)
  // EdgeOne builds request.url from its internal Host and exposes the public route separately.
  const pagesHost = (request.headers.get("eo-pages-host") || "")
    .split(",", 1)[0]
    .trim()
    .toLowerCase()
  if (pagesHost !== PUBLIC_ORIGIN_HOST) return url

  url.protocol = "https:"
  url.host = PUBLIC_ORIGIN_HOST
  url.username = ""
  url.password = ""
  return url
}


async function fetchJson(fetchImpl, url, options, cacheStatus) {
  let response
  try {
    response = await fetchImpl(url, options)
  } catch {
    return {
      ok: false,
      status: 502,
      payload: { error: "后端服务暂时不可用", kind: "upstream" },
      response: errorResponse("后端服务暂时不可用", 502, "upstream", cacheStatus),
    }
  }

  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    // Python origins normally return JSON. Invalid payloads become a redacted gateway error.
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      status: 502,
      payload: null,
      response: errorResponse("后端接口返回格式无效", 502, "upstream", cacheStatus),
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
    response: jsonResponse(payload, response.status, cacheStatus),
  }
}


function decryptLegacyRecord(envelope, key, objectKey) {
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


function buildRecord(payload, now, ttlSeconds) {
  return {
    version: CACHE_RECORD_VERSION,
    cachedAt: now,
    expiresAt: now + ttlSeconds * 1000,
    payload,
  }
}


function validRecord(record, validatePayload) {
  return Boolean(
    record
      && typeof record === "object"
      && record.version === CACHE_RECORD_VERSION
      && Number.isFinite(record.cachedAt)
      && Number.isFinite(record.expiresAt)
      && validatePayload(record.payload),
  )
}


function recordStatus(record, now) {
  return record.expiresAt > now ? "hit" : "stale"
}


function cacheStore(getStoreImpl, logger) {
  try {
    return getStoreImpl(CACHE_STORE_NAME)
  } catch (error) {
    cacheWarning(logger, "initialization", error)
    return null
  }
}


function createStoreResolver(getStoreImpl, logger) {
  let resolvedStore = null
  return function resolveStore() {
    if (resolvedStore) return resolvedStore
    const nextStore = cacheStore(getStoreImpl, logger)
    if (nextStore) resolvedStore = nextStore
    return nextStore
  }
}


function createHotRecordCache(nowImpl) {
  const records = new Map()
  const pendingReads = new Map()

  function remember(objectKey, record) {
    records.delete(objectKey)
    records.set(objectKey, {
      record,
      retainedUntil: nowImpl() + HOT_CACHE_TTL_MS,
    })
    while (records.size > HOT_CACHE_MAX_ENTRIES) {
      const oldestKey = records.keys().next().value
      if (oldestKey === undefined) break
      records.delete(oldestKey)
    }
  }

  function recall(objectKey) {
    const cached = records.get(objectKey)
    if (!cached) return { found: false, record: null }
    if (cached.retainedUntil <= nowImpl()) {
      records.delete(objectKey)
      return { found: false, record: null }
    }
    records.delete(objectKey)
    records.set(objectKey, cached)
    return { found: true, record: cached.record }
  }

  async function read(store, objectKey, legacyKey, logger) {
    const cached = recall(objectKey)
    if (cached.found) return { record: cached.record, unavailable: false }

    const pending = pendingReads.get(objectKey)
    if (pending) return pending

    const operation = readRecord(store, objectKey, legacyKey, logger)
      .then((result) => {
        if (!result.unavailable && result.record) remember(objectKey, result.record)
        return result
      })
      .finally(() => pendingReads.delete(objectKey))
    pendingReads.set(objectKey, operation)
    return operation
  }

  return { read, remember }
}


async function readRecord(store, objectKey, legacyKey, logger) {
  let storedValue
  try {
    storedValue = await store.get(objectKey, { type: "json" })
  } catch (error) {
    cacheWarning(logger, "read", error)
    return { record: null, unavailable: true }
  }
  if (!storedValue) return { record: null, unavailable: false }
  if (
    storedValue
    && typeof storedValue === "object"
    && storedValue.version === CACHE_RECORD_VERSION
    && "payload" in storedValue
  ) {
    return { record: storedValue, unavailable: false }
  }
  if (!legacyKey) return { record: null, unavailable: false }
  try {
    return { record: decryptLegacyRecord(storedValue, legacyKey, objectKey), unavailable: false }
  } catch (error) {
    cacheWarning(logger, "legacy decrypt", error)
    return { record: null, unavailable: false }
  }
}


async function writeRecord(store, objectKey, record, ttlSeconds, logger) {
  if (!store) return false
  try {
    await store.setJSON(objectKey, record, {
      cacheControl: `max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds}`,
    })
    return true
  } catch (error) {
    cacheWarning(logger, "write", error)
    return false
  }
}


function messagePayloadCacheable(payload) {
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
  ])
  const digest = createHash("sha256").update(identity, "utf8").digest("hex")
  return `sms/v2/${digest}.json`
}


function messageVariantName(payload) {
  if (payload.revealCode === true && payload.showSms === true) return "full"
  if (payload.revealCode === true) return "code"
  if (payload.showSms === true) return "sms"
  return "masked"
}


function validMessageSnapshot(snapshot) {
  return Boolean(
    snapshot
      && typeof snapshot === "object"
      && snapshot.variants
      && typeof snapshot.variants === "object"
      && ["masked", "code", "sms", "full"].every((name) => Array.isArray(snapshot.variants[name])),
  )
}


function messageResponse(snapshot, requestPayload, cacheStatus) {
  const items = snapshot.variants[messageVariantName(requestPayload)]
  return jsonResponse(
    {
      items,
      count: items.length,
      accountId: snapshot.accountId || String(requestPayload.accountId || ""),
      accountLabel: snapshot.accountLabel || "",
      revealCode: requestPayload.revealCode === true,
      showSms: requestPayload.showSms === true,
      updatedAt: snapshot.updatedAt || "",
    },
    200,
    cacheStatus,
  )
}


function emptyMessageResponse(payload) {
  return jsonResponse(
    {
      items: [],
      count: 0,
      accountId: String(payload.accountId || ""),
      accountLabel: "",
      revealCode: payload.revealCode === true,
      showSms: payload.showSms === true,
      updatedAt: "",
    },
    200,
    "empty",
  )
}


async function fetchMessageSnapshot(request, payload, fetchImpl, cacheStatus) {
  const originUrl = publicRequestUrl(request)
  originUrl.pathname = MESSAGE_ORIGIN_PATH
  originUrl.search = ""
  originUrl.hash = ""
  const originPayload = { ...payload, cacheSnapshot: true }
  delete originPayload.refresh
  return fetchJson(
    fetchImpl,
    originUrl,
    {
      method: "POST",
      headers: requestHeaders(request, true),
      body: JSON.stringify(originPayload),
    },
    cacheStatus,
  )
}


export function createSmsCacheHandler(dependencies = {}) {
  const getStoreImpl = dependencies.getStoreImpl || getStore
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  const nowImpl = dependencies.nowImpl || Date.now
  const logger = dependencies.logger || console.warn
  const resolveStore = createStoreResolver(getStoreImpl, logger)
  const hotRecords = createHotRecordCache(nowImpl)

  return async function onRequest(context) {
    const request = context?.request
    if (!request || request.method !== "POST") {
      return errorResponse("仅支持 POST 请求", 405, "method")
    }

    const authorization = authorizeRequest(context, request)
    if (authorization.failure) return authorization.failure

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
    if (!messagePayloadCacheable(payload)) {
      return errorResponse("短信缓存请求参数无效", 400, "validation")
    }

    const objectKey = createSmsCacheKey(payload)
    const legacyKey = encryptionKey(context)
    const ttlSeconds = cacheTtlSeconds(context)
    const now = nowImpl()
    const refresh = payload.refresh === true

    if (refresh) {
      const origin = await fetchMessageSnapshot(request, payload, fetchImpl, "refresh")
      if (!origin.ok) return origin.response
      if (!validMessageSnapshot(origin.payload)) {
        return errorResponse("短信回源快照格式无效", 502, "upstream", "refresh")
      }

      const store = resolveStore()
      const record = buildRecord(origin.payload, now, ttlSeconds)
      const stored = await writeRecord(
        store,
        objectKey,
        record,
        ttlSeconds,
        logger,
      )
      if (stored) hotRecords.remember(objectKey, record)
      return messageResponse(origin.payload, payload, stored ? "refreshed" : "bypass")
    }

    const store = resolveStore()
    if (!store) {
      return errorResponse("Blob 缓存暂时不可用", 503, "storage")
    }

    const cached = await hotRecords.read(store, objectKey, legacyKey, logger)
    if (cached.unavailable) {
      return errorResponse("Blob 缓存读取失败", 503, "storage")
    }
    if (!validRecord(cached.record, validMessageSnapshot)) {
      return emptyMessageResponse(payload)
    }
    return messageResponse(cached.record.payload, payload, recordStatus(cached.record, now))
  }
}


function parseOrdersQuery(request) {
  const url = new URL(request.url)
  const rawStatus = (url.searchParams.get("status") || "2").trim().toLowerCase()
  const status = rawStatus === "all" ? "all" : Number.parseInt(rawStatus, 10)
  if (status !== "all" && (!Number.isInteger(status) || status < 0 || status > 4)) return null
  const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10)
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return null
  return { status, limit, refresh: ["1", "true"].includes(url.searchParams.get("refresh") || "") }
}


export function createOrdersCacheKey(query, accessKey) {
  const identity = JSON.stringify([accessKey, query.status, query.limit])
  const digest = createHash("sha256").update(identity, "utf8").digest("hex")
  return `orders/v1/${digest}.json`
}


function validOrdersSnapshot(snapshot) {
  return Boolean(
    snapshot
      && typeof snapshot === "object"
      && Array.isArray(snapshot.items)
      && Array.isArray(snapshot.warnings)
      && Number.isInteger(snapshot.accountCount)
      && Number.isInteger(snapshot.failedAccountCount),
  )
}


function emptyOrdersResponse(query) {
  return jsonResponse(
    {
      items: [],
      count: 0,
      hasMore: false,
      accountCount: 0,
      failedAccountCount: 0,
      partial: false,
      warnings: [],
      status: query.status,
      updatedAt: "",
    },
    200,
    "empty",
  )
}


async function fetchOrdersSnapshot(request, query, fetchImpl, cacheStatus) {
  const originUrl = publicRequestUrl(request)
  originUrl.pathname = ORDERS_ORIGIN_PATH
  originUrl.search = ""
  originUrl.hash = ""
  originUrl.searchParams.set("status", String(query.status))
  originUrl.searchParams.set("limit", String(query.limit))
  return fetchJson(
    fetchImpl,
    originUrl,
    { method: "GET", headers: requestHeaders(request) },
    cacheStatus,
  )
}


export function createOrdersCacheHandler(dependencies = {}) {
  const getStoreImpl = dependencies.getStoreImpl || getStore
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch
  const nowImpl = dependencies.nowImpl || Date.now
  const logger = dependencies.logger || console.warn
  const resolveStore = createStoreResolver(getStoreImpl, logger)
  const hotRecords = createHotRecordCache(nowImpl)

  return async function onRequest(context) {
    const request = context?.request
    if (!request || request.method !== "GET") {
      return errorResponse("仅支持 GET 请求", 405, "method")
    }

    const authorization = authorizeRequest(context, request)
    if (authorization.failure) return authorization.failure
    const query = parseOrdersQuery(request)
    if (!query) return errorResponse("订单缓存查询参数无效", 400, "validation")

    const objectKey = createOrdersCacheKey(query, authorization.expected)
    const legacyKey = encryptionKey(context)
    const ttlSeconds = cacheTtlSeconds(context)
    const now = nowImpl()

    if (query.refresh) {
      const origin = await fetchOrdersSnapshot(request, query, fetchImpl, "refresh")
      if (!origin.ok) return origin.response
      if (!validOrdersSnapshot(origin.payload)) {
        return errorResponse("号码回源快照格式无效", 502, "upstream", "refresh")
      }

      const store = resolveStore()
      const record = buildRecord(origin.payload, now, ttlSeconds)
      const stored = await writeRecord(
        store,
        objectKey,
        record,
        ttlSeconds,
        logger,
      )
      if (stored) hotRecords.remember(objectKey, record)
      return jsonResponse(origin.payload, 200, stored ? "refreshed" : "bypass")
    }

    const store = resolveStore()
    if (!store) return errorResponse("Blob 缓存暂时不可用", 503, "storage")

    const cached = await hotRecords.read(store, objectKey, legacyKey, logger)
    if (cached.unavailable) return errorResponse("Blob 缓存读取失败", 503, "storage")
    if (!validRecord(cached.record, validOrdersSnapshot)) return emptyOrdersResponse(query)
    return jsonResponse(cached.record.payload, 200, recordStatus(cached.record, now))
  }
}
