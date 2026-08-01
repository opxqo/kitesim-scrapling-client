import { createOrdersCacheHandler } from "../_shared/sms_cache.js"

const handleRequest = createOrdersCacheHandler()

export default function onRequest(context) {
  return handleRequest(context)
}
