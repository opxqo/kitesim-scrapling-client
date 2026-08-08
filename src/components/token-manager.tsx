import { type FormEvent, useCallback, useEffect, useState } from "react"
import { KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react"
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
  const [loadingChallenge, setLoadingChallenge] = useState(false)
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

  const loadChallenge = async () => {
    setLoadingChallenge(true)
    setFailure("")
    try {
      const nextChallenge = await requestChallenge()
      setChallenge(nextChallenge)
      setCaptchaCode("")
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setLoadingChallenge(false)
    }
  }

  const completeLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!challenge || captchaCode.length !== 4) return
    setSubmitting(true)
    setFailure("")
    try {
      const result = await submitChallenge(captchaCode, challenge.captchaKey)
      setChallenge(null)
      setCaptchaCode("")
      await loadStatus()
      toast.success(`Kitesim Token 已更新（${result.emailHint || "管理员账户"}）`)
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
        <AlertTitle>半自动 Token 登录仅在 EdgeOne 运行</AlertTitle>
        <AlertDescription>
          本地 Flask + Vite 不提供 Blob 认证路由；请使用 EdgeOne Preview 或 <code>edgeone makers dev</code>。
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          Kitesim Token 管理
        </CardTitle>
        <CardDescription className="text-xs">
          后台获取图片验证码；管理员识别一次后，Token 将加密保存到 EdgeOne Blob。
        </CardDescription>
        <CardAction>
          <Badge
            variant="outline"
            className={status?.tokenAvailable
              ? "border-emerald-200 bg-emerald-50 font-normal text-emerald-700"
              : "font-normal"}
          >
            {loadingStatus ? "检查中" : status?.tokenAvailable ? "Token 可用" : "尚未登录"}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        {status && !status.configured && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <TriangleAlert />
            <AlertTitle>服务端配置未完成</AlertTitle>
            <AlertDescription className="text-xs text-amber-800">
              请先配置 Kitesim 登录邮箱、密码、Token 加密密钥和内部签名密钥。
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

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-emerald-600" />
              浏览器不会收到 Kitesim Token 或登录密码
            </div>
            <div>
              账户：{status?.emailHint || "等待服务端配置"}
              {status?.verifiedAt ? ` · 最近验证 ${formatDateTime(status.verifiedAt)}` : ""}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadChallenge()}
            disabled={loadingChallenge || submitting || status?.configured === false}
          >
            <RefreshCw className={loadingChallenge ? "animate-spin" : ""} />
            {challenge ? "换一张验证码" : "获取验证码"}
          </Button>
        </div>

        {challenge && (
          <form className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-[160px_minmax(180px,1fr)_auto] md:items-end" onSubmit={completeLogin}>
            <div className="space-y-1.5">
              <Label>图片验证码</Label>
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
              {submitting ? "正在验证…" : "验证并更新 Token"}
            </Button>
          </form>
        )}

        {status?.tokenAvailable && !challenge && (
          <p className="text-xs text-muted-foreground">
            Token 已就绪；普通读取仍只访问 Blob 快照，点击工作台刷新按钮时才会访问 Kitesim。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
