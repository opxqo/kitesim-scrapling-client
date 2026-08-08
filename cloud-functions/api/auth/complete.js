import { createAuthCompleteHandler } from "../../_shared/kitesim_auth.js"

const handleRequest = createAuthCompleteHandler()

export default function onRequest(context) {
  return handleRequest(context)
}
