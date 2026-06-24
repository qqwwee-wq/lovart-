// scripts/test-single-row.js —— 测单行处理（2 worker 跑款号 955039718012 的 2 个 prompt）
'use strict';

const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[single-row]', ...a);

(async () => {
  const { runOnce } = require('../src/orchestrator');
  const result = await runOnce({
    trigger: 'test-single-row',
    recordId: '7Gtfo83ZWU', // 款号 955039718012 (needHalf=false → 2 个 prompt)
  });
  console.log('[test-single-row] 结果:', JSON.stringify(result, null, 2));
  // 等 worker 完成
  const { getPool } = require('../src/orchestrator');
  await getPool().stop();
  process.exit(0);
})().catch((e) => {
  console.error('[test-single-row] ❌', e.message);
  console.error(e.stack);
  process.exit(1);
});