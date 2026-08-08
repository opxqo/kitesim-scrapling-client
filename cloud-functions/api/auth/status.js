import { createAuthStatusHandler } from "../../_shared/kitesim_auth.js"

const handleRequest = createAuthStatusHandler()

export default function onRequest(context) {
  return handleRequest(context)
}
