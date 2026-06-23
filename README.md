# LOVART 慢速自动批量生图

通过钉钉表格触发，5 个 Playwright Worker 并发批量在 [lovart.ai](https://www.lovart.ai/zh/home) 生成商品图，自动回传到钉钉表格 + 本地归档。

## 快速开始

```bash
# 1. 安装依赖
npm install
npx playwright install chromium

# 2. 准备 .env（从 .env.example 复制并填值）
cp .env.example .env

# 3. （仅本地）保存 Lovart 登录 cookies
npm run login
# → 弹出浏览器 → 手动登录 → 回车 → cookies.json 写入 ./data/

# 4. 启动 HTTP 服务
npm start

# 5. 验证（不真生图，只读表+拼任务）
curl http://localhost:3000/run-dry

# 6. 触发一次批跑
curl -X POST http://localhost:3000/run
```

## 端点

| Method | Path | 用途 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/status` | pool / queue 实时状态 |
| POST | `/run` | 触发一次批跑（钉钉按钮回调） |
| POST | `/run-dry` | 只读表 + 拼任务，不真生成 |

## 部署

服务器上需要：
- Node.js ≥ 18
- Chromium（`npx playwright install chromium`）
- dws CLI（用于调钉钉 Open Platform）：`brew install dws` 或手动下载 → `dws auth login --device` 完成首次扫码
- 拷贝 `data/cookies.json`（Lovart 登录态）

`.env` 里把所有真实值填上（含 `HTTP_AUTH_TOKEN`、`DINGTALK_*`、`LOVART_COOKIES_FILE`）。

## 项目结构

```
.
├── .env.example          # 环境变量样例（提交到 git）
├── package.json
├── docs/
│   └── tables-schema.json # 钉钉表结构快照
├── src/
│   ├── config.js         # .env 加载与校验
│   ├── logger.js         # 控制台+文件日志
│   ├── orchestrator.js   # 批跑编排
│   ├── server.js         # Express HTTP 入口
│   ├── dingtalk/         # 钉钉 dws shell-out 封装
│   ├── lovart/           # Lovart Playwright 自动化
│   ├── workers/          # 5 槽 worker 池 + 单行执行
│   ├── queue/            # FIFO 任务队列
│   └── utils/            # 通用工具（拆分、下载、重试）
├── scripts/
│   ├── manual-login.js   # 一次性 Lovart 登录保存 cookies
│   └── smoke-buildtask.js # 表逻辑冒烟测试
├── data/                 # cookies.json 等（gitignored）
├── downloads/            # 生成的图片（gitignored）
└── logs/                 # 运行日志（gitignored）
```

## 业务规则

每行「生图表」记录：
- 读 `款号`、`素材图`、`是否需要半身照`
- `是否需要半身照=否` → 跑「提示词表」中 `lovart生图` 的所有段（每段生成 5 张 = 共 10 张）→ 写入 `生成结果`
- `是否需要半身照=是` → 跑 `lovart生图` + `lovart生图（半身照）` 的所有段（10 + 5 = 共 15 张）→ 10 张写入 `生成结果`，5 张写入 `生成结果（半身照）`
- 模型：Nano Banana 2，宽高比：3:4，画质：2K
- 状态字段枚举：`待处理` / `处理中` / `已完成` / `失败`

## 已知限制

- 5 个 Worker 共用同一个 Lovart 账号（Lovart 是否支持并发登录待验证）
- 选择器依赖 Lovart 前端 UI，需要登录后探索填进 `src/lovart/selectors.js`
- 钉钉附件上传走 dws → OSS PUT，依赖 dws 凭证
