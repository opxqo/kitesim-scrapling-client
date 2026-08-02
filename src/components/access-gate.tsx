import { type FormEvent, useRef, useState } from "react"
import { Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react"

import { AppMark } from "@/components/app-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DashboardController } from "@/hooks/use-dashboard"

export function AccessGate({ dashboard }: { dashboard: DashboardController }) {
  const [accessKey, setAccessKey] = useState("")
  const [visible, setVisible] = useState(false)
  const accessKeyRef = useRef<HTMLInputElement>(null)
  const unavailable = Boolean(dashboard.healthError) || dashboard.health?.authConfigured === false

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const accepted = await dashboard.verifyAccess(accessKey)
    if (accepted) {
      setAccessKey("")
    } else {
      accessKeyRef.current?.focus()
    }
  }

  return (
    <div className="min-h-svh bg-muted/30">
      <header className="flex min-h-[calc(3.75rem+env(safe-area-inset-top))] items-center border-b bg-background px-4 pt-[env(safe-area-inset-top)] md:min-h-14 md:px-6 md:pt-0">
        <div className="flex items-center gap-3">
          <AppMark />
          <div className="leading-none">
            <div className="text-sm font-semibold tracking-tight">Kitesim Relay</div>
            <div className="mt-1 text-[11px] text-muted-foreground">只读号码与验证码工作台</div>
          </div>
        </div>
        <Badge
          variant="outline"
          className="ml-auto font-normal"
        >
          <span
            className={`size-1.5 rounded-full ${
              dashboard.connection.mode === "error"
                ? "bg-destructive"
                : dashboard.connection.mode === "loading"
                  ? "animate-pulse bg-amber-500"
                  : "bg-emerald-500"
            }`}
          />
          {dashboard.connection.text}
        </Badge>
      </header>

      <main
        id="main-content"
        className="mx-auto grid min-h-[calc(100dvh-3.75rem)] max-w-5xl items-center gap-10 px-4 pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:py-10 lg:grid-cols-[1fr_420px]"
      >
        <section className="hidden max-w-xl lg:block">
          <Badge variant="secondary" className="mb-5 font-mono text-[10px] tracking-wider">
            PRIVATE OPERATIONS DESK
          </Badge>
          <h1 className="text-4xl leading-tight font-semibold tracking-[-0.035em] text-balance">
            号码、账户和验证码，
            <br />
            在一张安全桌面中完成。
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-muted-foreground">
            聚合多个 Kitesim Token 账户，只读取号码订单与短信。Token 始终保留在服务端环境变量中，浏览器不会接收或保存它们。
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              ["01", "多账户", "聚合查询"],
              ["02", "只读", "不修改订单"],
              ["03", "私密", "按需显示验证码"],
            ].map(([index, title, detail]) => (
              <Card key={index} size="sm" className="gap-2">
                <CardHeader>
                  <span className="font-mono text-[10px] text-muted-foreground">{index}</span>
                  <CardTitle className="mt-2">{title}</CardTitle>
                  <CardDescription className="text-xs">{detail}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <Card className="mx-auto w-full max-w-[420px] gap-0 py-0 shadow-lg shadow-foreground/[0.04]">
          <CardHeader className="border-b px-6 py-5">
            <div className="mb-4 grid size-10 place-items-center rounded-xl bg-primary/8 text-primary">
              <LockKeyhole className="size-5" />
            </div>
            <CardTitle className="text-xl">解锁工作台</CardTitle>
            <CardDescription>输入服务端配置的控制台访问口令</CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-5">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="dashboard-access-key">控制台访问口令</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={accessKeyRef}
                    id="dashboard-access-key"
                    name="accessKey"
                    type={visible ? "text" : "password"}
                    autoComplete="current-password"
                    minLength={12}
                    required
                    autoFocus={!unavailable}
                    disabled={dashboard.authenticating || unavailable}
                    value={accessKey}
                    onChange={(event) => setAccessKey(event.target.value)}
                    placeholder="至少 12 个字符"
                    className="h-11 pr-12 pl-10 md:h-10 md:pr-12 md:pl-10"
                    aria-invalid={dashboard.accessInvalid}
                    aria-describedby="access-feedback"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1/2 right-0 -translate-y-1/2 md:right-2 md:size-9"
                    onClick={() => setVisible((current) => !current)}
                    disabled={dashboard.authenticating || unavailable}
                    aria-label={visible ? "隐藏访问口令" : "显示访问口令"}
                    aria-pressed={visible}
                    aria-controls="dashboard-access-key"
                  >
                    {visible ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={dashboard.authenticating || unavailable}
              >
                {dashboard.authenticating ? "正在验证" : "进入工作台"}
              </Button>

              <p
                id="access-feedback"
                role={dashboard.accessInvalid || unavailable ? "alert" : "status"}
                aria-live={dashboard.accessInvalid || unavailable ? "assertive" : "polite"}
                className={`min-h-5 text-sm leading-5 ${dashboard.accessInvalid || unavailable ? "text-destructive" : "text-muted-foreground"}`}
              >
                {dashboard.accessFeedback}
              </p>
            </form>

            <Alert className="mt-3 bg-muted/40">
              <ShieldCheck />
              <AlertTitle>Token 不在这里填写</AlertTitle>
              <AlertDescription className="text-xs">
                当前输入框仅验证 DASHBOARD_ACCESS_KEY，Kitesim Token 只存在服务端。
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
