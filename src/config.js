// src/config.js —— 加载并校验 .env，集中暴露所有可调参数
'use strict';

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('[config] .env 文件不存在，使用 .env.example 默认值');
  dotenv.config({ path: path.resolve(__dirname, '..', '.env.example') });
}

function required(key) {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    throw new Error(`缺少必填环境变量: ${key}（请在 .env 中设置）`);
  }
  return v.trim();
}

function intOr(key, def) {
  const v = process.env[key];
  if (v == null || v === '') return def;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`环境变量 ${key} 不是合法整数: ${v}`);
  return n;
}

const config = {
  http: {
    host: process.env.HOST || '0.0.0.0',
    port: intOr('PORT', 3000),
    authToken: process.env.HTTP_AUTH_TOKEN || '',
  },
  dingtalk: {
    baseId: required('DINGTALK_BASE_ID'),
    productTableId: required('DINGTALK_PRODUCT_TABLE_ID'),  // lovart慢速生图表
    // 鉴权
    appKey: process.env.DINGTALK_APP_KEY || '',
    appSecret: process.env.DINGTALK_APP_SECRET || '',
    staticAccessToken: process.env.DINGTALK_ACCESS_TOKEN || '',
    // 字段映射（lovart慢速生图表 tDKCnjU）
    fields: {
      product: {
        modelImage: process.env.PRODUCT_FIELD_MODEL_IMAGE || 'Kazj7iR',  // 素材图
        result:     process.env.PRODUCT_FIELD_RESULT      || 'cFh92nW',  // 生成结果
        styleNo:    process.env.PRODUCT_FIELD_STYLE_NO    || 'J9cORMb',  // 款号
        status:     process.env.PRODUCT_FIELD_STATUS      || '9LNltPj',  // 状态 (执行状态)
        genStatus:  process.env.PRODUCT_FIELD_GEN_STATUS  || 'XzTcnFY',  // 出图状态 (运营已确认则跳过)
        prompt:     process.env.PRODUCT_FIELD_PROMPT      || 'VgE7ByO',  // 提示词（每行自带）
      },
    },
    // OpenAPI 直连模式启用条件：配了 operatorUserId 才走 v1.0/notable/... OpenAPI
    // 否则走 dws CLI 兜底（部署服务器时仍需 dws 二进制）
    // operatorUserId = 钉钉 corp 成员 userId（运营用 admin 自己的钉钉 userId 即可）
    operatorUserId: process.env.DINGTALK_OPERATOR_USERID || '',
  },
  business: {
    workerCount: intOr('WORKER_COUNT', 3),
    // 等图超时（秒）。实测 Lovart 正常 60-180s，限速时可达 10-20 分钟。默认 20min
    lovartGenTimeoutSec: intOr('LOVART_GEN_TIMEOUT_SEC', 1200),
    // 单行 prompt 失败自适应重试
    //   - 重试上限（首次算 attempt 1，重试算 attempt 2..N）
    promptRetryMax: intOr('PROMPT_RETRY_MAX', 5),
    //   - 重试基础退避（attempt 2 → 等这么久；attempt 3 → ×mult；attempt 4 → ×mult² …）
    promptRetryBaseMs: intOr('PROMPT_RETRY_BASE_MS', 300000), // 5 分钟
    //   - 指数倍数
    promptRetryMult: intOr('PROMPT_RETRY_MULT', 2),
    // 状态枚举值
    status: {
      pending: '待处理',
      processing: '处理中',
      done: '已完成',
      failed: '失败',
    },
  },
  lovart: {
    cookiesFile: path.resolve(
      __dirname,
      '..',
      process.env.LOVART_COOKIES_FILE || './data/cookies.json',
    ),
    homeUrl: process.env.LOVART_HOME_URL || 'https://www.lovart.ai/zh/home',
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
    dir: path.resolve(__dirname, '..', process.env.LOG_DIR || './logs'),
  },
  // 生图结果输出目录（运营约定的本地保存路径）
  // - 默认 C:\lovart生图结果：运营在 Windows 上的固定目录
  // - 环境变量 LOVART_OUTPUT_DIR 可覆盖
  // - 结构：{LOVART_OUTPUT_DIR}/{YYYY-MM-DD}/{款号}/{prompt-folder}/imgXX.png
  downloadsDir: process.env.LOVART_OUTPUT_DIR || 'C:\\lovart生图结果',
  captcha: {
    twoCaptchaApiKey: process.env.TWO_CAPTCHA_API_KEY || '',
    // 2Captcha API base
    apiBase: 'https://2captcha.com',
  },
};

module.exports = config;
