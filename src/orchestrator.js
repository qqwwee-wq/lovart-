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

/**
 * 主入口：拉数据 → 拼任务 → 入队
 * @param {object} opts
 * @param {string} [opts.trigger='manual']
 * @param {string} [opts.recordId] 指定只跑某一行（保留以兼容老逻辑）
 * @param {number} [opts.limit] 最多处理 N 行
 * @param {boolean} [opts.dryRun] 只读表+拼任务，不真生成
 */
async function runOnce({ trigger = 'manual', recordId = null, limit = null, dryRun = false } = {}) {
  if (_runningRunId) {
    log.warn(`已有运行中的批次 ${_runningRunId}，拒绝新触发`);
    return { runId: _runningRunId, skipped: true };
  }
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  _runningRunId = runId;
  log.info(`[${runId}] 开始批次 (trigger=${trigger} recordId=${recordId || 'ALL'} limit=${limit || '∞'} dryRun=${dryRun})`);

  try {
    // 1) 拉数据
    const [productRows, promptRows] = await Promise.all([
      fetchProductRows(),
      fetchPromptRows(),
    ]);

    // 2) 拼任务
    let tasks = buildTasks(
      productRows,
      promptRows,
      config.dingtalk.fields.product,
      config.dingtalk.fields.prompt,
    );

    // 如果指定 recordId，过滤只跑这一行
    if (recordId) {
      tasks = tasks.filter((t) => t.recordId === recordId);
      log.info(`[${runId}] 指定 recordId=${recordId}，过滤后 ${tasks.length} 个任务`);
    }

    // limit
    if (limit && tasks.length > limit) {
      log.info(`[${runId}] 限制处理 ${limit} 行（实际有 ${tasks.length}）`);
      tasks = tasks.slice(0, limit);
    }

    log.info(`[${runId}] 拼出 ${tasks.length} 个可执行任务`);

    if (tasks.length === 0) {
      log.info(`[${runId}] 没有可执行任务，结束`);
      return { runId, tasks: 0, completed: 0, failed: 0 };
    }

    // dry-run 模式只返回任务清单
    if (dryRun) {
      log.info(`[${runId}] dry-run 模式，跳过实际生成`);
      return { runId, tasks: tasks.length, dryRun: true, sample: tasks.slice(0, 3).map((t) => ({ recordId: t.recordId, styleNo: t.styleNo, prompts: t.prompts.length })) };
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
