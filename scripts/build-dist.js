// scripts/build-dist.js —— 打包分发版本（含便携 Node.js）
// 用法: node scripts/build-dist.js
// 产出: dist/lovart-app.zip
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'lovart-app');
const CACHE = path.join(ROOT, 'dist', '.cache');
const NODE_VERSION = 'v18.20.8'; // LTS 版本
const NODE_ZIP = `node-${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP}`;

const log = (...a) => console.log('[build]', ...a);

// 下载便携 Node.js
async function downloadNode() {
  const cacheDir = path.join(CACHE, NODE_VERSION);
  const zipPath = path.join(CACHE, NODE_ZIP);
  const nodeDir = path.join(DIST, 'node');

  // 如果 dist 中已有，跳过
  if (fs.existsSync(path.join(nodeDir, 'node.exe'))) {
    log('✅ 便携 Node.js 已存在，跳过下载');
    return;
  }

  // 如果缓存中有 zip，直接用
  if (!fs.existsSync(zipPath)) {
    fs.mkdirSync(CACHE, { recursive: true });
    log(`下载 Node.js ${NODE_VERSION} 便携版...`);
    log(`   ${NODE_URL}`);

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(zipPath);
      https.get(NODE_URL, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          // 跟随重定向
          https.get(res.headers.location, (res2) => {
            const total = parseInt(res2.headers['content-length'] || '0');
            let downloaded = 0;
            res2.on('data', (chunk) => {
              downloaded += chunk.length;
              if (total > 0 && downloaded % (10 * 1024 * 1024) < 65536) {
                log(`   ${(downloaded / 1024 / 1024).toFixed(0)}MB / ${(total / 1024 / 1024).toFixed(0)}MB`);
              }
            });
            res2.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
            res2.on('error', reject);
          });
        } else {
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
          res.on('error', reject);
        }
      }).on('error', reject);
    });
    log(`✅ 下载完成: ${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`);
  } else {
    log('使用缓存的 Node.js 便携版');
  }

  // 解压到 dist (只解压必要文件)
  log('解压 Node.js 便携版...');
  fs.mkdirSync(nodeDir, { recursive: true });

  // 用 PowerShell 解压，只提取 node.exe 和必要的模块
  execSync(
    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${path.join(DIST, '_tmp_node')}' -Force"`,
    { stdio: 'pipe' },
  );

  // 复制整个 node 目录
  const extracted = path.join(DIST, '_tmp_node', path.basename(NODE_ZIP, '.zip'));
  if (fs.existsSync(extracted)) {
    copyDir(extracted, nodeDir);
    fs.rmSync(path.join(DIST, '_tmp_node'), { recursive: true });
  }
  log('✅ Node.js 便携版就绪');
}

