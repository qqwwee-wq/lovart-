// scripts/daemon.js —— 守护进程，定期跑所有「待处理」行
// 用法：
//   node scripts/daemon.js                 # 默认每 5 分钟跑一次
//   node scripts/daemon.js --interval=10   # 每 10 分钟跑一次
//   node scripts/daemon.js --interval=1    # 每 1 分钟跑一次
//   node scripts/daemon.js --once          # 只跑一次然后退出
//
// 进程管理建议（server 部署时）：
//   pm2 start scripts/daemon.js --name lovart-batch -- --interval=5
//   或 systemd / supervisor / Docker
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { runOnce } = require('../src/orchestrator');
const { getPool } = require('../src/orchestrator');
const config = require('../src/config');
const { makeLogger } = require('../src/logger');

const log = makeLogger('cli.daemon');

function parseArgs() {
  const args = process.argv.slice(2);
  let intervalMin = 5;
  let once = false;

  for (const a of args) {
    if (a.startsWith('--interval=')) {
      intervalMin = parseFloat(a.split('=')[1]);
    } else if (a === '--once') {
      once = true;
    }
  }

  return { intervalMin, once };
}

async function tick() {
  log.info(`[${new Date().toISOString()}] 扫描待处理行...`);
  const start = Date.now();
  try {
    const result = await runOnce({ trigger: 'daemon-tick' });
    const sec = Math.round((Date.now() - start) / 1000);
    log.info(`  完成: ${result.tasks || 0} 任务 / ${sec}s`);
  } catch (e) {
    log.error('  tick 异常:', e.message);
  }
}

async function main() {
  const { intervalMin, once } = parseArgs();
  const intervalMs = intervalMin * 60_000;

  log.info('============================================');
  log.info(' LOVART 守护进程');
  log.info('============================================');
  log.info(`  扫描间隔: ${intervalMin} 分钟`);
  log.info(`  模式: ${once ? '跑一次退出' : '持续运行'}`);
  log.info('');

  // 优雅退出
  let stopping = false;
  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    log.info(`收到 ${sig}，优雅退出...`);
    try {
      await getPool().stop();
    } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 第一次立即跑
  await tick();

  if (once) {
    await getPool().stop();
    return;
  }

  // 周期扫描
  log.info(`等待 ${intervalMin} 分钟后下次扫描...`);
  setInterval(async () => {
    if (stopping) return;
    await tick();
    log.info(`等待 ${intervalMin} 分钟后下次扫描...`);
  }, intervalMs);
}

main().catch((e) => {
  log.error('daemon 异常:', e.message);
  process.exit(1);
});