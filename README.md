# Kitesim Signal Desk

一个使用 Scrapling 静态 `Fetcher` 聚合多个 Kitesim Token 账户、读取号码订单和短信验证码的私人网页控制台。面板采用 React、Vite、Tailwind CSS 与 shadcn/ui，支持本地 Flask，以及 EdgeOne Makers 的 Node.js Blob 缓存网关与 Python Cloud Functions。

所有上游 Kitesim 请求均为 GET，不会发送验证码、创建订单、支付、退款或修改账户。

## 架构

```text
React + shadcn/ui 静态面板
  ├─ POST /api/session       验证控制台访问口令
  ├─ GET  /api/orders        读取号码订单
  └─ POST /api/messages      读取所选号码的短信
              │
              ▼
EdgeOne Node.js Cloud Function
  ├─ 命中：解密 Blob 缓存后返回
  └─ 未命中：POST /api/messages-origin
              │
              ▼
EdgeOne Python Cloud Function / 本地 Flask
              │
              ▼
Scrapling Fetcher → 多个 Kitesim Token → Kitesim 只读 GET API
```

项目结构：

```text
index.html                         Vite HTML 入口
src/                               React 面板、数据控制器与 shadcn/ui 组件
public/                            Favicon 等原始静态资源
dist/                              npm run build 生成的部署产物（不提交）
package.json                       前端依赖、构建、检查与测试命令
components.json                   shadcn/ui 组件配置
cloud-functions/api/index.py      EdgeOne Flask 入口（外部路由 /api）
cloud-functions/api/messages.js   EdgeOne Node.js Blob 缓存入口（精确路由 /api/messages）
cloud-functions/_shared/           本地与云端共用的 API 和 Scrapling 核心
cloud-functions/requirements.txt  Python 3.10 函数依赖
app.py                             本地 API 与 dist 生产包预览服务
kitesim_scrapling.py              命令行客户端
edgeone.json                       Vite 构建、静态输出、安全头与函数超时
```

## 安全变量

服务端需要控制台口令，以及一个或多个 Kitesim Token：

- `KITESIM_TOKEN_1` … `KITESIM_TOKEN_20`：EdgeOne 推荐的多账户配置，每个变量保存一个 Token。
- `KITESIM_TOKEN_NAME_1` … `KITESIM_TOKEN_NAME_20`：对应的可选账户名称。
- `KITESIM_TOKENS`：本地简写，支持 JSON 数组或逗号、分号、换行分隔，且不能超过 500 字节。
- `KITESIM_TOKEN`：向后兼容的单账户配置；所有来源会合并并按 Token 去重。
- `DASHBOARD_ACCESS_KEY`：你自己生成的控制台访问口令，至少 12 个字符。
- `SMS_CACHE_ENCRYPTION_KEY`：Blob 短信缓存的 AES-256-GCM 密钥，必须是 32 字节 Base64；只放服务端环境变量。
- `SMS_CACHE_TTL_SECONDS`：短信缓存有效时间，默认 20 秒，允许范围 5 到 300 秒。

