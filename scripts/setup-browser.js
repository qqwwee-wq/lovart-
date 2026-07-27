// scripts/setup-browser.js —— 首次运行：下载/检测 Chromium 浏览器
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const NODE_EXE = process.execPath;

// Playwright 浏览器缓存目录
const PLAYWRIGHT_CACHE = process.env.PLAYWRIGHT_BROWSERS_PATH
  || path.join(os.homedir(), '.cache', 'ms-playwright');

console.log('[setup] Playwright 浏览器缓存目录:', PLAYWRIGHT_CACHE);

// ---- Step 1: 检查是否已安装 ----
function isChromeInstalled() {
  if (!fs.existsSync(PLAYWRIGHT_CACHE)) return false;
  // 查找 chromium-* 目录
  const dirs = fs.readdirSync(PLAYWRIGHT_CACHE).filter(d => d.startsWith('chromium-'));
  for (const d of dirs) {
    const chromeExe = path.join(PLAYWRIGHT_CACHE, d, 'chrome-win', 'chrome.exe');
    if (fs.existsSync(chromeExe)) {
      console.log('[setup] ✅ Chromium 已安装:', chromeExe);
      return true;
    }
  }
  return false;
}

if (isChromeInstalled()) {
  console.log('[setup] Chromium 已就绪，跳过下载。');
  process.exit(0);
}

// ---- Step 2: 尝试自动下载 ----
console.log('[setup] Chromium 未安装，开始下载（~150MB，需联网）...');
console.log('[setup] 如果卡住，设置国内镜像后重试:');
console.log('[setup]   set PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/');
console.log('[setup] 然后重新运行: node scripts\\setup-browser.js');
console.log('');

let success = false;

// 方法1: playwright CLI
try {
  const playwrightBin = path.join(ROOT, 'node_modules', '.bin', 'playwright.cmd');
  if (fs.existsSync(playwrightBin)) {
    console.log('[setup] 使用 playwright install chromium...');
    const r = spawnSync(`"${playwrightBin}"`, ['install', 'chromium'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      timeout: 10 * 60 * 1000, // 10分钟超时
    });
    if (r.status === 0) success = true;
  }
} catch (e) { console.log('[setup] 方法1失败:', e.message); }

// 方法2: npx playwright
if (!success) {
  try {
    console.log('[setup] 使用 npx playwright install chromium...');
    const r = spawnSync('npx', ['playwright', 'install', 'chromium'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      timeout: 10 * 60 * 1000,
    });
    if (r.status === 0) success = true;
  } catch (e) { console.log('[setup] 方法2失败:', e.message); }
}

if (success && isChromeInstalled()) {
  console.log('[setup] ✅ Chromium 安装完成');
  process.exit(0);
}

// ---- Step 3: 下载失败，给手动指引 ----
console.log('');
console.log('========================================');
console.log('  浏览器组件安装失败');
console.log('========================================');
console.log('');
console.log('手动安装步骤：');
console.log('  1. 打开 https://playwright.dev/docs/browsers');
console.log('  2. 下载 chromium-win64 或手动运行:');
console.log('     npx playwright install chromium');
console.log('  3. 将下载的 chromium 放到:');
console.log('     ' + PLAYWRIGHT_CACHE);
console.log('  4. 重新双击 start.bat');
console.log('');
process.exit(1);
