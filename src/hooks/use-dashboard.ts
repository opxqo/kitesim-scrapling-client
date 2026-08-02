import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { ApiError, copyText, getHealth, getMessages, getOrders, verifySession } from "@/lib/api"
import {
  firstCodeRecord,
  isCodeRevealed,
  orderKey,
  privacyMessageOptions,
  statusCountsFromOrders,
} from "@/lib/dashboard"
import type {
  AccountWarning,
  CacheStatus,
  DashboardStatus,
  HealthResponse,
  KitesimMessage,
  KitesimOrder,
} from "@/types"

const ACCESS_STORAGE_KEY = "kitesim.relay.accessKey"
const AUTO_REFRESH_STORAGE_KEY = "kitesim.relay.autoRefreshSeconds"
const AUTO_REFRESH_VALUES = new Set([0, 30, 60, 300])
const CACHE_STATUSES = new Set<CacheStatus>(["hit", "stale", "empty", "refreshed", "bypass"])

export type ConnectionMode = "idle" | "loading" | "ready" | "warning" | "error"

type AccessVerificationFailure = {
  clearAccessKey: boolean
  feedback: string
  accessInvalid: boolean
  connection: { mode: ConnectionMode; text: string }
}

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

function readStoredAutoRefreshSeconds(): number {
  try {
    const value = Number.parseInt(window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) || "0", 10)
    return AUTO_REFRESH_VALUES.has(value) ? value : 0
  } catch {
    return 0
  }
}

function storeAutoRefreshSeconds(value: number) {
  try {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(value))
  } catch {
    // Local storage is a convenience, not a requirement.
  }
}

export function normalizeCacheStatus(value: unknown): CacheStatus | null {
  return CACHE_STATUSES.has(value as CacheStatus) ? value as CacheStatus : null
}

function explainError(error: unknown): string {
  if (!(error instanceof ApiError)) return "读取失败，请稍后再试"
  if (error.kind === "dashboard_auth") return "访问口令已失效，请重新输入"
  if (error.kind === "upstream_auth") return "Kitesim Token 已失效，请更新服务端环境变量"
  return error.message || "读取失败，请稍后再试"
}

export function accessVerificationFailure(error: unknown): AccessVerificationFailure {
  if (error instanceof ApiError && error.kind === "dashboard_auth") {
    return {
      clearAccessKey: true,
      feedback: explainError(error),
      accessInvalid: true,
      connection: { mode: "idle", text: "等待访问口令" },
    }
  }

  const message = explainError(error).replace(/[。.!！?？]+$/u, "")
  return {
    clearAccessKey: false,
    feedback: `${message}；当前标签页口令已保留，可重试。`,
    accessInvalid: false,
    connection: { mode: "error", text: "验证失败，可重试" },
  }
}

