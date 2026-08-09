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
  Route,
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
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
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

type MobilePanel = "numbers" | "messages"
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
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
              aria-label="管理 Kitesim 账户登录"
            >
              <UserRoundCheck data-icon="inline-start" />
              <span className="truncate group-data-[collapsible=icon]:hidden">账户登录</span>
              <Badge variant="secondary" className="ml-auto group-data-[collapsible=icon]:hidden">
                {Math.max(0, dashboard.accountCount - dashboard.failedAccountCount)}/{dashboard.accountCount}
              </Badge>
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>管理 Kitesim 自动登录与 Token</TooltipContent>
      </Tooltip>
      <DialogContent className="w-[calc(100%-1rem)] gap-3 p-3 sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Kitesim 账户登录</DialogTitle>
          <DialogDescription>AI 自动维护 Token，识别失败时可由管理员输入验证码接管。</DialogDescription>
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
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="hidden lg:inline-flex">
            <BreadcrumbPage className="text-muted-foreground">Kitesim Relay</BreadcrumbPage>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="hidden lg:block" />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate font-medium">信号调度台</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Badge
          variant={connectionVariant(dashboard.connection.mode)}
          className="hidden max-w-48 truncate font-normal min-[1100px]:inline-flex"
        >
          {connectionIcon}
          {dashboard.connection.text}
        </Badge>
        <AutoRefreshSelect dashboard={dashboard} />
        <ButtonGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="hidden sm:inline-flex"
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
        </ButtonGroup>
      </div>
    </header>
  )
}

