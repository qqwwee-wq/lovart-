// scripts/run-all.js —— CLI 一键跑所有「待处理」行
// 用法：
//   node scripts/run-all.js           # 跑一次所有待处理行
//   node scripts/run-all.js --limit=5 # 最多跑 5 行
//   node scripts/run-all.js --dry     # 只读表不真生成
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { runOnce } = require('../src/orchestrator');
const { getPool } = require('../src/orchestrator');
const config = require('../src/config');
const { makeLogger } = require('../src/logger');

const log = makeLogger('cli.run-all');

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;

  log.info('============================================');
  log.info(' LOVART 批量生图 CLI');
  log.info('============================================');
  log.info(`  待跑行数限制: ${limit || '不限制'}`);
  log.info(`  模式: ${dryRun ? 'dry-run（不真生成）' : '正式跑'}`);
  log.info(`  并发 worker: ${config.business.workerCount}`);
  log.info('');

  const startTs = Date.now();

  try {
    const result = await runOnce({
      trigger: 'cli',
      limit,
      dryRun,
    });

    const duration = Math.round((Date.now() - startTs) / 1000);
    log.info('');
    log.info('============================================');
    log.info(' ✅ 完成');
    log.info('============================================');
    log.info(`  耗时: ${duration}秒`);
    log.info(`  处理行数: ${result.tasks || 0}`);
    log.info(`  成功: ${result.completed || 0}`);
    log.info(`  失败: ${result.failed || 0}`);
    if (result.runId) log.info(`  runId: ${result.runId}`);
    if (result.error) log.error(`  错误: ${result.error}`);
  } catch (e) {
    log.error('CLI 异常:', e.message);
    log.error(e.stack);
    process.exit(1);
  } finally {
    try {
      await getPool().stop();
    } catch (_) {}
    process.exit(0);
  }
}

main();