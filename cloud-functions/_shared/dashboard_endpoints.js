import { timingSafeEqual } from "node:crypto"


const ACCESS_KEY_MIN_LENGTH = 12


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


export function createHealthHandler() {
  return async function onRequest(context) {
    const request = context?.request
    if (!request || request.method !== "GET") {
      return errorResponse("仅支持 GET 请求", 405, "method")
    }
    return jsonResponse({
      ok: true,
      service: "kitesim-signal-desk",
      runtime: "edgeone-node-cloud-function",
      authConfigured: environmentValue(context, "DASHBOARD_ACCESS_KEY").length >= ACCESS_KEY_MIN_LENGTH,
    })
  }
}


export function createSessionHandler(dependencies = {}) {
  const nowImpl = dependencies.nowImpl || Date.now

  return async function onRequest(context) {
    const request = context?.request
    if (!request || request.method !== "POST") {
      return errorResponse("仅支持 POST 请求", 405, "method")
    }
    const authorizationFailure = authorizeRequest(context, request)
    if (authorizationFailure) return authorizationFailure
    return jsonResponse({
      ok: true,
      scope: "read-only",
      verifiedAt: new Date(nowImpl()).toISOString(),
    })
  }
}
