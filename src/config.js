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
    productTableId: required('DINGTALK_PRODUCT_TABLE_ID'),
    promptTableId: required('DINGTALK_PROMPT_TABLE_ID'),
    // 鉴权
    appKey: process.env.DINGTALK_APP_KEY || '',
    appSecret: process.env.DINGTALK_APP_SECRET || '',
    staticAccessToken: process.env.DINGTALK_ACCESS_TOKEN || '',
    // 字段映射（生图表）
    fields: {
      product: {
        modelImage: process.env.PRODUCT_FIELD_MODEL_IMAGE || 'DnmBokE',
        result: process.env.PRODUCT_FIELD_RESULT || 'szTnEwE',
        resultHalf: process.env.PRODUCT_FIELD_RESULT_HALF || '6z0bsDG',
        needHalf: process.env.PRODUCT_FIELD_NEED_HALF || 'd0kMhUg',
        styleNo: process.env.PRODUCT_FIELD_STYLE_NO || 'bbhOm6a',
        status: process.env.PRODUCT_FIELD_STATUS || 'RicGRRL',
      },
      prompt: {
        requirements: process.env.PROMPT_FIELD_REQUIREMENTS || 'K8j3XfP',
        taskType: process.env.PROMPT_FIELD_TASK_TYPE || 'qPAYcMw',
        resolution: process.env.PROMPT_FIELD_RESOLUTION || 'XNg9do5',
        ratio: process.env.PROMPT_FIELD_RATIO || '2yoWPdm',
        count: process.env.PROMPT_FIELD_COUNT || 'wYvotko',
        rules: process.env.PROMPT_FIELD_RULES || 'XwixyRq',
      },
    },
  },
  business: {
    workerCount: intOr('WORKER_COUNT', 5),
    lovartModel: process.env.LOVART_MODEL || 'Nano Banana 2',
    imageRatio: process.env.IMAGE_RATIO || '3:4',
    imageResolution: process.env.IMAGE_RESOLUTION || '2K',
    imagesPerPrompt: intOr('IMAGES_PER_PROMPT', 5),
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
  downloadsDir: path.resolve(__dirname, '..', 'downloads'),
  captcha: {
    twoCaptchaApiKey: process.env.TWO_CAPTCHA_API_KEY || '',
    // 2Captcha API base
    apiBase: 'https://2captcha.com',
  },
};

module.exports = config;