function copyDir(src, dst, exclude = []) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    if (exclude.includes(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      copyDir(s, d, exclude);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// ========== 主流程 ==========
(async () => {
// 1. 清理 + 创建目录
log('清理 dist...');
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// 1.5 下载便携 Node.js（无需同事自己装）
await downloadNode();

// 2. 复制源码
log('复制 src/ ...');
copyDir(path.join(ROOT, 'src'), path.join(DIST, 'src'));

// 3. 复制 scripts
log('复制 scripts/ ...');
copyDir(path.join(ROOT, 'scripts'), path.join(DIST, 'scripts'), ['node_modules', 'build-dist.js']);

// 4. 复制 public/
log('复制 public/ ...');
copyDir(path.join(ROOT, 'public'), path.join(DIST, 'public'));

// 5. 复制 node_modules
log('复制 node_modules/ ...（可能需要几分钟）');
copyDir(path.join(ROOT, 'node_modules'), path.join(DIST, 'node_modules'));

// 6. 复制 package.json
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(DIST, 'package.json'));

// 7. 复制 .env
const envSrc = path.join(ROOT, '.env');
if (fs.existsSync(envSrc)) {
  fs.copyFileSync(envSrc, path.join(DIST, '.env'));
  log('✅ 复制 .env');
} else {
  log('⚠️  .env 不存在！');
}

// 8. 创建 data/ 目录 + 复制 cookies
fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });
const cookiesSrc = path.join(ROOT, 'data', 'cookies.json');
if (fs.existsSync(cookiesSrc)) {
  fs.copyFileSync(cookiesSrc, path.join(DIST, 'data', 'cookies.json'));
  log('✅ 复制 data/cookies.json');
} else {
  log('⚠️  data/cookies.json 不存在（首次运行需登录）');
}

// 9. 创建 logs/ 目录
fs.mkdirSync(path.join(DIST, 'logs'), { recursive: true });

// 10. 生成 start.bat
const bat = `@echo off
chcp 65001 >nul
title Lovart 慢速生图控制台
cd /d "%~dp0"

echo ==========================================
echo   Lovart 慢速生图控制台
echo ==========================================
echo.
echo 首次使用:
echo   1. 需要安装 Node.js (https://nodejs.org)
echo   2. 首次运行会自动安装浏览器组件（需联网）
echo   3. 点击控制台的"登录 Lovart"按钮完成登录
echo.
echo 启动中...
echo.

:: 使用内置便携 Node.js
set "NODE=%~dp0node\node.exe"
if not exist "%NODE%" (
    echo [错误] 未找到 node.exe！请重新解压 zip 包
    pause
    exit /b 1
)

echo [首次运行] 安装浏览器组件（需联网，~150MB）...
"%NODE%" -e "require('child_process').execSync('\"%NODE%\" node_modules\\npm\\bin\\npx-cli.js playwright install chromium',{stdio:'inherit',cwd:__dirname})" 2>nul

:: 启动
echo [启动] 浏览器将自动打开 http://localhost:3000
"%NODE%" scripts/launcher.js
pause
`;

fs.writeFileSync(path.join(DIST, 'start.bat'), bat);
log('✅ 生成 start.bat');

// 11. 生成使用说明
const readme = `Lovart 慢速生图控制台 v0.2.1
================================

使用方法:
  1. 解压到任意目录
  2. 双击 start.bat 启动
  3. 浏览器自动打开 → 点击"登录 Lovart" → 在弹出浏览器中登录
  4. 登录完成后点击"开始处理"
  5. 首次运行会自动下载浏览器组件（~150MB，需联网）

无需安装任何东西！便携 Node.js 已内置。

文件说明:
  .env                - 配置文件（钉钉、生图参数等，可编辑）
  node/               - 便携 Node.js 运行时（已内置，无需安装）
  data/cookies.json   - Lovart 登录态（自动生成）
  logs/               - 运行日志
  C:\\lovart生图结果\\  - 生成图片输出目录

注意事项:
  - 首次运行需要联网下载 Chromium 浏览器组件（~150MB，仅一次）
  - Cookies 有效期约 30-90 天，过期后需重新登录
  - 不要关闭命令行窗口，关闭即停止服务
`;

fs.writeFileSync(path.join(DIST, 'README.txt'), readme);
log('✅ 生成 README.txt');

// 12. 打包 zip
log('打包 zip...');
const zipName = 'lovart-app.zip';
const zipPath = path.join(ROOT, 'dist', zipName);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

try {
  execSync(`powershell -Command "Compress-Archive -Path '${DIST}\\*' -DestinationPath '${zipPath}' -Force"`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const sizeMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  log('============================================');
  log(`✅ 打包完成: dist/${zipName} (${sizeMB} MB)`);
  log(`   解压后双击 start.bat 即可使用`);
  log('============================================');
} catch (e) {
  log('❌ zip 打包失败:', e.message);
  log('   手动打包: 将 dist/lovart-app/ 文件夹压缩为 zip');
}

log('完成');
})().catch(e => { console.error('[build] 异常:', e.message); process.exit(1); });
