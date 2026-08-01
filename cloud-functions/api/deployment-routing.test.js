import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"


const PUBLIC_API_FRAMEWORK = fileURLToPath(new URL("./index.py", import.meta.url))
const PYTHON_ORIGIN_FRAMEWORK = fileURLToPath(new URL("../origin/index.py", import.meta.url))
const PUBLIC_HEALTH_HANDLER = fileURLToPath(new URL("./health.js", import.meta.url))
const PUBLIC_SESSION_HANDLER = fileURLToPath(new URL("./session.js", import.meta.url))


describe("EdgeOne function routing", () => {
  it("keeps the Python framework outside the public Node cache route prefix", () => {
    expect(existsSync(PUBLIC_API_FRAMEWORK)).toBe(false)
    expect(existsSync(PYTHON_ORIGIN_FRAMEWORK)).toBe(true)
    expect(existsSync(PUBLIC_HEALTH_HANDLER)).toBe(true)
    expect(existsSync(PUBLIC_SESSION_HANDLER)).toBe(true)
  })
})
