import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  DatabaseZap,
  Eye,
  EyeOff,
  Inbox,
  KeyRound,
  LockKeyhole,
  MessageSquareText,
  Phone,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  UserRoundCheck,
  X,
} from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { AppMark } from "@/components/app-mark"
import { TokenManager } from "@/components/token-manager"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { DashboardController } from "@/hooks/use-dashboard"
import {
  buildAccountGroups,
  displayMessageContent,
  displaySensitiveIdentifier,
  firstCodeRecord,
  formatDateTime,
  formatPackage,
  formatShortTime,
  isCodeRevealed,
  orderKey,
  statusLabel,
} from "@/lib/dashboard"
import { cn } from "@/lib/utils"
import type { CacheStatus, DashboardStatus, KitesimMessage, KitesimOrder } from "@/types"

const STATUS_ITEMS: Array<{ value: DashboardStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "2", label: "使用中" },
  { value: "1", label: "激活中" },
  { value: "0", label: "待支付" },
  { value: "3", label: "已过期" },
  { value: "4", label: "已退款" },
]

const CACHE_STATUS_LABEL: Record<CacheStatus, string> = {
  hit: "Blob 快照",
  stale: "旧快照",
  empty: "无快照",
  refreshed: "刚刚更新",
  bypass: "写入失败",
}

const STATUS_TONE: Record<string, string> = {
  使用中: "text-emerald-700 bg-emerald-500/10",
  激活中: "text-indigo-700 bg-indigo-500/10",
  待支付: "text-amber-700 bg-amber-500/10",
  已过期: "text-slate-500 bg-slate-500/10",
  已退款: "text-slate-500 bg-slate-500/10",
}

type MobilePanel = "numbers" | "code" | "messages"

function displayPhone(order: KitesimOrder, masked: boolean) {
  return displaySensitiveIdentifier(order.phoneNumber, masked)
}

function displayIdentifier(value: string, masked: boolean) {
  return displaySensitiveIdentifier(value, masked)
}

function statusTone(mode: DashboardController["connection"]["mode"]) {
  if (mode === "error") return "bg-rose-500"
  if (mode === "warning") return "bg-amber-500"
  if (mode === "loading") return "animate-pulse bg-indigo-500"
  return "bg-emerald-500"
}

function usePagedItems<T>(items: T[], pageSize: number, resetKey: string) {
  const [pageState, setPageState] = useState({ page: 0, resetKey })
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(pageState.resetKey === resetKey ? pageState.page : 0, pageCount - 1)
  const setPage = (nextPage: number) => {
    setPageState({
      page: Math.min(Math.max(0, nextPage), pageCount - 1),
      resetKey,
    })
  }

  return {
    page,
    pageCount,
    setPage,
    items: items.slice(page * pageSize, page * pageSize + pageSize),
  }
}

