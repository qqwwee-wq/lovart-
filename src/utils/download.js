// src/utils/download.js —— 下载 URL 图片到本地（带重试）
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 下载单个文件（带重试）
 * @param {string} url
 * @param {string} dest 本地完整路径
 * @param {number} [retries=3] 重试次数
 * @returns {Promise<{path:string, size:number}>}
 */
async function downloadOne(url, dest, retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await _downloadOnce(url, dest);
      return result;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

function _downloadOnce(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const parsed = new URL(url);
    const lib = url.startsWith('https') ? https : http;

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://www.lovart.ai/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-site',
      },
    };

    const req = lib.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadOne(res.headers.location, dest, 0).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        req.destroy();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      let size = 0;
      res.on('data', (chunk) => (size += chunk.length));
      out.on('finish', () => out.close(() => resolve({ path: dest, size })));
      out.on('error', (e) => { out.close(); reject(e); });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function downloadMany(items) {
  // 一次一个，避免并发被 CDN 限速
  const results = [];
  for (const it of items) {
    try {
      const r = await downloadOne(it.url, it.dest);
      results.push(r);
    } catch (e) {
      results.push({ error: e.message, ...it });
    }
  }
  return results;
}

module.exports = { downloadOne, downloadMany, ensureDir };
