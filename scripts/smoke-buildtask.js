// scripts/smoke-buildtask.js —— 用抓下来的 JSON 跑一遍 buildTask，验证表逻辑
'use strict';

const fs = require('fs');
const path = require('path');
const { buildTasks } = require('../src/utils/buildTask');
const { splitPrompts, segFolderName } = require('../src/utils/splitPrompts');
const config = require('../src/config');

const fP = config.dingtalk.fields.product;
const fR = config.dingtalk.fields.prompt;

const productRows = JSON.parse(
  fs.readFileSync('C:/Users/admin/AppData/Local/Temp/product_rows.json', 'utf8'),
).records || [];

const promptRows = JSON.parse(
  fs.readFileSync('C:/Users/admin/AppData/Local/Temp/prompt_rows.json', 'utf8'),
).records || [];

console.log('=== 输入 ===');
console.log('生图表 rows:', productRows.length);
console.log('提示词表 rows:', promptRows.length);

console.log('\n=== 提示词表拆分测试 ===');
for (const r of promptRows) {
  const tt = r.cells[fR.taskType];
  const req = r.cells[fR.requirements] || '';
  const segs = splitPrompts(req);
  console.log(`任务类型=${tt}, 段数=${segs.length}, 图片数量=${r.cells[fR.count]}`);
  segs.forEach((s, i) => {
    console.log(`  [${i + 1}] 段首: ${s.slice(0, 50)}...`);
    console.log(`       段尾: ...${s.slice(-40)}`);
    console.log(`       文件夹名: ${segFolderName(s, i + 1)}`);
  });
}

console.log('\n=== 拼接任务 ===');
const tasks = buildTasks(productRows, promptRows, fP, fR);
console.log('可执行任务数:', tasks.length);
for (const t of tasks) {
  console.log(`\n--- recordId=${t.recordId} | 款号=${t.styleNo} | 半身照=${t.needHalf} ---`);
  console.log(`素材图: ${t.modelImage.filename} (${t.modelImage.url.slice(0, 80)}...)`);
  console.log(`要跑的提示词段数: ${t.prompts.length}`);
  for (const p of t.prompts) {
    console.log(`  - 任务类型=${p.taskType} | 写回字段=${p.writeField} | 文件夹=${p.folder}`);
    console.log(`    提示词首句: ${p.text.slice(0, 60)}...`);
  }
}
