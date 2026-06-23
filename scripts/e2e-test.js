// scripts/e2e-test.js —— 端到端测试 1 行（款号 955039718012，needHalf=false，2 段 prompt → 10 张图）
// 用法：node scripts/e2e-test.js
// ⚠️ 会真生成图、消耗 Lovart 积分，请确认 cookies 是你自己的账号再跑
'use strict';

const { runOnce, getPool } = require('../src/orchestrator');

(async () => {
  console.log('[e2e] 启动单行测试');
  const result = await runOnce({ trigger: 'e2e-test' });
  console.log('[e2e] 结果:', JSON.stringify(result, null, 2));
  await getPool().stop();
  process.exit(0);
})().catch((e) => {
  console.error('[e2e] ❌', e.message);
  console.error(e.stack);
  process.exit(1);
});