EdgeOne 当前将单个环境变量值限制为 500 字节，因此多账户应拆成编号变量，而不是把大量 Token 塞进一个值。具体限制以 [EdgeOne Makers Limits and Quotas](https://pages.edgeone.ai/document/limits-and-quotas) 为准。

本地少量账户也可以把 `KITESIM_TOKENS` 配置成单行 JSON：

```json
[{"name":"主号码","token":"TOKEN_1"},{"name":"备用号码","token":"TOKEN_2"}]
```

也支持逗号、分号或换行分隔的简写，网页会自动显示为“账户 1”“账户 2”：

```text
TOKEN_1,TOKEN_2,TOKEN_3
```

Token 只用于服务端构造 Scrapling 客户端。浏览器只收到匿名 `accountId`、账户名称，以及把账户、订单、号码绑定在一起的 `messageHandle`。该句柄由对应 Token 在服务端签名，不能用于还原 Token，也不能换到另一个账户或号码。某个账户读取失败时，接口会继续返回其他健康账户，并在页面显示局部失败提醒。

生成控制台访问口令：

```bash
python -c 'import secrets; print(secrets.token_urlsafe(32))'
```

不要把真实值写入代码、`.env.example`、README 或 Git。曾经粘贴到聊天、日志或截图里的 Kitesim Token 应先在 Kitesim 侧刷新。

## 本地运行

EdgeOne Python Cloud Functions 使用 Python 3.10，建议本地也使用相同版本：

```bash
cd /Volumes/UGREEN/Code/Test/kitesim-scrapling-client
python3.10 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements-web.txt
npm ci
```

先设置服务端变量：

```bash
export KITESIM_TOKEN_1='TOKEN_1'
export KITESIM_TOKEN_NAME_1='主号码'
export KITESIM_TOKEN_2='TOKEN_2'
export KITESIM_TOKEN_NAME_2='备用号码'
unset KITESIM_TOKENS KITESIM_TOKEN
export DASHBOARD_ACCESS_KEY='你生成的控制台访问口令'
export SMS_CACHE_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export SMS_CACHE_TTL_SECONDS='20'
```

开发模式使用两个终端：

```bash
# 终端 1：API，Vite 会把 /api 代理到这里
source .venv/bin/activate
python app.py

# 终端 2：React 热更新服务
npm run dev
```

打开 <http://127.0.0.1:5173>。网页里输入的是 `DASHBOARD_ACCESS_KEY`，不是 `KITESIM_TOKEN`。

普通 Vite + Flask 本地模式会直接调用 Python `/api/messages`，不连接 Blob。需要验证 Node 缓存路由、Blob 命名空间和 `X-SMS-Cache` 响应头时，请使用已关联 EdgeOne 项目的 `edgeone makers dev`。

需要验证与 EdgeOne 静态产物一致的本地效果时：

```bash
npm run build
export KITESIM_WEB_PORT=8088
.venv/bin/python app.py
```

打开 <http://127.0.0.1:8088>。

使用 EdgeOne 本地运行时验证：

```bash
edgeone makers dev
```

默认地址通常为 <http://localhost:8088>。

## EdgeOne Preview 部署

先确认使用 Global 还是 China 项目，两套账号和项目互相隔离。部署前检查：

```bash
edgeone -v
edgeone whoami
```

如果使用已创建的 Direct Upload 项目：

```bash
edgeone makers link
edgeone makers env set KITESIM_TOKEN_1 "$KITESIM_TOKEN_1"
edgeone makers env set KITESIM_TOKEN_NAME_1 "$KITESIM_TOKEN_NAME_1"
edgeone makers env set KITESIM_TOKEN_2 "$KITESIM_TOKEN_2"
edgeone makers env set KITESIM_TOKEN_NAME_2 "$KITESIM_TOKEN_NAME_2"
edgeone makers env set DASHBOARD_ACCESS_KEY "$DASHBOARD_ACCESS_KEY"
edgeone makers env set KITESIM_REQUEST_TIMEOUT "12"
edgeone makers env set SMS_CACHE_ENCRYPTION_KEY "$SMS_CACHE_ENCRYPTION_KEY"
edgeone makers env set SMS_CACHE_TTL_SECONDS "20"
edgeone makers deploy -e preview
```

如果使用 Git 集成项目，把仓库连接到 Makers，并在 Preview 环境设置同名变量；框架可选择 React/Vite，或使用下列显式设置：

```text
根目录      ./
安装命令    npm ci
构建命令    npm run build
输出目录    dist
Node.js     22.11.0
```

这些值已经写入 `edgeone.json`。先部署非生产分支验证，再合并生产分支。

Preview 上线后至少检查：

```text
GET  /
GET  /assets/<构建后的 CSS 文件名>
GET  /api/health
POST /api/session
GET  /api/orders?status=2
POST /api/messages
```

在 Preview 连续请求同一个号码和同一组显示选项时，还应检查响应头：首次通常是 `X-SMS-Cache: miss`，有效期内再次请求应为 `X-SMS-Cache: hit`。未配置或无法使用 Blob 时会显示 `X-SMS-Cache: bypass`，请求仍会回退到 Python 原接口。

`edgeone.json` 将 Python Cloud Function 最大执行时间设为 60 秒。Direct Upload 项目如果不应用该字段，请在 Makers 控制台的 Function 设置中配置相同值。

还要在 Preview 域名上检查 `Content-Security-Policy`、`X-Frame-Options`、`X-Content-Type-Options` 和 `Cache-Control`。当前 EdgeOne CLI 1.6.8 的本地静态服务没有模拟 `edgeone.json` 的 CDN 响应头，因此这项必须以 Preview 部署的 HTTPS 响应为准。

## 命令行使用

当前命令行客户端仍使用单个 `KITESIM_TOKEN`；多 Token 聚合由网页 API 提供：

```bash
python kitesim_scrapling.py
python kitesim_scrapling.py --all-status
python kitesim_scrapling.py --show-code --show-sms
python kitesim_scrapling.py --json
```

默认查询“使用中”状态的最新号码，并掩码验证码和短信长数字。

## 测试

测试全部使用假 Token、假号码和假短信，不访问真实 Kitesim：

```bash
npm run typecheck
npm run lint
npm test
npm run build
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m py_compile app.py kitesim_scrapling.py cloud-functions/api/index.py cloud-functions/_shared/*.py
```

## 已知边界

- 控制台口令保存在浏览器当前标签页的 `sessionStorage`，关闭标签页后清除。
- EdgeOne 部署会把成功的短信响应变体加密后写入 Blob；缓存键只保存业务标识的 SHA-256 摘要，不保存 Kitesim Token、控制台口令或明文号码。
- Blob 没有对象 TTL。`SMS_CACHE_TTL_SECONDS` 决定缓存是否可继续使用，过期内容会在该号码再次访问时被覆盖；长期不再访问的加密对象需要在 Blob 中手动清理。
- 轮换 `SMS_CACHE_ENCRYPTION_KEY` 后旧缓存无法解密，会自动按未命中处理并在再次访问时覆盖。
- 多 Token 查询最多接受 20 个去重后的账户；默认状态最多并发读取 8 个账户，每个账户只产生一次订单请求。
- “全部状态”一次最多查询 8 个账户，并对每个账户产生 5 次读取；单次上游超时会自动压到 8 秒以内，以适配当前 60 秒函数时限。超过 8 个账户时请切换到单一状态筛选。
- 多账户模式下，短信请求必须同时携带订单响应中的匿名 `accountId` 和签名 `messageHandle`；单账户旧客户端可继续省略这两个字段。
- Kitesim 列表接口的筛选码与订单返回的 `orderStatus` 不是同一套顺序；转换统一由 `ORDER_FILTER_TO_UPSTREAM_STATUS` 维护，不要直接删除该映射。
- `Scrapling` 0.4.12 的静态 Fetcher 会导入 Playwright 类型，但不会启动浏览器。本项目提供仅限静态 Fetcher 的最小类型兼容层，从函数依赖中移除完整 Playwright 包；不要把它改成 `DynamicFetcher` 或 `StealthyFetcher`。
- Preview 验证通过前不要发布到 Production，也不要绑定正式域名。
