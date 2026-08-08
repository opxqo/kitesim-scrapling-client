<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Kitesim Relay 多账户只读信号工作台">
</p>

<p align="center">
  <code>React 19 + TypeScript</code> · <code>EdgeOne Functions</code> · <code>Python 3.10 + Scrapling</code> · <code>EdgeOne Blob</code>
</p>

<p align="center">
  <a href="https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Fopxqo%2Fkitesim-scrapling-client&project-name=kitesim-relay&root-directory=.%2F&install-command=npm%20ci&build-command=npm%20run%20build&output-directory=.%2Fdist&env=KITESIM_LOGIN_EMAIL_1%2CKITESIM_LOGIN_EMAIL_2%2CKITESIM_LOGIN_EMAIL_3%2CKITESIM_LOGIN_PASSWORD%2CKITESIM_AUTH_ENCRYPTION_KEY%2CKITESIM_AUTH_BRIDGE_SECRET%2CDASHBOARD_ACCESS_KEY%2CSMS_CACHE_TTL_SECONDS&env-description=Configure%20server-side%20login%20credentials%20and%20independent%20secrets%20before%20deployment">
    <img src="https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg" alt="使用 EdgeOne Makers 一键部署 Kitesim Relay">
  </a>
</p>

Kitesim Relay 将多个 Kitesim 账户的号码、短信和 OTP 汇聚到一张私有工作台。项目只提供读取能力，不创建订单、不发送短信，也不执行支付、退款或账户修改。

## 工作方式

- **账户登录**：服务端从 `KITESIM_LOGIN_EMAIL_1` … `KITESIM_LOGIN_EMAIL_20` 与共享密码读取登录信息。管理员为每个账户人工输入一次图片验证码。
- **凭据保存**：登录产生的 Token 按账户使用 AES-256-GCM 加密，分别写入私有 `kitesim-auth` Blob；密码不写入 Blob，浏览器也不会收到密码或 Token。
- **普通读取**：浏览器只读取号码和短信 Blob 快照。快照为 `hit`、`stale` 或 `empty` 时都不会静默访问 Kitesim。
- **显式刷新**：仅手动刷新或用户主动开启的定时刷新会解密当前可用账户，并用 120 秒有效的 HMAC 签名包调用 Python Origin，然后回写快照。
- **局部容错**：一个账户失效时，其余已登录账户仍可返回；后台会标明需要重新验证的账户。

项目不包含 OCR，也不会绕过验证码。每个账户的 4 位图片验证码必须由管理员识别并输入。

## 本地运行

需要 Node.js 22、Python 3.10 和 EdgeOne CLI。

```bash
npm ci
python3.10 -m venv .venv
source .venv/bin/activate
python -m pip install -r cloud-functions/requirements.txt
cp .env.example .env
```

编辑被 Git 忽略的 `.env`，至少填写登录邮箱、共享密码以及三个独立安全值。然后运行完整的 EdgeOne 本地环境：

```bash
edgeone makers dev
```

打开 CLI 输出的本地地址，粘贴 `DASHBOARD_ACCESS_KEY` 解锁。进入“账户登录”，依次为每个账户获取验证码、人工输入并提交。全部账户完成后，点击工作台刷新按钮才会首次访问 Kitesim 并生成号码/短信快照。

若从旧静态 Token 配置迁移，可运行仓库内脚本。它会删除旧 Token 变量、保留现有账户密码、生成独立控制台口令，并保证 `.env` 权限为 `600`：

```bash
node scripts/configure-local-accounts.mjs first@example.com second@example.com third@example.com
```

脚本不会输出密码、Token 或生成的密钥。

## 环境变量

