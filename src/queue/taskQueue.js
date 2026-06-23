// src/queue/taskQueue.js —— 简单的 FIFO 任务队列 + 状态追踪
'use strict';

class TaskQueue {
  constructor() {
    this._pending = [];
    this._running = new Set(); // recordId set
    this._done = []; // {recordId, status, ts}
  }

  push(tasks) {
    for (const t of tasks) {
      if (this._running.has(t.recordId)) continue;
      if (this._pending.find((x) => x.recordId === t.recordId)) continue;
      this._pending.push(t);
    }
  }

  /** 取一个待执行任务（同时标记为 running） */
  take() {
    const t = this._pending.shift();
    if (t) this._running.add(t.recordId);
    return t || null;
  }

  release(recordId) {
    this._running.delete(recordId);
  }

  markDone(recordId, status = 'ok') {
    this._running.delete(recordId);
    this._done.push({ recordId, status, ts: Date.now() });
  }

  /** 重新入队（用于失败重试） */
  requeue(task) {
    this._running.delete(task.recordId);
    this._pending.push(task);
  }

  snapshot() {
    return {
      pending: this._pending.length,
      running: this._running.size,
      done: this._done.length,
      doneList: this._done.slice(-20),
    };
  }

  isEmpty() {
    return this._pending.length === 0 && this._running.size === 0;
  }
}

module.exports = { TaskQueue };
