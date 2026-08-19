/**
 * SubApp Action 系统
 *
 * 提供 Taku AIOS 与 SubApp 交互的能力
 */

export {
  clearActions,
  executeAction,
  getActionDefinition,
  getRegisteredActions,
  hasAction,
  registerAction,
} from './registry';

export type {
  ActionContext,
  ActionDefinition,
  ActionHandler,
  ActionParamSchema,
  ActionParamType,
  ActionResult,
  TakuManifest,
} from './types';
