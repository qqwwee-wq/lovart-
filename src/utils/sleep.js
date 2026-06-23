// src/utils/sleep.js —— 简单 sleep / retry 工具
'use strict';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 带超时的等待：每 tick 检查一次 condition()，返回 true 即结束
 * @param {() => boolean | Promise<boolean>} condition
 * @param {object} opts {timeoutMs, intervalMs, desc}
 */
async function waitUntil(condition, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const desc = opts.desc || 'waitUntil';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let ok = false;
    try {
      ok = await condition();
    } catch (_) {
      ok = false;
    }
    if (ok) return true;
    await sleep(intervalMs);
  }
  throw new Error(`[${desc}] 超时 ${Math.round(timeoutMs / 1000)}s`);
}

/**
 * 通用重试
 */
async function retry(fn, { tries = 3, delayMs = 1000, onError } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (onError) onError(e, i);
      if (i < tries) await sleep(delayMs);
    }
  }
  throw lastErr;
}

module.exports = { sleep, waitUntil, retry };
