# 家庭日历（family-calendar）

**免常驻设备**的家庭重要日子提醒系统：GitHub Actions 定时计算（农历/万年历）+ Cloudflare Workers 微信网关（iLink 官方协议）+ Pages 在线管理。零服务器、零常驻进程、几乎零成本。

```
┌─────────────────────────────┐     ┌──────────────────────────────────────────┐
│  GitHub（私有仓库）           │     │  Cloudflare 边缘（24h 在线，免常驻）        │
│                             │     │                                          │
│  notify.yml cron 每日 3 次   │     │  Worker 网关 (frankie0736 方案)           │
│  └─ notify.py (sxtwl 农历)   │ ──► │  POST /api/v1/notify (Bearer API Key)    │
│                             │ HTTP │  └─ Durable Object (60s alarm 轮询)      │
│  data/events.json ← 数据源   │     │  └─ D1 加密存 token/会话                  │
│  .state/ 去重+补发+自提交保活  │     │  └─ R2 临时图片                           │
│                             │     │       │ iLink 官方协议                    │
│  deploy-site.yml → Pages    │     │       ▼                                  │
│  add-event.yml ← issue 导入  │     │  ilinkai.weixin.qq.com                   │
└─────────────────────────────┘     └──────────────┬───────────────────────────┘
                                                   ▼
                                    微信「微信ClawBot」会话 → 手机微信
                                    （爸爸账号 / 妈妈账号 各自绑定，各自接收）
```

## 核心组件

| 组件 | 作用 | 常驻要求 |
|---|---|---|
| GitHub Actions `notify.yml` | cron 定时（00:05 / 08:30 / 20:30），跑农历换算、生成消息 | ❌ 无（托管 runner，跑完即销毁） |
| `scripts/notify.py` | 数据读取 + sxtwl 农历/万年历 + 5 天窗口匹配 + 推送 + 去重 + outbox 补发 | ❌ 无 |
| **CF Worker 网关** | 微信 iLink 协议网关：接收 webhook、调 sendmessage、60s 轮询保会话 | ✅ Cloudflare 平台保证（非你的设备） |
| Cloudflare D1 | 用户/绑定/token 加密存储 | ✅ CF 托管 |
| GitHub Pages | 事件展示页 + 添加入口 | ❌ 无（静态） |
| `add-event.yml` | 带 `event` 标签的 issue 自动写入 events.json | ❌ 无 |

> **关键点**：iLink 会话的"常驻"由 Cloudflare Durable Object 的 alarm 定时器承担（每 60s 自动唤醒轮询），你不需要任何 24h 设备。

## 目录结构

```
family-calendar/
├── .github/workflows/
│   ├── notify.yml        # 每日 3 时段定时通知 + 手动兜底
│   ├── deploy-site.yml   # push 自动部署 Pages
│   └── add-event.yml     # issue 导入事件
├── data/events.json      # 唯一数据源（事件 + 多用户 bot 配置）
├── scripts/
│   ├── notify.py         # 农历引擎 + 5 天窗口 + 推送（cf/weclawbot/generic 三模式）
│   ├── validate.py       # 数据校验
│   ├── render_site.py    # 生成 Pages
│   └── add_from_issue.py # issue → events.json
├── site/                 # 页面模板 + 添加模板
├── .state/               # 去重状态 + outbox（提交到仓库 = 保活）
└── requirements.txt
```

## 事件数据模型（历法单选 + 5 天窗口）

```json
{
  "id": "mom-birthday",
  "name": "妈妈生日",
  "person": "妈妈",
  "calendar": "lunar",            // 只填一个：lunar 农历 / solar 阳历
  "month": 8, "day": 15,
  "leap_policy": "leap_first",    // 闰月策略：leap_first / leap_both / normal
  "birth_year": 1962,             // 可选，用于算年龄
  "targets": ["dad:self"],        // 可选；不填则发给所有 bot
  "message": "🎂 $name（$person）农历生日，今年 $age 岁"
}
```

- 模板变量：`$name` `$person` `$age` `$days` `$date` `$lunar`
- 播报窗口固定 5 天：每次推送 = 当天 + 未来 5 天内全部事件（按倒计时排序）
- 农历支持闰月（自动判定闰月生日）、阳历 2/29（平年按 2/28）

## 多用户（多微信）配置

CF 网关是多用户架构：**每个家人注册一个账号、绑定自己的微信 ClawBot、拿自己的 API Key**。`settings.bots` 里每个 bot 对应一个家人：

```json
"settings": {
  "default_bot": "dad",
  "bots": [
    { "id": "dad", "mode": "cf", "api": "https://YOUR-WORKER.workers.dev",
      "token": "${CF_GATEWAY_KEY_DAD}", "default_targets": ["self"] },
    { "id": "mom", "mode": "cf", "api": "https://YOUR-WORKER.workers.dev",
      "token": "${CF_GATEWAY_KEY_MOM}", "default_targets": ["self"] }
  ]
}
```

