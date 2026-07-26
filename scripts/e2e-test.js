// scripts/e2e-test.js —— 端到端测试 1 行（款号 955039718012，needHalf=false，2 段 prompt → 10 张图）
// 用法：
//   node scripts/e2e-test.js                  # 默认段间间隔（.env PROMPT_INTERVAL_SEC=60s）
//   node scripts/e2e-test.js --interval=2m   # 覆盖段间间隔
// ⚠️ 会真生成图、消耗 Lovart 积分，请确认 cookies 是你自己的账号再跑
'use strict';

const { runOnce, getPool } = require('../src/orchestrator');

function parseDuration(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)(s|m|h)?$/i);
  if (!m) throw new Error(`--interval 格式不对：${s}`);
  const n = parseFloat(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  return Math.round(unit === 's' ? n * 1000 : unit === 'm' ? n * 60_000 : n * 3_600_000);
}

(async () => {
  const args = process.argv.slice(2);
  const intervalArg = args.find((a) => a.startsWith('--interval='));
  const promptIntervalMs = intervalArg ? parseDuration(intervalArg.split('=')[1]) : null;
  console.log('[e2e] 启动单行测试');
  const result = await runOnce({ trigger: 'e2e-test', promptIntervalMs });
  console.log('[e2e] 结果:', JSON.stringify(result, null, 2));
  await getPool().stop();
  process.exit(0);
})().catch((e) => {
  console.error('[e2e] ❌', e.message);
  console.error(e.stack);
  process.exit(1);
});