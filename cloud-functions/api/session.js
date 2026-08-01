import { createSessionHandler } from "../_shared/dashboard_endpoints.js"

const handleRequest = createSessionHandler()

export default function onRequest(context) {
  return handleRequest(context)
}
