// scripts/launcher.js —— 启动器：启动 Express 服务 + 自动打开浏览器
// 用法: node scripts/launcher.js
'use strict';

const { exec } = require('child_process');
const path = require('path');

// 加载 .env
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

// 优先使用打包内置的 CloakBrowser Chromium（离线可用）
const cloakDir = path.resolve(__dirname, '..', '.cloakbrowser');
if (fs.existsSync(cloakDir)) {
  process.env.CLOAKBROWSER_CACHE_DIR = cloakDir;
  console.log('[launcher] 使用内置 CloakBrowser Chromium:', cloakDir);
}

const config = require('../src/config');
const { makeLogger } = require('../src/logger');
const log = makeLogger('launcher');

async function main() {
  // 1. 检查 Playwright 浏览器是否已安装
  log.info('检查 Playwright 浏览器...');
  try {
    const { launch } = await import('cloakbrowser');
    // 快速验证浏览器能否启动（headless 测试）
    const browser = await launch({ headless: true });
    await browser.close();
    log.info('✅ Playwright 浏览器就绪');
  } catch (e) {
    log.warn('⚠️  Playwright 浏览器可能未安装，首次运行需要联网下载');
    log.warn('   如果启动后登录失败，请手动执行: npx playwright install chromium');
  }

  // 2. 启动 Express 服务
  const { server } = require('../src/server');
  const url = `http://localhost:${config.http.port}`;

  log.info('============================================');
  log.info(`  控制台: ${url}`);
  log.info('  按 Ctrl+C 退出');
  log.info('============================================');

  // 3. 自动打开浏览器
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) log.warn('自动打开浏览器失败，请手动访问 ' + url);
    else log.info('✅ 浏览器已打开');
  });
}

main().catch((e) => {
  console.error('启动失败:', e.message);
  process.exit(1);
});
