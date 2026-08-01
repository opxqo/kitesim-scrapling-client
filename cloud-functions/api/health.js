import { createHealthHandler } from "../_shared/dashboard_endpoints.js"

const handleRequest = createHealthHandler()

export default function onRequest(context) {
  return handleRequest(context)
}
