import { createAuthMaintenanceHandler } from "../../_shared/kitesim_auth.js"

const handleRequest = createAuthMaintenanceHandler()

export default function onRequest(context) {
  return handleRequest(context)
}
