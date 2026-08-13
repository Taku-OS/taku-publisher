import type { RepoAnalysis } from './analyzer.js';

export type CapabilityRouteKind = 'subapp-migration' | 'native-import' | 'reference-only';

export interface CapabilityRoute {
  kind: CapabilityRouteKind;
  capability: RepoAnalysis['appType'];
  reason: string;
  nextAction: string;
}

export function routeRepoCapability(analysis: RepoAnalysis): CapabilityRoute {
  if (['nextjs', 'vite-react', 'fastapi-next', 'streamlit', 'gradio'].includes(analysis.appType)) {
    return {
      kind: 'subapp-migration',
      capability: analysis.appType,
      reason: 'An interactive application runtime was detected.',
      nextAction: 'Create a versioned Taku SubApp migration workspace.',
    };
  }
  if (analysis.appType === 'workflow-skill') {
    return {
      kind: 'native-import',
      capability: analysis.appType,
      reason: 'The repository already exposes an Agent skill/workflow capability.',
      nextAction: 'Use the native Taku Stax skill import flow instead of SubApp conversion.',
    };
  }
  if (analysis.appType === 'browser-extension') {
    return {
      kind: 'reference-only',
      capability: analysis.appType,
      reason: 'Taku does not install or execute browser-extension runtimes as SubApps.',
      nextAction: 'Save a Stax browser-extension reference with manual setup guidance.',
    };
  }
  if (analysis.appType === 'external-connector') {
    return {
      kind: 'reference-only',
      capability: analysis.appType,
      reason: 'The repository needs an external daemon, bot, webhook, or auth lifecycle.',
      nextAction: 'Save a Stax external-connector reference and document its managed runtime.',
    };
  }
  return {
    kind: 'reference-only',
    capability: analysis.appType,
    reason: 'No supported interactive SubApp runtime was detected.',
    nextAction: 'Keep this repository as a reference until a native capability contract exists.',
  };
}
