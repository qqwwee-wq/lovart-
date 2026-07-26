// scripts/bulk-upload.js —— 把 downloads/2026-07-10/<款号>/<prompt-folder>/ 里的图片一次性传到钉钉生图表
// 用法：
//   node scripts/bulk-upload.js --record=tguz2mP8WZ
//   node scripts/bulk-upload.js --record=tguz2mP8WZ --status=已完成
//   node scripts/bulk-upload.js --record=tguz2mP8WZ --status=部分完成 --dry
//
// 规则：
//   - 文件夹名含「半身照」→ 传到 PRODUCT_FIELD_RESULT_HALF（生成结果-半身照）
//   - 其他 → 传到 PRODUCT_FIELD_RESULT（生成结果-全身照）
//   - 没图片的文件夹跳过（不报错）
//   - 默认状态：partial（有图片但部分缺）→ 「部分完成」；全有 → 「已完成」
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { uploadImageToField, updateStatus } = require('../src/dingtalk/upload');

// 新架构只有一个 taskType（'lovart慢速生图'），按「是否需要半身照」决定写哪个字段。
// 但 bulk-upload 跑时不查行（只给定 recordId + 下载目录），所以按文件夹名启发：
//   - 文件夹名含「半身」 → 生成结果（半身照）
//   - 其他 → 生成结果
const FIELD_RESULT = config.dingtalk.fields.product.result;        // cFh92nW
const FIELD_RESULT_HALF = config.dingtalk.fields.product.resultHalf; // w0S4pWR

/**
 * 从今天的 e2e 日志里解析 folder → 是否半身照 映射
 * 日志格式：▶▶ prompt N/3 | lovart慢速生图 | 文件夹=p1-半身
 * @returns {Map<string, boolean>} folder → 是否半身照
 */
function parseFolderIsHalf() {
  const map = new Map();
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(config.log.dir, `${today}.log`);
  if (!fs.existsSync(logPath)) {
    console.warn(`[bulk-upload] 日志不存在：${logPath}，将用文件夹名启发式判断`);
    return map;
  }
  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);
  // 匹配：▶▶ prompt N/3 | <taskType> | 文件夹=<folder>
  const re = /▶▶\s+prompt\s+\d+\/\d+\s*\|\s*([^|]+?)\s*\|\s*文件夹=([^\s]+)/;
  for (const ln of lines) {
    const m = ln.match(re);
    if (m) {
      const folder = m[2].trim();
      // 与 runResult.writeField 比对（日志里没记 writeField，只能靠文件夹名）
      const isHalf = /半身/.test(folder);
      map.set(folder, isHalf);
    }
  }
  console.log(`[bulk-upload] 从日志解析出 ${map.size} 个 folder→isHalf 映射`);
  return map;
}

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    }),
);

const RECORD_ID = args.record;
const STATUS_OVERRIDE = args.status;
const DRY_RUN = args.dry === 'true';

if (!RECORD_ID) {
  console.error('用法：node scripts/bulk-upload.js --record=<recordId> [--status=已完成|部分完成|失败] [--dry]');
  console.error('例子：node scripts/bulk-upload.js --record=tguz2mP8WZ');
  process.exit(1);
}

const STYLE_NO = args['style-no'] || '';
const DOWNLOAD_ROOT = path.join(config.downloadsDir, 'YYYY-MM-DD'.replace('YYYY-MM-DD', new Date().toISOString().slice(0, 10)), STYLE_NO);

