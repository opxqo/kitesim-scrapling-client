import { createSmsCacheHandler } from "../_shared/sms_cache.js"

const handleRequest = createSmsCacheHandler()

export default function onRequest(context) {
  return handleRequest(context)
}
