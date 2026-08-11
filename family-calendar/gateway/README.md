# wx-clawbot-notify-webhook

基于 Cloudflare Workers 和腾讯微信 iLink Bot API 的多用户通知 Gateway。

用户通过邀请码注册，每人绑定一个微信 ClawBot、管理自己的 API Key。其他程序只需调用统一 Webhook，即可向 API Key 所属用户的微信发送文字或图片通知，调用方不能指定收件人。

## 功能

- 邮箱 + 密码登录，邀请码注册，管理员创建邀请
- 每个用户绑定一个微信 ClawBot
- API Key 可随时查看、复制和 Rotate
- 文字通知，原样透传 Markdown
- JPEG、PNG、WebP 图片通知，最大 20 MiB；SVG 明确拒绝
- `urgent: true` 立即推送
- 每用户自定义静默时段，默认 UTC+8 00:00–07:00
- 静默时段内普通文字合并发送，图片临时存入 R2 后延迟发送
- 可选 `Idempotency-Key`
- 公开的纯 Markdown API 文档：`GET /docs`

已在微信客户端验证标题、粗体、斜体、粗斜体、删除线、引用、列表、任务列表、链接、表格、分隔线、行内代码和 fenced code block。

## 架构

```text
调用方
  │ Bearer API Key
  ▼
Cloudflare Worker ── D1（用户、会话、绑定、设置、队列元数据）
  │
  ├── shared Durable Object（轮询、发送、队列调度）
  ├── R2（仅临时保存待发送图片）
  └── 腾讯 iLink API / 微信 CDN
```

D1 是业务状态唯一事实源。Durable Object 不保存业务真相；R2 不保存历史消息，图片发送成功后立即删除。

## API

部署后打开：

```text
https://your-domain.example/docs
```

该地址公开返回 `text/markdown`，Base URL 根据当前 Host 自动生成，适合人和 AI 直接读取。登录后台也可复制同一份 Markdown 文档。

文字通知：

```bash
curl -X POST "https://your-domain.example/api/v1/notify" \
  -H "Authorization: Bearer $WX_NOTIFY_API_KEY" \
  -H "Idempotency-Key: deploy:api:42" \
  -H "Content-Type: application/json" \
  -d '{"text":"**Deploy complete**","urgent":true}'
```

图片通知：

```bash
curl -X POST "https://your-domain.example/api/v1/notify/image" \
  -H "Authorization: Bearer $WX_NOTIFY_API_KEY" \
  -H "Idempotency-Key: monitor:screenshot:42" \
  -F "image=@./screenshot.webp" \
  -F "urgent=true"
```

瞬时 iLink/CDN 网络错误最多自动尝试 3 次。静默时段队列失败后按指数退避再次投递，连续失败 12 次后标记为最终失败；重试始终复用同一幂等标识。

## 自部署

### 1. 准备环境

- Bun 1.3+
- Cloudflare 账号
- 已登录 Wrangler：`bunx wrangler login`
- 一个可选的自定义域名

```bash
git clone https://github.com/frankie0736/wx-clawbot-notify-webhook.git
cd wx-clawbot-notify-webhook
bun install
cp .dev.vars.example .dev.vars
cp wrangler.example.jsonc wrangler.jsonc
```

`.dev.vars` 和 `wrangler.jsonc` 已被 gitignore。前者保存 secret 和本地管理员信息；后者保存你的 Cloudflare Account/资源 ID。

### 2. 创建 Cloudflare 资源

```bash
bunx wrangler d1 create wx-clawbot-notify-webhook
bunx wrangler r2 bucket create wx-clawbot-notify-webhook-images
```

把命令返回的 Account ID、D1 Database ID 和 R2 bucket 名称填入 `wrangler.jsonc`。

为临时图片增加 7 天兜底清理规则：

```bash
bunx wrangler r2 bucket lifecycle add \
  wx-clawbot-notify-webhook-images \
  delete-orphaned-pending-images \
  pending/ \
  --expire-days 7 \
  --force
```

### 3. 配置本地变量

编辑 `.dev.vars`：

```dotenv
BETTER_AUTH_SECRET=<至少 32 字符随机值>
MASTER_KEY=<32 random bytes 的 base64>
PUBLIC_ORIGIN=https://your-domain.example
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=
```

可用以下命令生成前两个值：

```bash
openssl rand -base64 32
openssl rand -base64 32
```

`ADMIN_PASSWORD` 初始留空；bootstrap 注册脚本会生成强随机密码并仅写回本地 `.dev.vars`。

### 4. 迁移、secret 和部署

```bash
bun run db:migrate:remote
bun run secrets:push
bun run deploy
```

`secrets:push` 只上传 `BETTER_AUTH_SECRET` 和 `MASTER_KEY`，不会上传管理员邮箱或密码。

如果使用自定义域名，请在 Cloudflare Worker 中绑定域名，并确保 `.dev.vars` 的 `PUBLIC_ORIGIN` 与实际 origin 完全一致。

### 5. 创建首个管理员

自动创建管理员账号：

```bash
bun run bootstrap:admin
bun run bootstrap:register-admin
```

第一条命令在远程 D1 创建一枚仅限 `ADMIN_EMAIL` 的一次性管理员邀请，并把链接保存在 gitignored `.local/bootstrap-admin-invite`。第二条命令消费邀请、生成密码、验证登录，并把密码写入本地 `.dev.vars`。

也可以只运行 `bootstrap:admin`，然后手动打开邀请链接注册。

### 6. 绑定微信

1. 使用 `.dev.vars` 中的管理员邮箱和密码登录 `/dashboard`。
2. 点击“扫码绑定”，用微信扫码并确认。
3. 给新 Bot 发送一条 `init`。
4. 等待状态变为 `active`，通常不超过一分钟。
5. 在后台生成 API Key。

### 7. 验证

```bash
bun run check
bun run cf:dry-run
curl https://your-domain.example/health
curl https://your-domain.example/docs
```

本地开发：

```bash
bun run db:migrate:local
bun run dev
# 另一个终端
bun run smoke:local
```

## 数据与安全边界

- API Key：SHA-256 哈希用于鉴权，AES-GCM 密文用于用户登录后再次查看
- 微信 `bot_token` / `context_token`：AES-GCM 加密后存 D1
- 管理员密码：Better Auth 哈希存储；本地明文只在 gitignored `.dev.vars`
- 图片：按 magic bytes 校验，只接受 JPEG/PNG/WebP，最大 20 MiB
- 日志：不记录密码、API Key、微信 Token、AES key、上传 URL 或邀请 Token
- iLink 返回 `-14` 时标记 `reauth_required`，用户必须重新扫码

## 开发

项目约束见 [AGENTS.md](./AGENTS.md)。`CLAUDE.md` 是指向同一文件的符号链接。

```bash
bun run check
bun run cf:dry-run
```

## 协议与许可

iLink 实现参考腾讯 MIT 许可的 `@tencent-weixin/openclaw-weixin@2.4.6`。详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。使用前请自行确认并遵守微信 ClawBot/iLink 的服务条款。

本项目使用 [MIT License](./LICENSE)。