async function main() {
  // 找今天日期的目录
  const today = new Date().toISOString().slice(0, 10);
  const baseDir = STYLE_NO
    ? path.join(config.downloadsDir, today, STYLE_NO)
    : (() => {
        // 没指定款号时，按 recordId 在 downloads 下找
        const todayDir = path.join(config.downloadsDir, today);
        if (!fs.existsSync(todayDir)) {
          throw new Error(`下载目录不存在：${todayDir}`);
        }
        const subdirs = fs.readdirSync(todayDir).filter((d) => fs.statSync(path.join(todayDir, d)).isDirectory());
        if (subdirs.length === 0) throw new Error(`${todayDir} 下没有款号子目录`);
        if (subdirs.length > 1) {
          console.warn(`[bulk-upload] ${todayDir} 下有多个款号：${subdirs.join(', ')}，使用第一个：${subdirs[0]}`);
        }
        return path.join(todayDir, subdirs[0]);
      })();

  if (!fs.existsSync(baseDir)) {
    throw new Error(`款号目录不存在：${baseDir}`);
  }

  console.log(`[bulk-upload] recordId=${RECORD_ID}`);
  console.log(`[bulk-upload] 源目录: ${baseDir}`);

  // 从日志解析 folder → isHalf 映射（启发式兜底）
  const folderHalfMap = parseFolderIsHalf();

  // 扫所有 prompt 子目录
  const folders = fs.readdirSync(baseDir).filter((d) => fs.statSync(path.join(baseDir, d)).isDirectory());
  folders.sort();

  const resultMap = {}; // { fieldId: [filePaths] }
  const totalByFolder = {};

  for (const folder of folders) {
    const folderPath = path.join(baseDir, folder);
    const files = fs.readdirSync(folderPath)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => path.join(folderPath, f))
      .sort();
    totalByFolder[folder] = files.length;

    if (files.length === 0) {
      console.log(`[bulk-upload] ⏭ ${folder}: 0 张，跳过`);
      continue;
    }

    // 优先从日志取 isHalf 启发，否则用文件夹名判断
    let isHalf = folderHalfMap.get(folder);
    if (isHalf == null) {
      isHalf = /半身/i.test(folder);
      console.log(`[bulk-upload] ⚠ ${folder} 在日志里没找到启发，按文件夹名：${isHalf ? '半身' : '全身'}`);
    }
    const fieldId = isHalf ? FIELD_RESULT_HALF : FIELD_RESULT;
    const fieldName = isHalf ? '生成结果（半身照）' : '生成结果';

    if (!resultMap[fieldId]) resultMap[fieldId] = [];
    resultMap[fieldId].push(...files);

    console.log(`[bulk-upload] 📂 ${folder}: ${files.length} 张 → ${fieldName} (${fieldId})`);
  }

  if (DRY_RUN) {
    console.log('\n[bulk-upload] 🟡 dry-run 模式，不真上传');
    console.log(JSON.stringify({ resultMap, totalByFolder }, null, 2));
    return;
  }

  // 上传
  let uploaded = 0;
  let failed = 0;
  for (const [fieldId, files] of Object.entries(resultMap)) {
    const fieldName = fieldId === FIELD_RESULT_HALF ? '生成结果（半身照）' : '生成结果';
    console.log(`\n[bulk-upload] ⬆ 上传 ${files.length} 张到 ${fieldName} (${fieldId})...`);
    for (let i = 0; i < files.length; i++) {
      const fp = files[i];
      try {
        await uploadImageToField({ recordId: RECORD_ID, fieldId, filePath: fp });
        uploaded++;
        console.log(`  [${i + 1}/${files.length}] ✅ ${path.basename(fp)}`);
      } catch (e) {
        failed++;
        console.error(`  [${i + 1}/${files.length}] ❌ ${path.basename(fp)}: ${e.message}`);
      }
    }
  }

  // 算状态
  let status = STATUS_OVERRIDE;
  if (!status) {
    if (failed > 0) status = '部分完成'; // 自定义状态
    else if (uploaded === 0) status = '失败';
    else status = '已完成';
  }

  console.log(`\n[bulk-upload] 📊 汇总: 上传 ${uploaded} 失败 ${failed}`);
  console.log(`[bulk-upload] 计划状态: ${status}`);

  if (uploaded > 0 || status === '失败') {
    try {
      await updateStatus(RECORD_ID, status);
      console.log(`[bulk-upload] ✅ 状态已更新为：${status}`);
    } catch (e) {
      console.error(`[bulk-upload] ❌ 状态更新失败: ${e.message}`);
    }
  }

  console.log('\n[bulk-upload] 退出');
}

main().catch((e) => {
  console.error('[bulk-upload] ❌ 致命错误:', e.message);
  console.error(e.stack);
  process.exit(1);
});