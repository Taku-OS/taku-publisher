/**
 * 示例 Actions
 *
 * 这个文件展示如何定义和注册 SubApp Actions
 * 用户可以参考这个示例创建自己的 Actions
 */

import { registerAction } from '@/lib/actions';

// ============================================
// Action: greet
// ============================================

registerAction(
  {
    name: 'greet',
    description: '打个招呼',
    params: {
      name: {
        type: 'string',
        required: false,
        description: '要问候的名字',
        default: 'World',
      },
    },
  },
  async ({ name = 'World' }) => {
    const greeting = `Hello, ${name}!`;

    return {
      success: true,
      data: { greeting },
      message: greeting,
    };
  }
);

// ============================================
// Action: getStatus
// ============================================

registerAction(
  {
    name: 'getStatus',
    description: '获取应用状态',
    returns: {
      type: 'object',
      description: '包含应用运行状态的对象',
    },
  },
  async () => {
    return {
      success: true,
      data: {
        status: 'running',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: '0.1.1',
      },
    };
  }
);

// ============================================
// 更多示例（注释掉，供参考）
// ============================================

/*
// 音乐播放器示例
registerAction(
  {
    name: 'play',
    description: '播放指定歌曲',
    params: {
      song: { type: 'string', required: true, description: '歌曲名称或关键词' },
      artist: { type: 'string', required: false, description: '艺术家名称' },
    },
  },
  async ({ song, artist }) => {
    // 实际播放逻辑...
    return {
      success: true,
      message: `正在播放: ${song}${artist ? ` - ${artist}` : ''}`,
    };
  }
);

// 搜索示例
registerAction(
  {
    name: 'search',
    description: '搜索内容',
    params: {
      query: { type: 'string', required: true, description: '搜索关键词' },
      limit: { type: 'number', required: false, description: '返回数量', default: 10 },
    },
    returns: {
      type: 'array',
      description: '搜索结果列表',
    },
  },
  async ({ query, limit = 10 }) => {
    // 搜索逻辑...
    return {
      success: true,
      data: [],
      message: `搜索 "${query}" 完成`,
    };
  }
);
*/
