#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(
  repositoryRoot,
  'dist',
  'plugins',
  'codex',
  'taku-publisher',
  'skills',
  'taku-publisher',
);
const cli = path.join(skillRoot, 'scripts', 'taku-publisher.mjs');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-publisher-no-python-'));
const workspace = path.join(temporary, 'workspace');
const source = path.join(workspace, 'sample-skill');
const appSource = path.join(workspace, 'sample-app');
const workflowSource = path.join(workspace, 'sample-workflow');
const candidateOutputRoot = path.join(temporary, 'subapp-candidates');
const skillCandidateOutputRoot = path.join(temporary, 'skill-candidates');
const publisherHome = path.join(temporary, 'publisher-home');
const runtimeBin = path.join(temporary, 'runtime-bin');
const draftId = 'local_no_python_smoke';

try {
  for (const requiredNotice of [
    'LICENSE',
    'NOTICE',
    'THIRD_PARTY_NOTICES.md',
    'TRADEMARKS.md',
    path.join('creator', 'assets', 'fonts', 'OFL-1.1.txt'),
  ]) {
    const noticePath = path.join(skillRoot, requiredNotice);
    const noticeStat = await fs.stat(noticePath).catch(() => undefined);
    if (!noticeStat?.isFile()) {
      throw new Error(`Generated plugin is missing required notice: ${requiredNotice}`);
    }
  }

  const pythonFiles = (await listFiles(skillRoot)).filter((file) =>
    file.endsWith('.py') || file.endsWith('.pyc') || file.endsWith('.pyo'));
  if (pythonFiles.length) {
    throw new Error(`Generated plugin contains Python files: ${pythonFiles.join(', ')}`);
  }

  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(path.join(appSource, 'app'), { recursive: true });
  await fs.mkdir(workflowSource, { recursive: true });
  await fs.mkdir(runtimeBin);
  await fs.mkdir(candidateOutputRoot);
  await fs.mkdir(skillCandidateOutputRoot);
  await fs.symlink(process.execPath, path.join(runtimeBin, process.platform === 'win32' ? 'node.exe' : 'node'));
  await fs.writeFile(
    path.join(source, 'SKILL.md'),
    '---\nname: no-python-smoke\ndescription: Node-only plugin smoke fixture\n---\n# No Python Smoke\n',
  );
  await fs.writeFile(
    path.join(appSource, 'package.json'),
    JSON.stringify({ name: 'sample-app', dependencies: { next: '15.0.0' } }),
  );
  await fs.writeFile(
    path.join(appSource, 'README.md'),
    '# Sample App\n',
  );
  await fs.writeFile(path.join(appSource, 'LICENSE'), 'MIT License\n');
  await fs.writeFile(
    path.join(appSource, 'app', 'page.tsx'),
    'export const calculate = (value) => eval(value);\nexport default function Page() { return <main>Sample</main>; }\n',
  );
  await fs.writeFile(
    path.join(workflowSource, 'README.md'),
    '# Sample Workflow\n\nFormats one local report without network access.\n',
  );
  await fs.writeFile(path.join(workflowSource, 'LICENSE'), 'MIT License\n');
  await fs.writeFile(
    path.join(workflowSource, 'format_report.py'),
    'def format_report(value):\n    return "# Report\\n" + str(value)\n',
  );
  await installFakeGit(runtimeBin);
  const env = {
    ...process.env,
    PATH: runtimeBin,
    TAKU_PUBLISHER_HOME: publisherHome,
  };
  run(['discover', '--workspace', workspace, '--source', source], env);
  run([
    'init',
    '--workspace', workspace,
    '--source', source,
    '--type', 'skill',
    '--mode', 'create',
    '--draft-id', draftId,
  ], env);
  run(['stage', '--draft-id', draftId], env);
  run(['scan', '--draft-id', draftId], env);
  const projectAssessment = run([
    'project-assess',
    '--source', workflowSource,
  ], env);
  if (
    projectAssessment.status !== 'project_route_ready' ||
    projectAssessment.assessment?.route !== 'skill-generation'
  ) {
    throw new Error(`Unexpected project import route: ${projectAssessment.status}`);
  }
  const skillCandidate = run([
    'skill-prepare',
    '--source', workflowSource,
    '--output-root', skillCandidateOutputRoot,
    '--confirm-assessment', projectAssessment.assessment.confirmation_token,
    '--name', 'sample-workflow-skill',
  ], env);
  if (skillCandidate.status !== 'skill_candidate_prepared') {
    throw new Error(`Unexpected Skill candidate status: ${skillCandidate.status}`);
  }
  const skillHandoff = run([
    'skill-convert',
    '--candidate', skillCandidate.candidate_root,
  ], env);
  if (
    skillHandoff.status !== 'skill_agent_handoff_ready' ||
    skillHandoff.scripts_executed !== false
  ) {
    throw new Error(`Unexpected Skill handoff status: ${skillHandoff.status}`);
  }
  const skillCheck = run([
    'skill-conversion-check',
    '--candidate', skillCandidate.candidate_root,
  ], env);
  if (skillCheck.status !== 'skill_conversion_needs_work') {
    throw new Error(`Unexpected initial Skill conversion status: ${skillCheck.status}`);
  }
  const assessment = run([
    'subapp-assess',
    '--source', appSource,
  ], env);
  if (assessment.status !== 'subapp_conversion_review_required') {
    throw new Error(`Unexpected SubApp assessment status: ${assessment.status}`);
  }
  if (assessment.converter?.version !== '0.2.0') {
    throw new Error(`Unexpected bundled Converter version: ${assessment.converter?.version}`);
  }
  const assessmentReview = assessment.assessment_review_template;
  assessmentReview.dispositions[0].decision = 'accepted_with_remediation';
  assessmentReview.dispositions[0].rationale =
    'The fixture deliberately contains dynamic evaluation to exercise the packaged review flow.';
  assessmentReview.dispositions[0].remediation =
    'Replace dynamic evaluation with bounded product logic before the conversion gate can pass.';
  const assessmentReviewPath = path.join(temporary, 'subapp-assessment-review.json');
  await fs.writeFile(assessmentReviewPath, JSON.stringify(assessmentReview));
  const reviewedAssessment = run([
    'subapp-assess',
    '--source', appSource,
    '--assessment-review', assessmentReviewPath,
  ], env);
  if (reviewedAssessment.status !== 'subapp_conversion_review_accepted') {
    throw new Error(`Unexpected reviewed SubApp status: ${reviewedAssessment.status}`);
  }
  const candidate = run([
    'subapp-prepare',
    '--source', appSource,
    '--output-root', candidateOutputRoot,
    '--confirm-assessment', reviewedAssessment.confirmation_token,
    '--assessment-review', assessmentReviewPath,
    '--name', 'sample-candidate',
  ], env);
  if (candidate.status !== 'subapp_candidate_prepared') {
    throw new Error(`Unexpected SubApp candidate status: ${candidate.status}`);
  }
  if (candidate.agent_started !== false || candidate.publish_started !== false) {
    throw new Error('Candidate preparation crossed the Agent or publish boundary.');
  }
  await fs.access(path.join(candidate.workspace_root, '.taku', 'migration.json'));
  const handoff = run([
    'subapp-convert',
    '--candidate', candidate.workspace_root,
  ], env);
  if (handoff.status !== 'subapp_agent_handoff_ready') {
    throw new Error(`Unexpected SubApp Agent handoff status: ${handoff.status}`);
  }
  if (handoff.agent_started !== false || handoff.scripts_executed !== false) {
    throw new Error('SubApp Agent handoff crossed its read-only CLI boundary.');
  }
  const conversionCheck = run([
    'subapp-conversion-check',
    '--candidate', candidate.workspace_root,
  ], env);
  if (conversionCheck.status !== 'subapp_conversion_needs_work') {
    throw new Error(`Unexpected initial conversion status: ${conversionCheck.status}`);
  }
  if (process.platform !== 'win32') {
    const githubAssessment = run([
      'subapp-assess',
      '--source', 'https://github.com/example/sample-app',
      '--source-ref', 'main',
    ], env);
    if (githubAssessment.status !== 'subapp_conversion_eligible') {
      throw new Error(`Unexpected GitHub assessment status: ${githubAssessment.status}`);
    }
    const githubCandidate = run([
      'subapp-prepare',
      '--source', 'https://github.com/example/sample-app',
      '--source-ref', 'main',
      '--output-root', candidateOutputRoot,
      '--confirm-assessment', githubAssessment.confirmation_token,
      '--name', 'github-candidate',
    ], env);
    if (githubCandidate.status !== 'subapp_candidate_prepared') {
      throw new Error(`Unexpected GitHub candidate status: ${githubCandidate.status}`);
    }
    await fs.access(path.join(githubCandidate.workspace_root, '.taku', 'migration.json'));
  }

  const draftDirectory = path.join(publisherHome, draftId);
  const templatePath = path.join(draftDirectory, 'deep-scan-dispositions.template.json');
  const reviewed = JSON.parse(await fs.readFile(templatePath, 'utf8'));
  reviewed.full_review_completed = true;
  for (const row of reviewed.dispositions) {
    row.decision = 'allow';
    row.rationale = 'Reviewed as a bounded local smoke-test fixture.';
  }
  const reviewedPath = path.join(temporary, 'reviewed.json');
  await fs.writeFile(reviewedPath, JSON.stringify(reviewed));
  run(['apply-review', '--draft-id', draftId, '--dispositions', reviewedPath], env);
  run(['package', '--draft-id', draftId], env);
  const status = run(['status', '--draft-id', draftId], env);
  if (status.status !== 'packaged') throw new Error(`Unexpected final status: ${status.status}`);
  const doctor = run(['creator-doctor', '--json'], env);
  if (doctor.runtime !== 'node') throw new Error('Creator Doctor did not report the Node runtime.');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: 'node_only_plugin_smoke_passed',
    plugin: path.relative(repositoryRoot, path.dirname(skillRoot)),
    commands: process.platform === 'win32' ? 18 : 20,
    pythonFiles: 0,
  }, null, 2)}\n`);
} finally {
  const runtimeUrl = pathToFileURL(
    path.join(skillRoot, 'node_modules', '@taku', 'publisher-runtime', 'dist', 'util.js'),
  ).href;
  const { setTreeWritable } = await import(runtimeUrl);
  await setTreeWritable(temporary).catch(() => undefined);
  await fs.rm(temporary, { recursive: true, force: true });
}

async function installFakeGit(binRoot) {
  if (process.platform === 'win32') return;
  const gitPath = path.join(binRoot, 'git');
  await fs.writeFile(
    gitPath,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'init') {
  mkdirSync(join(args.at(-1), '.git'), { recursive: true });
} else if (args[0] === 'remote' && args[1] === 'get-url') {
  process.stdout.write('https://github.com/example/sample-app\\n');
} else if (args[0] === 'symbolic-ref') {
  process.stdout.write('refs/remotes/origin/main\\n');
} else if (args[0] === 'rev-parse') {
  process.stdout.write('0123456789abcdef0123456789abcdef01234567\\n');
} else if (args[0] === 'reset') {
  mkdirSync(join(process.cwd(), 'app'), { recursive: true });
  writeFileSync(join(process.cwd(), 'package.json'), JSON.stringify({ name: 'sample-app', dependencies: { next: '15.0.0' } }));
  writeFileSync(join(process.cwd(), 'README.md'), '# Sample App\\n');
  writeFileSync(join(process.cwd(), 'LICENSE'), 'MIT License\\n');
  writeFileSync(join(process.cwd(), 'app', 'page.tsx'), 'export default function Page() {}\\n');
}
`,
  );
  await fs.chmod(gitPath, 0o755);
}

function run(args, env) {
  const completed = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    env,
    encoding: 'utf8',
  });
  if (completed.stderr) process.stderr.write(completed.stderr);
  if (completed.status !== 0) {
    throw new Error(`Command failed: ${args.join(' ')}\n${completed.stdout}`);
  }
  const parsed = JSON.parse(completed.stdout);
  if (parsed.ok === false) throw new Error(`Command returned an error: ${completed.stdout}`);
  return parsed;
}

async function listFiles(root) {
  const output = [];
  const visit = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) output.push(target);
    }
  };
  await visit(root);
  return output;
}
