// src/utils/splitPrompts.js —— 把提示词表「具体拍摄要求」单元格按 "1. ... 2. ... 3." 切成多段
// 实际抓到的数据格式举例：
//   "1.生成5张不同的淘宝主图姿势…\n处理模型只能用Nano Banana 2\n2.生成5张不同的淘宝主图姿势…\n处理模型只能用Nano Banana 2"
'use strict';

/**
 * @param {string} text 提示词单元格原文
 * @returns {string[]} 切分后的多段提示词（每段都包含 "处理模型只能用Nano Banana 2"）
 */
function splitPrompts(text) {
  if (!text || typeof text !== 'string') return [];
  // 用 (?=\d+\.) 正向先行：匹配 "1." / "2." / "12." 等位置切分，保留编号本身
  // 兼容中英文句号，兼容空格
  const re = /(?=\b\d+\.\s*)/g;
  const parts = text
    .split(re)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts;
}

/**
 * 给一段提示词命名一个安全的本地文件夹名（取首句 + 任务特征关键词）
 * 例如 "1.生成5张不同的淘宝主图姿势…坐姿  坐在沙发上的…"
 *   → "p2-坐姿"
 * @param {string} seg
 * @param {number} idx 1-based 段序号
 */
function segFolderName(seg, idx) {
  const firstLine = (seg.split(/\r?\n/)[0] || '').trim();
  // 去掉开头 "1." 这种编号
  const stripped = firstLine.replace(/^\d+\.\s*/, '');
  // 优先级从高到低：先匹配更具体的姿态/景别词
  const m = stripped.match(/(半身照|坐姿|站姿|躺姿|蹲姿|全身照|坐在沙发上|沙发)/);
  const tag = m ? m[1] : stripped.slice(0, 12).replace(/[\\/:*?"<>|\s]+/g, '');
  return `p${idx}-${tag || 'prompt'}`.slice(0, 40);
}

module.exports = { splitPrompts, segFolderName };
