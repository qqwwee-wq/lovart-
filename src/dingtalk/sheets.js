// src/dingtalk/sheets.js —— 高层接口：拉取生图表+提示词表全量数据
'use strict';

const config = require('../config');
const { makeLogger } = require('../logger');
const { recordQuery } = require('./client');

const log = makeLogger('dingtalk.sheets');

/** 拉取生图表所有行 */
async function fetchProductRows() {
  log.info('开始拉取生图表', { baseId: config.dingtalk.baseId, tableId: config.dingtalk.productTableId });
  const r = await recordQuery({
    baseId: config.dingtalk.baseId,
    tableId: config.dingtalk.productTableId,
    all: true,
    limit: 100,
  });
  // --all 返回的形状是 {records, hasMore, pages}
  const rows = r.data?.records || r.records || [];
  log.info('生图表拉取完成', { count: rows.length, hasMore: r.data?.hasMore ?? r.hasMore });
  return rows;
}

/** 拉取提示词表所有行 */
async function fetchPromptRows() {
  log.info('开始拉取提示词表', { baseId: config.dingtalk.baseId, tableId: config.dingtalk.promptTableId });
  const r = await recordQuery({
    baseId: config.dingtalk.baseId,
    tableId: config.dingtalk.promptTableId,
    all: true,
    limit: 100,
  });
  const rows = r.data?.records || r.records || [];
  log.info('提示词表拉取完成', { count: rows.length });
  return rows;
}

module.exports = { fetchProductRows, fetchPromptRows };
