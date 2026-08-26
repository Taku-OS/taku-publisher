import { randomBytes } from 'node:crypto';
import * as path from 'node:path';

import { publisherHome } from './constants.js';
import type { DiscoveredProject } from './project-discovery.js';
import type { JsonObject, JsonValue } from './types.js';
import {
  atomicWriteJson,
  isRecord,
  PublisherError,
  readJson,
  secureDirectory,
} from './util.js';

export const CREATOR_PUBLISH_PLAN_SCHEMA_VERSION = 'taku.creator-publish-plan.v1';

export type CreatorPublishTarget = 'skill' | 'subapp';
export type CreatorPlanProjectStatus = 'queued' | 'in_progress' | 'completed' | 'blocked';
export type CreatorPlanCardStatus = 'ready_for_review' | 'published' | 'skipped';

export interface CreatorProjectSelection {
  projectId: string;
  target: CreatorPublishTarget;
}

export interface CreatorPublishPlanItem {
  projectId: string;
  name: string;
  path: string;
  target: CreatorPublishTarget;
  recommendedTarget: CreatorPublishTarget | null;
  classificationReviewRequired: boolean;
  status: CreatorPlanProjectStatus;
  nextAction: 'inspect_and_publish_skill' | 'assess_subapp';
  remoteItemId: string | null;
}

export interface CreatorPublishPlan {
  schemaVersion: typeof CREATOR_PUBLISH_PLAN_SCHEMA_VERSION;
  planId: string;
  createdAt: string;
  updatedAt: string;
  staxCard: {
    policy: 'publish_first';
    status: CreatorPlanCardStatus;
    waitsForProjects: false;
  };
  projects: CreatorPublishPlanItem[];
  execution: {
    mode: 'sequential';
    publicReleaseIsAutomatic: false;
    subAppsMayRequireLongRunningConversion: true;
  };
}

export interface CreatorPlanUpdate {
  cardStatus?: CreatorPlanCardStatus;
  projectId?: string;
  projectStatus?: CreatorPlanProjectStatus;
  remoteItemId?: string;
}

export function creatorProjectChoice(project: DiscoveredProject): JsonObject {
  const recommendedTarget = recommendedProjectTarget(project);
  return {
    id: project.id,
    name: project.name,
    routeHint: project.routeHint,
    recommendedTarget,
    targetOptions: ['skill', 'subapp'],
    eligibilityValidatedAfterSelection: true,
  };
}

export async function createCreatorPublishPlan(
  projects: DiscoveredProject[],
  selections: CreatorProjectSelection[],
  options: { env?: NodeJS.ProcessEnv; now?: () => Date } = {},
): Promise<CreatorPublishPlan> {
  if (!selections.length) {
    throw new PublisherError('Select at least one local project.', 'missing_creator_project_selection');
  }
  const byId = new Map(projects.map((project) => [project.id, project]));
  const seen = new Set<string>();
  const items = selections.map((selection) => {
    const projectId = String(selection.projectId ?? '').trim();
    if (!projectId || seen.has(projectId)) {
      throw new PublisherError('Each selected project must be unique.', 'invalid_creator_project_selection');
    }
    seen.add(projectId);
    const project = byId.get(projectId);
    if (!project) {
      throw new PublisherError('A selected project is no longer in recent local projects. Run creator-init again.', 'stale_creator_project_selection', { projectId });
    }
    if (selection.target !== 'skill' && selection.target !== 'subapp') {
      throw new PublisherError('Project target must be skill or subapp.', 'invalid_creator_project_target', { projectId });
    }
    const recommendedTarget = recommendedProjectTarget(project);
    return {
      projectId,
      name: project.name,
      path: project.path,
      target: selection.target,
      recommendedTarget,
      classificationReviewRequired: recommendedTarget !== selection.target,
      status: 'queued' as const,
      nextAction: selection.target === 'skill' ? 'inspect_and_publish_skill' as const : 'assess_subapp' as const,
      remoteItemId: null,
    };
  });
  const now = (options.now ?? (() => new Date()))().toISOString();
  const plan: CreatorPublishPlan = {
    schemaVersion: CREATOR_PUBLISH_PLAN_SCHEMA_VERSION,
    planId: `creator_plan_${randomBytes(12).toString('hex')}`,
    createdAt: now,
    updatedAt: now,
    staxCard: {
      policy: 'publish_first',
      status: 'ready_for_review',
      waitsForProjects: false,
    },
    projects: items,
    execution: {
      mode: 'sequential',
      publicReleaseIsAutomatic: false,
      subAppsMayRequireLongRunningConversion: true,
    },
  };
  await saveCreatorPublishPlan(plan, options.env);
  return plan;
}

