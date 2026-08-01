import { describe, expect, it } from "vitest"

import healthHandler from "./health.js"
import { createSessionHandler } from "../_shared/dashboard_endpoints.js"


const ACCESS_KEY = "dashboard-test-key"
const ENV = { DASHBOARD_ACCESS_KEY: ACCESS_KEY }


describe("EdgeOne dashboard metadata endpoints", () => {
  it("reports the Node runtime without exposing secrets", async () => {
    const response = await healthHandler({
      request: new Request("https://example.com/api/health"),
      env: ENV,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      service: "kitesim-signal-desk",
      runtime: "edgeone-node-cloud-function",
      authConfigured: true,
    })
  })

  it("keeps session verification authenticated and read-only", async () => {
    const handler = createSessionHandler({ nowImpl: () => 1_000 })
    const unauthorized = await handler({
      request: new Request("https://example.com/api/session", { method: "POST" }),
      env: ENV,
    })
    const authorized = await handler({
      request: new Request("https://example.com/api/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${ACCESS_KEY}` },
      }),
      env: ENV,
    })

    expect(unauthorized.status).toBe(401)
    expect(await unauthorized.json()).toMatchObject({ kind: "dashboard_auth" })
    expect(authorized.status).toBe(200)
    expect(await authorized.json()).toEqual({
      ok: true,
      scope: "read-only",
      verifiedAt: "1970-01-01T00:00:01.000Z",
    })
  })
})
