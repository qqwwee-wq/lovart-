// src/server.js —— HTTP 服务 + Web UI + API
// 启动后访问 http://localhost:3000 查看控制台
'use strict';

const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const config = require('./config');
const { makeLogger } = require('./logger');
const { runOnce, getPool } = require('./orchestrator');
const auth = require('./lovart/auth');

const log = makeLogger('server');
const app = express();
app.use(express.json({ limit: '1mb' }));

// ---- 全局状态 ----
const serverStartTime = Date.now();
let lastRunResult = null;
let lastMessage = '';
let loginInProgress = false;
let loginMessage = '';

// ---- 静态文件 ----
const publicDir = path.resolve(__dirname, '..', 'public');
app.use(express.static(publicDir));

// ---- 简单鉴权（可选） ----
function authMiddleware(req, res, next) {
  if (!config.http.authToken) return next();
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token !== config.http.authToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ==================== 前端页面 ====================
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ==================== 健康检查 ====================
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ==================== 状态查询 ====================
app.get('/api/status', authMiddleware, (_req, res) => {
  const pool = getPool();
  const snap = pool.snapshot();
  res.json({
    pool: snap,
    workerCount: config.business.workerCount,
    running: !!lastRunResult?.runId && snap.queue.running + snap.queue.pending > 0,
    lastRunId: lastRunResult?.runId || null,
    lastMessage,
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
  });
});

// ==================== 配置查询（脱敏） ====================
app.get('/api/config', authMiddleware, (_req, res) => {
  const cookies = auth.load();
  res.json({
    port: config.http.port,
    host: config.http.host,
    workerCount: config.business.workerCount,
    outputDir: config.downloadsDir,
    lovartHomeUrl: config.lovart.homeUrl,
    dingtalk: {
      baseId: config.dingtalk.baseId,
      productTableId: config.dingtalk.productTableId,
      hasAppKey: !!config.dingtalk.appKey,
      hasAppSecret: !!config.dingtalk.appSecret,
      operatorUserId: config.dingtalk.operatorUserId || '(未设置)',
    },
    business: {
      lovartGenTimeoutSec: config.business.lovartGenTimeoutSec,
      promptRetryMax: config.business.promptRetryMax,
      promptRetryBaseMs: config.business.promptRetryBaseMs,
      promptRetryMult: config.business.promptRetryMult,
    },
    log: {
      level: config.log.level,
      dir: config.log.dir,
    },
    cookieCount: cookies?.cookies?.length || 0,
    cookiesFile: config.lovart.cookiesFile,
  });
});

// ==================== 登录相关 ====================
app.get('/api/login/status', (_req, res) => {
  const exists = auth.exists();
  let cookies = null;
  let cookieCount = 0;
  try {
    cookies = auth.load();
    cookieCount = cookies?.cookies?.length || 0;
  } catch (_) {}

  res.json({
    loggedIn: exists && cookieCount > 0,
    inProgress: loginInProgress,
    message: loginMessage,
    cookieCount,
    file: config.lovart.cookiesFile,
  });
});

app.post('/api/login', async (_req, res) => {
  if (loginInProgress) {
    return res.json({ status: 'busy', message: '登录流程已在进行中，请等待完成' });
  }
  loginInProgress = true;
  loginMessage = '正在启动浏览器...';

  // 在子进程中运行 manual-login.js
  const loginScript = path.resolve(__dirname, '..', 'scripts', 'manual-login.js');
  const child = spawn('node', [loginScript], {
    cwd: path.resolve(__dirname, '..'),
    detached: true,
    shell: true,
    stdio: 'ignore',
  });

  child.on('close', (code) => {
    loginInProgress = false;
    if (code === 0) {
      loginMessage = '登录完成，cookies 已保存';
      log.info('登录流程完成');
    } else {
      loginMessage = `登录流程异常退出 (code=${code})`;
      log.warn(`登录流程退出 code=${code}`);
    }
  });

  child.on('error', (err) => {
    loginInProgress = false;
    loginMessage = '启动浏览器失败: ' + err.message;
    log.error('启动登录浏览器失败', { err: err.message });
  });

  child.unref();
  loginMessage = '浏览器已打开，请在浏览器中完成登录后关闭窗口';
  res.json({ status: 'launched', message: loginMessage });
});

// ==================== 任务控制 ====================
app.post('/api/tasks/run', authMiddleware, async (req, res) => {
  const { limit, dryRun, uploadTest } = req.body || {};

  // 检查登录状态
  if (!auth.exists()) {
    return res.status(400).json({ error: '请先登录 Lovart（点击"登录 Lovart"按钮）' });
  }

  try {
    lastMessage = dryRun
      ? 'dry-run 模式运行中...'
      : (uploadTest ? 'upload 测试模式运行中...' : '正式运行中...');

    // 异步启动任务，不阻塞响应
    const runPromise = runOnce({
      trigger: 'web-ui',
      limit: limit || null,
      dryRun: !!dryRun,
      uploadTest: !!uploadTest,
    });

    // 立即返回，任务在后台执行
    runPromise.then((result) => {
      lastRunResult = result;
      const ok = result.completed || 0;
      const fail = result.failed || 0;
      lastMessage = result.error
        ? `异常: ${result.error}`
        : `完成: ${result.tasks || 0} 个任务, ${ok} 成功, ${fail} 失败`;
      log.info('web-ui 任务完成', { runId: result.runId, ok, fail });
    }).catch((e) => {
      lastMessage = `异常: ${e.message}`;
      log.error('web-ui 任务异常', { err: e.message });
    });

    res.json({
      status: 'started',
      runId: 'pending',
      message: lastMessage,
      tasks: 0,
    });
  } catch (e) {
    lastMessage = `启动失败: ${e.message}`;
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tasks/stop', authMiddleware, async (_req, res) => {
  try {
    const pool = getPool();
    await pool.stop();
    lastMessage = '已停止';
    lastRunResult = null;
    log.info('web-ui 用户手动停止');
    res.json({ stopped: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 优雅退出 ====================
async function shutdown(sig) {
  log.info(`收到 ${sig}，优雅退出...`);
  try {
    const pool = getPool();
    await pool.stop();
  } catch (e) {
    log.warn('pool.stop 失败', { err: e.message });
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ==================== 启动 ====================
const server = app.listen(config.http.port, config.http.host, () => {
  log.info(`============================================`);
  log.info(`  Lovart 慢速生图控制台`);
  log.info(`  http://${config.http.host}:${config.http.port}`);
  log.info(`============================================`);
  log.info(`  Worker 数: ${config.business.workerCount}`);
  log.info(`  输出目录: ${config.downloadsDir}`);
  log.info(`  Cookies: ${auth.exists() ? '✅ 已登录' : '❌ 未登录（点击 UI 登录按钮）'}`);
  log.info(`============================================`);
});

module.exports = { app, server };
