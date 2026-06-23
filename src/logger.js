// src/logger.js —— 简易控制台+文件日志（避免引入 winston 之类的重依赖）
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.log.level] || LEVELS.info;

// 确保 logs 目录存在
if (!fs.existsSync(config.log.dir)) {
  fs.mkdirSync(config.log.dir, { recursive: true });
}

const today = () => new Date().toISOString().slice(0, 10);
const ts = () => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

function fmt(level, scope, msg, meta) {
  const base = `[${ts()}] ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (meta && Object.keys(meta).length) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

function write(level, scope, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const line = fmt(level, scope, msg, meta);
  // 控制台
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  // 文件
  const file = path.join(config.log.dir, `${today()}.log`);
  try {
    fs.appendFileSync(file, line + '\n', 'utf8');
  } catch (e) {
    // ignore file write errors
  }
}

function makeLogger(scope) {
  return {
    debug: (msg, meta) => write('debug', scope, msg, meta),
    info:  (msg, meta) => write('info',  scope, msg, meta),
    warn:  (msg, meta) => write('warn',  scope, msg, meta),
    error: (msg, meta) => write('error', scope, msg, meta),
  };
}

module.exports = { makeLogger };
