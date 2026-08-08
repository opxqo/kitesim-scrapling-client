import { createAuthChallengeHandler } from "../../_shared/kitesim_auth.js"

const handleRequest = createAuthChallengeHandler()

export default function onRequest(context) {
  return handleRequest(context)
}
