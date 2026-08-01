import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { ApiError, copyText, getHealth, getMessages, getOrders, verifySession } from "@/lib/api"
import {
  firstCodeRecord,
  isCodeRevealed,
  orderKey,
  statusCountsFromOrders,
} from "@/lib/dashboard"
import type {
  AccountWarning,
  DashboardStatus,
  HealthResponse,
  KitesimMessage,
  KitesimOrder,
} from "@/types"

const ACCESS_STORAGE_KEY = "kitesim.relay.accessKey"

export type ConnectionMode = "idle" | "loading" | "ready" | "warning" | "error"

function readStoredAccessKey(): string {
  try {
    return window.sessionStorage.getItem(ACCESS_STORAGE_KEY) || ""
  } catch {
    return ""
  }
}

function storeAccessKey(value: string) {
  try {
    if (value) window.sessionStorage.setItem(ACCESS_STORAGE_KEY, value)
    else window.sessionStorage.removeItem(ACCESS_STORAGE_KEY)
  } catch {
    // Session storage is a convenience, not a requirement.
  }
}

function explainError(error: unknown): string {
  if (!(error instanceof ApiError)) return "读取失败，请稍后再试"
  if (error.kind === "dashboard_auth") return "访问口令已失效，请重新输入"
  if (error.kind === "upstream_auth") return "Kitesim Token 已失效，请更新服务端环境变量"
  return error.message || "读取失败，请稍后再试"
}