- 事件没写 `targets` → 推给所有 bot（全家都收到）
- 事件写 `targets: ["dad:self"]` → 只推给爸爸
- CF 模式下 target 固定为 `self`（发到绑定者自己的微信 ClawBot 会话）

## 部署步骤

### Part A：部署 CF 网关（✅ 已完成 2026-08-11）

网关已部署到你的 Cloudflare 账号（goujy459），资源：
- **Worker**: `https://today.gojia.cloud`（/health ✅ /docs ✅）
- **D1**: `wx-clawbot-notify-webhook`（APAC 区域，迁移已应用）
- **R2**: `wx-clawbot-notify-webhook-images`（7 天清理规则已加）
- **管理员邀请**：已写入 D1（30 天有效）

**👉 管理员注册链接**（现在就能打开，一次性使用，30 天有效）：

```
https://today.gojia.cloud/register?invite=wxi_5d1a20480d5e4c33b7166041128545f4e63582506c575f8a
```

注册后登录 `/dashboard`：
1. 点 **扫码绑定** → 手机微信扫码确认
2. 给新 Bot 发一条 `init` 激活
3. 状态变 `active` 后 **生成 API Key**（给爸爸/妈妈各建一个账号，各绑各的微信）

> 网关代码在本仓库 `gateway/` 目录，之后改网关 push 即自动重新部署（deploy-gateway.yml）。

### Part B：对接 GitHub 仓库

1. 把本目录推到 **private** 仓库（`https://github.com/MARYCOMPLEX/today`）
2. 仓库 Settings → Secrets 添加：
   - `CF_GATEWAY_KEY_DAD` / `CF_GATEWAY_KEY_MOM`：各家人的网关 API Key（dashboard 生成）
   - `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`：Actions 自动部署网关用
   - `BETTER_AUTH_SECRET` / `MASTER_KEY`：网关运行时 secrets（同本地 .dev.vars）
   - Worker 地址已写进 `data/events.json` 的 `bots[].api`
3. 手动跑 `Actions → 家庭日历通知 → send_test=true` 验证
4. cron 每日 00:05 / 08:30 / 20:30（北京时间）自动运行

### Part C：Pages 在线管理

1. 仓库 Settings → Pages → 源选 `GitHub Actions`
2. 页面展示所有事件 + 最近一次日期 + 倒计时
3. 「添加/更新条目」→ 打开预填 JSON 的 issue → 打 `event` 标签 → 自动导入并关闭

## 推送链路与可靠性

```
notify.py --run --slot 08:30
  → 读取 events.json（5 天窗口过滤）
  → 按时段去重（同一事件同一时段只推一次）
  → 按 bot 聚合（dad / mom）
  → POST https://YOUR-WORKER.workers.dev/api/v1/notify
      Authorization: Bearer <API Key>
      {"text": "📅 家庭日历 · 2026-08-11（农历 六月廿九）\n• 🎂 今天：妈妈生日..."}
  → CF Gateway DO → iLink sendmessage → 微信
```

- **推送失败** → 进 `.state/outbox.json`，下次 cron 自动补发（一天 3 次天然重试）
- **网关侧**：有静默时段合并、指数退避重试（12 次上限）、幂等键，进一步兜底
- **iLink 失效**（-14）→ 网关自动标记 reauth_required，需重新扫码（网页一键）

## 保活机制汇总

| 层 | 保活方式 |
|---|---|
| GitHub cron | `.state/` 每日自动提交（git-auto-commit），防止 60 天不活跃暂停 |
| CF 网关 | Durable Object alarm 每 60s tick（平台保证 24h），token 加密存 D1 重启不丢 |
| 通知可靠性 | 本地 outbox 补发 + 网关队列重试 + 幂等键 |

## 本地测试

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/validate.py
python scripts/notify.py --run --slot 08:30 --dry-run   # 只看不发
```

## 注意事项

- **隐私**：家人生日 = 敏感数据，仓库必须 **private**；token 全部走 GitHub Secrets，不落库
- **灰度风险**：iLink 为腾讯官方开放但标注"灰度中"，可用性以官方为准；网关项目 0★ 建议先小范围自测
- **worker.dev 访问**：国内访问 worker.dev 可能不稳，可绑自定义域名（域名需备案规则自行确认）
- **免费额度**：Workers 免费计划含 D1/R2/DO 免费层，家庭用量（每日 3 次推送 + 60s 轮询）预计在免费额度内；超量费用极低
- **多账号**：每个家人一个 CF 账号绑定，互不干扰；封号风险用专门微信号
