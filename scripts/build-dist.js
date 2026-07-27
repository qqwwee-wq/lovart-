// scripts/build-dist.js —— 打包分发版本
// 用法: node scripts/build-dist.js
// 产出: dist/lovart-app.zip
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'lovart-app');

const log = (...a) => console.log('[build]', ...a);

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

// 1. 清理 + 创建目录
log('清理 dist...');
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// 2. 复制源码
log('复制 src/ ...');
copyDir(path.join(ROOT, 'src'), path.join(DIST, 'src'));

// 3. 复制 scripts
log('复制 scripts/ ...');
copyDir(path.join(ROOT, 'scripts'), path.join(DIST, 'scripts'), ['node_modules', 'build-dist.js']);

// 4. 复制 public/
log('复制 public/ ...');
copyDir(path.join(ROOT, 'public'), path.join(DIST, 'public'));

// 5. 复制 node_modules (太大了，只复制需要的)
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

:: 检查 node 是否可用
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js！请先安装 Node.js
    echo 下载地址: https://nodejs.org/dist/v18.20.0/node-v18.20.0-win-x64.zip
    pause
    exit /b 1
)

:: 检查 playwright 浏览器
node -e "require('child_process').execSync('npx playwright install chromium',{stdio:'inherit',cwd:__dirname})" 2>nul

:: 启动
echo [启动] 浏览器将自动打开 http://localhost:3000
node scripts/launcher.js
pause
`;

fs.writeFileSync(path.join(DIST, 'start.bat'), bat);
log('✅ 生成 start.bat');

// 11. 生成使用说明
const readme = `Lovart 慢速生图控制台 v0.2.0
================================

使用方法:
  1. 安装 Node.js 18+: https://nodejs.org
  2. 双击 start.bat 启动
  3. 浏览器自动打开 → 点击"登录 Lovart" → 在弹出浏览器中登录
  4. 登录完成后点击"开始处理"

文件说明:
  .env            - 配置文件（钉钉、生图参数等，可编辑）
  data/cookies.json - Lovart 登录态（自动生成）
  logs/           - 运行日志
  C:\\lovart生图结果\\ - 生成图片输出目录

注意事项:
  - 首次运行需要联网下载 Chromium 浏览器组件（~150MB）
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