export function useDashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState("")
  const [accessFeedback, setAccessFeedback] = useState("这里填写控制台口令，不是 Kitesim Token。")
  const [authenticating, setAuthenticating] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [status, setStatus] = useState<DashboardStatus>("2")
  const [orders, setOrders] = useState<KitesimOrder[]>([])
  const [accountCount, setAccountCount] = useState(0)
  const [failedAccountCount, setFailedAccountCount] = useState(0)
  const [warnings, setWarnings] = useState<AccountWarning[]>([])
  const [selectedKey, setSelectedKey] = useState("")
  const [messages, setMessages] = useState<KitesimMessage[]>([])
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>({})
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [revealCode, setRevealCode] = useState(false)
  const [showSms, setShowSms] = useState(false)
  const [privacyMasked, setPrivacyMasked] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState("")
  const [connection, setConnection] = useState<{ mode: ConnectionMode; text: string }>({
    mode: "loading",
    text: "正在检查服务",
  })

  const bootstrapped = useRef(false)
  const accessKeyRef = useRef("")
  const statusRef = useRef<DashboardStatus>("2")
  const selectedKeyRef = useRef("")
  const revealCodeRef = useRef(false)
  const showSmsRef = useRef(false)
  const orderSequence = useRef(0)
  const messageSequence = useRef(0)

  const selectedOrder = useMemo(
    () => orders.find((order) => orderKey(order) === selectedKey) ?? null,
    [orders, selectedKey],
  )

  const filteredOrders = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase()
    if (!needle) return orders
    return orders.filter((order) =>
      [order.phoneNumber, order.accountLabel, order.countryCode, order.statusLabel, order.packageId]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(needle)),
    )
  }, [orders, searchQuery])

  const resetWorkspace = useCallback(() => {
    orderSequence.current += 1
    messageSequence.current += 1
    setOrders([])
    setAccountCount(0)
    setFailedAccountCount(0)
    setWarnings([])
    setSelectedKey("")
    selectedKeyRef.current = ""
    setMessages([])
    setMessageCounts({})
    setStatusCounts({})
    setRevealCode(false)
    revealCodeRef.current = false
    setShowSms(false)
    showSmsRef.current = false
    setPrivacyMasked(true)
    setSearchQuery("")
    setLastUpdatedAt("")
    setLoadingOrders(false)
    setLoadingMessages(false)
  }, [])

  const lock = useCallback(
    (message = "工作台已锁定，访问口令已从当前标签页清除。") => {
      accessKeyRef.current = ""
      storeAccessKey("")
      setAuthenticated(false)
      setAuthenticating(false)
      setAccessFeedback(message)
      setConnection({ mode: healthError ? "error" : "idle", text: healthError ? "服务不可用" : "工作台已锁定" })
      resetWorkspace()
    },
    [healthError, resetWorkspace],
  )

  const handleRequestError = useCallback(
    (error: unknown, context: "号码" | "短信") => {
      const message = explainError(error)
      if (error instanceof ApiError && error.kind === "dashboard_auth") {
        lock(message)
        return
      }
      setConnection({ mode: "error", text: `${context}读取失败` })
      toast.error(message)
    },
    [lock],
  )

  const fetchMessages = useCallback(
    async (
      order: KitesimOrder,
      options: {
        key?: string
        revealCode?: boolean
        showSms?: boolean
        quiet?: boolean
        warningCount?: number
      } = {},
    ) => {
      const accessKey = options.key ?? accessKeyRef.current
      if (!accessKey) return
      const sequence = ++messageSequence.current
      const nextRevealCode = options.revealCode ?? revealCodeRef.current
      const nextShowSms = options.showSms ?? showSmsRef.current
      const warningCount = options.warningCount ?? warnings.length
      setLoadingMessages(true)
      setConnection({ mode: "loading", text: "正在同步短信" })

      try {
        const payload = await getMessages(accessKey, order, {
          revealCode: nextRevealCode,
          showSms: nextShowSms,
        })
        if (sequence !== messageSequence.current) return

        if (!Array.isArray(payload.items)) {
          throw new ApiError("短信接口返回格式无效", 502, "server")
        }
        const items = payload.items
        setMessages(items)
        setRevealCode(Boolean(payload.revealCode))
        revealCodeRef.current = Boolean(payload.revealCode)
        setShowSms(Boolean(payload.showSms))
        showSmsRef.current = Boolean(payload.showSms)
        setMessageCounts((current) => ({ ...current, [orderKey(order)]: items.length }))
        setLastUpdatedAt(payload.updatedAt || "")
        setConnection({
          mode: warningCount ? "warning" : "ready",
          text: warningCount ? "部分账户读取失败" : "安全通道已连接",
        })
        if (!options.quiet) toast.success(items.length ? "短信已刷新" : "这个号码暂时没有短信")
      } catch (error) {
        if (sequence !== messageSequence.current) return
        setMessages([])
        handleRequestError(error, "短信")
      } finally {
        if (sequence === messageSequence.current) setLoadingMessages(false)
      }
    },
    [handleRequestError, warnings.length],
  )

  const fetchOrders = useCallback(
    async (
      nextStatus: DashboardStatus,
      options: { key?: string; quiet?: boolean; preserveSelection?: boolean } = {},
    ) => {
      const accessKey = options.key ?? accessKeyRef.current
      if (!accessKey) return false
      const sequence = ++orderSequence.current
      messageSequence.current += 1
      setLoadingOrders(true)
      setMessages([])
      setRevealCode(false)
      revealCodeRef.current = false
      setShowSms(false)
      showSmsRef.current = false
      setConnection({ mode: "loading", text: "正在同步号码" })

      let orderToLoad: KitesimOrder | null = null
      let currentWarnings: AccountWarning[] = []
      try {
        const payload = await getOrders(accessKey, nextStatus)
        if (sequence !== orderSequence.current) return false

        if (
          !Array.isArray(payload.items)
          || !Array.isArray(payload.warnings)
          || !Number.isInteger(payload.accountCount)
          || payload.accountCount < 0
          || !Number.isInteger(payload.failedAccountCount)
          || payload.failedAccountCount < 0
        ) {
          throw new ApiError("号码接口返回格式无效", 502, "server")
        }

        const nextOrders = payload.items
        currentWarnings = payload.warnings
        const previousKey = options.preserveSelection ? selectedKeyRef.current : ""
        orderToLoad = nextOrders.find((order) => orderKey(order) === previousKey) ?? nextOrders[0] ?? null
        const nextSelectedKey = orderKey(orderToLoad)

        setOrders(nextOrders)
        setAccountCount(payload.accountCount)
        setFailedAccountCount(payload.failedAccountCount)
        setWarnings(currentWarnings)
        setSelectedKey(nextSelectedKey)
        selectedKeyRef.current = nextSelectedKey
        setLastUpdatedAt(payload.updatedAt || "")
        setStatusCounts((current) => {
          if (nextStatus === "all") return { ...current, ...statusCountsFromOrders(nextOrders) }
          return { ...current, [nextStatus]: nextOrders.length }
        })
        setConnection({
          mode: currentWarnings.length ? "warning" : "ready",
          text: currentWarnings.length ? "部分账户读取失败" : "号码已读取",
        })
      } catch (error) {
        if (sequence !== orderSequence.current) return false
        setOrders([])
        setAccountCount(0)
        setFailedAccountCount(0)
        setWarnings([])
        setSelectedKey("")
        selectedKeyRef.current = ""
        handleRequestError(error, "号码")
        return false
      } finally {
        if (sequence === orderSequence.current) setLoadingOrders(false)
      }

      if (sequence !== orderSequence.current) return false
      if (orderToLoad) {
        await fetchMessages(orderToLoad, {
          key: accessKey,
          revealCode: false,
          showSms: false,
          quiet: true,
          warningCount: currentWarnings.length,
        })
      }
      if (!options.quiet && accessKeyRef.current) {
        if (currentWarnings.length) {
          toast.warning(`号码已刷新，${currentWarnings.length} 个账户读取失败`)
        } else {
          toast.success(orderToLoad ? "号码和短信已刷新" : "当前状态没有号码")
        }
      }
      return true
    },
    [fetchMessages, handleRequestError],
  )

  const verifyAccess = useCallback(
    async (rawKey: string, options: { quiet?: boolean } = {}) => {
      const key = rawKey.trim()
      if (key.length < 12) {
        setAccessFeedback("访问口令至少需要 12 个字符。")
        return false
      }

      setAuthenticating(true)
      setAccessFeedback("正在验证访问口令…")
      setConnection({ mode: "loading", text: "正在建立安全通道" })
      try {
        await verifySession(key)
        accessKeyRef.current = key
        storeAccessKey(key)
        setAuthenticated(true)
        setAccessFeedback("")
        setConnection({ mode: "loading", text: "正在同步号码" })
        await fetchOrders(statusRef.current, { key, quiet: options.quiet })
        return true
      } catch (error) {
        accessKeyRef.current = ""
        storeAccessKey("")
        setAuthenticated(false)
        setAccessFeedback(explainError(error))
        setConnection({ mode: "idle", text: "等待访问口令" })
        return false
      } finally {
        setAuthenticating(false)
      }
    },
    [fetchOrders],
  )

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true

    void (async () => {
      try {
        const payload = await getHealth()
        setHealth(payload)
        if (!payload.ok) throw new ApiError("服务健康检查失败", 503, "server")
        if (!payload.authConfigured) {
          setAccessFeedback("服务端没有配置 DASHBOARD_ACCESS_KEY，暂时无法解锁。")
          setConnection({ mode: "error", text: "缺少服务端配置" })
          return
        }

        const storedKey = readStoredAccessKey()
        if (storedKey) {
          await verifyAccess(storedKey, { quiet: true })
        } else {
          setConnection({ mode: "idle", text: "等待访问口令" })
        }
      } catch (error) {
        const message = explainError(error)
        setHealthError(message)
        setAccessFeedback(message)
        setConnection({ mode: "error", text: "服务不可用" })
      }
    })()
  }, [verifyAccess])

  const changeStatus = useCallback(
    (nextStatus: DashboardStatus) => {
      if (nextStatus === statusRef.current || loadingOrders || loadingMessages) return
      statusRef.current = nextStatus
      setStatus(nextStatus)
      selectedKeyRef.current = ""
      setSelectedKey("")
      void fetchOrders(nextStatus)
    },
    [fetchOrders, loadingMessages, loadingOrders],
  )

  const selectOrder = useCallback(
    (nextKey: string) => {
      if (nextKey === selectedKeyRef.current || loadingOrders || loadingMessages) return
      const order = orders.find((item) => orderKey(item) === nextKey)
      if (!order) return
      selectedKeyRef.current = nextKey
      setSelectedKey(nextKey)
      setMessages([])
      setRevealCode(false)
      revealCodeRef.current = false
      setShowSms(false)
      showSmsRef.current = false
      void fetchMessages(order, { revealCode: false, showSms: false })
    },
    [fetchMessages, loadingMessages, loadingOrders, orders],
  )

  const toggleRevealCode = useCallback(() => {
    if (!selectedOrder || loadingMessages) return
    void fetchMessages(selectedOrder, { revealCode: !revealCodeRef.current })
  }, [fetchMessages, loadingMessages, selectedOrder])

  const toggleShowSms = useCallback(
    (nextValue: boolean) => {
      if (selectedOrder && !loadingMessages) {
        void fetchMessages(selectedOrder, { showSms: nextValue })
      }
    },
    [fetchMessages, loadingMessages, selectedOrder],
  )

  const refresh = useCallback(() => {
    if (!loadingOrders && !loadingMessages) {
      void fetchOrders(statusRef.current, { preserveSelection: true })
    }
  }, [fetchOrders, loadingMessages, loadingOrders])

  const copyValue = useCallback(async (value: string, label: string) => {
    try {
      await copyText(value)
      toast.success(`${label}已复制`)
    } catch {
      toast.error("浏览器没有允许访问剪贴板")
    }
  }, [])

  const copyLatestCode = useCallback(() => {
    const code = firstCodeRecord(messages)?.code || ""
    if (isCodeRevealed(code)) void copyValue(code, "验证码")
  }, [copyValue, messages])

  return {
    health,
    healthError,
    accessFeedback,
    authenticating,
    authenticated,
    status,
    orders,
    filteredOrders,
    accountCount,
    failedAccountCount,
    warnings,
    selectedKey,
    selectedOrder,
    messages,
    messageCounts,
    statusCounts,
    revealCode,
    showSms,
    privacyMasked,
    searchQuery,
    loadingOrders,
    loadingMessages,
    lastUpdatedAt,
    connection,
    setPrivacyMasked,
    setSearchQuery,
    verifyAccess,
    lock,
    refresh,
    changeStatus,
    selectOrder,
    toggleRevealCode,
    toggleShowSms,
    copyValue,
    copyLatestCode,
  }
}

export type DashboardController = ReturnType<typeof useDashboard>
