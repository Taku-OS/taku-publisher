#!/usr/bin/env node

/**
 * 文件监听自动格式化脚本
 * 专为 AI 开发场景设计：当文件发生变化时自动运行 Biome 格式化
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 监听的文件扩展名
const WATCHED_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.json'];

// 忽略的目录
const IGNORED_DIRS = [
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'out',
  '.biome'
];

// 监听的目录
const WATCH_DIRS = ['src', 'examples'];

let isFormatting = false;
const formatQueue = new Set();

/**
 * 运行 Biome 格式化
 */
function formatFile(filePath) {
  if (isFormatting) {
    formatQueue.add(filePath);
    return;
  }

  isFormatting = true;
  console.log(`🔧 格式化文件: ${filePath}`);

  const child = spawn('npx', ['biome', 'check', '--write', filePath], {
    stdio: 'pipe'
  });

  child.on('close', (code) => {
    isFormatting = false;
    
    if (code === 0) {
      console.log(`✅ 格式化完成: ${filePath}`);
    } else {
      console.log(`⚠️  格式化警告: ${filePath}`);
    }

    // 处理队列中的下一个文件
    if (formatQueue.size > 0) {
      const nextFile = formatQueue.values().next().value;
      formatQueue.delete(nextFile);
      setTimeout(() => formatFile(nextFile), 100);
    }
  });

  child.on('error', (err) => {
    console.error(`❌ 格式化失败: ${filePath}`, err.message);
    isFormatting = false;
  });
}

/**
 * 检查文件是否需要监听
 */
function shouldWatch(filePath) {
  // 检查扩展名
  const ext = path.extname(filePath);
  if (!WATCHED_EXTENSIONS.includes(ext)) {
    return false;
  }

  // 检查是否在忽略目录中
  const relativePath = path.relative(process.cwd(), filePath);
  return !IGNORED_DIRS.some(dir => relativePath.startsWith(dir));
}

/**
 * 监听目录变化
 */
function watchDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.log(`⚠️  目录不存在: ${dirPath}`);
    return;
  }

  console.log(`👀 开始监听目录: ${dirPath}`);

  fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    const filePath = path.join(dirPath, filename);
    
    // 检查文件是否存在且需要监听
    if (fs.existsSync(filePath) && shouldWatch(filePath)) {
      if (eventType === 'change') {
        // 延迟格式化，避免频繁触发
        setTimeout(() => formatFile(filePath), 500);
      }
    }
  });
}

/**
 * 主函数
 */
function main() {
  console.log('🚀 启动 Biome 自动格式化监听器');
  console.log('📁 监听目录:', WATCH_DIRS.join(', '));
  console.log('📝 监听文件类型:', WATCHED_EXTENSIONS.join(', '));
  console.log('🔄 当文件修改时将自动运行 Biome 格式化\n');

  // 监听指定目录
  WATCH_DIRS.forEach(dir => {
    const fullPath = path.join(process.cwd(), dir);
    watchDirectory(fullPath);
  });

  console.log('✨ 监听器已启动，按 Ctrl+C 退出\n');
}

// 处理退出信号
process.on('SIGINT', () => {
  console.log('\n👋 停止文件监听器');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 停止文件监听器');
  process.exit(0);
});

// 启动
main();