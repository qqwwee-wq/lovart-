# LOVART 慢速自动批量生图

读取钉钉「生图表」里的待处理行，调用 [Lovart](https://www.lovart.ai) chat agent 自动生成商品图，结果回写到钉钉 + 本地归档。

## 快速开始

### 1. 安装

```bash
git clone <repo-url>
cd lovart慢速生图
npm install
cp .env.example .env
# 填 .env 里的钉钉/Lovart 配置
```

### 2. 保存 Lovart 登录态（一次性）

```bash
npm run login
# 浏览器打开 Lovart，手动登录（Google/Apple/邮箱），回车保存 cookies 到 ./data/cookies.json
```

### 3. 跑任务

**一键跑所有「待处理」行：**
```bash
npm run run
# 或：node scripts/run-all.js
```

**先 dry-run（不真生成，只看会跑什么）：**
```bash
npm run run:dry
```

**守护进程（每 5 分钟扫一次）：**
```bash
npm run daemon
# 或：node scripts/daemon.js --interval=5
```

**单次跑然后退出：**
```bash
npm run daemon:once
# 或：node scripts/daemon.js --once
```

**限制条数：**
```bash
node scripts/run-all.js --limit=5
```

### 4. 监控（可选）

```bash
npm start                 # 起 HTTP 服务
curl http://localhost:3000/health
curl http://localhost:3000/status   # worker 池实时状态
```

## 工作流程

```
1. 读钉钉「生图表」+「生图提示词表」
2. 按「是否需要半身照」拼出任务
3. CloakBrowser（隐身 Chromium）注入 cookies + 模拟真人节奏
4. 打开 Lovart canvas → 跳过 onboarding → 输入 prompt → 发送
5. 等 Lovart 生成 5 张图 → 下载到本地 → 上传回钉钉
6. 更新状态：「待处理」→「处理中」→「已完成」/「失败」
```

## 部署

服务器上需要：
- Node.js ≥ 18
- CloakBrowser binary（首次跑 npm run run 时自动下载到 `~/.cloakbrowser/`）
- dws CLI（用于调钉钉 Open Platform）：`brew install dws` 或手动下载 → `dws auth login --device` 完成首次扫码
- 拷贝 `data/cookies.json`（Lovart 登录态）

`.env` 里把所有真实值填上。

**推荐进程管理（pm2 例子）：**
```bash
pm2 start scripts/daemon.js --name lovart-batch -- --interval=5
pm2 save
pm2 startup
```

## 项目结构

```
.
├── .env.example
├── README.md
├── STATUS.md             # 详细状态报告
├── docs/
│   └── tables-schema.json
├── src/
│   ├── config.js
│   ├── logger.js
│   ├── orchestrator.js   # 批跑编排
│   ├── server.js         # HTTP 监控服务
│   ├── dingtalk/         # 钉钉表读写
│   ├── lovart/           # Lovart 自动化
│   │   ├── auth.js
│   │   ├── browser.js    # CloakBrowser 启动
│   │   ├── selectors.js
│   │   ├── client.js
│   │   └── captcha.js    # 2Captcha 兜底
│   ├── workers/          # Worker 池
│   └── utils/            # 通用工具
├── scripts/
│   ├── manual-login.js   # 保存 Lovart cookies
│   ├── run-all.js        # ← CLI 一键跑
│   ├── daemon.js         # ← 守护进程
│   ├── e2e-test.js
│   └── *.js              # 调试
├── data/
│   └── cookies.json       # Lovart 登录态
└── downloads/             # 生成的图片
```

## 业务规则

每行「生图表」记录：
- 读 `款号`、`素材图`、`是否需要半身照`
- `是否需要半身照=否` → 跑「提示词表」中 `lovart生图` 的所有段（每段生成 5 张 = 共 10 张）→ 写入 `生成结果`
- `是否需要半身照=是` → 跑 `lovart生图` + `lovart生图（半身照）` 的所有段（10 + 5 = 共 15 张）→ 10 张写入 `生成结果`，5 张写入 `生成结果（半身照）`
- 模型：Nano Banana 2，宽高比：3:4，画质：2K
- 状态字段枚举：`待处理` / `处理中` / `已完成` / `失败`

## 已知限制

- ❌ 参考图上传暂时绕开（DataTransfer 会让 Lovart React app 崩）
- ❌ Lovart 账号需有足够积分
- 详见 [STATUS.md](STATUS.md)

## 许可证

仅供学习与个人使用。