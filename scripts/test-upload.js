// scripts/test-upload.js —— 拿任意图片上传到钉钉指定行指定字段（仅用于测试回传链路）
// 用法：
//   node scripts/test-upload.js --record=tguz2mP8WZ --files="d:/Desktop/1.png,d:/Desktop/3.png,..."
//   node scripts/test-upload.js --record=tguz2mP8WZ --field=resultHalf --auto=3   # 自动从 downloads 拿最近 N 张
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { uploadImageToField, updateStatus } = require('../src/dingtalk/upload');
const { makeLogger } = require('../src/logger');

const log = makeLogger('test-upload');

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    }),
);

const RECORD_ID = args.record;
if (!RECORD_ID) {
  console.error('用法：node scripts/test-upload.js --record=<recordId> [--files=...] [--field=result|resultHalf] [--auto=N]');
  process.exit(1);
}

// 解析要上传的文件
let files = [];
if (args.files) {
  files = args.files.split(',').map((s) => s.trim()).filter(Boolean);
} else if (args.auto) {
  const n = parseInt(args.auto, 10);
  // 从今天的 downloads 拿最近的 N 张图
  const today = new Date().toISOString().slice(0, 10);
  const downloadsRoot = path.join(config.downloadsDir, today);
  if (!fs.existsSync(downloadsRoot)) {
    console.error(`downloads/${today} 不存在，无法 auto 取图`);
    process.exit(1);
  }
  const all = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(e)) all.push(p);
    }
  }
  walk(downloadsRoot);
  files = all.slice(-n).reverse(); // 取最后 N 张（最新生成的）
}

// 字段
const FIELD = args.field || 'resultHalf';
const fieldId = FIELD === 'result' || FIELD === '生成结果'
  ? config.dingtalk.fields.product.result
  : FIELD === 'resultHalf' || FIELD === '生成结果（半身照）'
    ? config.dingtalk.fields.product.resultHalf
    : FIELD; // 接受 raw fieldId

(async () => {
  console.log(`[test-upload] recordId=${RECORD_ID} field=${FIELD} (${fieldId})`);
  console.log(`[test-upload] 待上传文件: ${files.length} 张`);
  files.forEach((f, i) => {
    const stat = fs.existsSync(f) ? fs.statSync(f) : null;
    console.log(`  [${i + 1}] ${f} ${stat ? `(${Math.round(stat.size / 1024)}KB)` : '❌ NOT FOUND'}`);
  });

  if (files.length === 0) {
    console.log('[test-upload] 没有文件可传');
    process.exit(1);
  }

  let ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!fs.existsSync(f)) {
      console.log(`  [${i + 1}] ❌ 文件不存在: ${f}`);
      fail++;
      continue;
    }
    try {
      await uploadImageToField({ recordId: RECORD_ID, fieldId, filePath: f });
      console.log(`  [${i + 1}] ✅ ${path.basename(f)}`);
      ok++;
    } catch (e) {
      console.error(`  [${i + 1}] ❌ ${path.basename(f)}: ${e.message.slice(0, 200)}`);
      fail++;
    }
  }

  console.log(`\n[test-upload] 汇总: ✅ ${ok} / ❌ ${fail}`);

  // 可选：自动把状态改成 "测试中"
  if (args['set-status']) {
    try {
      await updateStatus(RECORD_ID, args['set-status']);
      console.log(`[test-upload] 状态已设为: ${args['set-status']}`);
    } catch (e) {
      console.error(`[test-upload] 状态更新失败: ${e.message}`);
    }
  }
})().catch((e) => {
  console.error('[test-upload] 致命错误:', e.message);
  process.exit(1);
});