| 变量 | 要求 | 用途 |
| --- | --- | --- |
| `KITESIM_LOGIN_EMAIL_1` … `KITESIM_LOGIN_EMAIL_20` | 至少 1 个 | 分账户登录邮箱；编号可以不连续 |
| `KITESIM_LOGIN_PASSWORD` | 必填 | 所有已配置账户共用的 Kitesim 密码 |
| `KITESIM_AUTH_ENCRYPTION_KEY` | 必填 | Base64 编码的 32 字节 AES 密钥，用于加密账户 Token Blob |
| `KITESIM_AUTH_BRIDGE_SECRET` | 必填 | 至少 24 字符，签名 Node → Python 的短时多账户载荷 |
| `DASHBOARD_ACCESS_KEY` | 必填 | 独立控制台口令，至少 12 个字符；不要复用 Kitesim 密码 |
| `KITESIM_REQUEST_TIMEOUT` | 可选 | 上游单次请求超时，默认 12 秒 |
| `SMS_CACHE_TTL_SECONDS` | 可选 | 快照新鲜度，默认 20 秒，范围 5–300 秒 |
| `SMS_CACHE_ENCRYPTION_KEY` | 旧版迁移可选 | 仅读取旧 AES 快照；新部署应留空 |

生成独立密钥：

```bash
openssl rand -base64 32  # KITESIM_AUTH_ENCRYPTION_KEY
openssl rand -hex 32     # KITESIM_AUTH_BRIDGE_SECRET
openssl rand -base64 32  # DASHBOARD_ACCESS_KEY
```

本项目不支持任何静态 Kitesim Token 环境变量。运行时 Token 只能由验证码登录生成，并从加密 Blob 通过短时签名桥进入 Python Origin。

## 部署到 EdgeOne

本仓库已通过 `edgeone.json` 声明构建命令、`dist` 输出、Node.js 版本、安全响应头与 Python 函数超时。用户可在 EdgeOne 控制台手动部署，并设置与本地相同的变量名。

使用 CLI 时，先确认账号和项目，再逐项设置变量；不要把真实值写进命令历史共享记录或仓库：

```bash
edgeone -v
edgeone whoami
edgeone makers link
edgeone makers env set KITESIM_LOGIN_EMAIL_1 "$KITESIM_LOGIN_EMAIL_1"
edgeone makers env set KITESIM_LOGIN_PASSWORD "$KITESIM_LOGIN_PASSWORD"
edgeone makers env set KITESIM_AUTH_ENCRYPTION_KEY "$KITESIM_AUTH_ENCRYPTION_KEY"
edgeone makers env set KITESIM_AUTH_BRIDGE_SECRET "$KITESIM_AUTH_BRIDGE_SECRET"
edgeone makers env set DASHBOARD_ACCESS_KEY "$DASHBOARD_ACCESS_KEY"
edgeone makers env set SMS_CACHE_TTL_SECONDS '20'
edgeone makers deploy -e preview
```

为其余账户重复设置编号邮箱。环境变量修改后需要重新部署；验证码登录产生的加密 Token 保存在 Blob，不应放回环境变量。

## 安全边界

- Kitesim 上游业务客户端只发起只读 GET；登录端点仅用于交换短时 Token。
- 浏览器只接收脱敏邮箱提示、稳定 `accountId` 和服务端签名的 `messageHandle`。
- 每个 Token 使用账户专属 Blob 路径和 AES-GCM AAD；修改对应邮箱后旧密文会自动失效。
- Python Origin 不读取静态 Token 配置；缺少、伪造或过期的内部多账户签名包会在访问上游前被拒绝。
- 控制台口令只保存在当前标签页的 `sessionStorage`，关闭标签页后清除。
- 号码、短信和验证码快照是私有 Blob 中的版本化 JSON，必须限制 EdgeOne 项目和存储访问权限。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m py_compile app.py kitesim_scrapling.py cloud-functions/origin/index.py cloud-functions/_shared/*.py
```

测试只使用假账户、假 Token、假号码和假短信，不访问真实 Kitesim。

## 已知边界

- 登录依赖 Kitesim 当前 H5 登录和图片验证码接口；接口字段或风控变化时需要同步适配。
- 登录成功只更新账户 Token，不立即刷新业务数据。
- 定时刷新默认关闭，可选 30 秒、1 分钟或 5 分钟。
- “全部状态”最多同时查询 8 个账户；普通状态最多并发读取 8 个账户。
- Blob 快照不会自动删除，长期废弃对象需要在存储侧手动清理。
