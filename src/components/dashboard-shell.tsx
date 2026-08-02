import {
  Activity,
  AlertTriangle,
  Clock3,
  Copy,
  DatabaseZap,
  Eye,
  EyeOff,
  Inbox,
  KeyRound,
  LockKeyhole,
  Phone,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  TimerReset,
} from "lucide-react"

import { AppMark } from "@/components/app-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

const STATUS_TONE: Record<string, string> = {
  使用中: "border-emerald-200 bg-emerald-50 text-emerald-700",
  激活中: "border-blue-200 bg-blue-50 text-blue-700",
  待支付: "border-amber-200 bg-amber-50 text-amber-700",
  已过期: "border-border bg-muted text-muted-foreground",
  已退款: "border-border bg-muted text-muted-foreground",
}

const CACHE_STATUS_LABEL: Record<CacheStatus, string> = {
  hit: "Blob 快照",
  stale: "Blob 旧快照",
  empty: "Blob 无快照",
  refreshed: "Blob 已更新",
  bypass: "Blob 写入失败",
}

function displayPhone(order: KitesimOrder, masked: boolean) {
  return displaySensitiveIdentifier(order.phoneNumber, masked)
}

function displayIdentifier(value: string, masked: boolean) {
  return displaySensitiveIdentifier(value, masked)
}

function StatusBadge({ order }: { order: KitesimOrder }) {
  const label = statusLabel(order)
  return (
    <Badge variant="outline" className={cn("font-normal", STATUS_TONE[label])}>
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  )
}

