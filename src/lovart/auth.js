// src/lovart/auth.js —— Lovart 登录态管理：cookies 加载/保存
// 5 个 Worker 共用一个账号，所以从同一个文件读 cookies
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

function cookiesFile() {
  return config.lovart.cookiesFile;
}

function exists() {
  return fs.existsSync(cookiesFile());
}

/**
 * 读取 cookies（Playwright storage state 格式）
 */
function load() {
  if (!exists()) return null;
  try {
    return JSON.parse(fs.readFileSync(cookiesFile(), 'utf8'));
  } catch (e) {
    throw new Error(`读取 cookies 文件失败 (${cookiesFile()}): ${e.message}`);
  }
}

function save(state) {
  const dir = path.dirname(cookiesFile());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cookiesFile(), JSON.stringify(state, null, 2));
  console.log(`[lovart.auth] cookies 已保存 → ${cookiesFile()}`);
}

module.exports = { load, save, exists, cookiesFile };
