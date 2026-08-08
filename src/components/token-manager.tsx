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
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
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
    <Card size="sm" className="gap-0 py-0">
      <CardHeader className="border-b py-3">
        <CardTitle>登录状态</CardTitle>
        <CardDescription className="text-xs">每个账户由管理员人工识别一次图片验证码。</CardDescription>
        <CardAction>
          <Badge variant={readyCount > 0 ? "secondary" : "outline"}>
            {loadingStatus ? <Spinner /> : <ShieldCheck data-icon="inline-start" />}
            {loadingStatus ? "检查中" : `${readyCount}/${accountCount} 已登录`}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 p-3">
        {status && !status.configured && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>服务端配置未完成</AlertTitle>
            <AlertDescription className="text-xs">
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

        <Alert>
          <ShieldCheck />
          <AlertTitle>浏览器不会收到 Kitesim 密码或 Token</AlertTitle>
          <AlertDescription className="text-xs">登录结果按账户加密保存到服务端 Blob。</AlertDescription>
        </Alert>

        {loadingStatus && !status ? (
          <div className="grid gap-2 md:grid-cols-3">
            {[0, 1, 2].map((item) => <Skeleton key={item} className="h-24 w-full" />)}
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {status?.accounts.map((account) => {
              const isLoading = loadingAccountId === account.accountId
              const isActive = challenge?.accountId === account.accountId
              return (
                <Item
                  key={account.accountId}
                  variant={account.tokenAvailable ? "muted" : "outline"}
                  size="sm"
                  className="min-w-0 md:flex-col md:items-stretch"
                >
                  <ItemMedia variant="icon">
                    {account.tokenAvailable ? <CheckCircle2 /> : <KeyRound />}
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full truncate text-xs">{account.emailHint}</ItemTitle>
                    <ItemDescription className="text-[10px]">
                      {account.verifiedAt
                        ? `最近验证 ${formatDateTime(account.verifiedAt)}`
                        : "尚未生成可用登录状态"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="md:w-full">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="md:w-full"
                      onClick={() => void loadChallenge(account.accountId)}
                      disabled={Boolean(loadingAccountId) || submitting || !account.credentialsConfigured}
                    >
                      {isLoading ? <Spinner /> : <RefreshCw data-icon="inline-start" />}
                      {isActive ? "换一张" : account.tokenAvailable ? "重新登录" : "获取验证码"}
                    </Button>
                  </ItemActions>
                </Item>
              )
            })}
          </div>
        )}

        {challenge && (
          <form onSubmit={completeLogin}>
            <Card size="sm" className="gap-0 py-0">
              <CardHeader className="border-b py-2">
                <CardTitle>图片验证码 · {challenge.emailHint}</CardTitle>
                <CardDescription className="text-xs">人工识别下图 4 位字符，然后提交登录。</CardDescription>
              </CardHeader>
              <CardContent className="py-3">
                <FieldGroup>
                  <div className="grid gap-3 md:grid-cols-[180px_minmax(180px,1fr)] md:items-end">
                    <Field>
                      <FieldLabel>验证码图片</FieldLabel>
                      <Item variant="outline" size="xs" className="h-12 justify-center bg-background">
                        <img
                          src={`data:image/png;base64,${challenge.captchaImageBase64}`}
                          alt="Kitesim 图片验证码"
                          className="max-h-10 max-w-full object-contain"
                        />
                      </Item>
                    </Field>
                    <Field data-invalid={Boolean(failure)}>
                      <FieldLabel htmlFor="kitesim-captcha">输入上图 4 位字符</FieldLabel>
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
                      <FieldDescription>仅用于本次登录，不会保存验证码。</FieldDescription>
                    </Field>
                  </div>
                </FieldGroup>
              </CardContent>
              <CardFooter className="justify-end p-3">
                <Button type="submit" disabled={submitting || captchaCode.length !== 4}>
                  {submitting ? <Spinner /> : <KeyRound data-icon="inline-start" />}
                  {submitting ? "正在验证" : "验证并登录"}
                </Button>
              </CardFooter>
            </Card>
          </form>
        )}
      </CardContent>

      {readyCount > 0 && !challenge && (
        <CardFooter className="text-xs text-muted-foreground">
          普通读取只访问 Blob；只有手动刷新或已启用的定时刷新会访问 Kitesim。
        </CardFooter>
      )}
    </Card>
  )
}
