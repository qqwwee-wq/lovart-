// src/server.js —— HTTP 入口（钉钉按钮回调端点）
// 端点：
//   GET  /health           健康检查
//   GET  /status           当前 pool / queue 状态
//   POST /run              触发一次批跑（钉钉按钮回调）
//   POST /run-dry          干跑：只读表 + 拼任务，不真生成
'use strict';

const express = require('express');
const config = require('./config');
const { makeLogger } = require('./logger');
const { runOnce, getPool } = require('./orchestrator');

const log = makeLogger('server');
const app = express();
app.use(express.json({ limit: '1mb' }));

// 简单鉴权（可选）
function authMiddleware(req, res, next) {
  if (!config.http.authToken) return next();
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token !== config.http.authToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/status', authMiddleware, (_req, res) => {
  const pool = getPool();
  res.json({ pool: pool.snapshot() });
});

// 真正的端点：钉钉按钮调这里
app.post('/run', authMiddleware, async (req, res) => {
  const trigger = req.body?.trigger || 'http';
  log.info('收到 /run 触发', { trigger, body: req.body });
  // 异步响应：先 200，再后台跑（避免钉钉按钮超时）
  res.json({ accepted: true, trigger });
  // 不 await，让 HTTP 立即返回
  runOnce({ trigger }).catch((e) => log.error('runOnce 异常', { err: e.message }));
});

app.post('/run-dry', authMiddleware, async (req, res) => {
  try {
    const configMod = require('./config');
    const { fetchProductRows, fetchPromptRows } = require('./dingtalk/sheets');
    const { buildTasks } = require('./utils/buildTask');
    const [productRows, promptRows] = await Promise.all([
      fetchProductRows(),
      fetchPromptRows(),
    ]);
    const tasks = buildTasks(
      productRows,
      promptRows,
      configMod.dingtalk.fields.product,
      configMod.dingtalk.fields.prompt,
    );
    res.json({
      ok: true,
      productRows: productRows.length,
      promptRows: promptRows.length,
      tasks: tasks.length,
      sample: tasks.slice(0, 2).map((t) => ({
        recordId: t.recordId,
        styleNo: t.styleNo,
        needHalf: t.needHalf,
        promptCount: t.prompts.length,
      })),
    });
  } catch (e) {
    log.error('/run-dry 失败', { err: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 优雅退出
async function shutdown(sig) {
  log.info(`收到 ${sig}，开始优雅退出`);
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

const server = app.listen(config.http.port, config.http.host, () => {
  log.info(`HTTP 服务已启动 http://${config.http.host}:${config.http.port}`);
  log.info(`端点: GET /health | GET /status | POST /run | POST /run-dry`);
  log.info(`并发 worker 数: ${config.business.workerCount}`);
});

module.exports = { app, server };
