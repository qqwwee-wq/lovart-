// src/utils/download.js —— 下载 URL 图片到本地
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * 确保目录存在
 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 下载单个文件
 * @param {string} url
 * @param {string} dest 本地完整路径
 * @returns {Promise<{path:string, size:number}>}
 */
function downloadOne(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 跟随重定向
        return downloadOne(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      let size = 0;
      res.on('data', (chunk) => (size += chunk.length));
      out.on('finish', () => out.close(() => resolve({ path: dest, size })));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('download timeout')));
  });
}

/**
 * 批量下载（并发 3）
 */
async function downloadMany(items /* [{url, dest}] */) {
  const limit = 3;
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const r = await Promise.allSettled(batch.map((it) => downloadOne(it.url, it.dest)));
    r.forEach((p, j) => {
      if (p.status === 'fulfilled') results.push(p.value);
      else results.push({ error: p.reason?.message || String(p.reason), ...batch[j] });
    });
  }
  return results;
}

module.exports = { downloadOne, downloadMany, ensureDir };
