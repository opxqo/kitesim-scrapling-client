import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api"

import { accessVerificationFailure, normalizeCacheStatus } from "./use-dashboard"

describe("dashboard cache status normalization", () => {
  it("does not report a Blob write failure when a legacy or direct response omits cacheStatus", () => {
    expect(normalizeCacheStatus(undefined)).toBeNull()
    expect(normalizeCacheStatus("unknown-status")).toBeNull()
    expect(normalizeCacheStatus("bypass")).toBe("bypass")
  })
})

describe("dashboard access verification failure policy", () => {
  it("clears the tab-scoped access key only when the API explicitly rejects dashboard auth", () => {
    expect(accessVerificationFailure(
      new ApiError("访问口令错误", 401, "dashboard_auth"),
    )).toMatchObject({
      clearAccessKey: true,
      accessInvalid: true,
      connection: { mode: "idle", text: "等待访问口令" },
    })

    for (const error of [
      new ApiError("无法连接服务", 0, "network"),
      new ApiError("请求超时", 0, "timeout"),
      new ApiError("服务暂时不可用", 503, "server"),
      new ApiError("请求失败", 401, "http"),
      new Error("unexpected failure"),
    ]) {
      expect(accessVerificationFailure(error)).toMatchObject({
        clearAccessKey: false,
        accessInvalid: false,
        connection: { mode: "error", text: "验证失败，可重试" },
      })
      expect(accessVerificationFailure(error).feedback).toContain("口令已保留，可重试")
    }
  })
})
