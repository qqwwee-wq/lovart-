// src/orchestrator.js —— 编排：从钉钉拉数据 → 拼任务 → 入队 → 等待完成
'use strict';

const config = require('./config');
const { makeLogger } = require('./logger');
const { fetchProductRows, fetchPromptRows } = require('./dingtalk/sheets');
const { buildTasks } = require('./utils/buildTask');
const { WorkerPool } = require('./workers/pool');

const log = makeLogger('orchestrator');

let _pool = null;
let _runningRunId = null;

function getPool() {
  if (!_pool) _pool = new WorkerPool(config.business.workerCount);
  return _pool;
}

/** 主入口：拉数据 → 拼任务 → 入队 */
async function runOnce({ trigger = 'manual' } = {}) {
  if (_runningRunId) {
    log.warn(`已有运行中的批次 ${_runningRunId}，拒绝新触发`);
    return { runId: _runningRunId, skipped: true };
  }
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  _runningRunId = runId;
  log.info(`[${runId}] 开始批次 (trigger=${trigger})`);

  try {
    // 1) 拉数据
    const [productRows, promptRows] = await Promise.all([
      fetchProductRows(),
      fetchPromptRows(),
    ]);

    // 2) 拼任务
    const tasks = buildTasks(
      productRows,
      promptRows,
      config.dingtalk.fields.product,
      config.dingtalk.fields.prompt,
    );
    log.info(`[${runId}] 拼出 ${tasks.length} 个可执行任务`);

    if (tasks.length === 0) {
      log.info(`[${runId}] 没有可执行任务，结束`);
      return { runId, tasks: 0, completed: 0, failed: 0 };
    }

    // 3) 入队 + 等待完成
    const pool = getPool();
    pool.enqueue(tasks);
    await pool.drain();
    const snap = pool.snapshot();
    const completed = snap.queue.doneList.filter((d) => d.status === 'ok').length;
    const failed = snap.queue.doneList.filter((d) => d.status === 'failed').length;
    log.info(`[${runId}] 批次完成`, snap);
    return { runId, tasks: tasks.length, completed, failed };
  } catch (e) {
    log.error(`[${runId}] 批次异常`, { err: e.message, stack: e.stack });
    return { runId, error: e.message };
  } finally {
    _runningRunId = null;
  }
}

module.exports = { runOnce, getPool };
