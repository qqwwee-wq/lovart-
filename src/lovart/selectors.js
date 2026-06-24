// src/lovart/selectors.js —— Lovart 画布的 chat-style UI 选择器
//
// 实测发现（Lovart 2026-06）：
// - 画布 URL 形如 https://www.lovart.ai/canvas?projectId=<id>
// - 主页"新建项目"链接指向 /canvas?newProject=true（创建后会被 302 到带 projectId 的 URL）
// - 画布是 chat-style：右下角 contenteditable 输入框 + 旁边 "Agent" 发送按钮
// - 模型在 UI 上不可单独选择（"Nano Banana 2"/"Pro" 是后端别名，通过 prompt 文本指定）
// - 参考图通过画布中央的拖拽区（"将文件拖拽至此处添加到对话"）上传
// - 生成结果图片直接出现在画布上
'use strict';

module.exports = {
  // 项目入口
  home: {
    newProjectLink: 'a[href*="/canvas?newProject=true"]', // 左侧第一个 + 图标
  },

  // 画布 URL 模板：访问 /canvas?newProject=true 会自动建项目并跳转
  canvas: {
    newProjectUrl: 'https://www.lovart.ai/canvas?newProject=true',
    projectIdParam: 'projectId',
  },

  // 输入区（右下角）
  input: {
    // contenteditable DIV（不是 textarea）
    textbox: '[role="textbox"]',
    // 备选
    textboxAlt: 'div[contenteditable="true"]',
  },

  // 发送按钮（"Agent" 按钮在输入框右侧）
  send: {
    // 真发送按钮（Agent 是模式切换器，popover-trigger）
    sendButton: '[data-testid="agent-send-button"]',
    // 老 fallback
    agentButton: 'button:has-text("Agent")',
  },

  // 参考图上传（拖拽区）
  upload: {
    // 画布中央的拖拽提示 "将文件拖拽至此处添加到对话"
    dropZoneText: '将文件拖拽至此处添加到对话',
    // file input 通常是隐藏的
    fileInput: 'input[type="file"]',
    // 备选：拖拽目标区域
    dropTarget: 'div:has-text("将文件拖拽至此处添加到对话")',
  },

  // 等待/状态
  status: {
    // 生成中的 loading 指示器（待补：实际可能是 "正在分析" 等文本）
    generatingText: '正在分析用户意图',
    generatingTextAlt: '正在搜索高质量参考',
    // 完成后结果图片（在画布上的 <img>，属于本次生成的）
    resultImages: 'img[src*="lovart.ai/artifacts/user"]',
  },

  // 对话/项目设置（顶部右侧"对话"按钮，可能含模型选择）
  // 实测发现"对话"按钮在 (1053, 8)，但点击后没有 nano banana 2 显式选项
  settings: {
    dialogButton: 'button:has-text("对话")',
  },
};