function SidebarDataStatus({ dashboard }: { dashboard: DashboardController }) {
  const successfulAccounts = Math.max(0, dashboard.accountCount - dashboard.failedAccountCount)
  const cacheLabel = dashboard.ordersCacheStatus
    ? CACHE_STATUS_LABEL[dashboard.ordersCacheStatus]
    : "等待读取"

  return (
    <SidebarGroup className="mt-auto group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>数据通道</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <div title="普通读取仅访问 Blob 快照">
                <DatabaseZap />
                <span>{cacheLabel}</span>
              </div>
            </SidebarMenuButton>
            <SidebarMenuBadge>{dashboard.orders.length}</SidebarMenuBadge>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <div title="账户凭据与 Token 仅在服务端处理">
                <ShieldCheck />
                <span>服务端凭据隔离</span>
              </div>
            </SidebarMenuButton>
            <SidebarMenuBadge>{successfulAccounts}/{dashboard.accountCount}</SidebarMenuBadge>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function WorkspaceSidebar({ dashboard }: { dashboard: DashboardController }) {
  const groups = useMemo(() => buildAccountGroups(dashboard.orders), [dashboard.orders])
  const selectedAccountId = dashboard.selectedOrder?.accountId
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <div>
                <AppMark />
                <div className="min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="block truncate font-semibold tracking-tight">Kitesim Relay</span>
                  <span className="block truncate text-[10px] text-sidebar-foreground/60">多账户信号工作台</span>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            <Route />
            账户路由
            <Badge variant="secondary" className="ml-auto group-data-[collapsible=icon]:hidden">{groups.length}</Badge>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {dashboard.loadingOrders && !groups.length ? (
                [0, 1, 2].map((item) => (
                  <SidebarMenuItem key={item}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))
              ) : groups.length ? (
                groups.map((group) => {
                  const firstOrder = group.orders[0]
                  const selected = selectedAccountId === group.accountId
                  const accountLabel = displayIdentifier(group.accountLabel, dashboard.privacyMasked)
                  return (
                    <SidebarMenuItem key={group.accountId}>
                      <SidebarMenuButton
                        type="button"
                        size="lg"
                        isActive={selected}
                        tooltip={accountLabel}
                        className="h-12 pr-8"
                        onClick={() => {
                          dashboard.selectOrder(orderKey(firstOrder))
                          if (isMobile) setOpenMobile(false)
                        }}
                      >
                        <Server />
                        <div className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-xs font-medium">{accountLabel}</span>
                          <span className="block truncate font-mono text-[10px] text-sidebar-foreground/60">
                            {displayPhone(firstOrder, dashboard.privacyMasked)}
                          </span>
                        </div>
                      </SidebarMenuButton>
                      <SidebarMenuBadge>{group.orders.length}</SidebarMenuBadge>
                    </SidebarMenuItem>
                  )
                })
              ) : (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <div title="当前筛选没有账户数据">
                      <Server />
                      <span>暂无账户数据</span>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {dashboard.warnings.length > 0 && (
          <Alert variant="destructive" className="mx-2 w-auto group-data-[collapsible=icon]:hidden">
            <AlertTriangle />
            <AlertTitle>{dashboard.warnings.length} 个账户读取失败</AlertTitle>
          </Alert>
        )}

        <SidebarDataStatus dashboard={dashboard} />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <AccountLoginDialog dashboard={dashboard} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
              onClick={() => {
                if (isMobile) setOpenMobile(false)
                dashboard.lock()
              }}
              aria-label="锁定工作台"
            >
              <LockKeyhole data-icon="inline-start" />
              <span className="group-data-[collapsible=icon]:hidden">锁定工作台</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">锁定并清除当前标签页口令</TooltipContent>
        </Tooltip>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
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
      <CardHeader className="min-w-0 shrink-0 border-b py-2.5">
        <CardTitle>号码队列</CardTitle>
        <CardDescription className="hidden text-xs sm:block">选择号码，切换验证码与短信通道</CardDescription>
        <CardAction>
          <InputGroup className="w-[148px] max-w-[46vw] sm:w-[196px] sm:max-w-none">
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
                      <Badge variant={statusVariant(label)} className="hidden min-[1180px]:inline-flex">{label}</Badge>
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

function CodeRunway({ dashboard }: { dashboard: DashboardController }) {
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
  const sourceLabel = dashboard.messageCacheStatus
    ? CACHE_STATUS_LABEL[dashboard.messageCacheStatus]
    : "等待读取"
  const contextItems = [
    {
      label: "接收号码",
      value: order ? displayPhone(order, dashboard.privacyMasked) : "—",
      icon: Smartphone,
      mono: true,
    },
    {
      label: "所属账户",
      value: displayIdentifier(order?.accountLabel || "—", dashboard.privacyMasked),
      icon: Server,
      mono: false,
    },
    {
      label: "数据来源",
      value: sourceLabel,
      icon: DatabaseZap,
      mono: false,
    },
  ]

  return (
    <Card size="sm" className="h-full min-h-0 min-w-0 gap-0 py-0">
      <CardHeader className="shrink-0 border-b py-2.5">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          实时验证码
        </CardTitle>
        <CardDescription className="truncate text-xs">
          {record
            ? `${displayIdentifier(record.message.sender || "未知发送方", dashboard.privacyMasked)} · ${formatShortTime(record.message.time)}`
            : "等待所选号码的验证码短信"}
        </CardDescription>
        <CardAction>
          <Badge variant={dashboard.privacyMasked ? "outline" : "secondary"}>
            {dashboard.privacyMasked ? "已保护" : "可见"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid min-h-0 flex-1 gap-2 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(250px,.72fr)]">
        <Item variant="muted" className="min-h-0 flex-1 flex-nowrap px-3">
          <ItemContent className="min-w-0">
            {dashboard.loadingMessages ? (
              <Skeleton className="h-12 w-44" />
            ) : (
              <ItemTitle className="max-w-full font-mono text-4xl tracking-[0.18em] tabular-nums sm:text-5xl xl:text-6xl">
                {displayCode}
              </ItemTitle>
            )}
            <ItemDescription className="truncate text-xs">
              {record ? "最近一条已识别短信，可直接复制" : "最近短信中没有识别到验证码"}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="self-center">
            <ButtonGroup>
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
            </ButtonGroup>
          </ItemActions>
        </Item>
        <ItemGroup className="grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-2 min-[1200px]:grid-cols-3">
          {contextItems.map(({ label, value, icon: Icon, mono }) => (
            <Item
              key={label}
              variant="outline"
              size="xs"
              className={cn(
                "min-w-0 flex-nowrap",
                label === "数据来源" && "sm:col-span-2 min-[1200px]:col-span-1",
              )}
            >
              <ItemMedia variant="icon" className="hidden min-[430px]:flex sm:flex">
                <Icon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemDescription className="truncate text-[10px]">{label}</ItemDescription>
                <ItemTitle className={cn("max-w-full truncate text-xs", mono && "font-mono")}>{value}</ItemTitle>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
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
        <CardHeader className="shrink-0 border-b py-2.5">
          <CardTitle className="flex items-center gap-2">
            短信情报
            <Badge variant="secondary">{dashboard.messageTotalCount}</Badge>
            {dashboard.messageHasMore && <Badge variant="destructive" className="hidden xl:inline-flex">仍有更多</Badge>}
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
                    <ItemMedia className="hidden min-[1100px]:flex">
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
                      <Badge variant="outline" className="hidden font-mono min-[1200px]:inline-flex">
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

function CompactWorkspace({ dashboard }: { dashboard: DashboardController }) {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("numbers")

  return (
    <Tabs
      value={mobilePanel}
      onValueChange={(value) => setMobilePanel(value as MobilePanel)}
      className="h-full w-full min-h-0 min-w-0 min-[940px]:hidden"
    >
      <TabsList className="w-full shrink-0">
        <TabsTrigger value="numbers">
          <Phone data-icon="inline-start" />
          号码队列
        </TabsTrigger>
        <TabsTrigger value="messages">
          <MessageSquareText data-icon="inline-start" />
          短信情报
        </TabsTrigger>
      </TabsList>
      <TabsContent value="numbers" className="min-h-0 min-w-0">
        <NumberWorkspace dashboard={dashboard} pageSize={4} onSelect={() => setMobilePanel("messages")} />
      </TabsContent>
      <TabsContent value="messages" className="min-h-0 min-w-0">
        <MessageInbox dashboard={dashboard} pageSize={4} />
      </TabsContent>
    </Tabs>
  )
}

export function DashboardShell({ dashboard }: { dashboard: DashboardController }) {
  return (
    <SidebarProvider
      defaultOpen
      className="h-dvh min-h-0 overflow-hidden bg-sidebar text-foreground"
      style={
        {
          "--sidebar-width": "15rem",
          "--sidebar-width-icon": "3.25rem",
        } as React.CSSProperties
      }
    >
      <a href="#dashboard-content" className="sr-only rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        跳到主要内容
      </a>
      <WorkspaceSidebar dashboard={dashboard} />
      <SidebarInset
        id="dashboard-content"
        className="h-dvh min-h-0 min-w-0 overflow-hidden md:h-[calc(100dvh-1rem)]"
      >
        <WorkspaceHeader dashboard={dashboard} />
        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[218px_minmax(0,1fr)] gap-2 overflow-hidden bg-muted/30 p-2 sm:grid-rows-[172px_minmax(0,1fr)] md:gap-3 md:p-3">
          <CodeRunway dashboard={dashboard} />

          <div className="hidden min-h-0 min-w-0 grid-cols-[minmax(360px,1.15fr)_minmax(300px,.85fr)] gap-3 min-[940px]:grid">
            <NumberWorkspace dashboard={dashboard} pageSize={5} />
            <MessageInbox dashboard={dashboard} pageSize={4} />
          </div>

          <CompactWorkspace dashboard={dashboard} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
