import { type FormEvent, useRef, useState } from "react"
import { Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck, TriangleAlert } from "lucide-react"

import { AppMark } from "@/components/app-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
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

  const connectionVariant = dashboard.connection.mode === "error"
    ? "destructive"
    : dashboard.connection.mode === "ready"
      ? "secondary"
      : "outline"

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-muted/30">
      <header className="flex h-14 shrink-0 items-center border-b bg-background px-4 md:px-6">
        <div className="flex items-center gap-3">
          <AppMark />
          <div className="leading-none">
            <div className="text-sm font-semibold tracking-tight">Kitesim Relay</div>
            <div className="mt-1 text-[11px] text-muted-foreground">只读号码与验证码工作台</div>
          </div>
        </div>
        <Badge variant={connectionVariant} className="ml-auto font-normal">
          {dashboard.connection.mode === "loading"
            ? <Spinner />
            : dashboard.connection.mode === "error"
              ? <TriangleAlert data-icon="inline-start" />
              : <ShieldCheck data-icon="inline-start" />}
          {dashboard.connection.text}
        </Badge>
      </header>

      <main
        id="main-content"
        className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 items-center gap-8 px-4 py-6 lg:grid-cols-[1fr_420px]"
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
            聚合多个 Kitesim 账户，只读取号码订单与短信。登录产生的 Token 仅以密文保存在服务端 Blob，浏览器不会接收或保存它们。
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              ["01", "多账户", "聚合查询"],
              ["02", "只读", "不修改订单"],
              ["03", "私密", "按需显示验证码"],
            ].map(([index, title, detail]) => (
              <Card key={index} size="sm">
                <CardHeader>
                  <Badge variant="outline" className="font-mono">{index}</Badge>
                  <CardTitle>{title}</CardTitle>
                  <CardDescription className="text-xs">{detail}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        <Card className="mx-auto w-full max-w-[420px] gap-0 py-0">
          <CardHeader className="border-b px-6 py-5">
            <Avatar>
              <AvatarFallback><LockKeyhole /></AvatarFallback>
            </Avatar>
            <CardTitle className="text-xl">解锁工作台</CardTitle>
            <CardDescription>输入服务端配置的控制台访问口令</CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-5">
            <form onSubmit={handleSubmit} noValidate>
              <FieldGroup>
                <Field data-invalid={dashboard.accessInvalid || unavailable}>
                  <FieldLabel htmlFor="dashboard-access-key">控制台访问口令</FieldLabel>
                  <InputGroup className="h-11 md:h-10">
                    <InputGroupAddon><KeyRound /></InputGroupAddon>
                    <InputGroupInput
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
                      aria-invalid={dashboard.accessInvalid}
                      aria-describedby="access-feedback"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-sm"
                        onClick={() => setVisible((current) => !current)}
                        disabled={dashboard.authenticating || unavailable}
                        aria-label={visible ? "隐藏访问口令" : "显示访问口令"}
                        aria-pressed={visible}
                        aria-controls="dashboard-access-key"
                      >
                        {visible ? <EyeOff /> : <Eye />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription
                    id="access-feedback"
                    role={dashboard.accessInvalid || unavailable ? "alert" : "status"}
                    aria-live={dashboard.accessInvalid || unavailable ? "assertive" : "polite"}
                    className={dashboard.accessInvalid || unavailable ? "text-destructive" : undefined}
                  >
                    {dashboard.accessFeedback}
                  </FieldDescription>
                </Field>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={dashboard.authenticating || unavailable}
                >
                  {dashboard.authenticating ? <Spinner /> : <LockKeyhole data-icon="inline-start" />}
                  {dashboard.authenticating ? "正在验证" : "进入工作台"}
                </Button>
              </FieldGroup>
            </form>

            <Alert className="mt-3">
              <ShieldCheck />
              <AlertTitle>Token 不在这里填写</AlertTitle>
              <AlertDescription className="text-xs">
                当前输入框仅验证 DASHBOARD_ACCESS_KEY，Kitesim 登录信息由后台单独管理。
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
