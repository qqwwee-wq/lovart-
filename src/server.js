// src/server.js —— HTTP 服务（只用于健康检查 + 状态查询）
// 注意：本项目主要用 CLI 跑（scripts/run-all.js 或 scripts/daemon.js）
//       HTTP 服务只是辅助监控端点
'use strict';

const express = require('express');
const config = require('./config');
const { makeLogger } = require('./logger');
const { getPool } = require('./orchestrator');

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
  res.json({ pool: pool.snapshot(), workerCount: config.business.workerCount });
});

// 优雅退出
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

const server = app.listen(config.http.port, config.http.host, () => {
  log.info(`HTTP 服务已启动 http://${config.http.host}:${config.http.port}`);
  log.info(`端点: GET /health | GET /status`);
  log.info(`Worker 数: ${config.business.workerCount}`);
  log.info(`运行批跑: node scripts/run-all.js`);
  log.info(`守护进程: node scripts/daemon.js --interval=5`);
});

module.exports = { app, server };