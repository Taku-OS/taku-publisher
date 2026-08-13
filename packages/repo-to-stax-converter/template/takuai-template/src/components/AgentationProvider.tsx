'use client';

import { Agentation } from 'agentation';
import { useCallback } from 'react';

type AgentationCopyMessage = {
  __taku: true;
  type: 'taku:agentation:copy';
  applicationId?: string;
  markdown: string;
  url: string;
  timestamp: number;
};

export function AgentationProvider() {
  const handleCopy = useCallback((markdown: string) => {
    try {
      const applicationId = (window as unknown as { __takuApplicationId?: string | null })
        .__takuApplicationId;
      const payload: AgentationCopyMessage = {
        __taku: true,
        type: 'taku:agentation:copy',
        applicationId: typeof applicationId === 'string' ? applicationId : undefined,
        markdown,
        url: window.location.href,
        timestamp: Date.now(),
      };
      window.parent?.postMessage(payload, '*');
    } catch {
      // ignore
    }
  }, []);

  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return <Agentation onCopy={handleCopy} />;
}
