// scripts/setup-browser.js —— 首次运行：下载 Chromium 浏览器
// 运行方式: node scripts/setup-browser.js
'use strict';
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE_EXE = process.execPath; // 当前运行的 node.exe

console.log('[setup] 正在下载 Chromium 浏览器（首次运行需要，~150MB，请耐心等待）...');
try {
  // 方法1: 用 npx playwright install chromium
  const npxPath = path.join(ROOT, 'node_modules', '.bin', 'npx.cmd');
  const playwrightBin = path.join(ROOT, 'node_modules', '.bin', 'playwright.cmd');

  if (require('fs').existsSync(playwrightBin)) {
    console.log('[setup] 使用 playwright CLI...');
    execSync(`"${playwrightBin}" install chromium`, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || '' },
    });
  } else {
    // 方法2: 用 node 直接调用 playwright-core 的安装
    console.log('[setup] 使用 playwright-core 安装...');
    execSync(`"${NODE_EXE}" node_modules/playwright-core/cli.js install chromium`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  }
  console.log('[setup] ✅ Chromium 安装成功');
} catch (e) {
  console.error('[setup] ❌ Chromium 安装失败:', e.message);
  console.error('[setup] 请检查网络连接，或手动运行: npx playwright install chromium');
  process.exit(1);
}
