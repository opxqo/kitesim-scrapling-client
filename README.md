# Kitesim Signal Desk

一个使用 Scrapling 静态 `Fetcher` 读取 Kitesim 号码订单和短信验证码的私人网页控制台，同时支持本地 Flask 和 EdgeOne Makers Python Cloud Functions。

所有上游 Kitesim 请求均为 GET，不会发送验证码、创建订单、支付、退款或修改账户。

## 架构

```text
浏览器静态页面
  ├─ POST /api/session       验证控制台访问口令
  ├─ GET  /api/orders        读取号码订单
  └─ POST /api/messages      读取所选号码的短信
              │
              ▼
EdgeOne Python Cloud Function / 本地 Flask
              │
              ▼
Scrapling Fetcher → Kitesim 只读 GET API
```

项目结构：

```text
index.html                         EdgeOne 静态入口
static/                            网页样式与交互
cloud-functions/api/index.py      EdgeOne Flask 入口（外部路由 /api）
cloud-functions/_shared/           本地与云端共用的 API 和 Scrapling 核心
cloud-functions/requirements.txt  Python 3.10 函数依赖
app.py                             本地 Flask 预览服务
kitesim_scrapling.py              命令行客户端
edgeone.json                       安全响应头与函数超时
```

## 安全变量

服务端需要两个不同的变量：

- `KITESIM_TOKEN`：Kitesim AppToken，只用于服务端访问 Kitesim。
- `DASHBOARD_ACCESS_KEY`：你自己生成的控制台访问口令，至少 12 个字符。

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
```

设置变量并启动：

```bash
export KITESIM_TOKEN='更新后的 Kitesim AppToken'
export DASHBOARD_ACCESS_KEY='你生成的控制台访问口令'
python app.py
```

打开 <http://127.0.0.1:8765>，网页里输入的是 `DASHBOARD_ACCESS_KEY`，不是 `KITESIM_TOKEN`。

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
edgeone makers env set KITESIM_TOKEN "$KITESIM_TOKEN"
edgeone makers env set DASHBOARD_ACCESS_KEY "$DASHBOARD_ACCESS_KEY"
edgeone makers env set KITESIM_REQUEST_TIMEOUT "12"
edgeone makers deploy -e preview
```

如果使用 Git 集成项目，把仓库连接到 Makers，并在 Preview 环境设置同名变量；先部署非生产分支验证，再合并生产分支。

Preview 上线后至少检查：

```text
GET  /
GET  /static/styles.css
GET  /api/health
POST /api/session
GET  /api/orders?status=2
POST /api/messages
```

`edgeone.json` 将 Python Cloud Function 最大执行时间设为 60 秒。Direct Upload 项目如果不应用该字段，请在 Makers 控制台的 Function 设置中配置相同值。

还要在 Preview 域名上检查 `Content-Security-Policy`、`X-Frame-Options`、`X-Content-Type-Options` 和 `Cache-Control`。当前 EdgeOne CLI 1.6.8 的本地静态服务没有模拟 `edgeone.json` 的 CDN 响应头，因此这项必须以 Preview 部署的 HTTPS 响应为准。

## 命令行使用

命令行只需要 `KITESIM_TOKEN`：

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
python -m unittest discover -s tests -v
node --check static/app.js
python -m py_compile app.py kitesim_scrapling.py cloud-functions/api/index.py cloud-functions/_shared/*.py
```

## 已知边界

- 控制台口令保存在浏览器当前标签页的 `sessionStorage`，关闭标签页后清除。
- EdgeOne Functions 是无状态运行时，服务端不保存短信、验证码或会话记录。
- “全部状态”会触发 5 次订单列表读取，耗时高于单一状态；默认只读取“使用中”。
- Kitesim 列表接口的筛选码与订单返回的 `orderStatus` 不是同一套顺序；转换统一由 `ORDER_FILTER_TO_UPSTREAM_STATUS` 维护，不要直接删除该映射。
- `Scrapling` 0.4.12 的静态 Fetcher 会导入 Playwright 类型，但不会启动浏览器。本项目提供仅限静态 Fetcher 的最小类型兼容层，从函数依赖中移除完整 Playwright 包；不要把它改成 `DynamicFetcher` 或 `StealthyFetcher`。
- Preview 验证通过前不要发布到 Production，也不要绑定正式域名。
