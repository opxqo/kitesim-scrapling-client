import { useMemo, useState } from "react"
import {
  AlertTriangle,
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
} from "lucide-react"

import { AppMark } from "@/components/app-mark"
import { TokenManager } from "@/components/token-manager"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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

type MobilePanel = "numbers" | "code" | "messages"
type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

function displayPhone(order: KitesimOrder, masked: boolean) {
  return displaySensitiveIdentifier(order.phoneNumber, masked)
}

function displayIdentifier(value: string, masked: boolean) {
  return displaySensitiveIdentifier(value, masked)
}

function connectionVariant(mode: DashboardController["connection"]["mode"]): BadgeVariant {
  if (mode === "error") return "destructive"
  if (mode === "ready") return "secondary"
  return "outline"
}

function statusVariant(label: string): BadgeVariant {
  if (label === "使用中") return "default"
  if (label === "激活中" || label === "已退款") return "secondary"
  if (label === "已过期") return "destructive"
  return "outline"
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

function DataPagination({
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
  const navigate = (event: React.MouseEvent<HTMLAnchorElement>, nextPage: number) => {
    event.preventDefault()
    if (nextPage >= 0 && nextPage < pageCount) onChange(nextPage)
  }

  return (
    <Pagination>
      <PaginationContent className="w-full justify-between">
        <PaginationItem className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {label}
        </PaginationItem>
        <PaginationItem>
          <PaginationPrevious
            href="#previous-page"
            text=""
            aria-disabled={page === 0}
            tabIndex={page === 0 ? -1 : 0}
            className={cn(page === 0 && "pointer-events-none opacity-50")}
            onClick={(event) => navigate(event, page - 1)}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#current-page" isActive size="sm" onClick={(event) => event.preventDefault()}>
            {page + 1}/{pageCount}
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            href="#next-page"
            text=""
            aria-disabled={page >= pageCount - 1}
            tabIndex={page >= pageCount - 1 ? -1 : 0}
            className={cn(page >= pageCount - 1 && "pointer-events-none opacity-50")}
            onClick={(event) => navigate(event, page + 1)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

function AccountLoginDialog({ dashboard }: { dashboard: DashboardController }) {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" aria-label="管理 Kitesim 账户登录">
              <UserRoundCheck data-icon="inline-start" />
              <span className="hidden xl:inline">账户登录</span>
              <Badge variant="secondary">
                {Math.max(0, dashboard.accountCount - dashboard.failedAccountCount)}/{dashboard.accountCount}
              </Badge>
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>管理 Kitesim 登录与图片验证码</TooltipContent>
      </Tooltip>
      <DialogContent className="w-[calc(100%-1rem)] gap-3 p-3 sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Kitesim 账户登录</DialogTitle>
          <DialogDescription>管理员识别图片验证码后完成登录，Token 仅加密保存在服务端。</DialogDescription>
        </DialogHeader>
        <TokenManager dashboard={dashboard} />
      </DialogContent>
    </Dialog>
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{sender}</DialogTitle>
          <DialogDescription>{formatDateTime(message.time)} · 完整短信详情</DialogDescription>
        </DialogHeader>
        <Item variant="muted">
          <ItemMedia variant="icon">
            <MessageSquareText />
          </ItemMedia>
          <ItemContent>
            <ItemDescription className="line-clamp-none break-words whitespace-pre-wrap text-foreground">
              {content}
            </ItemDescription>
          </ItemContent>
        </Item>
        <Item size="sm">
          <ItemContent>
            <ItemTitle>识别到的验证码</ItemTitle>
            <ItemDescription>{message.code.length ? `${message.code.length} 个结果` : "未识别"}</ItemDescription>
          </ItemContent>
          <ItemActions>
            {message.code.map((code, index) => (
              <Button
                key={`${code}-${index}`}
                type="button"
                variant="outline"
                size="sm"
                disabled={dashboard.privacyMasked || !isCodeRevealed(code)}
                onClick={() => dashboard.copyValue(code, "验证码")}
              >
                {dashboard.privacyMasked ? "••••••" : code}
                <Copy data-icon="inline-end" />
              </Button>
            ))}
          </ItemActions>
        </Item>
      </DialogContent>
    </Dialog>
  )
}

function AutoRefreshSelect({ dashboard }: { dashboard: DashboardController }) {
  return (
    <Select
      value={String(dashboard.autoRefreshSeconds)}
      onValueChange={(value) => dashboard.changeAutoRefreshSeconds(Number(value))}
      disabled={dashboard.loadingOrders || dashboard.loadingMessages}
    >
      <SelectTrigger size="sm" className="hidden min-w-[118px] sm:flex" aria-label="定时刷新周期">
        <Clock3 />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          <SelectItem value="0">手动刷新</SelectItem>
          <SelectItem value="30">每 30 秒</SelectItem>
          <SelectItem value="60">每分钟</SelectItem>
          <SelectItem value="300">每 5 分钟</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function WorkspaceHeader({ dashboard }: { dashboard: DashboardController }) {
  const busy = dashboard.loadingOrders || dashboard.loadingMessages
  const connectionIcon = dashboard.connection.mode === "loading"
    ? <Spinner />
    : dashboard.connection.mode === "error" || dashboard.connection.mode === "warning"
      ? <AlertTriangle data-icon="inline-start" />
      : <ShieldCheck data-icon="inline-start" />

  return (
    <header className="flex h-14 shrink-0 items-center border-b bg-background px-3 md:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <AppMark />
        <div className="min-w-0 leading-none">
          <div className="truncate text-sm font-semibold tracking-tight">Kitesim Relay</div>
          <span className="mt-1 hidden text-[10px] text-muted-foreground sm:block">多账户号码与验证码工作台</span>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Badge variant={connectionVariant(dashboard.connection.mode)} className="hidden font-normal md:inline-flex">
          {connectionIcon}
          {dashboard.connection.text}
        </Badge>
        <AutoRefreshSelect dashboard={dashboard} />
        <AccountLoginDialog dashboard={dashboard} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => dashboard.setPrivacyMasked(!dashboard.privacyMasked)}
              disabled={busy}
              aria-label={dashboard.privacyMasked ? "显示敏感信息" : "隐藏敏感信息"}
            >
              {dashboard.privacyMasked ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{dashboard.privacyMasked ? "显示敏感信息" : "恢复隐私遮罩"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => dashboard.refresh()}
              disabled={busy}
              aria-label="刷新全部账户"
            >
              {busy ? <Spinner /> : <RefreshCw data-icon="inline-start" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>从 Kitesim 刷新并回写 Blob</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="hidden sm:inline-flex"
              onClick={() => dashboard.lock()}
              aria-label="锁定工作台"
            >
              <LockKeyhole data-icon="inline-start" />
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
    { label: "短信", value: String(dashboard.messageTotalCount), icon: Inbox },
  ]

  return (
    <Item variant="outline" size="sm" className="h-full w-full min-w-0 flex-nowrap bg-card">
      <ItemMedia variant="icon" className="hidden md:flex">
        <DatabaseZap />
      </ItemMedia>
      <ItemContent className="hidden min-w-0 md:flex">
        <ItemTitle>
          信号总控台
          <Badge variant="outline">{cacheLabel}</Badge>
        </ItemTitle>
        <ItemDescription>
          {dashboard.lastUpdatedAt ? `同步于 ${formatDateTime(dashboard.lastUpdatedAt)}` : "普通读取仅访问 Blob 快照"}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="w-full min-w-0 md:w-auto">
        <div className="grid w-full min-w-0 grid-cols-3 gap-2">
          {metrics.map(({ label, value, icon: Icon }) => (
            <Item key={label} variant="muted" size="xs" className="min-w-0 flex-nowrap">
              <ItemMedia variant="icon" className="hidden sm:flex">
                <Icon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="font-mono tabular-nums">{value}</ItemTitle>
                <ItemDescription className="truncate text-[10px]">{label}</ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </div>
      </ItemActions>
      <Badge variant="secondary" className="hidden xl:inline-flex">
        <ShieldCheck data-icon="inline-start" />
        凭据仅服务端可见
      </Badge>
    </Item>
  )
}

function AccountRail({ dashboard }: { dashboard: DashboardController }) {
  const groups = useMemo(() => buildAccountGroups(dashboard.orders), [dashboard.orders])
  const pager = usePagedItems(groups, 6, `${dashboard.status}:${groups.length}`)
  const selectedAccountId = dashboard.selectedOrder?.accountId

  return (
    <Card size="sm" className="h-full min-h-0 min-w-0 gap-0 py-0">
      <CardHeader className="shrink-0 border-b py-3">
        <CardTitle>账户路由</CardTitle>
        <CardDescription className="text-xs">按登录账户隔离</CardDescription>
        <CardAction>
          <Badge variant="secondary">{groups.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-2">
        {dashboard.loadingOrders && !groups.length ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-14 w-full" />)}
          </div>
        ) : pager.items.length ? (
          <ItemGroup className="gap-1">
            {pager.items.map((group, index) => {
              const firstOrder = group.orders[0]
              const selected = selectedAccountId === group.accountId
              return (
                <Item key={group.accountId} variant={selected ? "muted" : "default"} size="xs" className="flex-nowrap">
                  <ItemMedia>
                    <Avatar>
                      <AvatarFallback>{String(pager.page * 6 + index + 1).padStart(2, "0")}</AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full truncate text-xs">
                      {displayIdentifier(group.accountLabel, dashboard.privacyMasked)}
                    </ItemTitle>
                    <ItemDescription className="truncate font-mono text-[10px]">
                      {displayPhone(firstOrder, dashboard.privacyMasked)} · {group.orders.length} 个号码
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="button"
                      variant={selected ? "secondary" : "ghost"}
                      size="icon-sm"
                      onClick={() => dashboard.selectOrder(orderKey(firstOrder))}
                      aria-label={`选择账户 ${group.accountLabel}`}
                    >
                      <Phone data-icon="inline-start" />
                    </Button>
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        ) : (
          <Empty className="h-full p-3">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Server /></EmptyMedia>
              <EmptyTitle>没有账户数据</EmptyTitle>
              <EmptyDescription>
                {dashboard.ordersCacheStatus === "empty" ? "Blob 暂无号码快照，请点击刷新" : "当前筛选没有号码"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
      {dashboard.warnings.length > 0 && (
        <Alert variant="destructive" className="mx-2 mb-2 w-auto">
          <AlertTriangle />
          <AlertTitle>{dashboard.warnings.length} 个账户读取失败</AlertTitle>
        </Alert>
      )}
      <CardFooter className="shrink-0 p-2">
        <DataPagination page={pager.page} pageCount={pager.pageCount} onChange={pager.setPage} label="账户" />
      </CardFooter>
    </Card>
  )
}

function StatusFilters({ dashboard }: { dashboard: DashboardController }) {
  return (
    <ToggleGroup
      type="single"
      value={dashboard.status}
      variant="outline"
      size="sm"
      spacing={1}
      className="w-full min-w-0"
      onValueChange={(value) => value && dashboard.changeStatus(value as DashboardStatus)}
      aria-label="号码状态筛选"
    >
      {STATUS_ITEMS.map((item) => {
        const count = item.value === dashboard.status ? dashboard.orders.length : dashboard.statusCounts[item.value]
        const disabled = item.value === "all" && dashboard.accountCount > 8
        return (
          <ToggleGroupItem
            key={item.value}
            value={item.value}
            disabled={disabled || dashboard.loadingOrders || dashboard.loadingMessages}
            title={disabled ? "账户超过 8 个时不能查询全部状态" : item.label}
            className="min-w-0 flex-1 basis-0 [flex-shrink:1]"
          >
            <span className="truncate">{item.label}</span>
            <span className="hidden font-mono text-[9px] tabular-nums sm:inline">{count ?? "—"}</span>
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
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
    <Card size="sm" className="h-full min-h-0 min-w-0 gap-0 py-0">
      <CardHeader className="min-w-0 shrink-0 border-b py-3">
        <CardTitle>号码信号</CardTitle>
        <CardDescription className="hidden text-xs sm:block">选择号码后读取完整短信</CardDescription>
        <CardAction>
          <InputGroup className="w-[150px] max-w-[46vw] sm:w-[210px] sm:max-w-none">
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput
              placeholder="搜索号码或账户"
              value={dashboard.searchQuery}
              onChange={(event) => dashboard.setSearchQuery(event.target.value)}
              aria-label="搜索号码或账户"
            />
          </InputGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2 py-2">
        <StatusFilters dashboard={dashboard} />
        <div className="min-h-0 flex-1">
          {dashboard.loadingOrders && !dashboard.filteredOrders.length ? (
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: Math.min(pageSize, 5) }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
            </div>
          ) : pager.items.length ? (
            <ItemGroup className="gap-1">
              {pager.items.map((order) => {
                const key = orderKey(order)
                const selected = dashboard.selectedKey === key
                const count = dashboard.messageCounts[key]
                const label = statusLabel(order)
                return (
                  <Item key={key} variant={selected ? "muted" : "default"} size="xs" className="flex-nowrap">
                    <ItemMedia variant="icon" className={selected ? "text-primary" : "text-muted-foreground"}>
                      <Phone />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full truncate font-mono text-xs">
                        {displayPhone(order, dashboard.privacyMasked)}
                      </ItemTitle>
                      <ItemDescription className="truncate text-[10px]">
                        {order.countryCode || "未知地区"} · {displayIdentifier(order.accountLabel || "默认账户", dashboard.privacyMasked)} · {formatPackage(order)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant={statusVariant(label)} className="hidden sm:inline-flex">{label}</Badge>
                      <Badge variant="outline">{count === undefined ? "未读" : `${count} 条`}</Badge>
                      <Button
                        type="button"
                        variant={selected ? "secondary" : "ghost"}
                        size="icon-sm"
                        onClick={() => {
                          dashboard.selectOrder(key)
                          onSelect?.()
                        }}
                        aria-label={`选择号码 ${order.phoneNumber}`}
                      >
                        <MessageSquareText data-icon="inline-start" />
                      </Button>
                    </ItemActions>
                  </Item>
                )
              })}
            </ItemGroup>
          ) : (
            <Empty className="h-full p-3">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Phone /></EmptyMedia>
                <EmptyTitle>没有号码</EmptyTitle>
                <EmptyDescription>
                  {dashboard.searchQuery
                    ? "没有匹配的号码"
                    : dashboard.ordersCacheStatus === "empty"
                      ? "Blob 暂无号码快照，请点击刷新"
                      : "当前状态没有号码"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </CardContent>
      <CardFooter className="shrink-0 p-2">
        <DataPagination
          page={pager.page}
          pageCount={pager.pageCount}
          onChange={pager.setPage}
          label={`共 ${dashboard.filteredOrders.length} 个号码`}
        />
      </CardFooter>
    </Card>
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
    <Card size="sm" className="h-full min-h-0 min-w-0 gap-0 py-0">
      <CardHeader className="shrink-0 border-b py-3">
        <CardTitle>最新验证码</CardTitle>
        <CardDescription className="text-xs">最近一条含验证码短信</CardDescription>
        <CardAction>
          <Badge variant={dashboard.privacyMasked ? "outline" : "secondary"}>
            {dashboard.privacyMasked ? "已保护" : "可见"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 py-2">
        <Item variant="muted" className="min-h-0 flex-1 flex-nowrap">
          <ItemContent className="min-w-0">
            {dashboard.loadingMessages ? (
              <Skeleton className="h-9 w-36" />
            ) : (
              <ItemTitle className="max-w-full font-mono text-3xl tracking-widest tabular-nums">
                {displayCode}
              </ItemTitle>
            )}
            <ItemDescription className="truncate text-xs">
              {record
                ? `${displayIdentifier(record.message.sender || "未知发送方", dashboard.privacyMasked)} · ${formatShortTime(record.message.time)}`
                : "最近短信中没有识别到验证码"}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => dashboard.setPrivacyMasked(!dashboard.privacyMasked)}
              disabled={!record || dashboard.loadingMessages}
              aria-label="切换隐私遮罩"
            >
              {dashboard.privacyMasked ? <Eye data-icon="inline-start" /> : <EyeOff data-icon="inline-start" />}
            </Button>
            <Button
              size="icon-sm"
              onClick={dashboard.copyLatestCode}
              disabled={!canCopy || dashboard.loadingMessages}
              aria-label="复制最新验证码"
            >
              <Copy data-icon="inline-start" />
            </Button>
          </ItemActions>
        </Item>
        <div className="grid grid-cols-2 gap-2">
          <Item variant="outline" size="xs" className="min-w-0">
            <ItemContent className="min-w-0">
              <ItemDescription>接收号码</ItemDescription>
              <ItemTitle className="max-w-full truncate font-mono text-xs">
                {order ? displayPhone(order, dashboard.privacyMasked) : "—"}
              </ItemTitle>
            </ItemContent>
          </Item>
          <Item variant="outline" size="xs" className="min-w-0">
            <ItemContent className="min-w-0">
              <ItemDescription>所属账户</ItemDescription>
              <ItemTitle className="max-w-full truncate text-xs">
                {displayIdentifier(order?.accountLabel || "—", dashboard.privacyMasked)}
              </ItemTitle>
            </ItemContent>
          </Item>
        </div>
      </CardContent>
    </Card>
  )
}

function MessageInbox({ dashboard, pageSize }: { dashboard: DashboardController; pageSize: number }) {
  const [selectedMessage, setSelectedMessage] = useState<KitesimMessage | null>(null)
  const pager = usePagedItems(dashboard.messages, pageSize, `${dashboard.selectedKey}:${dashboard.messages.length}`)

  return (
    <>
      <Card size="sm" className="h-full min-h-0 min-w-0 gap-0 py-0">
        <CardHeader className="shrink-0 border-b py-3">
          <CardTitle className="flex items-center gap-2">
            短信收件箱
            <Badge variant="secondary">{dashboard.messageTotalCount}</Badge>
            {dashboard.messageHasMore && <Badge variant="destructive">仍有更多</Badge>}
          </CardTitle>
          <CardDescription className="truncate text-xs">
            {dashboard.selectedOrder
              ? `${displayPhone(dashboard.selectedOrder, dashboard.privacyMasked)} · 点击详情查看全文`
              : "请先选择号码"}
          </CardDescription>
          <CardAction>
            <Switch
              size="sm"
              checked={!dashboard.privacyMasked}
              onCheckedChange={(visible) => dashboard.setPrivacyMasked(!visible)}
              disabled={!dashboard.selectedOrder || dashboard.loadingMessages}
              aria-label="显示完整短信"
            />
          </CardAction>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 p-2">
          {dashboard.loadingMessages ? (
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: Math.min(pageSize, 4) }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
            </div>
          ) : pager.items.length ? (
            <ItemGroup className="gap-1">
              {pager.items.map((message, index) => {
                const sender = displayIdentifier(message.sender || "未知发送方", dashboard.privacyMasked)
                const content = displayMessageContent(message.content, dashboard.privacyMasked)
                const firstCode = message.code[0]
                return (
                  <Item key={String(message.id ?? `${message.time}-${pager.page}-${index}`)} size="xs" className="flex-nowrap">
                    <ItemMedia>
                      <Avatar>
                        <AvatarFallback>{Array.from(sender).slice(0, 2).join("").toUpperCase() || "—"}</AvatarFallback>
                      </Avatar>
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full truncate text-xs">
                        {sender}
                        <span className="font-normal text-muted-foreground">{formatShortTime(message.time)}</span>
                      </ItemTitle>
                      <ItemDescription className="line-clamp-2 text-[10px]">{content}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant="outline" className="font-mono">
                        {firstCode ? (dashboard.privacyMasked ? "••••••" : firstCode) : "无代码"}
                        {message.code.length > 1 ? ` +${message.code.length - 1}` : ""}
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setSelectedMessage(message)}
                        aria-label={`查看来自 ${sender} 的完整短信`}
                      >
                        <MessageSquareText data-icon="inline-start" />
                      </Button>
                    </ItemActions>
                  </Item>
                )
              })}
            </ItemGroup>
          ) : (
            <Empty className="h-full p-3">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Inbox /></EmptyMedia>
                <EmptyTitle>{dashboard.selectedOrder ? "没有短信" : "尚未选择号码"}</EmptyTitle>
                <EmptyDescription>
                  {dashboard.selectedOrder
                    ? dashboard.messageCacheStatus === "empty"
                      ? "Blob 暂无短信快照，请点击刷新"
                      : "当前号码暂时没有短信"
                    : "先选择一个号码读取短信"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
        <CardFooter className="shrink-0 p-2">
          <DataPagination
            page={pager.page}
            pageCount={pager.pageCount}
            onChange={pager.setPage}
            label={`已获取 ${dashboard.messages.length} 条完整短信`}
          />
        </CardFooter>
      </Card>
      <MessageDetailDialog message={selectedMessage} dashboard={dashboard} onClose={() => setSelectedMessage(null)} />
    </>
  )
}

function MobileWorkspace({ dashboard }: { dashboard: DashboardController }) {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("numbers")

  return (
    <Tabs
      value={mobilePanel}
      onValueChange={(value) => setMobilePanel(value as MobilePanel)}
      className="h-full w-full min-h-0 min-w-0 lg:hidden"
    >
      <TabsList className="w-full shrink-0">
        <TabsTrigger value="numbers">
          <Phone data-icon="inline-start" />
          号码
        </TabsTrigger>
        <TabsTrigger value="code">
          <KeyRound data-icon="inline-start" />
          验证码
        </TabsTrigger>
        <TabsTrigger value="messages">
          <MessageSquareText data-icon="inline-start" />
          短信
        </TabsTrigger>
      </TabsList>
      <TabsContent value="numbers" className="min-h-0 min-w-0">
        <NumberWorkspace dashboard={dashboard} pageSize={4} onSelect={() => setMobilePanel("code")} />
      </TabsContent>
      <TabsContent value="code" className="min-h-0 min-w-0">
        <CodePanel dashboard={dashboard} />
      </TabsContent>
      <TabsContent value="messages" className="min-h-0 min-w-0">
        <MessageInbox dashboard={dashboard} pageSize={4} />
      </TabsContent>
    </Tabs>
  )
}

export function DashboardShell({ dashboard }: { dashboard: DashboardController }) {
  return (
    <div className="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-muted/30 text-foreground">
      <a href="#dashboard-content" className="sr-only rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        跳到主要内容
      </a>
      <WorkspaceHeader dashboard={dashboard} />
      <main
        id="dashboard-content"
        className="grid min-h-0 min-w-0 flex-1 grid-rows-[64px_minmax(0,1fr)] gap-2 p-2 md:gap-3 md:p-3"
      >
        <CommandStrip dashboard={dashboard} />

        <div className="hidden min-h-0 grid-cols-[190px_minmax(430px,1.12fr)_minmax(340px,.88fr)] gap-3 lg:grid">
          <AccountRail dashboard={dashboard} />
          <NumberWorkspace dashboard={dashboard} pageSize={7} />
          <div className="grid min-h-0 grid-rows-[210px_minmax(0,1fr)] gap-3">
            <CodePanel dashboard={dashboard} />
            <MessageInbox dashboard={dashboard} pageSize={3} />
          </div>
        </div>

        <MobileWorkspace dashboard={dashboard} />
      </main>
    </div>
  )
}
