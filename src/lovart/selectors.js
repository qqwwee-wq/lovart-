// src/lovart/selectors.js —— Lovart 页面的关键选择器
// ⚠️ 这些选择器是基于公开页面的，需要登录后用 MCP 探索确认/修正
//
// 探索流程（执行 npm run login 后用 MCP 走一遍）：
//   1. 进入 https://www.lovart.ai/zh/home 登录后页面
//   2. 点击 "新对话" / "创建项目" → 拿到 新建项目 按钮、模型选择器
//   3. 上传参考图 → 拿到 file input 选择器
//   4. 在 prompt 输入框输入 → 拿到 textarea/contenteditable 选择器
//   5. 设置 ratio (3:4) + 2K + 模型 Nano Banana 2 → 拿到对应控件
//   6. 点生成 → 拿到生成按钮 + 进度/结果区域选择器
//   7. 等完成 → 拿到下载按钮选择器（或读 <img src>）
//
// 本文件每个选择器都留 TODO，等你登录后我们一起填。
'use strict';

module.exports = {
  home: {
    // 登录后首页的根容器 / 主要导航
    appRoot: 'main',
    newProjectButton: null, // TODO: "新对话"/"创建项目"
  },
  project: {
    // 项目内（生成画布）相关
    fileInput: 'input[type="file"]', // 通常 upload 控件都是这个，备用
    uploadButton: null, // TODO
    promptInput: null, // TODO: prompt 输入框 (textarea / contenteditable)
    modelSelect: null, // TODO: "Select model" 按钮
    modelOptionNanoBanana2: null, // TODO
    ratioSelect: null, // TODO: 比例选择
    ratioOption3x4: null, // TODO
    resolutionSelect: null, // TODO: 分辨率/画质选择
    resolutionOption2K: null, // TODO
    generateButton: null, // TODO: 提交生成
    generatingIndicator: null, // TODO: 生成中的 loading/进度
    resultImages: null, // TODO: 完成后 5 张 img 的容器选择器
    downloadButton: null, // TODO: 单张/批量下载
  },
};
