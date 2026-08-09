import { type FormEvent, useCallback, useEffect, useState } from "react"
import { Bot, CheckCircle2, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react"
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
  const [maintaining, setMaintaining] = useState(false)
  const [failure, setFailure] = useState("")

  const edgeOneRuntime = dashboard.health?.runtime === "edgeone-node-cloud-function"
  const readStatus = dashboard.readKitesimAuthStatus
  const requestChallenge = dashboard.requestKitesimAuthChallenge
  const submitChallenge = dashboard.submitKitesimAuthChallenge
  const runMaintenance = dashboard.runKitesimAuthMaintenance

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

  const maintainTokens = async () => {
    setMaintaining(true)
    setFailure("")
    try {
      const result = await runMaintenance()
      setStatus(await readStatus())
      if (result.failedCount) {
        toast.warning(`自动维护完成，${result.failedCount} 个账户需要人工接管`)
      } else if (result.reloggedCount) {
        toast.success(`AI 已自动更新 ${result.reloggedCount} 个账户的 Token`)
      } else {
        toast.success("所有账户 Token 均有效")
      }
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setMaintaining(false)
    }
  }

  if (!edgeOneRuntime) {
    return (
      <Alert>
        <KeyRound />
        <AlertTitle>自动登录仅在 EdgeOne Functions 运行</AlertTitle>
        <AlertDescription>
          本地 Flask + Vite 不提供 Blob 认证路由；请使用 <code>edgeone makers dev</code>。
        </AlertDescription>
      </Alert>
    )
  }

  const readyCount = status?.readyCount ?? 0
  const accountCount = status?.accountCount ?? 0
  const automationReady = status?.automation?.configured === true
  const lastMaintenance = status?.automation?.maintenance

  return (
    <Card size="sm" className="gap-0 py-0">
      <CardHeader className="border-b py-3">
        <CardTitle>登录状态</CardTitle>
        <CardDescription className="text-xs">AI 自动识别验证码并维护 Token；人工输入作为失败兜底。</CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void maintainTokens()}
              disabled={maintaining || loadingStatus || !automationReady}
            >
              {maintaining ? <Spinner /> : <Bot data-icon="inline-start" />}
              {maintaining ? "维护中" : "立即维护"}
            </Button>
            <Badge variant={readyCount > 0 ? "secondary" : "outline"}>
              {loadingStatus ? <Spinner /> : <ShieldCheck data-icon="inline-start" />}
              {loadingStatus ? "检查中" : `${readyCount}/${accountCount} 已登录`}
            </Badge>
          </div>
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

        {status?.configured && !automationReady && (
          <Alert>
            <Bot />
            <AlertTitle>AI 自动维护尚未就绪</AlertTitle>
            <AlertDescription className="text-xs">
              请启用自动维护，并配置 AI 网关密钥；当前仍可使用下方人工验证码登录。
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
          <AlertTitle>模型只会收到验证码图片</AlertTitle>
          <AlertDescription className="text-xs">
            账户、密码和 Token 都留在服务端；登录结果按账户加密保存到 Blob。
          </AlertDescription>
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
              const maintenanceAccount = lastMaintenance?.accounts.find(
                (item) => item.accountId === account.accountId,
              )
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
                      {maintenanceAccount?.message
                        || (account.verifiedAt
                        ? `最近验证 ${formatDateTime(account.verifiedAt)}`
                        : "尚未生成可用登录状态")}
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
                      {isActive ? "换一张" : account.tokenAvailable ? "人工重登" : "人工验证码"}
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
                <CardDescription className="text-xs">AI 未完成时，人工识别下图 4 位字符并接管登录。</CardDescription>
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
          {lastMaintenance?.lastCompletedAt
            ? `最近自动维护 ${formatDateTime(lastMaintenance.lastCompletedAt)}；普通读取仍只访问 Blob。`
            : "每日计划任务与显式刷新会维护 Token；普通读取仍只访问 Blob。"}
        </CardFooter>
      )}
    </Card>
  )
}
