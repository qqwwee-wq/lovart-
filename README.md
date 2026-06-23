# lovart 慢速生图

通过 Playwright MCP 控制浏览器，自动化操作 Lovart 慢速生图流程。

## 环境要求

- Node.js ≥ 18
- Git

## 已配置 MCP 服务

| 服务 | 用途 |
| --- | --- |
| `playwright` | 浏览器自动化（[Microsoft @playwright/mcp](https://github.com/microsoft/playwright-mcp)） |

首次启动时会自动下载 Chromium。

## 快速开始

```bash
# 1. 拉取仓库
git clone <repo-url>
cd lovart慢速生图

# 2. 安装依赖（如有）
npm install

# 3. 启动 Claude Code，MCP 服务会自动加载
claude
```

## 目录结构

```
.
├── .mcp.json          # MCP 服务配置
├── .gitignore
└── README.md
```

## 常用 Playwright MCP 工具

启动后可在 Claude Code 中调用：

- `browser_navigate` — 打开网页
- `browser_click` — 点击元素
- `browser_screenshot` — 截图
- `browser_fill_form` — 填写表单
- `browser_evaluate` — 执行 JavaScript

## 许可证

仅供学习与个人使用。
