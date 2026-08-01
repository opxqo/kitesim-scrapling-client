import { describe, expect, it } from "vitest"

import { normalizeCacheStatus } from "./use-dashboard"

describe("dashboard cache status normalization", () => {
  it("does not report a Blob write failure when a legacy or direct response omits cacheStatus", () => {
    expect(normalizeCacheStatus(undefined)).toBeNull()
    expect(normalizeCacheStatus("unknown-status")).toBeNull()
    expect(normalizeCacheStatus("bypass")).toBe("bypass")
  })
})
