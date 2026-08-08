import { type FormEvent, useCallback, useEffect, useState } from "react"
import { CheckCircle2, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DashboardController } from "@/hooks/use-dashboard"
import { ApiError } from "@/lib/api"
import { formatDateTime } from "@/lib/dashboard"
import type { KitesimAuthChallenge, KitesimAuthStatus } from "@/types"


function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  return "操作失败，请稍后重试"
}


export function TokenManager({ dashboard }: { dashboard: DashboardController }) {
  const [status, setStatus] = useState<KitesimAuthStatus | null>(null)
  const [challenge, setChallenge] = useState<KitesimAuthChallenge | null>(null)
  const [captchaCode, setCaptchaCode] = useState("")
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingAccountId, setLoadingAccountId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState("")

  const edgeOneRuntime = dashboard.health?.runtime === "edgeone-node-cloud-function"
  const readStatus = dashboard.readKitesimAuthStatus
  const requestChallenge = dashboard.requestKitesimAuthChallenge
  const submitChallenge = dashboard.submitKitesimAuthChallenge

  const loadStatus = useCallback(async () => {
    if (!edgeOneRuntime) return
    setLoadingStatus(true)
    setFailure("")
    try {
      setStatus(await readStatus())
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setLoadingStatus(false)
    }
  }, [edgeOneRuntime, readStatus])

  useEffect(() => {
    if (!edgeOneRuntime) return
    let active = true
    void readStatus()
      .then((nextStatus) => {
        if (active) setStatus(nextStatus)
      })
      .catch((error: unknown) => {
        if (active) setFailure(errorMessage(error))
      })
      .finally(() => {
        if (active) setLoadingStatus(false)
      })
    return () => {
      active = false
    }
  }, [edgeOneRuntime, readStatus])

  const loadChallenge = async (accountId: string) => {
    setLoadingAccountId(accountId)
    setFailure("")
    try {
      const nextChallenge = await requestChallenge(accountId)
      setChallenge(nextChallenge)
      setCaptchaCode("")
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setLoadingAccountId("")
    }
  }

  const completeLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!challenge || captchaCode.length !== 4) return
    setSubmitting(true)
    setFailure("")
    try {
      const result = await submitChallenge(
        challenge.accountId,
        captchaCode,
        challenge.captchaKey,
      )
      setChallenge(null)
      setCaptchaCode("")
      await loadStatus()
      toast.success(`Kitesim 登录状态已更新（${result.emailHint}）`)
    } catch (error) {
      const message = errorMessage(error)
      setFailure(message)
      if (error instanceof ApiError && error.kind === "captcha") {
        setChallenge(null)
        setCaptchaCode("")
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!edgeOneRuntime) {
    return (
      <Alert>
        <KeyRound />
        <AlertTitle>半自动登录仅在 EdgeOne Functions 运行</AlertTitle>
        <AlertDescription>
          本地 Flask + Vite 不提供 Blob 认证路由；请使用 <code>edgeone makers dev</code>。
        </AlertDescription>
      </Alert>
    )
  }

  const readyCount = status?.readyCount ?? 0
  const accountCount = status?.accountCount ?? 0

  return (
    <Card size="sm" className="border-0 bg-transparent ring-0 shadow-none">
      <CardHeader className="pr-14 pt-3">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          Kitesim 账户登录
        </CardTitle>
        <CardDescription className="text-xs">
          每个账户由管理员识别一次图片验证码；生成的 Token 分账户加密保存到 Blob。
        </CardDescription>
        <CardAction>
          <Badge
            variant="outline"
            className={readyCount > 0
              ? "border-emerald-200 bg-emerald-50 font-normal text-emerald-700"
              : "font-normal"}
          >
            {loadingStatus ? "检查中" : `${readyCount}/${accountCount} 已登录`}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3 pb-3">
        {status && !status.configured && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <TriangleAlert />
            <AlertTitle>服务端配置未完成</AlertTitle>
            <AlertDescription className="text-xs text-amber-800">
              请配置分项登录邮箱、共享密码、Token 加密密钥和内部签名密钥。
            </AlertDescription>
          </Alert>
        )}

        {failure && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>操作未完成</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          浏览器不会收到 Kitesim 密码或 Token
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {status?.accounts.map((account) => {
            const isLoading = loadingAccountId === account.accountId
            const isActive = challenge?.accountId === account.accountId
            return (
              <div
                key={account.accountId}
                className="soft-inset flex min-h-[104px] flex-col justify-between gap-2 rounded-2xl border-0 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {account.tokenAvailable && <CheckCircle2 className="size-4 text-emerald-600" />}
                    <span className="truncate">{account.emailHint}</span>
                    <Badge variant="outline" className="font-normal">
                      {account.tokenAvailable ? "已登录" : "待验证"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {account.verifiedAt
                      ? `最近验证 ${formatDateTime(account.verifiedAt)}`
                      : "尚未生成可用登录状态"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadChallenge(account.accountId)}
                  disabled={Boolean(loadingAccountId) || submitting || !account.credentialsConfigured}
                >
                  <RefreshCw className={isLoading ? "animate-spin" : ""} />
                  {isActive ? "换一张验证码" : account.tokenAvailable ? "重新登录" : "获取验证码"}
                </Button>
              </div>
            )
          })}
        </div>

        {challenge && (
          <form
            className="signal-puck grid gap-3 rounded-2xl border-0 p-3 md:grid-cols-[160px_minmax(180px,1fr)_auto] md:items-end"
            onSubmit={completeLogin}
          >
            <div className="space-y-1.5">
              <Label>图片验证码 · {challenge.emailHint}</Label>
              <div className="flex h-12 items-center justify-center overflow-hidden rounded-md border bg-white px-2">
                <img
                  src={`data:image/png;base64,${challenge.captchaImageBase64}`}
                  alt="Kitesim 图片验证码"
                  className="max-h-11 max-w-full object-contain"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kitesim-captcha">输入上图 4 位字符</Label>
              <Input
                id="kitesim-captcha"
                value={captchaCode}
                onChange={(event) => setCaptchaCode(
                  event.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase(),
                )}
                autoComplete="off"
                autoCapitalize="characters"
                inputMode="text"
                maxLength={4}
                placeholder="例如 A7B9"
                className="h-12 font-mono text-lg tracking-[0.35em] md:h-9"
                aria-invalid={Boolean(failure)}
              />
            </div>
            <Button type="submit" disabled={submitting || captchaCode.length !== 4}>
              {submitting ? "正在验证…" : "验证并登录"}
            </Button>
          </form>
        )}

        {readyCount > 0 && !challenge && (
          <p className="text-xs text-muted-foreground">
            已登录账户可用于刷新；普通读取仍只访问 Blob 快照，只有显式或已启用的定时刷新才访问 Kitesim。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
