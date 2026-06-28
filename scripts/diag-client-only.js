// scripts/diag-client-only.js —— 直接调 client.js runRow，绕过 orchestrator
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const config = require('../src/config');
const { runRow } = require('../src/lovart/client');

const log = (...a) => console.error('[diag-only]', ...a);

(async () => {
  log('构造假 task');
  const task = {
    recordId: '7Gtfo83ZWU',
    styleNo: '955039718012',
    modelImage: { url: 'https://example.com/dummy.png', filename: 'dummy.png' },
    prompts: [
      {
        taskType: 'lovart生图',
        text: '1.生成5张不同的淘宝主图姿势...',
        folder: 'p1-test',
        writeField: 'szTnEwE',
      },
    ],
  };

  try {
    log('开始调 runRow...');
    const result = await runRow('W1', task, {});
    log('✅ 成功', JSON.stringify(result));
  } catch (e) {
    log('❌ 失败', e.message);
  }
  process.exit(0);
})();