export function useDashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState("")
  const [accessFeedback, setAccessFeedback] = useState("这里填写控制台口令，不是 Kitesim Token。")
  const [accessInvalid, setAccessInvalid] = useState(false)
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
  const [privacyMasked, setPrivacyMaskedState] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [ordersCacheStatus, setOrdersCacheStatus] = useState<CacheStatus | null>(null)
  const [messageCacheStatus, setMessageCacheStatus] = useState<CacheStatus | null>(null)
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(readStoredAutoRefreshSeconds)
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
  const privacyMaskedRef = useRef(true)
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
    setPrivacyMaskedState(true)
    privacyMaskedRef.current = true
    setSearchQuery("")
    setLastUpdatedAt("")
    setLoadingOrders(false)
    setLoadingMessages(false)
    setOrdersCacheStatus(null)
    setMessageCacheStatus(null)
  }, [])

  const lock = useCallback(
    (message = "工作台已锁定，访问口令已从当前标签页清除。") => {
      accessKeyRef.current = ""
      storeAccessKey("")
      setAuthenticated(false)
      setAuthenticating(false)
      setAccessInvalid(false)
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
        refresh?: boolean
        quiet?: boolean
        warningCount?: number
      } = {},
    ) => {
      const accessKey = options.key ?? accessKeyRef.current
      if (!accessKey) return null
      const sequence = ++messageSequence.current
      const nextRevealCode = options.revealCode ?? revealCodeRef.current
      const nextShowSms = options.showSms ?? showSmsRef.current
      const warningCount = options.warningCount ?? warnings.length
      const refresh = options.refresh === true
      setLoadingMessages(true)
      setConnection({
        mode: "loading",
        text: refresh ? "正在从 Kitesim 刷新短信" : "正在读取 Blob 短信",
      })

      try {
        const payload = await getMessages(accessKey, order, {
          revealCode: nextRevealCode,
          showSms: nextShowSms,
          refresh,
        })
        if (sequence !== messageSequence.current) return null

        if (!Array.isArray(payload.items)) {
          throw new ApiError("短信接口返回格式无效", 502, "server")
        }
        if (
          Boolean(payload.revealCode) !== nextRevealCode
          || Boolean(payload.showSms) !== nextShowSms
        ) {
          throw new ApiError("短信接口返回的隐私状态不一致", 502, "server")
        }
        const items = payload.items
        const cacheStatus = normalizeCacheStatus(payload.cacheStatus)
        setMessages(items)
        setMessageCacheStatus(cacheStatus)
        setRevealCode(Boolean(payload.revealCode))
        revealCodeRef.current = Boolean(payload.revealCode)
        setShowSms(Boolean(payload.showSms))
        showSmsRef.current = Boolean(payload.showSms)
        const nextPrivacyMasked = !payload.revealCode
        setPrivacyMaskedState(nextPrivacyMasked)
        privacyMaskedRef.current = nextPrivacyMasked
        setMessageCounts((current) => ({ ...current, [orderKey(order)]: items.length }))
        if (payload.updatedAt) setLastUpdatedAt(payload.updatedAt)

        if (warningCount) {
          setConnection({ mode: "warning", text: "部分账户读取失败" })
        } else if (cacheStatus === "empty") {
          setConnection({ mode: "ready", text: "Blob 暂无短信快照" })
        } else if (cacheStatus === "stale") {
          setConnection({ mode: "warning", text: "已读取旧短信快照" })
        } else if (cacheStatus === "bypass") {
          setConnection({ mode: "warning", text: "Blob 写入失败" })
        } else if (cacheStatus === "refreshed") {
          setConnection({ mode: "ready", text: "短信快照已更新" })
        } else if (cacheStatus === null) {
          setConnection({ mode: "ready", text: refresh ? "短信刷新完成" : "短信读取完成" })
        } else {
          setConnection({ mode: "ready", text: "已读取 Blob 短信" })
        }

        if (!options.quiet) {
          if (cacheStatus === "empty") {
            toast.info("Blob 暂无短信快照，请点击刷新")
          } else if (cacheStatus === "stale") {
            toast.warning("已读取旧短信快照；点击刷新可获取最新数据")
          } else if (cacheStatus === "bypass") {
            toast.warning("已从 Kitesim 刷新，但 Blob 快照写入失败")
          } else if (cacheStatus === "refreshed") {
            toast.success(items.length ? "短信已刷新并写入 Blob" : "短信已刷新，当前暂无记录")
          } else if (cacheStatus === null) {
            toast.success(items.length ? (refresh ? "短信已刷新" : "短信已读取") : "当前暂无短信")
          } else {
            toast.success(items.length ? "已读取 Blob 短信快照" : "Blob 快照中暂无短信")
          }
        }
        return cacheStatus
      } catch (error) {
        if (sequence !== messageSequence.current) return null
        setMessages([])
        setMessageCacheStatus(null)
        setRevealCode(false)
        revealCodeRef.current = false
        setShowSms(false)
        showSmsRef.current = false
        setPrivacyMaskedState(true)
        privacyMaskedRef.current = true
        handleRequestError(error, "短信")
        return null
      } finally {
        if (sequence === messageSequence.current) setLoadingMessages(false)
      }
    },
    [handleRequestError, warnings.length],
  )

  const fetchOrders = useCallback(
    async (
      nextStatus: DashboardStatus,
      options: { key?: string; quiet?: boolean; preserveSelection?: boolean; refresh?: boolean } = {},
    ) => {
      const accessKey = options.key ?? accessKeyRef.current
      if (!accessKey) return false
      const sequence = ++orderSequence.current
      const refresh = options.refresh === true
      const privacyOptions = privacyMessageOptions(privacyMaskedRef.current)
      messageSequence.current += 1
      setLoadingOrders(true)
      setMessages([])
      setMessageCacheStatus(null)
      setRevealCode(privacyOptions.revealCode)
      revealCodeRef.current = privacyOptions.revealCode
      setShowSms(privacyOptions.showSms)
      showSmsRef.current = privacyOptions.showSms
      setConnection({
        mode: "loading",
        text: refresh ? "正在从 Kitesim 刷新号码" : "正在读取 Blob 号码",
      })

      let orderToLoad: KitesimOrder | null = null
      let currentWarnings: AccountWarning[] = []
      let ordersStatus: CacheStatus | null = null
      try {
        const payload = await getOrders(accessKey, nextStatus, { refresh })
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
        ordersStatus = normalizeCacheStatus(payload.cacheStatus)
        currentWarnings = payload.warnings
        const previousKey = options.preserveSelection ? selectedKeyRef.current : ""
        orderToLoad = nextOrders.find((order) => orderKey(order) === previousKey) ?? nextOrders[0] ?? null
        const nextSelectedKey = orderKey(orderToLoad)

        setOrders(nextOrders)
        setAccountCount(payload.accountCount)
        setFailedAccountCount(payload.failedAccountCount)
        setWarnings(currentWarnings)
        setOrdersCacheStatus(ordersStatus)
        setSelectedKey(nextSelectedKey)
        selectedKeyRef.current = nextSelectedKey
        if (payload.updatedAt) setLastUpdatedAt(payload.updatedAt)
        setStatusCounts((current) => {
          if (nextStatus === "all") return { ...current, ...statusCountsFromOrders(nextOrders) }
          return { ...current, [nextStatus]: nextOrders.length }
        })
        if (currentWarnings.length) {
          setConnection({ mode: "warning", text: "部分账户读取失败" })
        } else if (ordersStatus === "empty") {
          setConnection({ mode: "ready", text: "Blob 暂无号码快照" })
        } else if (ordersStatus === "stale") {
          setConnection({ mode: "warning", text: "已读取旧号码快照" })
        } else if (ordersStatus === "bypass") {
          setConnection({ mode: "warning", text: "Blob 写入失败" })
        } else if (ordersStatus === "refreshed") {
          setConnection({ mode: "ready", text: "号码快照已更新" })
        } else if (ordersStatus === null) {
          setConnection({ mode: "ready", text: refresh ? "号码刷新完成" : "号码读取完成" })
        } else {
          setConnection({ mode: "ready", text: "已读取 Blob 号码" })
        }
      } catch (error) {
        if (sequence !== orderSequence.current) return false
        setOrders([])
        setAccountCount(0)
        setFailedAccountCount(0)
        setWarnings([])
        setOrdersCacheStatus(null)
        setSelectedKey("")
        selectedKeyRef.current = ""
        handleRequestError(error, "号码")
        return false
      } finally {
        if (sequence === orderSequence.current) setLoadingOrders(false)
      }

      if (sequence !== orderSequence.current) return false
      let messagesStatus: CacheStatus | null = null
      if (orderToLoad) {
        messagesStatus = await fetchMessages(orderToLoad, {
          key: accessKey,
          ...privacyOptions,
          refresh,
          quiet: true,
          warningCount: currentWarnings.length,
        })
      }
      if (!options.quiet && accessKeyRef.current) {
        if (currentWarnings.length) {
          toast.warning(`${refresh ? "刷新" : "读取"}完成，${currentWarnings.length} 个账户失败`)
        } else if (ordersStatus === "empty") {
          toast.info("Blob 暂无号码快照，请点击刷新")
        } else if (ordersStatus === "stale" || messagesStatus === "stale") {
          toast.warning("已读取旧 Blob 快照；点击刷新可获取最新数据")
        } else if (ordersStatus === "bypass" || messagesStatus === "bypass") {
          toast.warning("已从 Kitesim 刷新，但 Blob 快照写入失败")
        } else if (ordersStatus === null || (orderToLoad !== null && messagesStatus === null)) {
          toast.success(orderToLoad ? (refresh ? "号码和短信已刷新" : "号码和短信已读取") : "号码读取完成")
        } else if (ordersStatus === "refreshed") {
          toast.success(orderToLoad ? "号码和短信已刷新并写入 Blob" : "号码已刷新并写入 Blob")
        } else if (messagesStatus === "empty") {
          toast.info("已读取号码快照；所选号码暂无短信快照")
        } else {
          toast.success(orderToLoad ? "已读取 Blob 号码和短信快照" : "Blob 快照中当前状态没有号码")
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
        setAccessInvalid(true)
        return false
      }

      setAuthenticating(true)
      setAccessInvalid(false)
      setAccessFeedback("正在验证访问口令…")
      setConnection({ mode: "loading", text: "正在建立安全通道" })
      try {
        await verifySession(key)
        accessKeyRef.current = key
        storeAccessKey(key)
        setAuthenticated(true)
        setAccessInvalid(false)
        setAccessFeedback("")
        setConnection({ mode: "loading", text: "正在读取 Blob 号码" })
        await fetchOrders(statusRef.current, { key, quiet: options.quiet, refresh: false })
        return true
      } catch (error) {
        const failure = accessVerificationFailure(error)
        if (failure.clearAccessKey) {
          accessKeyRef.current = ""
          storeAccessKey("")
        } else {
          accessKeyRef.current = key
          storeAccessKey(key)
        }
        setAuthenticated(false)
        setAccessFeedback(failure.feedback)
        setAccessInvalid(failure.accessInvalid)
        setConnection(failure.connection)
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
          setAccessInvalid(true)
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
        setAccessInvalid(true)
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
      void fetchOrders(nextStatus, { refresh: false })
    },
    [fetchOrders, loadingMessages, loadingOrders],
  )

  const setPrivacyMasked = useCallback(
    (nextMasked: boolean) => {
      if (loadingOrders || loadingMessages) return
      const privacyOptions = privacyMessageOptions(nextMasked)
      setPrivacyMaskedState(nextMasked)
      privacyMaskedRef.current = nextMasked
      setRevealCode(privacyOptions.revealCode)
      revealCodeRef.current = privacyOptions.revealCode
      setShowSms(privacyOptions.showSms)
      showSmsRef.current = privacyOptions.showSms
      if (selectedOrder) {
        void fetchMessages(selectedOrder, { ...privacyOptions, refresh: false })
      }
    },
    [fetchMessages, loadingMessages, loadingOrders, selectedOrder],
  )

  const selectOrder = useCallback(
    (nextKey: string) => {
      if (nextKey === selectedKeyRef.current || loadingOrders || loadingMessages) return
      const order = orders.find((item) => orderKey(item) === nextKey)
      if (!order) return
      selectedKeyRef.current = nextKey
      setSelectedKey(nextKey)
      setMessages([])
      setMessageCacheStatus(null)
      const privacyOptions = privacyMessageOptions(privacyMaskedRef.current)
      setRevealCode(privacyOptions.revealCode)
      revealCodeRef.current = privacyOptions.revealCode
      setShowSms(privacyOptions.showSms)
      showSmsRef.current = privacyOptions.showSms
      void fetchMessages(order, { ...privacyOptions, refresh: false })
    },
    [fetchMessages, loadingMessages, loadingOrders, orders],
  )

  const refresh = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (loadingOrders || loadingMessages) return false
    return fetchOrders(statusRef.current, {
      preserveSelection: true,
      refresh: true,
      quiet: options.quiet,
    })
  }, [fetchOrders, loadingMessages, loadingOrders])

  useEffect(() => {
    if (!authenticated || autoRefreshSeconds <= 0) return
    const intervalId = window.setInterval(() => {
      void refresh({ quiet: true })
    }, autoRefreshSeconds * 1000)
    return () => window.clearInterval(intervalId)
  }, [authenticated, autoRefreshSeconds, refresh])

  const changeAutoRefreshSeconds = useCallback((value: number) => {
    if (!AUTO_REFRESH_VALUES.has(value)) return
    setAutoRefreshSeconds(value)
    storeAutoRefreshSeconds(value)
    if (value === 0) {
      toast.success("定时刷新已关闭；页面将只读取 Blob 快照")
    } else {
      toast.success(`已设置每 ${value} 秒从 Kitesim 刷新并回写 Blob`)
    }
  }, [])

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
    if (!privacyMasked && isCodeRevealed(code)) void copyValue(code, "验证码")
  }, [copyValue, messages, privacyMasked])

  return {
    health,
    healthError,
    accessFeedback,
    accessInvalid,
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
    ordersCacheStatus,
    messageCacheStatus,
    autoRefreshSeconds,
    lastUpdatedAt,
    connection,
    setPrivacyMasked,
    setSearchQuery,
    verifyAccess,
    lock,
    refresh,
    changeAutoRefreshSeconds,
    changeStatus,
    selectOrder,
    copyValue,
    copyLatestCode,
  }
}

export type DashboardController = ReturnType<typeof useDashboard>
