'use client';

import { useEffect } from 'react';
import { initTakuClientActionBridge } from '@/lib/client-actions/bridge';

// 在这里导入“client actions 注册入口”（默认为空，供你按需添加）
import '@/client-actions';

export function TakuClientActionBridge() {
  useEffect(() => {
    initTakuClientActionBridge();
  }, []);

  return null;
}
