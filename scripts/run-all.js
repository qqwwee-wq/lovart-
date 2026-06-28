// scripts/run-all.js —— CLI 一键跑所有「待处理」行
// 用法：
//   node scripts/run-all.js               # 跑一次所有待处理行
//   node scripts/run-all.js --limit=5     # 最多跑 5 行
//   node scripts/run-all.js --dry         # 只读表不真生成
//   node scripts/run-all.js --record=ID   # 只跑指定行
//   node scripts/run-all.js --quiet       # 减少日志
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { runOnce } = require('../src/orchestrator');
const { getPool } = require('../src/orchestrator');
const config = require('../src/config');
const { makeLogger } = require('../src/logger');

const log = makeLogger('cli.run-all');

function banner(s, c = '=') {
  const line = c.repeat(60);
  log.info('');
  log.info(line);
  log.info(`  ${s}`);
  log.info(line);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const quiet = args.includes('--quiet');
  const visible = args.includes('--visible'); // 可见浏览器模式（看操作过程）
  const slowMoArg = args.find((a) => a.startsWith('--slow='));
  const slowMo = slowMoArg ? parseInt(slowMoArg.split('=')[1]) : 0;
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;
  const recordArg = args.find((a) => a.startsWith('--record='));
  const recordId = recordArg ? recordArg.split('=')[1] : null;

  // 安静模式降级日志
  if (quiet) {
    process.env.LOG_LEVEL = 'warn';
  }

  // 可见模式：通过环境变量让 browser.js 用非 headless + 慢动作
  if (visible) {
    process.env.CLOAK_HEADLESS = 'false';
    if (slowMo) process.env.CLOAK_SLOWMO = String(slowMo);
  }

  const startTs = Date.now();

  banner('🚀 LOVART 批量生图 CLI 启动');
  log.info(`  待跑行数限制: ${limit || '不限制'}`);
  log.info(`  模式: ${dryRun ? '🟡 dry-run（不真生成）' : '🟢 正式跑'}`);
  if (visible) log.info(`  👀 可视模式: headless=false${slowMo ? ` slowMo=${slowMo}ms` : ''}`);
  if (recordId) log.info(`  指定行: ${recordId}`);
  log.info(`  并发 worker: ${config.business.workerCount}`);
  log.info(`  输出目录: ${config.downloadsDir}`);
  log.info(`  Lovart URL: ${config.lovart.homeUrl}`);
  log.info('');

  try {
    const result = await runOnce({
      trigger: 'cli',
      recordId,
      limit,
      dryRun,
    });

    const duration = Math.round((Date.now() - startTs) / 1000);
    banner('✅ 完成');
    log.info(`  耗时: ${duration}秒`);
    log.info(`  处理行数: ${result.tasks || 0}`);
    log.info(`  成功: ${result.completed || 0}`);
    log.info(`  失败: ${result.failed || 0}`);
    if (result.runId) log.info(`  runId: ${result.runId}`);
    if (result.error) log.error(`  错误: ${result.error}`);
    if (result.dryRun && result.sample) {
      log.info(`  示例任务:`);
      result.sample.forEach((s) => log.info(`    - recordId=${s.recordId} 款号=${s.styleNo} ${s.prompts}条 prompt`));
    }
  } catch (e) {
    banner('❌ 异常');
    log.error('CLI 异常:', e.message);
    log.error(e.stack);
    process.exit(1);
  } finally {
    banner('🏁 退出');
    try {
      await getPool().stop();
    } catch (_) {}
    process.exit(0);
  }
}

main();