function AutoRefreshSelect({ dashboard }: { dashboard: DashboardController }) {
  return (
    <Select
      value={String(dashboard.autoRefreshSeconds)}
      onValueChange={(value) => dashboard.changeAutoRefreshSeconds(Number(value))}
      disabled={dashboard.loadingOrders || dashboard.loadingMessages}
    >
      <SelectTrigger
        size="sm"
        className="hidden min-w-[124px] shrink-0 sm:flex"
        aria-label="定时刷新周期"
      >
        <TimerReset className="text-muted-foreground" />
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
  const connectionTone = {
    idle: "border-border bg-background text-muted-foreground",
    loading: "border-amber-200 bg-amber-50 text-amber-700",
    ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    error: "border-red-200 bg-red-50 text-red-700",
  }[dashboard.connection.mode]

  return (
    <header className="sticky top-0 z-30 flex min-h-[calc(3.75rem+env(safe-area-inset-top))] items-center border-b bg-background/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:min-h-[52px] md:px-5 md:pt-0">
      <div className="flex min-w-0 items-center gap-3">
        <AppMark />
        <div className="min-w-0 leading-none">
          <div className="truncate text-sm font-semibold tracking-tight">Kitesim Relay</div>
          <span className="mt-1 hidden truncate text-xs text-muted-foreground sm:block">
            多账户号码与验证码工作台
          </span>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Badge variant="outline" className={cn("hidden font-normal sm:inline-flex", connectionTone)}>
          <span
            className={cn(
              "size-1.5 rounded-full bg-current",
              dashboard.connection.mode === "loading" && "animate-pulse",
            )}
          />
          {dashboard.connection.text}
        </Badge>
        <span className="hidden text-xs text-muted-foreground lg:inline">
          {dashboard.lastUpdatedAt ? `同步于 ${formatShortTime(dashboard.lastUpdatedAt)}` : "尚未同步"}
        </span>
        <Separator orientation="vertical" className="mx-1 hidden h-5 md:block" />
        <AutoRefreshSelect dashboard={dashboard} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="md:hidden"
              onClick={() => dashboard.setPrivacyMasked(!dashboard.privacyMasked)}
              disabled={busy}
              aria-label={dashboard.privacyMasked ? "显示所有敏感信息" : "隐藏所有敏感信息"}
            >
              {dashboard.privacyMasked ? <EyeOff /> : <Eye />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{dashboard.privacyMasked ? "显示所有敏感信息" : "恢复全部隐私遮罩"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="hidden items-center gap-2 rounded-lg border px-2.5 py-1.5 md:flex">
              {dashboard.privacyMasked ? (
                <EyeOff className="size-3.5 text-muted-foreground" />
              ) : (
                <Eye className="size-3.5 text-muted-foreground" />
              )}
              <span className="text-xs">隐私遮罩</span>
              <Switch
                size="sm"
                checked={dashboard.privacyMasked}
                onCheckedChange={dashboard.setPrivacyMasked}
                disabled={busy}
                aria-label="切换全部敏感信息隐私遮罩"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>统一遮罩手机号、电话型账户名、短信来源、正文和验证码</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => dashboard.refresh()}
              disabled={busy}
              aria-label="刷新全部账户"
            >
              <RefreshCw className={cn(busy && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>从 Kitesim 刷新当前数据并回写 Blob</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" onClick={() => dashboard.lock()} aria-label="锁定工作台">
              <LockKeyhole />
            </Button>
          </TooltipTrigger>
          <TooltipContent>清除当前标签页中的访问口令</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function ViewHeading({ dashboard }: { dashboard: DashboardController }) {
  const cacheLabel = dashboard.ordersCacheStatus
    ? CACHE_STATUS_LABEL[dashboard.ordersCacheStatus]
    : dashboard.lastUpdatedAt
      ? "缓存状态未知"
      : "缓存等待读取"
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 md:min-h-9 md:py-0">
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight">总控台</h1>
        <span className="hidden text-xs text-muted-foreground sm:inline">账户、号码和验证码集中处理</span>
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-normal">
          <DatabaseZap data-icon="inline-start" />
          {cacheLabel}
        </Badge>
        <Badge variant="outline" className="font-normal">
          {dashboard.accountCount} 个 Token
        </Badge>
        <span className="hidden items-center gap-1.5 sm:flex">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          凭据仅服务端可见
        </span>
      </div>
    </div>
  )
}

function MetricStrip({ dashboard }: { dashboard: DashboardController }) {
  const successfulAccounts = Math.max(0, dashboard.accountCount - dashboard.failedAccountCount)
  const healthPercentage = dashboard.accountCount
    ? Math.round((successfulAccounts / dashboard.accountCount) * 100)
    : 0
  const currentStatus = STATUS_ITEMS.find((item) => item.value === dashboard.status)?.label ?? "当前筛选"
  const metrics = [
    {
      label: "账户",
      value: String(dashboard.accountCount),
      note: dashboard.failedAccountCount
        ? `${successfulAccounts} 正常 · ${dashboard.failedAccountCount} 失败`
        : dashboard.accountCount
          ? "全部读取正常"
          : "等待同步",
      icon: Server,
      tone: "text-indigo-600",
    },
    {
      label: "号码",
      value: String(dashboard.orders.length),
      note: `${currentStatus} · 最多显示 20 个`,
      icon: Smartphone,
      tone: "text-blue-600",
    },
    {
      label: "短信记录",
      value: String(dashboard.messages.length),
      note: dashboard.selectedOrder
        ? displayPhone(dashboard.selectedOrder, dashboard.privacyMasked)
        : "尚未选择号码",
      icon: Inbox,
      tone: "text-amber-600",
    },
    {
      label: "同步健康度",
      value: `${healthPercentage}%`,
      note: dashboard.lastUpdatedAt ? formatDateTime(dashboard.lastUpdatedAt) : "尚未同步",
      icon: Activity,
      tone: dashboard.failedAccountCount ? "text-amber-600" : "text-emerald-600",
    },
  ]

  return (
    <Card className="grid grid-cols-2 gap-0 py-0 lg:grid-cols-4">
      {metrics.map((metric, index) => {
        const Icon = metric.icon
        return (
          <div
            key={metric.label}
            className={cn(
              "flex min-h-20 items-center gap-3 px-3 py-3 md:px-4 lg:min-h-14 lg:py-2",
              index % 2 === 1 && "border-l",
              index >= 2 && "border-t lg:border-t-0",
              index === 2 && "lg:border-l",
            )}
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
              <Icon className={cn("size-4", metric.tone)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums">{metric.value}</span>
                <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
              </div>
              <p className="line-clamp-2 text-xs leading-4 text-muted-foreground">{metric.note}</p>
              {metric.label === "同步健康度" && (
                <Progress value={healthPercentage} className="mt-1.5 h-1" />
              )}
            </div>
          </div>
        )
      })}
    </Card>
  )
}

function AccountRail({ dashboard }: { dashboard: DashboardController }) {
  const groups = buildAccountGroups(dashboard.orders)
  const selectedAccountId = dashboard.selectedOrder?.accountId

  return (
    <Card className="h-[280px] gap-0 py-0 lg:h-full">
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">账户与号码</CardTitle>
        <CardDescription className="text-xs">每个 Token 对应独立账户</CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-0">
        <ScrollArea className="h-full">
          <div className="py-1">
            {dashboard.loadingOrders && !groups.length ? (
              <div className="space-y-3 p-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : groups.length ? (
              groups.map((group, index) => {
                const firstOrder = group.orders[0]
                const selected = selectedAccountId === group.accountId
                return (
                  <Button
                    key={group.accountId}
                    variant="ghost"
                    className={cn(
                      "h-auto w-full justify-start rounded-none px-3 py-3 text-left md:h-auto",
                      selected && "bg-accent text-accent-foreground",
                    )}
                    onClick={() => dashboard.selectOrder(orderKey(firstOrder))}
                  >
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-primary/8 text-xs font-semibold text-primary">
                        {String(index + 1)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {displayIdentifier(group.accountLabel, dashboard.privacyMasked)}
                        </span>
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs font-normal text-muted-foreground">
                        {displayPhone(firstOrder, dashboard.privacyMasked)}
                      </span>
                      <span className="mt-1 flex items-center justify-between text-xs font-normal text-muted-foreground">
                        <span>账户 {index + 1}</span>
                        <span>{group.orders.length} 个号码</span>
                      </span>
                    </span>
                  </Button>
                )
              })
            ) : (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {dashboard.ordersCacheStatus === "empty"
                  ? "Blob 暂无号码快照，请点击刷新"
                  : dashboard.ordersCacheStatus
                    ? "Blob 快照中当前筛选没有号码"
                    : "当前筛选没有号码"}
              </div>
            )}

            {dashboard.warnings.map((warning) => (
              <div key={warning.accountId} className="border-t px-3 py-3">
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {displayIdentifier(warning.accountLabel, dashboard.privacyMasked)}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">{warning.message}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
      <CardFooter className="block space-y-2 py-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">成功账户</span>
          <span className="font-medium">
            {Math.max(0, dashboard.accountCount - dashboard.failedAccountCount)} / {dashboard.accountCount}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">数据模式</span>
          <span className="font-medium">Blob 优先</span>
        </div>
      </CardFooter>
    </Card>
  )
}

function StatusFilters({ dashboard }: { dashboard: DashboardController }) {
  const helperId = dashboard.accountCount > 8 ? "all-status-limit" : undefined

  return (
    <div className="space-y-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={2}
        value={dashboard.status}
        onValueChange={(value) => value && dashboard.changeStatus(value as DashboardStatus)}
        className="grid w-full grid-cols-3 gap-2 md:flex md:w-fit md:flex-nowrap"
        aria-describedby={helperId}
      >
        {STATUS_ITEMS.map((item) => {
          const count = item.value === dashboard.status
            ? dashboard.orders.length
            : dashboard.statusCounts[item.value]
          const disabled = item.value === "all" && dashboard.accountCount > 8
          return (
            <Tooltip key={item.value}>
              <TooltipTrigger asChild>
                <span className="min-w-0">
                  <ToggleGroupItem
                    value={item.value}
                    disabled={disabled || dashboard.loadingOrders || dashboard.loadingMessages}
                    className="w-full gap-1.5"
                    aria-label={`${item.label}${count === undefined ? "" : `，${count} 个号码`}`}
                  >
                    {item.label}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {count ?? "—"}
                    </span>
                  </ToggleGroupItem>
                </span>
              </TooltipTrigger>
              {disabled && <TooltipContent>全部状态一次最多查询 8 个账户</TooltipContent>}
            </Tooltip>
          )
        })}
      </ToggleGroup>
      {dashboard.accountCount > 8 && (
        <p id={helperId} className="text-xs leading-5 text-muted-foreground md:hidden">
          账户超过 8 个时不能一次查询全部状态。
        </p>
      )}
    </div>
  )
}

function NumberTable({ dashboard }: { dashboard: DashboardController }) {
  return (
    <Card className="h-full gap-0 py-0">
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">号码概览</CardTitle>
        <CardDescription className="text-xs">Blob 快照中的跨 Token 聚合与状态筛选</CardDescription>
        <CardAction>
          <div className="relative hidden lg:block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-7 w-44 pl-8 text-xs md:h-7 md:pl-8 md:text-xs"
              placeholder="搜索号码或账户"
              value={dashboard.searchQuery}
              onChange={(event) => dashboard.setSearchQuery(event.target.value)}
              aria-label="搜索号码或账户"
            />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="px-3 py-2">
        <div className="relative mb-2 lg:hidden">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-10 md:pl-10"
            placeholder="搜索号码或账户"
            value={dashboard.searchQuery}
            onChange={(event) => dashboard.setSearchQuery(event.target.value)}
            aria-label="搜索号码或账户"
          />
        </div>
        <StatusFilters dashboard={dashboard} />
      </CardContent>
      <Separator />
      <CardContent className="min-h-0 flex-1 px-0">
        <ScrollArea className="h-[174px] lg:h-[158px]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 pl-3 text-xs text-muted-foreground">号码</TableHead>
                <TableHead className="h-8 text-xs text-muted-foreground">状态</TableHead>
                <TableHead className="hidden h-8 text-xs text-muted-foreground lg:table-cell">
                  套餐 / 到期
                </TableHead>
                <TableHead className="h-8 pr-3 text-right text-xs text-muted-foreground">短信</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.loadingOrders && !dashboard.filteredOrders.length ? (
                [0, 1].map((index) => (
                  <TableRow key={index}>
                    <TableCell className="pl-3"><Skeleton className="h-8 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="h-8 w-36" /></TableCell>
                    <TableCell className="pr-3"><Skeleton className="ml-auto h-5 w-12" /></TableCell>
                  </TableRow>
                ))
              ) : dashboard.filteredOrders.length ? (
                dashboard.filteredOrders.map((order) => {
                  const key = orderKey(order)
                  const count = dashboard.messageCounts[key]
                  return (
                    <TableRow key={key} data-state={dashboard.selectedKey === key ? "selected" : undefined}>
                      <TableCell className="py-1.5 pl-2">
                        <Button
                          variant="ghost"
                          className="h-auto min-h-11 max-w-full justify-start px-1.5 py-1 text-left"
                          onClick={() => dashboard.selectOrder(key)}
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background">
                            <Phone className="size-3.5 text-muted-foreground" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-xs font-medium">
                              {displayPhone(order, dashboard.privacyMasked)}
                            </span>
                            <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                              {order.countryCode || "未知地区"} ·{" "}
                              {displayIdentifier(order.accountLabel || "默认账户", dashboard.privacyMasked)}
                            </span>
                          </span>
                        </Button>
                      </TableCell>
                      <TableCell className="py-2"><StatusBadge order={order} /></TableCell>
                      <TableCell className="hidden py-2 lg:table-cell">
                        <div className="max-w-48 truncate text-xs">{formatPackage(order)}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {order.expireTime ? `至 ${formatDateTime(order.expireTime)}` : "未提供到期时间"}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 pr-3 text-right">
                        <Badge variant={count === undefined ? "outline" : "secondary"}>
                          {count === undefined ? "未读取" : `${count} 条`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-xs text-muted-foreground">
                    {dashboard.searchQuery
                      ? "没有匹配的号码"
                      : dashboard.ordersCacheStatus === "empty"
                        ? "Blob 暂无号码快照，请点击右上角刷新"
                        : dashboard.ordersCacheStatus
                          ? "Blob 快照中当前状态没有号码"
                          : "当前状态没有号码"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
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
      : !dashboard.privacyMasked && dashboard.revealCode
        ? code.length > 3
          ? `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`
          : code
        : "••• •••"

  return (
    <Card className="h-full gap-0 py-0">
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">最新验证码</CardTitle>
        <CardDescription className="text-xs">
          {record
            ? `${displayIdentifier(
                record.message.sender || "未知发送方",
                dashboard.privacyMasked,
              )} · ${formatShortTime(record.message.time)}`
            : "等待短信数据"}
        </CardDescription>
        <CardAction>
          <Badge variant={dashboard.privacyMasked ? "secondary" : "default"}>
            {dashboard.privacyMasked ? "已保护" : "全部可见"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between py-3">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {dashboard.loadingMessages ? (
                <Skeleton className="h-10 w-44" />
              ) : (
                <p className="font-mono text-3xl font-semibold tracking-[0.12em] tabular-nums sm:text-4xl">
                  {displayCode}
                </p>
              )}
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <KeyRound className="size-3.5" />
                <span>{record ? "识别自最新短信" : "最近短信中没有识别到验证码"}</span>
              </div>
            </div>
            <div className="flex gap-2 md:gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => dashboard.setPrivacyMasked(!dashboard.privacyMasked)}
                    disabled={!record || dashboard.loadingMessages}
                    aria-label={dashboard.privacyMasked ? "显示所有敏感信息" : "隐藏所有敏感信息"}
                  >
                    {dashboard.privacyMasked ? <Eye /> : <EyeOff />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{dashboard.privacyMasked ? "显示所有敏感信息" : "恢复全部隐私遮罩"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    onClick={dashboard.copyLatestCode}
                    disabled={!canCopy || dashboard.loadingMessages}
                    aria-label="复制验证码"
                  >
                    <Copy />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{canCopy ? "复制验证码" : "先显示完整验证码"}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <Separator className="my-3" />

          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">接收号码</dt>
              <dd className="mt-0.5 truncate font-mono font-medium">
                {order ? displayPhone(order, dashboard.privacyMasked) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">所属账户</dt>
              <dd className="mt-0.5 truncate font-medium">
                {displayIdentifier(order?.accountLabel || "—", dashboard.privacyMasked)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">国家 / 区号</dt>
              <dd className="mt-0.5 font-medium">
                {order ? [order.countryCode, order.phoneCode].filter(Boolean).join(" / ") || "—" : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">自动续费</dt>
              <dd className="mt-0.5 font-medium">
                {order ? (Number(order.autoRenew) === 1 ? "已开启" : "未开启") : "—"}
              </dd>
            </div>
          </dl>
        </div>
      </CardContent>
      <CardFooter className="justify-between py-2.5 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground">
          <Clock3 className="size-3.5 shrink-0" />
          {dashboard.lastUpdatedAt ? `同步于 ${formatDateTime(dashboard.lastUpdatedAt)}` : "等待同步"}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => dashboard.setPrivacyMasked(!dashboard.privacyMasked)}
          disabled={!order || dashboard.loadingMessages}
        >
          {dashboard.privacyMasked ? "显示全部" : "全部遮罩"}
        </Button>
      </CardFooter>
    </Card>
  )
}

function MessageCode({
  code,
  dashboard,
}: {
  code: string
  dashboard: DashboardController
}) {
  const revealed = !dashboard.privacyMasked && dashboard.revealCode && isCodeRevealed(code)
  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline" className="font-mono tracking-wider">
        {revealed ? code : "••••••"}
      </Badge>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => dashboard.copyValue(code, "验证码")}
        disabled={!revealed}
        aria-label="复制此验证码"
      >
        <Copy />
      </Button>
    </div>
  )
}

function MessageRow({
  message,
  dashboard,
}: {
  message: KitesimMessage
  dashboard: DashboardController
}) {
  const sender = message.sender || "未知发送方"
  const displaySender = displayIdentifier(sender, dashboard.privacyMasked)
  const displayContent = displayMessageContent(message.content, dashboard.privacyMasked)
  return (
    <TableRow>
      <TableCell className="py-1.5 pl-3">
        <div className="flex items-center gap-2">
          <Avatar className="size-6">
            <AvatarFallback className="bg-muted text-[9px] font-semibold">
              {Array.from(displaySender.trim()).slice(0, 2).join("").toUpperCase() || "—"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{displaySender}</div>
            <span className="text-[10px] text-muted-foreground">短信</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="max-w-0 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="truncate text-xs text-muted-foreground">{displayContent}</p>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm leading-5">{displayContent}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="py-1.5">
        {message.code?.[0] ? (
          <MessageCode code={message.code[0]} dashboard={dashboard} />
        ) : (
          <span className="text-[10px] text-muted-foreground">未识别</span>
        )}
      </TableCell>
      <TableCell className="py-1.5 pr-3 text-right text-xs text-muted-foreground">
        {formatShortTime(message.time)}
      </TableCell>
    </TableRow>
  )
}

function MessageCard({
  message,
  dashboard,
}: {
  message: KitesimMessage
  dashboard: DashboardController
}) {
  const sender = message.sender || "未知发送方"
  const displaySender = displayIdentifier(sender, dashboard.privacyMasked)
  const displayContent = displayMessageContent(message.content, dashboard.privacyMasked)
  return (
    <article className="p-3">
      <div className="flex items-center gap-3">
        <Avatar className="size-9">
          <AvatarFallback className="bg-muted text-xs font-semibold">
            {Array.from(displaySender.trim()).slice(0, 2).join("").toUpperCase() || "—"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{displaySender}</div>
          <span className="text-xs text-muted-foreground">短信</span>
        </div>
        <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatShortTime(message.time)}
        </time>
      </div>
      <p className="mt-3 break-words whitespace-pre-wrap text-sm leading-6 text-foreground/80">
        {displayContent}
      </p>
      <div className="mt-3 flex min-h-11 items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">验证码</span>
        {message.code?.[0] ? (
          <MessageCode code={message.code[0]} dashboard={dashboard} />
        ) : (
          <span className="text-xs text-muted-foreground">未识别</span>
        )}
      </div>
    </article>
  )
}

function MessageInbox({ dashboard }: { dashboard: DashboardController }) {
  return (
    <Card className="h-full min-h-0 gap-0 py-0">
      <CardHeader className="border-b py-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          短信收件箱
          <Badge variant="secondary">{dashboard.messages.length}</Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          {dashboard.selectedOrder
            ? `${displayPhone(dashboard.selectedOrder, dashboard.privacyMasked)} 的最近消息`
            : "选择号码后读取短信"}
        </CardDescription>
        <CardAction>
          <div className="flex min-h-11 items-center gap-3 text-xs text-muted-foreground md:min-h-0 md:gap-2">
            <span className="hidden sm:inline">显示敏感信息</span>
            <Switch
              size="sm"
              checked={!dashboard.privacyMasked}
              onCheckedChange={(visible) => dashboard.setPrivacyMasked(!visible)}
              disabled={!dashboard.selectedOrder || dashboard.loadingMessages}
              aria-label="切换所有敏感信息显示"
            />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-0">
        <div className="max-h-[560px] divide-y overflow-y-auto overscroll-contain md:hidden">
          {dashboard.loadingMessages ? (
            [0, 1, 2].map((index) => (
              <div key={index} className="space-y-3 p-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-9 rounded-full" />
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="ml-auto h-4 w-10" />
                </div>
                <Skeleton className="h-16 w-full" />
              </div>
            ))
          ) : dashboard.messages.length ? (
            dashboard.messages.map((message, index) => (
              <MessageCard key={String(message.id ?? index)} message={message} dashboard={dashboard} />
            ))
          ) : (
            <div className="grid min-h-32 place-items-center px-4 text-center text-sm text-muted-foreground">
              {dashboard.selectedOrder
                ? dashboard.messageCacheStatus === "empty"
                  ? "Blob 暂无该号码的短信快照，请点击刷新"
                  : "当前号码暂时没有短信"
                : "先选择一个号码"}
            </div>
          )}
        </div>

        <div className="hidden md:block">
          <ScrollArea className="h-[218px] lg:h-[150px]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 pl-3 text-xs text-muted-foreground">来源</TableHead>
                  <TableHead className="h-8 text-xs text-muted-foreground">内容</TableHead>
                  <TableHead className="h-8 text-xs text-muted-foreground">验证码</TableHead>
                  <TableHead className="h-8 pr-3 text-right text-xs text-muted-foreground">时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.loadingMessages ? (
                  [0, 1, 2].map((index) => (
                    <TableRow key={index}>
                      <TableCell className="pl-3"><Skeleton className="h-7 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell className="pr-3"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                    </TableRow>
                  ))
                ) : dashboard.messages.length ? (
                  dashboard.messages.map((message, index) => (
                    <MessageRow key={String(message.id ?? index)} message={message} dashboard={dashboard} />
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-xs text-muted-foreground">
                      {dashboard.selectedOrder
                        ? dashboard.messageCacheStatus === "empty"
                          ? "Blob 暂无该号码的短信快照，请点击刷新"
                          : dashboard.messageCacheStatus
                            ? "Blob 快照中该号码暂时没有短信"
                            : "当前号码暂时没有短信"
                        : "先选择一个号码"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardShell({ dashboard }: { dashboard: DashboardController }) {
  return (
    <div className="min-h-svh bg-muted/30">
      <a
        href="#dashboard-content"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        跳到主要内容
      </a>
      <WorkspaceHeader dashboard={dashboard} />
      <main id="dashboard-content" className="mx-auto w-full max-w-[1600px] px-3 pt-1.5 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-4">
        <ViewHeading dashboard={dashboard} />
        <div className="space-y-3">
          <MetricStrip dashboard={dashboard} />
          {dashboard.warnings.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle />
              <AlertTitle>{dashboard.warnings.length} 个账户读取失败</AlertTitle>
              <AlertDescription className="text-xs text-amber-800">
                {dashboard.warnings
                  .map((warning) => displayIdentifier(warning.accountLabel, dashboard.privacyMasked))
                  .join("、")}；其他账户已继续同步。
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[216px_minmax(0,1fr)_306px] lg:grid-rows-[260px_206px] xl:grid-cols-[226px_minmax(0,1fr)_326px]">
            <div className="order-3 lg:order-none lg:row-span-2">
              <AccountRail dashboard={dashboard} />
            </div>
            <div className="order-1 lg:order-none">
              <NumberTable dashboard={dashboard} />
            </div>
            <div className="order-2 lg:order-none">
              <CodePanel dashboard={dashboard} />
            </div>
            <div className="order-4 lg:order-none lg:col-span-2">
              <MessageInbox dashboard={dashboard} />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
