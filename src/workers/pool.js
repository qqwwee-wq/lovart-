// src/workers/pool.js —— 固定 N 槽的 Worker 池，永不空闲
// 行为：
//   - 启动时把传入的所有任务塞入队列
//   - 启动 N 个 worker（每个长期存在），每个 worker 反复从队列取任务执行
//   - 任务完成后立即取下一个
//   - 全部任务完成后所有 worker 进入 idle 等待
'use strict';

const config = require('../config');
const { makeLogger } = require('../logger');
const { TaskQueue } = require('../queue/taskQueue');
const { executeRow } = require('./runOne');

const log = makeLogger('workers.pool');

class WorkerPool {
  constructor(workerCount = config.business.workerCount) {
    this.workerCount = workerCount;
    this.queue = new TaskQueue();
    this.workers = [];
    this._stopRequested = false;
    this._drainResolver = null;
  }

  /**
   * 把新一批任务塞入队列
   * 只启动 min(workerCount, tasks.length) 个 worker（避免一次性开太多浏览器）
   */
  enqueue(tasks) {
    if (!tasks || tasks.length === 0) return;
    log.info(`enqueue ${tasks.length} tasks`, { running: this.workers.length });
    this.queue.push(tasks);
    if (this.workers.length === 0) {
      // 只启动足够数量的 worker（避免为单行任务开 5 个 browser）
      const toStart = Math.min(this.workerCount, tasks.length);
      this._start(toStart);
    } else {
      this._wakeWorkers();
    }
  }

  _start(n) {
    log.info(`启动 ${n} 个 worker（max=${this.workerCount}）`);
    for (let i = 1; i <= n; i++) {
      const label = `W${i}`;
      const w = this._runWorker(label).catch((e) => {
        log.error(`worker ${label} 异常退出`, { err: e.message });
      });
      this.workers.push({ label, promise: w });
    }
  }

  async _runWorker(label) {
    log.info(`[${label}] worker 就绪`);
    while (!this._stopRequested) {
      const task = this.queue.take();
      if (!task) {
        if (this.queue.isEmpty()) {
          // 通知外部 drain
          if (this._drainResolver) {
            const r = this._drainResolver;
            this._drainResolver = null;
            r();
          }
        }
        // 等待唤醒
        await new Promise((r) => {
          this._waiters = this._waiters || [];
          this._waiters.push(r);
        });
        continue;
      }
      try {
        await executeRow(label, task);
        this.queue.markDone(task.recordId, 'ok');
      } catch (e) {
        log.error(`[${label}] 任务执行异常`, { err: e.message, recordId: task.recordId });
        this.queue.markDone(task.recordId, 'failed');
      }
    }
    log.info(`[${label}] worker 退出`);
  }

  _wakeWorkers() {
    if (!this._waiters) return;
    const ws = this._waiters;
    this._waiters = [];
    ws.forEach((r) => r());
  }

  /** 等待队列空 + 所有 worker idle */
  async drain() {
    if (this.queue.isEmpty() && this.workers.length > 0) {
      // 已经在 idle
      return;
    }
    return new Promise((resolve) => {
      this._drainResolver = resolve;
      this._wakeWorkers(); // 触发一次检查
    });
  }

  snapshot() {
    return {
      workers: this.workers.length,
      queue: this.queue.snapshot(),
    };
  }

  async stop() {
    this._stopRequested = true;
    this._wakeWorkers();
    await Promise.allSettled(this.workers.map((w) => w.promise));
    this.workers = [];
  }
}

module.exports = { WorkerPool };
