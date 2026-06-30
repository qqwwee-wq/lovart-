// src/dingtalk/client.js —— 薄封装 dws CLI，调用钉钉 Open Platform
// 部署提示：服务器上首次使用前需执行 `dws auth login --device` 完成扫码登录
'use strict';

const { execFile } = require('child_process');
const path = require('path');

function dwsPath() {
  // 优先从 .env 拿，否则依赖系统 PATH
  return process.env.DWS_BIN || 'dws';
}

function run(args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = dwsPath();
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // stderr 里如果有 RECOVERY_EVENT_ID 一并带出去
        const e = new Error(
          `dws 调用失败: ${args.slice(0, 4).join(' ')}...\n` +
            (stderr ? stderr.trim() : err.message),
        );
        e.stderr = stderr || '';
        e.stdout = stdout || '';
        e.args = args;
        return reject(e);
      }
      // stdout 永远是 JSON（因为我们传了 --format json）
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (e) {
        return reject(new Error(`dws 返回非 JSON: ${stdout.slice(0, 200)}`));
      }
      resolve(parsed);
    });
  });
}

/** 通用 aitable record query，自动翻页 */
async function recordQuery({ baseId, tableId, filters = null, cursor = null, all = false, limit = 50 }) {
  const args = ['aitable', 'record', 'query', '--base-id', baseId, '--table-id', tableId, '--format', 'json'];
  if (all) args.push('--all');
  if (limit) args.push('--limit', String(limit));
  if (filters) args.push('--filters', JSON.stringify(filters));
  if (cursor) args.push('--cursor', cursor);
  return run(args);
}

/** 批量更新记录（≤30 条/次） */
async function recordUpdate({ baseId, tableId, records }) {
  // records = [{recordId, cells:{fieldId: value}}]
  return run(['aitable', 'record', 'update', '--base-id', baseId, '--table-id', tableId,
    '--records', JSON.stringify(records), '--format', 'json']);
}

/** 准备附件上传凭证 */
async function attachmentPrepare({ baseId, tableId, recordId, fieldId, fileName, fileSize }) {
  return run([
    'aitable', 'attachment', 'upload',
    '--base-id', baseId,
    '--file-name', fileName, '--size', String(fileSize),
    '--format', 'json',
  ]);
}

/** 把分块 PUT 到 OSS（模拟 aitable attachment upload 流程） */
async function attachmentPutToOss({ uploadUrl, filePath, headers }) {
  const fs = require('fs');
  const https = require('https');
  const http = require('http');
  const { URL } = require('url');
  const buf = fs.readFileSync(filePath);
  const urlObj = new URL(uploadUrl);
  const lib = urlObj.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      method: 'PUT',
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      headers: {
        'Content-Length': buf.length,
        'Content-Type': '', // aitable 要求清空
        ...headers,
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ statusCode: res.statusCode, body });
        else reject(new Error(`OSS PUT failed ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

/** 确认上传完成 */
async function attachmentConfirm({ baseId, tableId, recordId, fieldId, resourceId }) {
  return run([
    'aitable', 'attachment', 'confirm',
    '--base-id', baseId, '--table-id', tableId,
    '--record-id', recordId, '--field-id', fieldId,
    '--resource-id', resourceId,
    '--format', 'json',
  ]);
}

/** 健康检查 */
async function ping() {
  return run(['--version']);
}

module.exports = {
  recordQuery,
  recordUpdate,
  attachmentPrepare,
  attachmentPutToOss,
  attachmentConfirm,
  ping,
};