function Pager({
  page,
  pageCount,
  onChange,
  label,
}: {
  page: number
  pageCount: number
  onChange: (page: number) => void
  label: string
}) {
  return (
    <div className="flex h-8 items-center justify-between border-t border-white/70 px-3 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="soft-control"
          onClick={() => onChange(page - 1)}
          disabled={page === 0}
          aria-label={`上一页${label}`}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-10 text-center font-mono tabular-nums">
          {page + 1}/{pageCount}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="soft-control"
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount - 1}
          aria-label={`下一页${label}`}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

function AccountLoginDialog({ dashboard }: { dashboard: DashboardController }) {
  return (
    <DialogPrimitive.Root>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogPrimitive.Trigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="soft-control gap-2 px-2.5"
              aria-label="管理 Kitesim 账户登录"
            >
              <UserRoundCheck />
              <span className="hidden xl:inline">账户登录</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {Math.max(0, dashboard.accountCount - dashboard.failedAccountCount)}/{dashboard.accountCount}
              </span>
            </Button>
          </DialogPrimitive.Trigger>
        </TooltipTrigger>
        <TooltipContent>管理 Kitesim 登录与图片验证码</TooltipContent>
      </Tooltip>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/22 backdrop-blur-[3px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out data-[state=open]:fade-in" />
        <DialogPrimitive.Content className="neumorph-dialog fixed top-1/2 left-1/2 z-50 w-[min(760px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden p-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Kitesim 账户登录</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            管理账户验证码登录，Token 只保存在服务端。
          </DialogPrimitive.Description>
          <DialogPrimitive.Close asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="soft-control absolute top-4 right-4 z-10"
              aria-label="关闭账户登录弹窗"
            >
              <X />
            </Button>
          </DialogPrimitive.Close>
          <TokenManager dashboard={dashboard} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function MessageDetailDialog({
  message,
  dashboard,
  onClose,
}: {
  message: KitesimMessage | null
  dashboard: DashboardController
  onClose: () => void
}) {
  if (!message) return null
  const sender = displayIdentifier(message.sender || "未知发送方", dashboard.privacyMasked)
  const content = displayMessageContent(message.content, dashboard.privacyMasked)
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/22 backdrop-blur-[3px]" />
        <DialogPrimitive.Content className="neumorph-dialog fixed top-1/2 left-1/2 z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden p-6 outline-none">
          <div className="flex items-start gap-3 pr-10">
            <div className="signal-puck grid size-11 shrink-0 place-items-center rounded-2xl text-indigo-600">
              <MessageSquareText className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-base font-semibold">{sender}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(message.time)} · 完整短信详情
              </DialogPrimitive.Description>
            </div>
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" className="soft-control absolute top-4 right-4" aria-label="关闭短信详情">
              <X />
            </Button>
          </DialogPrimitive.Close>
          <div className="soft-inset mt-5 rounded-2xl p-4">
            <p className="break-words whitespace-pre-wrap text-sm leading-6 text-slate-700">{content}</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs text-muted-foreground">识别到的验证码</span>
            {message.code.length ? message.code.map((code, index) => (
              <Button
                key={`${code}-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                className="soft-control font-mono tracking-wider"
                disabled={dashboard.privacyMasked || !isCodeRevealed(code)}
                onClick={() => dashboard.copyValue(code, "验证码")}
              >
                {dashboard.privacyMasked ? "••••••" : code}
                <Copy />
              </Button>
            )) : <span className="text-xs text-muted-foreground">未识别</span>}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function AutoRefreshSelect({ dashboard }: { dashboard: DashboardController }) {
  return (
    <Select
      value={String(dashboard.autoRefreshSeconds)}
      onValueChange={(value) => dashboard.changeAutoRefreshSeconds(Number(value))}
      disabled={dashboard.loadingOrders || dashboard.loadingMessages}
    >
      <SelectTrigger size="sm" className="soft-control hidden min-w-[118px] border-0 bg-transparent shadow-none sm:flex" aria-label="定时刷新周期">
        <Clock3 className="text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="0">手动刷新</SelectItem>
        <SelectItem value="30">每 30 秒</SelectItem>
        <SelectItem value="60">每分钟</SelectItem>
        <SelectItem value="300">每 5 分钟</SelectItem>
      </SelectContent>
    </Select>
  )
}

function WorkspaceHeader({ dashboard }: { dashboard: DashboardController }) {
  const busy = dashboard.loadingOrders || dashboard.loadingMessages
  return (
    <header className="flex h-14 shrink-0 items-center border-b border-white/70 bg-[#eef2f8]/90 px-3 backdrop-blur-xl md:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <AppMark />
        <div className="min-w-0 leading-none">
          <div className="truncate text-sm font-semibold tracking-tight text-slate-900">Kitesim Relay</div>
          <span className="mt-1 hidden text-[10px] font-medium tracking-[0.14em] text-slate-500 uppercase sm:block">
            Signal operations desk
          </span>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="soft-inset hidden h-8 items-center gap-2 rounded-xl px-3 text-xs text-slate-600 md:flex">
          <span className={cn("size-2 rounded-full", statusTone(dashboard.connection.mode))} />
          <span>{dashboard.connection.text}</span>
        </div>
        <AutoRefreshSelect dashboard={dashboard} />
        <AccountLoginDialog dashboard={dashboard} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="soft-control"
              onClick={() => dashboard.setPrivacyMasked(!dashboard.privacyMasked)}
              disabled={busy}
              aria-label={dashboard.privacyMasked ? "显示敏感信息" : "隐藏敏感信息"}
            >
              {dashboard.privacyMasked ? <EyeOff /> : <Eye />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{dashboard.privacyMasked ? "显示敏感信息" : "恢复隐私遮罩"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="soft-control" onClick={() => dashboard.refresh()} disabled={busy} aria-label="刷新全部账户">
              <RefreshCw className={cn(busy && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>从 Kitesim 刷新并回写 Blob</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="soft-control hidden sm:inline-flex" onClick={() => dashboard.lock()} aria-label="锁定工作台">
              <LockKeyhole />
            </Button>
          </TooltipTrigger>
          <TooltipContent>锁定工作台</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function CommandStrip({ dashboard }: { dashboard: DashboardController }) {
  const successfulAccounts = Math.max(0, dashboard.accountCount - dashboard.failedAccountCount)
  const cacheLabel = dashboard.ordersCacheStatus
    ? CACHE_STATUS_LABEL[dashboard.ordersCacheStatus]
    : "等待读取"
  const metrics = [
    { label: "账户", value: `${successfulAccounts}/${dashboard.accountCount}`, icon: Server },
    { label: "号码", value: String(dashboard.orders.length), icon: Smartphone },
    { label: "当前短信", value: String(dashboard.messageTotalCount), icon: Inbox },
  ]

  return (
    <section className="soft-panel flex min-h-0 items-center gap-3 overflow-hidden rounded-2xl px-3 py-2 md:px-4">
      <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
        <div className="signal-puck grid size-9 shrink-0 place-items-center rounded-xl text-indigo-600">
          <DatabaseZap className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-slate-900">信号总控台</h1>
            <Badge variant="outline" className="h-5 border-0 bg-white/60 px-1.5 text-[10px] font-normal text-slate-500">
              {cacheLabel}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {dashboard.lastUpdatedAt ? `同步于 ${formatDateTime(dashboard.lastUpdatedAt)}` : "普通读取仅访问 Blob 快照"}
          </p>
        </div>
      </div>
      <div className="grid w-full grid-cols-3 gap-2 md:w-auto md:min-w-[390px]">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div key={label} className="soft-inset flex h-11 items-center gap-2 rounded-xl px-2.5 md:min-w-[120px]">
            <Icon className="size-3.5 shrink-0 text-indigo-500" />
            <div className="min-w-0">
              <div className="font-mono text-sm font-semibold leading-none text-slate-800 tabular-nums">{value}</div>
              <div className="mt-1 truncate text-[9px] font-medium tracking-wider text-slate-500 uppercase">{label}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden items-center gap-1.5 text-[11px] text-slate-500 xl:flex">
        <ShieldCheck className="size-3.5 text-emerald-600" />
        凭据仅服务端可见
      </div>
    </section>
  )
}

function AccountRail({ dashboard }: { dashboard: DashboardController }) {
  const groups = useMemo(() => buildAccountGroups(dashboard.orders), [dashboard.orders])
  const pager = usePagedItems(groups, 6, `${dashboard.status}:${groups.length}`)
  const selectedAccountId = dashboard.selectedOrder?.accountId

  return (
    <section className="soft-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/70 px-3">
        <div>
          <h2 className="text-xs font-semibold text-slate-800">账户路由</h2>
          <p className="mt-1 text-[10px] text-slate-500">按登录账户隔离</p>
        </div>
        <span className="font-mono text-xs text-slate-500">{groups.length}</span>
      </div>
      <div className="min-h-0 flex-1 p-2">
        {dashboard.loadingOrders && !groups.length ? (
          <div className="space-y-2">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : pager.items.length ? pager.items.map((group, index) => {
          const firstOrder = group.orders[0]
          const selected = selectedAccountId === group.accountId
          return (
            <button
              key={group.accountId}
              type="button"
              className={cn(
                "mb-1.5 flex h-[66px] w-full items-center gap-2.5 rounded-xl px-2.5 text-left transition",
                selected ? "signal-puck text-slate-900" : "hover:bg-white/45",
              )}
              onClick={() => dashboard.selectOrder(orderKey(firstOrder))}
            >
              <Avatar className="size-8 rounded-xl">
                <AvatarFallback className="rounded-xl bg-indigo-500/10 text-[10px] font-semibold text-indigo-700">
                  {String(pager.page * 6 + index + 1).padStart(2, "0")}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {displayIdentifier(group.accountLabel, dashboard.privacyMasked)}
                </span>
                <span className="mt-1 block truncate font-mono text-[10px] text-slate-500">
                  {displayPhone(firstOrder, dashboard.privacyMasked)}
                </span>
                <span className="mt-1 flex items-center gap-1 text-[9px] text-slate-400">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {group.orders.length} 个号码
                </span>
              </span>
            </button>
          )
        }) : (
          <div className="grid h-full place-items-center px-3 text-center text-[11px] leading-5 text-slate-500">
            {dashboard.ordersCacheStatus === "empty" ? "Blob 暂无号码快照\n请点击刷新" : "当前筛选没有号码"}
          </div>
        )}
      </div>
      {dashboard.warnings.length > 0 && (
        <div className="mx-2 mb-2 flex items-center gap-2 rounded-xl bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-800">
          <AlertTriangle className="size-3.5 shrink-0" />
          {dashboard.warnings.length} 个账户读取失败
        </div>
      )}
      <Pager page={pager.page} pageCount={pager.pageCount} onChange={pager.setPage} label="账户" />
    </section>
  )
}

function StatusFilters({ dashboard }: { dashboard: DashboardController }) {
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {STATUS_ITEMS.map((item) => {
        const count = item.value === dashboard.status ? dashboard.orders.length : dashboard.statusCounts[item.value]
        const disabled = item.value === "all" && dashboard.accountCount > 8
        return (
          <button
            key={item.value}
            type="button"
            className={cn(
              "h-9 min-w-0 rounded-xl px-1 text-[10px] font-medium transition",
              dashboard.status === item.value
                ? "signal-puck text-indigo-700"
                : "soft-inset text-slate-500 hover:text-slate-800",
            )}
            disabled={disabled || dashboard.loadingOrders || dashboard.loadingMessages}
            onClick={() => dashboard.changeStatus(item.value)}
            title={disabled ? "账户超过 8 个时不能查询全部状态" : item.label}
          >
            <span className="block truncate">{item.label}</span>
            <span className="font-mono text-[9px] tabular-nums">{count ?? "—"}</span>
          </button>
        )
      })}
    </div>
  )
}

function NumberWorkspace({
  dashboard,
  pageSize,
  onSelect,
}: {
  dashboard: DashboardController
  pageSize: number
  onSelect?: () => void
}) {
  const resetKey = `${dashboard.status}:${dashboard.searchQuery}:${dashboard.filteredOrders.length}`
  const pager = usePagedItems(dashboard.filteredOrders, pageSize, resetKey)
  return (
    <section className="soft-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/70 px-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">号码信号</h2>
          <p className="mt-0.5 truncate text-[10px] text-slate-500">选择号码后在右侧读取完整短信</p>
        </div>
        <div className="relative w-[min(42%,220px)]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            className="soft-inset h-8 border-0 bg-transparent pr-2 pl-8 text-xs shadow-none md:h-8 md:pr-2 md:pl-8"
            placeholder="搜索号码"
            value={dashboard.searchQuery}
            onChange={(event) => dashboard.setSearchQuery(event.target.value)}
            aria-label="搜索号码或账户"
          />
        </div>
      </div>
      <div className="shrink-0 px-3 py-2">
        <StatusFilters dashboard={dashboard} />
      </div>
      <div className="min-h-0 flex-1 border-t border-white/70 px-2 py-1.5">
        {dashboard.loadingOrders && !dashboard.filteredOrders.length ? (
          <div className="space-y-1.5">
            {Array.from({ length: Math.min(pageSize, 5) }, (_, index) => <Skeleton key={index} className="h-[54px] w-full rounded-xl" />)}
          </div>
        ) : pager.items.length ? pager.items.map((order) => {
          const key = orderKey(order)
          const selected = dashboard.selectedKey === key
          const count = dashboard.messageCounts[key]
          const label = statusLabel(order)
          return (
            <button
              key={key}
              type="button"
              className={cn(
                "mb-1 grid h-[54px] w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl px-2.5 text-left transition",
                selected ? "signal-puck" : "hover:bg-white/45",
              )}
              onClick={() => {
                dashboard.selectOrder(key)
                onSelect?.()
              }}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", selected ? "bg-indigo-500/10" : "soft-inset")}>
                  <Phone className={cn("size-3.5", selected ? "text-indigo-600" : "text-slate-400")} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs font-semibold text-slate-800">
                    {displayPhone(order, dashboard.privacyMasked)}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-slate-500">
                    {order.countryCode || "未知地区"} · {displayIdentifier(order.accountLabel || "默认账户", dashboard.privacyMasked)} · {formatPackage(order)}
                  </span>
                </span>
              </span>
              <span className={cn("hidden rounded-lg px-2 py-1 text-[9px] font-medium sm:inline", STATUS_TONE[label] || "bg-slate-500/10 text-slate-500")}>{label}</span>
              <span className="min-w-10 text-right font-mono text-[10px] text-slate-500">
                {count === undefined ? "未读" : `${count} 条`}
              </span>
            </button>
          )
        }) : (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-slate-500">
            {dashboard.searchQuery
              ? "没有匹配的号码"
              : dashboard.ordersCacheStatus === "empty"
                ? "Blob 暂无号码快照，请点击刷新"
                : "当前状态没有号码"}
          </div>
        )}
      </div>
      <Pager page={pager.page} pageCount={pager.pageCount} onChange={pager.setPage} label={`共 ${dashboard.filteredOrders.length} 个号码`} />
    </section>
  )
}

function CodePanel({ dashboard }: { dashboard: DashboardController }) {
  const order = dashboard.selectedOrder
  const record = firstCodeRecord(dashboard.messages)
  const code = record?.code || ""
  const canCopy = !dashboard.privacyMasked && dashboard.revealCode && isCodeRevealed(code)
  const displayCode = dashboard.loadingMessages
    ? ""
    : !code
      ? "— — —"
      : dashboard.privacyMasked
        ? "••• •••"
        : code.length > 3
          ? `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`
          : code

  return (
    <section className="soft-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[9px] font-semibold tracking-[0.18em] text-indigo-500 uppercase">Latest signal</p>
          <h2 className="mt-1 text-sm font-semibold text-slate-900">最新验证码</h2>
        </div>
        <Badge variant="outline" className="border-0 bg-white/55 text-[10px] font-normal text-slate-500">
          {dashboard.privacyMasked ? "已保护" : "可见"}
        </Badge>
      </div>
      <div className="soft-inset mt-3 flex min-h-0 flex-1 items-center justify-between rounded-2xl px-4">
        <div className="min-w-0">
          {dashboard.loadingMessages ? (
            <Skeleton className="h-10 w-40" />
          ) : (
            <p className="font-mono text-[clamp(1.8rem,3.2vw,2.7rem)] font-semibold tracking-[0.13em] text-slate-900 tabular-nums">
              {displayCode}
            </p>
          )}
          <p className="mt-1 truncate text-[10px] text-slate-500">
            {record ? `${displayIdentifier(record.message.sender || "未知发送方", dashboard.privacyMasked)} · ${formatShortTime(record.message.time)}` : "最近短信中没有识别到验证码"}
          </p>
        </div>
        <div className="ml-3 flex shrink-0 gap-1.5">
          <Button variant="ghost" size="icon-sm" className="soft-control" onClick={() => dashboard.setPrivacyMasked(!dashboard.privacyMasked)} disabled={!record || dashboard.loadingMessages} aria-label="切换隐私遮罩">
            {dashboard.privacyMasked ? <Eye /> : <EyeOff />}
          </Button>
          <Button size="icon-sm" className="signal-button" onClick={dashboard.copyLatestCode} disabled={!canCopy || dashboard.loadingMessages} aria-label="复制最新验证码">
            <Copy />
          </Button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <div className="min-w-0">
          <span className="text-slate-400">接收号码</span>
          <p className="mt-0.5 truncate font-mono font-medium text-slate-700">{order ? displayPhone(order, dashboard.privacyMasked) : "—"}</p>
        </div>
        <div className="min-w-0">
          <span className="text-slate-400">所属账户</span>
          <p className="mt-0.5 truncate font-medium text-slate-700">{displayIdentifier(order?.accountLabel || "—", dashboard.privacyMasked)}</p>
        </div>
      </div>
    </section>
  )
}

function MessageInbox({ dashboard, pageSize }: { dashboard: DashboardController; pageSize: number }) {
  const [selectedMessage, setSelectedMessage] = useState<KitesimMessage | null>(null)
  const pager = usePagedItems(dashboard.messages, pageSize, `${dashboard.selectedKey}:${dashboard.messages.length}`)

  return (
    <>
      <section className="soft-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/70 px-3">
          <div className="signal-puck grid size-8 shrink-0 place-items-center rounded-xl text-indigo-600">
            <Inbox className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">短信收件箱</h2>
              <span className="font-mono text-[10px] text-slate-500">{dashboard.messageTotalCount}</span>
              {dashboard.messageHasMore && <Badge variant="destructive" className="h-4 px-1 text-[8px]">仍有更多</Badge>}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-slate-500">
              {dashboard.selectedOrder ? `${displayPhone(dashboard.selectedOrder, dashboard.privacyMasked)} · 点击任意短信查看全文` : "请先选择号码"}
            </p>
          </div>
          <Switch
            size="sm"
            checked={!dashboard.privacyMasked}
            onCheckedChange={(visible) => dashboard.setPrivacyMasked(!visible)}
            disabled={!dashboard.selectedOrder || dashboard.loadingMessages}
            aria-label="显示完整短信"
          />
        </div>
        <div className="min-h-0 flex-1 px-2 py-1.5">
          {dashboard.loadingMessages ? (
            <div className="space-y-1.5">
              {Array.from({ length: Math.min(pageSize, 4) }, (_, index) => <Skeleton key={index} className="h-[68px] w-full rounded-xl" />)}
            </div>
          ) : pager.items.length ? pager.items.map((message, index) => {
            const sender = displayIdentifier(message.sender || "未知发送方", dashboard.privacyMasked)
            const content = displayMessageContent(message.content, dashboard.privacyMasked)
            const firstCode = message.code[0]
            return (
              <button
                key={String(message.id ?? `${message.time}-${pager.page}-${index}`)}
                type="button"
                className="mb-1.5 grid min-h-[68px] w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2.5 text-left transition hover:bg-white/55 focus-visible:outline-2 focus-visible:outline-indigo-400"
                onClick={() => setSelectedMessage(message)}
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-indigo-500/8 text-[9px] font-semibold text-indigo-700">
                    {Array.from(sender).slice(0, 2).join("").toUpperCase() || "—"}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[11px] font-semibold text-slate-700">{sender}</span>
                    <time className="shrink-0 text-[9px] text-slate-400">{formatShortTime(message.time)}</time>
                  </span>
                  <span className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{content}</span>
                </span>
                <span className="soft-inset rounded-lg px-2 py-1 font-mono text-[9px] tracking-wider text-slate-600">
                  {firstCode ? (dashboard.privacyMasked ? "••••••" : firstCode) : "无代码"}
                  {message.code.length > 1 ? ` +${message.code.length - 1}` : ""}
                </span>
              </button>
            )
          }) : (
            <div className="grid h-full place-items-center px-4 text-center text-xs text-slate-500">
              {dashboard.selectedOrder
                ? dashboard.messageCacheStatus === "empty"
                  ? "Blob 暂无短信快照，请点击刷新"
                  : "当前号码暂时没有短信"
                : "先选择一个号码"}
            </div>
          )}
        </div>
        <Pager page={pager.page} pageCount={pager.pageCount} onChange={pager.setPage} label={`共 ${dashboard.messages.length} 条已获取短信`} />
      </section>
      <MessageDetailDialog message={selectedMessage} dashboard={dashboard} onClose={() => setSelectedMessage(null)} />
    </>
  )
}

function MobileNavigation({ active, onChange }: { active: MobilePanel; onChange: (panel: MobilePanel) => void }) {
  const items: Array<{ value: MobilePanel; label: string; icon: typeof Phone }> = [
    { value: "numbers", label: "号码", icon: Phone },
    { value: "code", label: "验证码", icon: KeyRound },
    { value: "messages", label: "短信", icon: MessageSquareText },
  ]
  return (
    <nav className="soft-panel grid h-10 grid-cols-3 gap-1 rounded-2xl p-1 lg:hidden" aria-label="工作台分区">
      {items.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={cn("flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-medium", active === value ? "signal-puck text-indigo-700" : "text-slate-500")}
          onClick={() => onChange(value)}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </nav>
  )
}

export function DashboardShell({ dashboard }: { dashboard: DashboardController }) {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("numbers")

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#eef2f8] text-slate-900">
      <a href="#dashboard-content" className="sr-only z-[70] rounded-md bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        跳到主要内容
      </a>
      <WorkspaceHeader dashboard={dashboard} />
      <main id="dashboard-content" className="grid min-h-0 flex-1 grid-rows-[58px_40px_minmax(0,1fr)] gap-2 p-2 md:grid-rows-[60px_40px_minmax(0,1fr)] md:gap-3 md:p-3 lg:grid-rows-[60px_minmax(0,1fr)]">
        <CommandStrip dashboard={dashboard} />
        <MobileNavigation active={mobilePanel} onChange={setMobilePanel} />

        <div className="hidden min-h-0 grid-cols-[176px_minmax(390px,1.1fr)_minmax(318px,.8fr)] gap-3 lg:grid xl:grid-cols-[190px_minmax(470px,1.12fr)_minmax(350px,.88fr)]">
          <AccountRail dashboard={dashboard} />
          <NumberWorkspace dashboard={dashboard} pageSize={8} />
          <div className="grid min-h-0 grid-rows-[218px_minmax(0,1fr)] gap-3">
            <CodePanel dashboard={dashboard} />
            <MessageInbox dashboard={dashboard} pageSize={4} />
          </div>
        </div>

        <div className="min-h-0 lg:hidden">
          <div className={cn("h-full", mobilePanel !== "numbers" && "hidden")}>
            <NumberWorkspace dashboard={dashboard} pageSize={4} onSelect={() => setMobilePanel("code")} />
          </div>
          <div className={cn("h-full", mobilePanel !== "code" && "hidden")}>
            <CodePanel dashboard={dashboard} />
          </div>
          <div className={cn("h-full", mobilePanel !== "messages" && "hidden")}>
            <MessageInbox dashboard={dashboard} pageSize={4} />
          </div>
        </div>
      </main>
    </div>
  )
}
