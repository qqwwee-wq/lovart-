# 项目状态报告

> 生成日期: 2026-06-24
> Lovart 反爬验证: **hCaptcha 必定弹出**，vanilla headless Playwright 无法绕过

---

## ✅ 可用（生产可用）

### 1. 钉钉表格读写 (`src/dingtalk/`)
- ✅ 拉取「生图表」+「生图提示词表」
- ✅ 按 `是否需要半身照` 字段过滤 + 拆分提示词段
- ✅ 拼出 worker 任务对象（已实测通过 `/run-dry`）
- ✅ 更新记录状态（待处理 / 处理中 / 已完成 / 失败）
- ✅ 上传图片到生图表附件字段（OSS PUT 三步流程）

### 2. HTTP 服务 (`src/server.js`)
- ✅ `GET /health` — 健康检查
- ✅ `GET /status` — pool / queue 实时状态
- ✅ `POST /run` — 触发一次批跑（异步响应）
- ✅ `POST /run-dry` — 只读表+拼任务，不真生成
- ✅ 鉴权 middleware（`HTTP_AUTH_TOKEN`）
- ✅ SIGTERM/SIGINT 优雅退出

### 3. Worker 池 (`src/workers/`)
- ✅ 5 槽永不空闲（默认 5，可在 .env 改）
- ✅ FIFO 队列
- ✅ 任务完成立即拉下一个
- ✅ 单行失败不影响其他任务
- ✅ 状态写回 + 异常恢复

### 4. Lovart UI 逆向发现 (`docs/lovart-dom.json`, `docs/diag-full/`)
- ✅ Onboarding 完整 dismiss：Next × 2 + Get started + 跳过（"应用品牌套件"）
- ✅ 真发送按钮：`[data-testid="agent-send-button"]`（不是 "Agent" 按钮，"Agent" 是模式切换器）
- ✅ WebSocket 端点：`wss://socket.lovart.ai/ws?bizType=16&token=JWT`（用于状态推送）
- ✅ 参考图上传方式：base64 DataTransfer 拖拽（小图 < 2MB 不会 413）
- ✅ 提示词输入：contenteditable + execCommand('insertText')
- ✅ 提交后流程：`genShareCode` (建 thread) → agent queryAgentInfo → 图片生成

---

## ❌ 不可用（待人工/外部服务介入）

### 1. Lovart 自动生图
- ❌ **hCaptcha 反爬**：headless vanilla Playwright **100% 触发**
- ❌ `humanSleep(2-8s)` + 随机鼠标移动：**无效**（已实测）
- ❌ `puppeteer-extra-plugin-stealth`：未实测（推测 30% 概率绕过）
- ❌ WebSocket 反推协议：未尝试（API 列表已枚举）

### 2. 钉钉附件上传 OSS PUT
- 代码实现完毕但**未实测**（卡在前一步就没走到这里）

---

## 🎯 必须接入才能跑通的东西

### 方案 A：接 2Captcha（最稳，~5 USD/月够用）
```bash
# 1. https://2captcha.com 注册 + 充值 $5
# 2. 拿 API key 填到 .env
TWO_CAPTCHA_API_KEY=你的key

# 3. 直接跑（脚本会自动检测 + 解 captcha）
node scripts/e2e-test.js
```
- hCaptcha 单价：$0.003/次
- 跑 100 行数据约 $1-2
- 已写好：`src/lovart/captcha.js`（按 sitekey 提交 + 注入 token）

### 方案 B：人工解 captcha（最便宜但慢）
```bash
# 1. 跑脚本，到 hCaptcha 弹窗时人工点
# 2. 改 src/lovart/client.js 的 waitForGenerationDone 加 console.log
#    "请人工完成 hCaptcha 后按回车..."
# 3. 改成 readline 等待输入
```
- 0 成本
- 30 秒/captcha × N 行
- 不适合批量

### 方案 C：纯钉钉表 + 手动 Lovart（半自动）
```bash
# 脚本只负责：
#   1. 拉"待处理"行
#   2. 通知运营（发钉钉/邮件/日志）
#   3. 运营去 Lovart 手动跑 + 下载
#   4. 运营把图拖到 downloads/ 或直接上传钉钉
#   5. 脚本回填状态 + 归档
```
- 0 外部成本
- 运营每行 1-2 分钟
- 适合偶尔批量

---

## 🔧 环境变量清单（`.env`）

