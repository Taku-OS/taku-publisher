/**
 * Actions 入口
 *
 * 导入所有 action 文件以注册它们
 * 该 registration root 仅由认证后的 Host RPC 加载
 */

// 导入示例 actions
import './example';

// 导入宿主内部 actions（不会暴露 token；用于运行时同步鉴权）
import './__taku-internal';
