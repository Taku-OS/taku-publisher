import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { setTreeWritable } from '../dist/index.js';

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const pythonCli = path.join(repositoryRoot, 'scripts', 'taku_publisher.py');
const nodeCli = path.join(repositoryRoot, 'packages', 'publisher-runtime', 'dist', 'bin', 'taku-publisher.js');

test('Node Publisher preserves the Python local workflow contract during migration', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-publisher-parity-'));
  t.after(async () => {
    await setTreeWritable(root).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  });
  const source = path.join(root, 'sample-skill');
  await fs.mkdir(source);
  await fs.writeFile(
    path.join(source, 'SKILL.md'),
    '---\nname: parity-skill\ndescription: Contract parity fixture\n---\n# Parity Skill\n',
  );
  await fs.writeFile(
    path.join(source, 'index.mjs'),
    'const endpoint = process.env.SERVICE_URL;\nawait fetch(endpoint);\n',
  );
  const pythonEnv = { ...process.env, TAKU_PUBLISHER_HOME: path.join(root, 'python-home') };
  const nodeEnv = { ...process.env, TAKU_PUBLISHER_HOME: path.join(root, 'node-home') };

  const pythonDiscovery = run('python3', [pythonCli, 'discover', '--workspace', root, '--source', source], pythonEnv);
  const nodeDiscovery = run(process.execPath, [nodeCli, 'discover', '--workspace', root, '--source', source], nodeEnv);
  assert.deepEqual(
    comparableOutput(nodeDiscovery, ['candidates', 'candidate_count', 'allowed_types', 'unavailable_types', 'availability_note', 'selection_rule']),
    comparableOutput(pythonDiscovery, ['candidates', 'candidate_count', 'allowed_types', 'unavailable_types', 'availability_note', 'selection_rule']),
  );

  const pythonDraft = 'local_python_parity';
  const nodeDraft = 'local_node_parity';
  const commonInit = ['init', '--workspace', root, '--source', source, '--type', 'skill', '--mode', 'create'];
  const pythonInit = run('python3', [pythonCli, ...commonInit, '--draft-id', pythonDraft], pythonEnv);
  const nodeInit = run(process.execPath, [nodeCli, ...commonInit, '--draft-id', nodeDraft], nodeEnv);
  assert.deepEqual(nodeInit.unit, pythonInit.unit);
  assert.equal(nodeInit.status, pythonInit.status);
  assert.equal(nodeInit.action_type, pythonInit.action_type);

  const pythonStage = run('python3', [pythonCli, 'stage', '--draft-id', pythonDraft], pythonEnv);
  const nodeStage = run(process.execPath, [nodeCli, 'stage', '--draft-id', nodeDraft], nodeEnv);
  assert.equal(nodeStage.stage_sha256, pythonStage.stage_sha256);
  assert.equal(nodeStage.file_count, pythonStage.file_count);
  assert.equal(nodeStage.total_bytes, pythonStage.total_bytes);

  const pythonScan = run('python3', [pythonCli, 'scan', '--draft-id', pythonDraft], pythonEnv);
  const nodeScan = run(process.execPath, [nodeCli, 'scan', '--draft-id', nodeDraft], nodeEnv);
  assert.deepEqual(nodeScan.scan_summary, pythonScan.scan_summary);
  assert.deepEqual(nodeScan.requirements, pythonScan.requirements);

  const pythonDirectory = path.join(pythonEnv.TAKU_PUBLISHER_HOME, pythonDraft);
  const nodeDirectory = path.join(nodeEnv.TAKU_PUBLISHER_HOME, nodeDraft);
  const pythonReview = await completedReview(pythonDirectory);
  const nodeReview = await completedReview(nodeDirectory);
  const pythonReviewPath = path.join(root, 'python-review.json');
  const nodeReviewPath = path.join(root, 'node-review.json');
  await fs.writeFile(pythonReviewPath, JSON.stringify(pythonReview));
  await fs.writeFile(nodeReviewPath, JSON.stringify(nodeReview));
  run('python3', [pythonCli, 'apply-review', '--draft-id', pythonDraft, '--dispositions', pythonReviewPath], pythonEnv);
  run(process.execPath, [nodeCli, 'apply-review', '--draft-id', nodeDraft, '--dispositions', nodeReviewPath], nodeEnv);
  const pythonPackage = run('python3', [pythonCli, 'package', '--draft-id', pythonDraft], pythonEnv);
  const nodePackage = run(process.execPath, [nodeCli, 'package', '--draft-id', nodeDraft], nodeEnv);
  assert.equal(nodePackage.artifact.sha256, pythonPackage.artifact.sha256);
  assert.equal(nodePackage.artifact.size, pythonPackage.artifact.size);
  assert.deepEqual(nodePackage.artifact.files, pythonPackage.artifact.files);
});

function run(command, args, env) {
  const completed = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
  });
  if (completed.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${completed.stdout}\n${completed.stderr}`);
  }
  return JSON.parse(completed.stdout);
}

async function completedReview(directory) {
  const template = JSON.parse(
    await fs.readFile(path.join(directory, 'deep-scan-dispositions.template.json'), 'utf8'),
  );
  template.full_review_completed = true;
  for (const row of template.dispositions) {
    row.decision = 'allow';
    row.rationale = 'Reviewed as a bounded environment and network fixture.';
  }
  return template;
}

function comparableOutput(output, keys) {
  return Object.fromEntries(keys.map((key) => [key, output[key]]));
}