export async function loadCreatorPublishPlan(
  planId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CreatorPublishPlan> {
  const file = path.join(creatorPlanDirectory(planId, env), 'plan.json');
  const value = await readJson(file);
  if (!isCreatorPublishPlan(value) || !isRecord(value) || value.planId !== planId) {
    throw new PublisherError('Creator publish plan is invalid.', 'invalid_creator_publish_plan');
  }
  return value as unknown as CreatorPublishPlan;
}

export async function updateCreatorPublishPlan(
  planId: string,
  update: CreatorPlanUpdate,
  options: { env?: NodeJS.ProcessEnv; now?: () => Date } = {},
): Promise<CreatorPublishPlan> {
  const env = options.env ?? process.env;
  const plan = await loadCreatorPublishPlan(planId, env);
  if (update.cardStatus) plan.staxCard.status = update.cardStatus;
  if (update.projectId || update.projectStatus || update.remoteItemId) {
    if (!update.projectId || !update.projectStatus) {
      throw new PublisherError('Project updates require both project ID and status.', 'invalid_creator_plan_update');
    }
    const item = plan.projects.find((candidate) => candidate.projectId === update.projectId);
    if (!item) throw new PublisherError('Project is not part of this creator plan.', 'unknown_creator_plan_project');
    item.status = update.projectStatus;
    if (update.remoteItemId !== undefined) item.remoteItemId = update.remoteItemId.trim() || null;
  }
  plan.updatedAt = (options.now ?? (() => new Date()))().toISOString();
  await saveCreatorPublishPlan(plan, env);
  return plan;
}

export function nextCreatorPlanAction(plan: CreatorPublishPlan): JsonObject {
  if (plan.staxCard.status === 'ready_for_review') {
    return {
      kind: 'stax_card',
      action: 'review_and_publish_stax_card',
      blocking: false,
    };
  }
  const active = plan.projects.find((item) => item.status === 'in_progress')
    ?? plan.projects.find((item) => item.status === 'queued');
  if (active) {
    return {
      kind: active.target,
      action: active.nextAction,
      projectId: active.projectId,
      name: active.name,
      path: active.path,
      classificationReviewRequired: active.classificationReviewRequired,
    };
  }
  const blocked = plan.projects.filter((item) => item.status === 'blocked');
  if (blocked.length) {
    return {
      kind: 'plan',
      action: 'resolve_blocked_projects',
      blockedProjectIds: blocked.map((item) => item.projectId),
    };
  }
  return { kind: 'plan', action: 'complete' };
}

export function parseCreatorSelections(value: string): CreatorProjectSelection[] {
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.map((entry) => {
    const separator = entry.lastIndexOf('=');
    if (separator <= 0) throw new PublisherError('Selections must use project-id=skill or project-id=subapp.', 'invalid_creator_project_selection');
    const projectId = entry.slice(0, separator).trim();
    const target = entry.slice(separator + 1).trim();
    if (target !== 'skill' && target !== 'subapp') {
      throw new PublisherError('Project target must be skill or subapp.', 'invalid_creator_project_target', { projectId });
    }
    return { projectId, target };
  });
}

function recommendedProjectTarget(project: DiscoveredProject): CreatorPublishTarget | null {
  if (project.routeHint === 'existing-skill' || project.routeHint === 'workflow-candidate') return 'skill';
  if (project.routeHint === 'subapp-candidate') return 'subapp';
  return null;
}

async function saveCreatorPublishPlan(plan: CreatorPublishPlan, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const directory = creatorPlanDirectory(plan.planId, env);
  await secureDirectory(directory);
  await atomicWriteJson(path.join(directory, 'plan.json'), plan as unknown as JsonValue);
}

function creatorPlanDirectory(planId: string, env: NodeJS.ProcessEnv): string {
  const normalized = String(planId ?? '').trim();
  if (!/^creator_plan_[a-f0-9]{24}$/.test(normalized)) {
    throw new PublisherError('Invalid creator plan ID.', 'invalid_creator_plan_id');
  }
  return path.join(publisherHome(env), 'creator-plans', normalized);
}

function isCreatorPublishPlan(value: JsonValue): boolean {
  if (!isRecord(value) || value.schemaVersion !== CREATOR_PUBLISH_PLAN_SCHEMA_VERSION) return false;
  if (typeof value.planId !== 'string' || !Array.isArray(value.projects) || !isRecord(value.staxCard)) return false;
  return value.projects.every((item) => isRecord(item)
    && typeof item.projectId === 'string'
    && (item.target === 'skill' || item.target === 'subapp')
    && ['queued', 'in_progress', 'completed', 'blocked'].includes(String(item.status)));
}