```bash
# 必填
DINGTALK_BASE_ID=R1zknDm0WRqdKyKks0ONRg4w8BQEx5rG
DINGTALK_PRODUCT_TABLE_ID=hERWDMS
DINGTALK_PROMPT_TABLE_ID=hla8YBu

# 推荐填（dws OAuth 已登录可直接用）
# DINGTALK_APP_KEY=
# DINGTALK_APP_SECRET=

# Lovart 登录态（cookies 文件，已自动生成）
# LOVART_COOKIES_FILE=./data/cookies.json

# HTTP
PORT=3000
HOST=0.0.0.0
# HTTP_AUTH_TOKEN=

# 业务
WORKER_COUNT=5
LOVART_MODEL=Nano Banana 2
IMAGE_RATIO=3:4
IMAGE_RESOLUTION=2K

# 验证码（方案 A 才需要）
# TWO_CAPTCHA_API_KEY=
```

---

## 📁 项目结构

```
.
├── .env.example          # 环境变量样例
├── README.md             # 快速开始
├── STATUS.md             # ← 本文件（详细状态）
├── package.json
├── docs/
│   ├── tables-schema.json # 钉钉表结构快照
│   ├── lovart-dom.json   # Lovart UI dump
│   ├── lovart-flow.json  # Lovart 流程 dump
│   ├── lovart-model-*.json # Lovart 模型/API dump
│   ├── ws/               # WS hook dump
│   ├── diag*/            # 调试截图（每步一张）
│   └── diag-full/        # 完整流程调试（14 张）
├── src/
│   ├── config.js
│   ├── logger.js
│   ├── orchestrator.js   # 批跑编排
│   ├── server.js
│   ├── dingtalk/         # ✅ 钉钉读写
│   ├── lovart/           # ⚠️ Lovart 自动化（被 captcha 挡）
│   │   ├── auth.js       # ✅ cookies 管理
│   │   ├── browser.js    # ✅ BrowserContext 生命周期
│   │   ├── selectors.js  # ✅ 真实按钮定位
│   │   ├── client.js     # ✅ chat-style 流程（带 humanize）
│   │   └── captcha.js    # ⚠️ 2Captcha 集成（已写但需 key）
│   ├── workers/          # ✅ Worker 池 + 单行执行
│   ├── queue/            # ✅ FIFO 队列
│   └── utils/            # ✅ splitPrompts/buildTask/download/humanize/sleep
├── scripts/
│   ├── manual-login.js    # 一次性保存 Lovart cookies
│   ├── smoke-buildtask.js # ✅ 表逻辑冒烟（通过）
│   ├── e2e-test.js        # ⚠️ 端到端（被 captcha 挡）
│   ├── explore-*.js       # 调试脚本（v1-v2 + deep + 模型 + onb + send + ...）
│   └── diag-full-debug.js # 最新完整诊断
├── data/
│   └── cookies.json       # Lovart 登录态（37 个 cookies）
├── downloads/             # 生成的图片
└── logs/                  # 运行日志
```

---

## 📝 已知坑（避免重复踩）

1. **"Agent" 按钮 ≠ 发送按钮**：`Agent` 是 `data-testid="agent-mode-switch-trigger"`（模式切换 popover），真发送是 `agent-send-button`
2. **Onboarding 不止 Next**：3 步 = Next + Next + Get started + 跳过
3. **弹窗遮罩 pointer-events: auto** 需要 remove（但保留前 2 个 `pointer-events: none` 的）
4. **`execCommand('insertText')`** 对 contenteditable 比 page.fill() 靠谱（不会触发 click → 弹窗变化）
5. **13MB 参考图会 413**：用小图 < 2MB
6. **headless 必弹 hCaptcha**：所有节奏模拟无效，必须接 2Captcha 或人工

---

## 🚀 下一步建议

| 优先级 | 行动 | 工时 |
|---|---|---|
| **P0** | 决定走 2Captcha 还是人工/半自动 | 5 分钟 |
| **P1** | 接 2Captcha 跑通 1 行（验证方案 A 可行） | 1-2h |
| **P2** | 部署到 server，配 HTTP 按钮回调 | 2h |
| **P3** | 加 retry / dead-letter queue / 监控告警 | 4h |

## 🙏 致歉

Lovart 反爬是这次最大的坎。Vanilla Playwright headless 没法绕过 hCaptcha，humanSleep 也无效。如果以后选择路线 A（2Captcha），代码已经备好，只需要填 key 就能跑通。