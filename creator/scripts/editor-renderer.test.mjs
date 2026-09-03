import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
  renderPreview,
  renderStaxStudioRuntime,
} from './editor-renderer.mjs';

test('bundles the multicolour Gemini mark', async () => {
  const svg = await readFile(new URL('../assets/logos/gemini-color.svg', import.meta.url), 'utf8');
  assert.match(svg, /fill="#3186FF"/);
  assert.match(svg, /stop-color="#08B962"/);
  assert.match(svg, /stop-color="#F94543"/);
  assert.match(svg, /stop-color="#FABC12"/);
});

function draftFixture() {
  return {
    personaV2: {
      code: 'AILW',
      archetype: {
        title: 'Daemon Daddy',
        subtitle: '守护进程老爹',
        signature: '我的脚本，我的儿女',
      },
      confidence: 0.87,
      traits: [
        { id: 'token-tycoon', label: 'Token Tycoon', category: 'Achievement', evidence: 'Top token use', confidence: 0.72 },
        { id: 'flow-state', label: 'Flow State', category: 'Work Pattern', evidence: 'Long sessions', confidence: 0.78 },
        { id: 'tool-hoarder', label: 'Tool Hoarder', category: 'Ecosystem', evidence: 'Many tools', confidence: 0.68 },
        { id: 'polyglot', label: 'Polyglot', category: 'Stack', evidence: 'Many file types', confidence: 0.66 },
        { id: 'self-reflector', label: 'Self-Reflector', category: 'Output', evidence: 'Long WIP', confidence: 0.6 },
      ],
      hiddenCandidates: [
        { id: 'insomniac-daywalker', title: 'Insomniac Daywalker', subtitle: '不眠行者', trigger: '22-04 + 06-12 双时段都高活跃' },
      ],
      axes: [],
      influences: [],
    },
    card: { name: 'ldx', visibility: 'public', serialNumber: 'TAKU-000123', primaryAi: 'codex' },
    aiIdentity: {
      schemaVersion: 'taku.creator.ai-clients.v1',
      defaultClient: 'codex',
      options: [
        { id: 'codex', label: 'CODEX', icon: 'codex' },
        { id: 'claude-code', label: 'CLAUDE', icon: 'claude' },
      ],
    },
    staxProfile: {
      handle: 'ldx',
      social: { x: '@ldx_builds', github: 'ldx' },
      serialNumber: 'TAKU-000417',
      serial: { display: 'No. 000417' },
      daysOnTaku: 12,
      platform: {
        publishedItemCount: 3,
        skillInstallCount: 1300,
        skillCount: 9,
        subscriberCount: 43,
        shareCount: 6,
        registrationRank: 17,
      },
      rank: {
        rankGrade: {
          grade: 'A',
          label: 'A · Server Top 5%',
          topPercent: 0.04,
        },
        percentiles: { installs: 0.96, tokens: 0.99 },
        topPercentiles: { installs: 0.04, tokens: 0.01 },
      },
      blocks: {
        seal: { supported: true, label: 'No. 000417' },
        aura: { supported: true, label: 'AURA-A' },
        water: { supported: true, label: 'Flow' },
        tier4: { supported: true, tier: 'NEON' },
        cgauge: { supported: false, reason: 'No gauge metric yet.' },
        ctxring: { supported: false, reason: 'No context ring data yet.' },
      },
    },
    __toolChoices: {
      displayedTools: [
        {
          id: 'local-tool-1',
          name: 'youtube-to-ebook',
          type: 'skill',
          source: 'local-upload',
          ownership: 'owned',
          metadata: { addedFrom: 'creator-editor' },
        },
      ],
    },
    stats: {
      usage: {
        label: 'This Month',
        totalTokens: 2_574_342_445,
        eventCount: 21_077,
        estimatedCost: { totalUsd: 2147.63 },
        behaviorProfile: {
          userTurnCount: 137,
        },
        localActivity: {
          activeDayCount: 12,
          buildDayCount: 9,
          buildSessionCount: 42,
          chatSessionCount: 18,
          dailyHeatmap: [
            { date: '2026-07-21', active: true, sessionCount: 2, buildSessionCount: 1, eventCount: 6, toolCallCount: 5, tokenCount: 1200, buildIntensity: 2 },
            { date: '2026-07-22', active: true, sessionCount: 3, buildSessionCount: 2, eventCount: 8, toolCallCount: 7, tokenCount: 1800, buildIntensity: 3 },
          ],
          sessionSplit: {
            sessionCount: 60,
            buildSessionCount: 42,
            chatSessionCount: 18,
            buildShare: 0.7,
            chatShare: 0.3,
          },
          buildStreak: { currentDays: 4, bestDays: 9 },
          trend30d: {
            buckets: [
              { id: 'w1', label: '7/1-7/6', buildSessionCount: 3 },
              { id: 'w2', label: '7/7-7/12', buildSessionCount: 8 },
              { id: 'w3', label: '7/13-7/18', buildSessionCount: 12 },
              { id: 'w4', label: '7/19-7/24', buildSessionCount: 14 },
              { id: 'w5', label: '7/25-7/30', buildSessionCount: 5 },
            ],
          },
          delta30d: { current: 42, previous: 21, delta: 1, display: '+100%' },
          workPattern: { peakHour: 22, activeHourCount: 6 },
        },
        sources: [
          { source: 'codex', label: 'Codex', totalTokens: 2_574_342_445, sessionCount: 246 },
        ],
      },
    },
    personaSignals: {
      toolUsage: { usedToolCount: 17, toolCallCount: 210, topTools: [] },
      git: { aiSessionSourceLinesAdded: 8300, aiSessionSourceFilesChanged: 64, aiSessionCommitCount30d: 32 },
      external: {
        rankGrade: {
          grade: 'A',
          label: 'A · Top 5% creator',
          topPercent: 0.04,
          metric: 'installs',
          reason: 'Marketplace installs are in the top 5%.',
        },
        taku: {
          skillInstallCount: 1200,
          publishedItemCount: 8,
          subscriberCount: 42,
          shareCount: 5,
          registrationRank: 18,
        },
        github: {
          totalStars: 256,
          publicRepoCount: 12,
        },
        percentiles: {
          installs: 0.96,
          subscribers: 0.9,
          tokens: 0.99,
          stars: 0.75,
        },
      },
    },
  };
}

test('shows three persona badges on the hero when no hidden persona is featured', () => {
  const data = staxDataFromHtml(renderPreview({
    creator: { username: 'demo' },
    personaV2: {
      code: 'EILW',
      archetype: { title: 'Mad Inventor', signature: 'Demo' },
      traits: [
        { id: 'token-tycoon', label: 'Token Tycoon' },
        { id: 'flow-state', label: 'Flow State' },
        { id: 'snack-coder', label: 'Snack Coder' },
      ],
    },
  }, { editor: { enabled: true } }));

  assert.deepEqual(data.heroTags, ['Token Tycoon', 'Flow State', 'Snack Coder']);
});

function staxDataFromHtml(html) {
  const match = String(html).match(/window\.__TAKU_STAX_DATA__ = (.*?);\nwindow\.__TAKU_STAX_BOOTSTRAP__/s);
  assert.ok(match, 'Stax data bootstrap is missing from the preview HTML');
  return JSON.parse(match[1]);
}

function assertInlineScriptsParse(html) {
  const scripts = [...String(html).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, 'preview HTML should include inline scripts');
  scripts.forEach((match, index) => {
    new vm.Script(match[1], { filename: `preview-inline-${index + 1}.js` });
  });
}

test('opens the share result with the authoritative URL after a cloud Studio publish', () => {
  const html = renderStaxStudioRuntime();
  const initialize = html.match(/function initialize\(message\)\{([\s\S]*?)\n  \}\n  function finishPublish/);

  assert.ok(initialize, 'cloud Studio initialize bridge is missing');
  assert.doesNotMatch(initialize[1], /published:true/);
  assert.doesNotMatch(initialize[1], /scanov.*classList\.add\('off'\)/);
  assert.doesNotMatch(initialize[1], /revealov.*classList\.remove\('on'\)/);
  assert.doesNotMatch(html, /hasPublishedStax/);
  assert.doesNotMatch(html, /else if \(hasPublishedStax/);
  assert.match(html, /if \(data\.readonly\)[\s\S]*?else \{[\s\n]*playIntro\("publisher"\)/);
  assert.match(html, /window\.__TAKU_STAX_INTRO_RUN__=introRun/);
  assert.match(html, /if\(dead\|\|!isCurrentIntro\(\)\)return/);
  assert.match(html, /message\.type===MESSAGE_PREFIX\+'published'/);
  assert.match(html, /setStaxPublication\(publication\)/);
  assert.match(html, /button\.textContent='POSTED ✓'/);
  assert.match(html, /button\.textContent='TRY AGAIN'/);
  assert.match(html, /target\.textContent='PUBLISHING\.\.\.'/);
  assert.match(html, /message\.type===MESSAGE_PREFIX\+'publish-error'/);
  assert.match(html, /window\.__TAKU_STAX_POST__=post/);
  assert.match(html, /message\.type===MESSAGE_PREFIX\+'settings-saved'/);
  assert.match(html, /window\.__TAKU_GITHUB_SAVE_SUCCESS__/);
  assert.match(html, /message\.type===MESSAGE_PREFIX\+'settings-error'/);
  assert.match(html, /event\.target\.closest\('#mpost'\)\)return/);
  assert.match(html, /document\.getElementById\('modal'\)\?\.classList\.remove\('on'\)/);
  assert.match(html, /openShare\('owner'\)/);
  assertInlineScriptsParse(html);
});

test('shows only publishable Skills in the optional Community picker', () => {
  const draft = draftFixture();
  draft.__toolChoices.hiddenTools = [
    { id: 'workflow-1', name: 'Claude Marketing', type: 'workflow', source: 'taku-workflow' },
    { id: 'agent-1', name: 'product-manager', type: 'subagent', source: 'codex-subagent' },
    { id: 'private-skill', name: 'Private Skill', type: 'skill', source: 'codex', publishable: false },
    { id: 'public-skill', name: 'Public Skill', type: 'skill', source: 'codex', publishable: true },
  ];

  const data = staxDataFromHtml(renderPreview(draft, { editor: { enabled: true } }));

  assert.deepEqual(
    data.communityTools.map((item) => ({ name: item.name, type: item.type })),
    [
      { name: 'youtube-to-ebook', type: 'skill' },
      { name: 'Public Skill', type: 'skill' },
    ],
  );
});

test('renders local and Taku creator metrics as simple data tables', () => {
  const html = renderPreview(draftFixture());

  assert.match(html, /Taku Creator 数据维度/);
  assert.match(html, /card serial number/);
  assert.match(html, /No\. 000417/);
  assert.match(html, /days on Taku/);
  assert.match(html, /supported Stax blocks/);
  assert.match(html, /seal, aura, water, tier4/);
  assert.match(html, /unsupported Stax blocks/);
  assert.match(html, /cgauge, ctxring/);
  assert.match(html, /unsupported: No gauge metric yet\./);
  assert.match(html, /daily heatmap/);
  assert.match(html, /daily builds/);
  assert.match(html, /streak days/);
  assert.match(html, /active hours/);
  assert.match(html, /chat\/build split/);
  assert.match(html, /tool calls/);
  assert.match(html, /model mix/);
  assert.match(html, /2\.6B/);
  assert.match(html, /\$2,148/);
  assert.match(html, /30-day delta/);
  assert.match(html, /Marketplace installs/);
  assert.match(html, /1\.3K/);
  assert.match(html, /published works/);
  assert.match(html, /subscribers/);
  assert.match(html, /shares/);
  assert.match(html, /public card view count/);
  assert.match(html, /share count for Stax Card/);
  assert.match(html, /registration rank/);
  assert.match(html, /#17/);
  assert.match(html, /rank grade/);
  assert.match(html, /A · Server Top 5%/);
  assert.match(html, /community compare/);
  assert.match(html, /Top % installs/);
  assert.match(html, /Top 4%/);
  assert.match(html, /Top % tokens/);
  assert.match(html, /Top 1%/);
  assert.match(html, /GitHub stars/);
  assert.match(html, /public repos/);
  assert.match(html, /trend chart/);
  assert.match(html, /2026-07-22/);
  assert.match(html, /raw aggregates/);
  assert.doesNotMatch(html, /Creator tool publishing/);
  assert.doesNotMatch(html, /发布前审核工具/);
  assert.doesNotMatch(html, /api\/publish/);
});

test('renders draft Stax block support data before server-only block fallbacks', () => {
  const draft = {
    ...draftFixture(),
    staxProfile: {},
    personaV2: {
      ...draftFixture().personaV2,
      code: 'AMLW',
      axes: [
        { id: 'howYouBuild', label: 'Architect ↔ Explorer', first: 'A', second: 'E', letter: 'A', score: 0.8 },
        { id: 'whatYouUse', label: 'Maker-facing ↔ Infra-facing', first: 'M', second: 'I', letter: 'M', score: 0.7 },
        { id: 'whenYouBuild', label: 'Owl ↔ Lark', first: 'O', second: 'L', letter: 'L', score: 0.2 },
        { id: 'howYouEcosystem', label: 'Hoarder ↔ Wolf', first: 'H', second: 'W', letter: 'W', score: 0.3 },
      ],
      archetype: {
        title: 'Indie Sigma',
        subtitle: '独立σ',
        signature: '我的栈不带任何人的污染',
      },
    },
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Daemon Daddy' } },
        { key: 'team', status: 'supported', source: 'publisher.ai_identity', value: { team: ['CODEX', 'codex'], identityBasis: 'invoking-host', options: [{ id: 'codex', label: 'CODEX', icon: 'codex' }, { id: 'claude-code', label: 'CLAUDE', icon: 'claude' }] } },
        { key: 'tools', status: 'partial', source: 'publisher.inventory', quality: { label: '待用户选择' }, value: { tools: [{ name: 'youtube-to-ebook' }] } },
        { key: 'ctxring', status: 'partial', source: 'publisher.local_usage', quality: { label: '本地日志' }, value: { ctxAvg: 0.64, avgInputTokens: 66000, requestCount: 24, display: '66K' } },
        { key: 'dots', status: 'partial', source: 'publisher.local_activity.tool_calls', quality: { label: '本地日志' }, value: { apiCalls90d: 86, toolCallCount: 20542, display: '20.5K', periodLabel: 'This Month', dailyToolCalls: [{ date: '2026-07-28', count: 84 }, { date: '2026-07-29', count: 126 }] } },
        { key: 'knock', status: 'partial', source: 'publisher.local_usage', quality: { label: '本地日志' }, value: { label: 'EVENTS', value: '19.1K' } },
        { key: 'bracket', status: 'partial', source: 'publisher.local_usage', estimated: true, quality: { label: '估算' }, value: { label: 'EST. SPEND', value: '$1188', estimated: true, periodId: 'thisMonth', periodLabel: 'This Month' } },
        { key: 'node', status: 'partial', source: 'publisher.inventory', quality: { label: '本地扫描' }, value: { integrations: [{ name: 'PROMPT CRM', color: '#C9F24C' }, { name: 'CODE AGENT', color: '#2BD4C0' }, { name: 'WEB WIDGET', color: '#7C6CF6' }, { name: 'MCP', color: '#FFC93D' }] } },
        { key: 'splitring', status: 'partial', source: 'publisher.local_activity', estimated: true, quality: { label: '估算' }, value: { chatShare: 0.061, buildShare: 0.939, sessionCount: 98, chatSessionCount: 6, buildSessionCount: 92, periodId: 'thisMonth', periodLabel: 'This Month' } },
        { key: 'vsavg', status: 'supported', source: 'server.community.token_snapshot', value: { creatorTokens: 3460000, communityMedian: 1000000, deltaPercent: 246, display: '+246%', baseline: 'median', periodLabel: 'This Month' } },
        { key: 'trend', status: 'partial', source: 'publisher.local_activity', quality: { label: '本地日志' }, value: { metric: 'buildSessions', delta: -0.186, display: '-19%', currentBuilds: 48, previousBuilds: 59, comparison: '48 VS 59', currentPeriodLabel: '7/27-8/1', previousPeriodLabel: '7/21-7/26' } },
        { key: 'bars90', status: 'partial', source: 'publisher.local_usage', quality: { label: '部分样本' }, value: { tokens90d: [0.1, 0.2, 0.3], visualBuckets: [0.3, 0.45, 0.4, 0.6], tokens90dTotal: '2.6B', dayCount: 12, observedBucketCount: 3, isPartialSample: true, periodLabel: 'This Month' } },
        { key: 'dial', status: 'unsupported', source: 'unavailable', reason: 'composite score weights must be defined by backend ranking' },
      ],
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: { loginUrl: 'https://taku.ai/profile?source=taku_creator' },
    },
  });

  assert.match(html, /COOKING YOUR STAX/);
  assert.match(html, /Local Scan Ready/);
  assert.match(html, /Connect Taku/);
  assert.match(html, /Build With Local Blocks/);
  assert.match(html, /id="pboard"/);
  assert.match(html, /id="dockscroll"/);
  assert.match(html, /\.cardpg\{position:relative;margin-top:18px;width:980px;max-width:100%;height:660px/);
  assert.match(html, /\.hud \.usr\{min-width:0;overflow:hidden;text-overflow:ellipsis;font-family:'Space Mono';font-size:12\.5px;letter-spacing:\.13em;color:rgba\(255,255,255,\.55\);white-space:nowrap\}/);
  assert.match(html, /\.hud \.qrswitch,\.hud \.socialswitch\{display:none!important\}/);
  assert.match(html, /\.hud \.btn2,\.hud #lockup,\.hud \.teamswitch\{flex:none\}/);
  assert.match(html, /id="lockup" src="" alt="taku" style="width:auto;height:26px;object-fit:contain"/);
  assert.match(html, /id="bintro"><svg class="bicon"/);
  assert.match(html, /#pboard\{position:absolute;left:74px;top:72px;width:832px;height:520px\}/);
  assert.match(html, /const U=104,PCOLS=8,PROWS=5;/);
  assert.match(html, /signatureAnchors=randomize\?\[\]:\[\['hero',2,1\],\['type',6,1\]\]/);
  assert.match(html, /function shuffleBuild\(stagger,random=false\)/);
  assert.match(html, /shuffleBuild\(true,true\);toast\('SHUFFLED/);
  assert.match(html, /canvas:\{width:980,height:660,columns:PCOLS,rows:PROWS,cellSize:U,gap:GAP\}/);
  assert.match(html, /\.clogo\{width:auto;height:20px/);
  assert.match(html, /class="churl" id="churl"/);
  assert.match(html, /id="churltxt">taku\.ai\/stax\/mason/);
  assert.match(html, /staxUrl: text\(data\.staxCardPageUrl, ""\)/);
  assert.match(html, /setCardHeaderUrl\(PD\.staxUrl\)/);
  assert.match(html, /\.cfoot\{bottom:0;height:68px;padding:0 28px/);
  assert.match(html, /id="cfxpill"/);
  assert.match(html, /id="cfghpill"/);
  assert.match(html, /<b>COOK YOURS<\/b><i>\$<\/i><span>npx taku stax<\/span>/);
  assert.match(html, /const social=PD\.social&&typeof PD\.social==='object'\?PD\.social:\{\}/);
  assert.match(html, /classList\.toggle\('is-hidden',!github\)/);
  assert.match(html, /\.tchip\.on \.tv\{opacity:\.35;filter:saturate\(\.7\)\}/);
  assert.match(html, /\.tchip\.on::after\{content:"";position:absolute;right:-4px;top:-4px;width:18px;height:18px;border-radius:50%;background:#C9F24C/);
  assert.match(html, /\.tchip\.lock \.tv\{filter:grayscale\(1\);opacity:\.22\}/);
  assert.match(html, /const lockIcon=isAction/);
  assert.match(html, /\$\{lockIcon\}<span>\$\{safeText\(lockHint\)\}<\/span>/);
  assert.match(html, /<span>\$\{safeText\(lockHint\)\}<\/span>/);
  assert.match(html, /id="teamselect"/);
  assert.match(html, /"teamOptions":\[\{"id":"codex","label":"CODEX","icon":"codex","selected":true\},\{"id":"claude-code","label":"CLAUDE","icon":"claude","selected":false\}\]/);
  assert.match(html, /primaryAi: selectedTeam\.id/);
  assert.match(html, /const planned=planBuildLayout\(P\.fullset,Boolean\(random\)\)/);
  assert.match(html, /\.stagev \*,\.dock \*,\.dockdrag\{user-select:none;-webkit-user-select:none\}/);
  assert.match(html, /if\(d\.classList\.contains\('on'\)\)return;/);
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /font-family:'Space Grotesk'/);
  assert.match(html, /font-family:'Instrument Serif'/);
  assert.match(html, /window\.__TAKU_STAX_BOOTSTRAP__/);
  assert.match(html, /"code":"AMLW"/);
  assert.match(html, /"title":"INDIE"/);
  assert.match(html, /"subtitle":"Sigma"/);
  assert.match(html, /"personaTitle":"Indie Sigma"/);
  assert.match(html, /"heroDefinition":"My stack stays uncontaminated by anyone else/);
  assert.match(html, /"heroBadge":"Insomniac Daywalker"/);
  assert.match(html, /"heroTags":\[/);
  assert.match(html, /"Token Tycoon"/);
  assert.match(html, /"Flow State"/);
  assert.match(html, /"heroBadgeColor":"#[0-9A-F]{6}"/);
  assert.match(html, /"family":"CRAFTSMEN"/);
  assert.match(html, /"familyColor":"#AECDE0"/);
  assert.match(html, /LBL\('left:15px','top:15px','TEAM','rgba\(255,255,255,\.55\)',h\*0\.076\)/);
  assert.doesNotMatch(html, /LBL\('left:13px','top:11px','PRIMARY AI'/);
  assert.match(html, /left:15px;top:56%;transform:translateY\(-50%\);width:\$\{h\*0\.5\}px/);
  assert.match(html, /font-family:\$\{GK\};font-weight:700;font-size:\$\{h\*0\.32\}px[^>]+>\$\{safeText\(name\)\}/);
  assert.match(html, /const axisRows=Array\.from\(\{length:4\},\(_,i\)=>/);
  assert.match(html, /const n=12,bw=\(w-30-\(n-1\)\*3\)\/n/);
  assert.match(html, /const typeCode=String\(PD\.type\|\|''\)\.trim\(\)\.toUpperCase\(\)\.slice\(0,4\)/);
  assert.match(html, /const displayAxisLabel=value=>safeText\(w<170\?String\(value\)\.slice\(0,5\):value\)/);
  assert.match(html, /LBL\('left:15px','top:15px','TYPE','rgba\(255,255,255,\.55\)',h\*0\.052\)/);
  assert.match(html, /right:15px;top:15px[^>]+>\$\{safeText\(typeCode\)\}/);
  assert.match(html, /const ty=h\*0\.185\+i\*h\*0\.198/);
  assert.match(html, /gap:3px;margin-top:\$\{h\*0\.03\}px/);
  assert.match(html, /width:\$\{bw\}px;height:\$\{h\*0\.045\}px/);
  assert.match(html, /LBL\('left:18px','top:14px','ARCHETYPE · '\+safeText\(PD\.family\),dm,h\*0\.05,'z-index:2'\)/);
  assert.doesNotMatch(html, /LBL\('right:18px','top:14px',safeText\(PD\.family\)/);
  assert.match(html, /top:\$\{h\*0\.13\}px;font-family:\$\{GK\};font-weight:700;font-size:\$\{h\*0\.115\}px;letter-spacing:-\.03em;color:\$\{tx\}[^>]+>\$\{safeText\(PD\.handle\)\}/);
  assert.match(html, /titleParts\[0\]=titleParts\[0\]\.replace\(\/\^THE\(\?:\\s\+\|\$\)\/i,''\)\.trim\(\)/);
  assert.match(html, /const singleLineThreshold=h\*1\.05/);
  assert.match(html, /const singleLineMaxWidth=h\*1\.25/);
  assert.match(html, /const splitTitle=baseTitleWidth>singleLineThreshold&&normalizedTitleParts\.length>1/);
  assert.match(html, /const titleSize=splitTitle\?baseTitleSize:Math\.min\(h\*0\.23/);
  assert.match(html, /const titleTop=splitTitle\?h\*0\.2725:h\*0\.28/);
  assert.match(html, /const taglineTop=splitTitle\?h\*0\.615:h\*0\.57/);
  assert.match(html, /font-family:\$\{GK\};font-weight:700;font-size:\$\{titleSize\}px;line-height:\.99/);
  assert.doesNotMatch(html, /\$\{safeText\(PD\.n1\)\}<br><em style="font-family:\$\{IS\}/);
  assert.match(html, /width:\$\{w-h\*0\.82-30\}px[^>]+line-height:1\.5[^>]+max-height:\$\{h\*0\.15\}px/);
  assert.match(html, /const tagStyles=\[\[C\.lime,'#161A06'\],\[C\.teal,'#06322D'\],\[C\.yellow,'#3A2803'\]\]/);
  assert.match(html, /box-shadow:3px 3px 0 rgba\(0,0,0,\.35\)/);
  assert.match(html, /bottom:44px;width:\$\{h\*0\.72\}px/);
  assert.match(html, /"tokens90d":\[0\.1,0\.2,0\.3\]/);
  assert.match(html, /"visualBuckets":\[0\.3,0\.45,0\.4,0\.6\]/);
  assert.match(html, /"tokens90dTotal":"2\.6B"/);
  assert.match(html, /"dayCount":12/);
  assert.match(html, /"isPartialSample":true/);
  assert.match(html, /const defaultBars=\[\.3,\.45,\.4,\.6,\.5,\.75,\.62,\.85,\.7,\.95,\.8,1\]/);
  assert.match(html, /const values=Array\.from\(\{length:12\},\(_,i\)=>Math\.max\(0,Number\(source\?\.\[i\]\)\|\|0\)\)/);
  assert.match(html, /const max=Math\.max\(0,\.\.\.values\)\|\|1/);
  assert.match(html, /const n=12,bw=\(w-\(n-1\)\*3\)\/n,base=h\*0\.5/);
  assert.match(html, /left:15px;right:\$\{labelRight\}px[^>]+>\$\{label\}<\/div>/);
  assert.match(html, /right:15px;top:\$\{h-base\*0\.5\}px[^>]+font-size:\$\{h\*0\.24\}px/);
  assert.match(html, /TOKENS · \$\{period\}/);
  assert.match(html, /period\.length>8\?`TOKENS ·<br>\$\{safeText\(period\)\}`/);
  assert.match(html, /"apiCalls90d":86,"toolCallCount":20542,"display":"20\.5K","periodLabel":"This Month"/);
  assert.match(html, /API CALLS · 90 DAYS/);
  assert.match(html, /dailyToolCalls: Array\.isArray\(dotsValue\.dailyToolCalls\)/);
  assert.match(html, /const cols=15,rows=6,capacity=cols\*rows,r=2\.6/);
  assert.match(html, /const total=Math\.min\(capacity,rawTotal\)/);
  assert.match(html, /for\(let y=0;y<rows;y\+\+\)for\(let x=0;x<cols;x\+\+\)/);
  assert.match(html, /svgWrap\(w,h,shadowed\(rr\(w,h\),C\.ink\)\+`<path d="\$\{rr\(w,h\)\}" fill="none" stroke="\$\{C\.blue\}"/);
  assert.match(html, /apiCalls90d: Number\.isFinite\(Number\(dotsValue\.apiCalls90d\)\)/);
  assert.doesNotMatch(html, /LOCAL TOOL CALLS/);
  assert.match(html, /"creatorTokens":3460000,"communityMedian":1000000,"deltaPercent":246/);
  assert.match(html, /const median=Math\.max\(0,Number\(PD\.vsavg\?\.communityMedian\)\|\|0\)/);
  assert.match(html, />AVG<\/text>/);
  assert.match(html, /font-size="\$\{F\(h\*0\.085\)\}" fill="\$\{medianLabel\}">AVG<\/text>/);
  assert.match(html, /TOKENS · 90D VS COMMUNITY/);
  assert.doesNotMatch(html, /TOKENS · YOU VS COMMUNITY/);
  assert.match(html, /\$\{display\}<\/div>/);
  assert.doesNotMatch(html, />\+246%<\/div>/);
  assert.match(html, /LBL\('left:11px','top:10px','Δ 30 DAYS'/);
  assert.doesNotMatch(html, /LOCAL TREND/);
  assert.doesNotMatch(html, /VS PREV 6D/);
  assert.match(html, /"currentBuilds":48,"previousBuilds":59,"comparison":"48 VS 59"/);
  assert.match(html, /currentPeriodLabel: text\(trendValue\.currentPeriodLabel/);
  assert.match(html, /WHAT IT MEANS/);
  assert.match(html, /not server-verified and not a quality or productivity score/);
  assert.doesNotMatch(html, /const cols=15,rows=5/);
  assert.match(html, /"rankTopPercentLabel":""/);
  assert.match(html, /"lockLabel":"GROW ON TAKU"/);
  assert.match(html, /"unlockSummary":\{"localReady":\d+,"takuAuth":\d+,"unavailable":\d+,"total":\d+\}/);
  assert.match(html, /"unlockKind":"taku-auth"/);
  assert.match(html, /function ceremonyBlocks\(P\)/);
  assert.match(html, /block\.key==='badges'/);
  assert.match(html, /String\(block\.status\|\|'supported'\)\.toLowerCase\(\)==='unsupported'/);
  assert.match(html, /const blocks=ceremonyBlocks\(P\)/);
  assert.match(html, /const CEREMONY_ORDER=\['hero','qr','social','team','type','tier1','basic','seal','bars90'\]/);
  assert.match(html, /intro\.copy\|\|GUIDE_DESCRIPTIONS\[block\.key\]\|\|guideSourceDetail\(block\.source,block\)/);
  assert.match(html, /hero:\{title:'YOUR HERO BLOCK'/);
  assert.match(html, /social:\{title:'FIND ME'/);
  assert.match(html, /type:\{title:'YOUR FOUR AXES'/);
  assert.match(html, /basic:\{title:'DAYS ON TAKU'/);
  assert.match(html, /seal:\{title:'YOUR SERIAL'/);
  assert.match(html, /ONE OF 16 ARCHETYPES/);
  assert.match(html, /UNLOCKED · \$\{String\(position\)\.padStart\(2,'0'\)\} \/ \$\{String\(total\)\.padStart\(2,'0'\)\}/);
  assert.match(html, /\$\{ceremonyPreviewFor\(block\)\}/);
  assert.match(html, /scale=Math\.min\(1\.25,430\/w\)/);
  assert.match(html, /CLICK TO ENTER STUDIO/);
  assert.match(html, /R\.social=\(w,h\)=>/);
  assert.match(html, /social:\[1,1\]/);
  assert.match(html, /const iconSize=h\*0\.22/);
  assert.match(html, /left:15px;top:\$\{h\*0\.42\}px/);
  assert.match(html, /left:15px;right:12px;bottom:14px/);
  assert.match(html, /font-size:\$\{F\(h\*0\.13\)\}px/);
  assert.match(html, /const socialValue = value\("social"\)/);
  assert.match(html, /social: \{ x: text\(socialValue\.x, ""\), github: text\(socialValue\.github, ""\) \}/);
  assert.match(html, /document\.getElementById\('bintro'\)\.addEventListener\('click',\(\)=>ceremony\(CURP\)\)/);
  assert.doesNotMatch(html, /id="renter"/);
  assert.match(html, /lockKind==='taku-auth'\?'Connect Taku to unlock':'Not available yet'/);
  assert.match(html, /topPercentLabel: text\(tier1Value\.topPercentLabel, data\.rankTopPercentLabel\)/);
  assert.match(html, /topPercent: Number\(tier1Value\.topPercent\) \|\| 0/);
  assert.doesNotMatch(html, /data\.rankTopPercentLabel \|\| "25%"/);
  assert.match(html, /const tier=String\(rank\.tier\|\|'STANDARD'\)\.trim\(\)\.toUpperCase\(\)/);
  assert.match(html, /if\(tier==='LASER'\)return R\.tier4\(w,h,pct\)/);
  assert.match(html, /if\(tier==='NEON'\)return R\.aura\(w,h,pct\)/);
  assert.match(html, /if\(tier==='SWEEP'\)return R\.tier2\(w,h,pct\)/);
  assert.match(html, /R\.tier2=\(w,h,pct='10%'\)=>/);
  assert.match(html, /fill="none" stroke="\$\{C\.lime\}" stroke-width="2"/);
  assert.match(html, /font-size:\$\{h\*0\.34\}px;color:\$\{C\.lime\}">\$\{safeText\(pct\)\}/);
  assert.match(html, /class="ct sweepfx" style="inset:0"/);
  assert.match(html, /background-size:260% 100%;animation:sweep 3\.2s ease-in-out infinite/);
  assert.match(html, /R\.aura=\(w,h,pct='1%'\)=>/);
  assert.match(html, /class="ct neono" style="inset:0"/);
  assert.match(html, /animation:glowo 2\.6s ease-in-out infinite/);
  assert.match(html, /fill="none" stroke="url\(#ag\$\{id\}\)" stroke-width="2"/);
  assert.match(html, /'TOP','#FF9A55',h\*0\.088,'white-space:nowrap;letter-spacing:\.34em'/);
  assert.match(html, /-webkit-background-clip:text;background-clip:text;color:transparent">\$\{safeText\(pct\)\}/);
  assert.match(html, /R\.tier4=\(w,h,pct='\.1%'\)=>/);
  assert.match(html, /background:conic-gradient\(#FF5A1F,#FFC93D,#C9F24C,#2BD4C0,#7C6CF6,#FF5A1F\);animation:spinbg 5\.5s linear infinite/);
  assert.match(html, /inset:2px;border-radius:7px;background:#17171E/);
  assert.match(html, /background:linear-gradient\(100deg,#FF5A1F,#FFC93D,#C9F24C,#2BD4C0,#7C6CF6\);-webkit-background-clip:text;background-clip:text;color:transparent/);
  assert.match(html, /LBL\('left:50%;transform:translateX\(-50%\)',`top:\$\{h\*0\.18\}px`,'TOP','rgba\(255,255,255,\.45\)',h\*0\.09,'white-space:nowrap'\)/);
  assert.match(html, /bottom:\$\{h\*0\.16\}px;font-size:\$\{h\*0\.37\}px;color:rgba\(255,255,255,\.75\)/);
  assert.match(html, /"needsTakuAuth":true/);
  assert.match(html, /"loginUrl":"https:\/\/taku.ai\/profile\?source=taku_creator"/);
  assert.match(html, /"art":"persona_AMLW"/);
  assert.match(html, /"artDataUrl":"data:image\/png;base64,/);
  assert.match(html, /PD\.heroBadge/);
  assert.match(html, /PD\.heroTags/);
  assert.match(html, /PD\.signature/);
  assert.match(html, /SEAL 2×2 — circular block: serial\/edition/);
  assert.match(html, /const cx=w\/2,cy=h\/2,R0=Math\.min\(w,h\)\*0\.44/);
  assert.match(html, /serialDigits\?`Nº \$\{serialDigits\}`:serialRaw/);
  assert.match(html, /y="\$\{cy\+R0\*0\.58\}"[^>]+letter-spacing="1\.5"[^>]*>GENESIS EDITION<\/text>/);
  assert.doesNotMatch(html, /cy\+R0\*0\.68/);
  assert.match(html, /LBL\('left:13px','top:13px',safeText\(PD\.basicLbl\|\|'DAYS · ON TAKU'\),'rgba\(23,18,58,\.62\)',h\*0\.085\)/);
  assert.match(html, /left:13px;bottom:\$\{h\*0\.13\}px;font-size:\$\{h\*0\.4\}px;color:#17123A">\$\{safeText\(PD\.basicVal\|\|'0'\)\}/);
  assert.doesNotMatch(html, />LIVE<\/text>/);
  assert.match(html, /pie:\[2,2\]/);
  assert.match(html, /modelcost:\[2,2\]/);
  assert.doesNotMatch(html, /R\.halfl=/);
  assert.doesNotMatch(html, /R\.halfr=/);
  assert.doesNotMatch(html, /halfl:\[1,2\]/);
  assert.doesNotMatch(html, /halfr:\[1,2\]/);
  assert.match(html, /const EARNED=\[\['pie'\],\['modelcost'\]/);
  assert.match(html, /const LOCKED=\[\['node','WIRE 3\+ TOOLS'\],\['splitring','CONNECT 30-DAY USAGE'\]\]/);
  assert.doesNotMatch(html, /const EARNED=.*\['aura'\]/);
  assert.doesNotMatch(html, /const LOCKED=.*\['tier4'/);
  assert.match(html, /key === "aura" \|\| key === "tier4" \? "tier1" : key/);
  assert.match(html, /MODEL MIX · \$\{periodShortLabel\(PD\.pie\?\.periodLabel\)\}/);
  assert.match(html, /const cx=w\/2,cy=h\*0\.37,Rr=Math\.min\(w,h\)\*0\.25/);
  assert.match(html, /stroke="#111116" stroke-width="2"/);
  assert.match(html, /top:\$\{h\*\(0\.655\+i\*0\.11\)\}px/);
  assert.doesNotMatch(html, /cy=h\*0\.4,Rr=Math\.min\(w,h\)\*0\.27/);
  assert.match(html, /const cx=w\/2,cy=h\*0\.56,Rr=Math\.min\(w,h\)\/2-22,a0=-215,a1=35/);
  assert.match(html, /arc\(a0,a1,'rgba\(255,255,255,\.13\)',14\)\+arc\(a0,a0\+\(a1-a0\)\*val,C\.blue,14\)/);
  assert.match(html, /font-size="\$\{h\*0\.21\}" letter-spacing="-1" fill="#fff">\$\{safeText\(pctLabel\)\}<\/text>/);
  assert.match(html, /'MONTHLY QUOTA','rgba\(255,255,255,\.55\)',h\*0\.052/);
  assert.match(html, /`bottom:\$\{h\*0\.055\}px`,safeText\(resetLabel\),'rgba\(255,255,255,\.4\)',h\*0\.05/);
  assert.match(html, /R\.modelcost=\(w,h\)=>/);
  assert.match(html, /function planBuildLayout\(keys,randomize=false\)/);
  assert.match(html, /const planned=planBuildLayout\(P\.fullset,Boolean\(random\)\)/);
  assert.match(html, /API EQUIV\./);
  assert.match(html, /PARTIAL · \$\{coverage\}% PRICED/);
  assert.match(html, /top:\$\{h\*\(0\.655\+i\*0\.11\)\}px;display:flex;align-items:center;gap:8px/);
  assert.match(html, /border-bottom:1px dotted rgba\(255,255,255,\.16\)/);
  assert.match(html, /const display=safeText\(modelDisplayName\(name\)\)/);
  assert.match(html, /return \{label:'CLAUDE',icon:'ic_claude'\}/);
  assert.match(html, /return \{label:'CODEX',icon:'ic_codex'\}/);
  assert.match(html, /return \{label:'CURSOR',icon:'ic_cursor'\}/);
  assert.match(html, /return \{label:'GEMINI',icon:'ic_gemini'\}/);
  assert.match(html, /return \{label:'DEEPSEEK',icon:'ic_deepseek'\}/);
  assert.match(html, /return \{label:'GROK',icon:'ic_grok'\}/);
  assert.match(html, /return \{label:'LLAMA',icon:'ic_llama'\}/);
  assert.match(html, /"logo_mark":"data:image\/svg\+xml;base64,/);
  assert.match(html, /"ic_cursor":"data:image\/svg\+xml;base64,/);
  assert.match(html, /"ic_gemini":"data:image\/svg\+xml;base64,/);
  assert.match(html, /"ic_deepseek":"data:image\/svg\+xml;base64,/);
  assert.match(html, /background:\$\{background\};color:\$\{color\};box-shadow:3px 3px 0 rgba\(0,0,0,\.35\)/);
  assert.match(html, /left:18px;right:18px;bottom:11px;display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:visible;z-index:2/);
  assert.match(html, /async function exportPreviewPng\(\)/);
  assert.match(html, /fetch\('\/api\/export\/png'/);
  assert.doesNotMatch(html, /canvas\.toBlob/);
  assert.match(html, /const filename='taku-stax-'\+publicSlug\(PD\.handle\)\+'\.png'/);
  assert.match(html, /link\.download=filename/);
  assert.doesNotMatch(html, /PNG EXPORT · wired in prod/);
  assert.match(html, /POST TO FEED ↗/);
  assert.match(html, /data-m="full">FULL CARD/);
  assert.match(html, /data-m="mini">MINI CARD/);
  assert.match(html, /function buildMini\(\)/);
  assert.match(html, /"shareTitle":"Certified flex\."/);
  assert.match(html, /\.pb\.shake\{animation:shake \.32s\}/);
  assert.match(html, /el\.dataset\.blockKey=key/);
  assert.match(html, /el\.addEventListener\('animationend',\(\)=>el\.classList\.remove\('shake'\),\{once:true\}\)/);
  assert.match(html, /function renderPublishPreview\(mode\)/);
  assert.match(html, /clone\.querySelectorAll\('\.drag,\.fresh,\.shake'\)\.forEach\(el=>el\.classList\.remove\('drag','fresh','shake'\)\)/);
  assert.match(html, /renderPublishPreview\(button\.dataset\.m\)/);
  assert.doesNotMatch(html, /renderPublishPreview\(button\.dataset\.m,true\)/);
  assert.match(html, /COMMUNITY · OPTIONAL/);
  assert.match(html, /默认只显示在 Profile/);
  assert.match(html, /"communityTools":\[\{"id":"local-tool-1","name":"youtube-to-ebook","type":"skill"/);
  assert.doesNotMatch(html, /id="mprofile"/);
  assert.match(html, /id="mlink">COPY LINK/);
  assert.match(html, /function profilePublicUrl\(\)/);
  assert.match(html, /STAX LINK COPIED/);
  assert.match(html, /channel:'copy-stax'/);
  assert.match(html, /api\/stax\/publication/);
  assert.match(html, /api\/stax\/share/);
  assert.doesNotMatch(html, /LIVE AT stax\.taku\.ai/);
  assert.match(html, /const EARNED=\[\['pie'\]/);
  assert.doesNotMatch(html, /const EARNED=.*\['badges'\]/);
  assert.match(html, /const badgeLabel=value=>String\(value\|\|''\)\.trim\(\)\.toUpperCase\(\)\.slice\(0,14\)/);
  assert.match(html, /const B=profileBadgeLabels\(\)/);
  assert.match(html, /left:4px;top:\$\{y\}px;width:max-content;height:\$\{ph\}px;padding:0 \$\{h\*0\.18\}px/);
  assert.match(html, /\{background:C\.lime,color:'#161A06',border:'none'\}/);
  assert.match(html, /\{background:'transparent',color:C\.teal,border:`2px solid \$\{C\.teal\}`\}/);
  assert.match(html, /box-sizing:border-box;white-space:nowrap/);
  assert.match(html, /box-shadow:4px 4px 0 rgba\(0,0,0,\.4\)/);
  assert.match(html, /pill\(4\+h\*0\.14,0,B\[0\]\)\+\s*\n\s*pill\(4\+h\*0\.56,1,B\[1\]\)/);
  assert.doesNotMatch(html, /LBL\('left:2px','top:1px','BUILDER BADGES'/);
  assert.match(html, /R\.badge=\(w,h,index=0\)=>/);
  assert.match(html, /const palette=\[\[C\.lime,'#161A06'\],\[C\.teal,'#06322D'\],\[C\.yellow,'#3A2803'\]\]/);
  assert.match(html, /Array\.from\(\{length:24\}/);
  assert.match(html, /font-weight:700;font-size:13\.4px;letter-spacing:-\.02em;line-height:\.95[^>]+text-transform:uppercase/);
  assert.match(html, /function badgeBlockKeys\(\)\{return profileBadgeLabels\(\)\.map\(\(_,index\)=>'badge'\+index\);\}/);
  assert.match(html, /function blockSize\(key\)\{return badgeKeyIndex\(key\)>=0\?\[1,1\]:SIZES\[key\];\}/);
  assert.match(html, /earnedKeys\.splice\(insertAt,0,\.\.\.badgeBlockKeys\(\)\)/);
  assert.match(html, /el\.innerHTML=renderBlock\(key,w,h\)/);
  assert.match(html, /"axes":\[\["EXPLORER","ARCHITECT","#7C6CF6",2\]/);
  assert.match(html, /\["MAKER","INFRA","#2BD4C0",7\]/);
  assert.match(html, /\["LARK","OWL","#C9F24C",8\]/);
  assert.match(html, /\["WOLF","HOARDER","#FFC93D",7\]/);
  assert.doesNotMatch(html, /ARCHITECT ↔ EXPLORER/);
  assert.match(html, /hero/);
  assert.match(html, /ctxring/);
  assert.match(html, /const cx=w\/2,cy=h\*0\.58,r=w\*0\.3,circ=2\*Math\.PI\*r/);
  assert.match(html, /stroke="\$\{C\.teal\}" stroke-width="8" stroke-linecap="round"/);
  assert.match(html, /stroke-dasharray="\$\{\(circ\*v\)\.toFixed\(1\)\} \$\{circ\.toFixed\(1\)\}"/);
  assert.match(html, /'CONTEXT','rgba\(255,255,255,\.55\)',h\*0\.082/);
  assert.match(html, /ctxAvg: Number\.isFinite\(Number\(ctxringValue\.ctxAvg\)\)/);
  assert.doesNotMatch(html, /TOKENS \/ REQUEST/);
  assert.doesNotMatch(html, /'AVG INPUT','rgba\(255,255,255,\.55\)'/);
  assert.match(html, /const ax=w\*0\.63, ay=h\*0\.42, L=w\*0\.26/);
  assert.match(html, /LBL\('left:11px','top:10px','Δ 30 DAYS','rgba\(255,255,255,\.55\)',h\*0\.085\)/);
  assert.match(html, /bottom:\$\{h\*0\.12\}px;font-size:\$\{h\*0\.26\}px/);
  assert.doesNotMatch(html, /LOCAL TREND/);
  assert.doesNotMatch(html, /VS PREV 6D/);
  assert.match(html, /const valueSize=h\*\(value\.length>5\?0\.34:0\.4\)/);
  assert.match(html, /LBL\('left:13px','top:13px',safeText\(label\),'rgba\(61,42,4,\.65\)',h\*0\.088\)/);
  assert.doesNotMatch(html, /LOCAL EVENTS/);
  assert.doesNotMatch(html, /`LOCAL \$\{label\}`/);
  assert.match(html, /API CALLS/);
  assert.match(html, /19\.1K/);
  assert.match(html, /EST\. SPEND/);
  assert.match(html, /THIS MONTH/);
  assert.match(html, /\$1188/);
  assert.match(html, /const amountSize=h\*\(amount\.length>5\?0\.26:amount\.length>4\?0\.29:0\.32\)/);
  assert.match(html, /top:\$\{h\*0\.17\}px`,safeText\(label\),'rgba\(244,240,230,\.6\)',h\*0\.082/);
  assert.match(html, /bottom:\$\{h\*0\.16\}px;font-size:\$\{amountSize\}px/);
  assert.doesNotMatch(html, /const period=String\(PD\.bracket/);
  assert.doesNotMatch(html, /SPEND · 90D/);
  assert.match(html, /YOUR STACK · \$\{dots\.length\} WIRED/);
  assert.match(html, />YOU<\/text>/);
  assert.match(html, /"integrations":\[\{"name":"PROMPT CRM","color":"#C9F24C"\}/);
  assert.match(html, /Array\.isArray\(nodeValue\.integrations\)/);
  assert.match(html, /Array\.isArray\(nodeValue\.categories\)/);
  assert.doesNotMatch(html, /LOCAL STACK/);
  assert.doesNotMatch(html, /CAPABILITIES/);
  assert.match(html, /const cx=h\*0\.5,cy=h\*0\.54,r=h\*0\.27/);
  assert.match(html, /left:\$\{h\*0\.98\}px`,'top:13px','SPLIT · 30D'/);
  assert.match(html, /top:\$\{h\*0\.38\}px.*CHAT <b/);
  assert.match(html, /top:\$\{h\*0\.64\}px.*BUILD <b/);
  assert.doesNotMatch(html, /SESSION MIX/);
  assert.doesNotMatch(html, /\$\{period\} · EST\./);
  assert.doesNotMatch(html, /\$\{safeText\(total\)\} SESSIONS/);
  assert.match(html, /"chatSessionCount":6/);
  assert.match(html, /"buildSessionCount":92/);
  assert.match(html, /SPLIT · 30D/);
  assert.doesNotMatch(html, /TIME SPLIT · 30D/);
  assert.doesNotMatch(html, /SESSION MIX · \$\{period\}/);
  assert.doesNotMatch(html, /SESSIONS · EST\./);
  assert.match(html, /Needs Selection/);
  assert.match(html, /Local Logs/);
  assert.match(html, /dial/);
  assert.doesNotMatch(html, /独立σ/);
  assert.match(html, /api\/card/);
});

test('deduplicates Stax team labels before rendering the card', () => {
  const draft = {
    ...draftFixture(),
    staxProfile: {},
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'team',
          status: 'supported',
          source: 'publisher.usage.sources',
          value: {
            team: ['CODEX', 'codex'],
            sources: [
              { source: 'codex', label: 'Codex' },
              { source: 'openai-codex', label: 'Codex' },
              { source: 'claude-code', label: 'Claude' },
            ],
          },
        },
        { key: 'type', status: 'supported', source: 'publisher.persona', value: { type: 'AMLW' } },
      ],
    },
  };

  const html = renderPreview(draft, { editor: { enabled: true } });

  assert.match(html, /"team":"CODEX"/);
  assert.doesNotMatch(html, /"team":"CODEX \/ CLAUDE"/);
  assert.match(html, /team: \[text\(data\.team \|\| teamValue\.team, "CODEX"\)/);
  assert.doesNotMatch(html, /CODEX,CODEX/);
});

test('maps the HACKERS hero variant without changing the selected team', () => {
  const draft = draftFixture();
  draft.personaV2.code = 'EILW';

  const data = staxDataFromHtml(renderPreview(draft, { editor: { enabled: true } }));

  assert.equal(data.family, 'HACKERS');
  assert.equal(data.familyColor, '#F0641E');
  assert.equal(data.art, 'persona_EILW');
  assert.equal(data.team, 'CODEX');
});

test('maps the ARCHITECTS hero variant to its deep purple family palette', () => {
  const draft = draftFixture();
  draft.personaV2.code = 'AILW';

  const data = staxDataFromHtml(renderPreview(draft, { editor: { enabled: true } }));

  assert.equal(data.family, 'ARCHITECTS');
  assert.equal(data.familyColor, '#5F3794');
  assert.equal(data.art, 'persona_AILW');
});

test('renders the selected Claude team with its official asset and brand colour', () => {
  const draft = draftFixture();
  draft.card.primaryAi = 'claude-code';
  draft.aiIdentity.defaultClient = 'claude-code';
  draft.staxBlocks = {
    schemaVersion: 'taku.stax.blocks.v1',
    blocks: [
      { key: 'team', status: 'supported', source: 'publisher.ai_identity', value: { team: ['CLAUDE', 'claude'], teamIcon: 'claude' } },
    ],
  };

  const html = renderPreview(draft, { editor: { enabled: true } });
  const data = staxDataFromHtml(html);

  assert.equal(data.team, 'CLAUDE');
  assert.equal(data.teamIcon, 'claude');
  assert.match(html, /"ic_claude":"data:image\/svg\+xml;base64,/);
  assert.match(html, /kind==='claude' \? '#DA7756'/);
});

test('renders the selected Codex team with its official asset and brand colour', () => {
  const draft = draftFixture();
  draft.staxBlocks = {
    schemaVersion: 'taku.stax.blocks.v1',
    blocks: [
      { key: 'team', status: 'supported', source: 'publisher.ai_identity', value: { team: ['CODEX', 'codex'], teamIcon: 'codex' } },
    ],
  };

  const html = renderPreview(draft, { editor: { enabled: true } });
  const data = staxDataFromHtml(html);

  assert.equal(data.team, 'CODEX');
  assert.equal(data.teamIcon, 'codex');
  assert.match(html, /"ic_codex":"data:image\/svg\+xml;base64,/);
  assert.match(html, /kind==='codex' \? '#8B87F8'/);
});

test('renders the selected Cursor team with its official asset and brand colour', () => {
  const draft = draftFixture();
  draft.staxBlocks = {
    schemaVersion: 'taku.stax.blocks.v1',
    blocks: [
      { key: 'team', status: 'supported', source: 'publisher.ai_identity', value: { team: ['CURSOR', 'cursor'], teamIcon: 'cursor' } },
    ],
  };

  const html = renderPreview(draft, { editor: { enabled: true } });
  const data = staxDataFromHtml(html);

  assert.equal(data.team, 'CURSOR');
  assert.equal(data.teamIcon, 'cursor');
  assert.match(html, /"ic_cursor":"data:image\/svg\+xml;base64,/);
  assert.match(html, /kind==='codex' \? '#8B87F8' : '#E8E6E1'/);
});

test('maps the VIBE MAKERS hero variant to its muted green family palette', () => {
  const draft = draftFixture();
  draft.personaV2.code = 'EMLW';

  const data = staxDataFromHtml(renderPreview(draft, { editor: { enabled: true } }));

  assert.equal(data.family, 'VIBE MAKERS');
  assert.equal(data.familyColor, '#A8B184');
  assert.equal(data.art, 'persona_EMLW');
});

test('keeps local tool provenance in data without rendering it on the tools card', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'tools',
          status: 'partial',
          source: 'publisher.inventory',
          value: {
            tools: [
              { name: 'Claude Marketing', type: 'workflow', source: 'taku-workflow' },
              { name: 'claude-commands', type: 'workflow', source: 'taku-workflow' },
              { name: 'claude-to-im', type: 'workflow', source: 'taku-workflow' },
            ],
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, { editor: { enabled: true } });

  assert.match(html, /"name":"Claude Marketing","type":"workflow","source":"taku-workflow"/);
  assert.match(html, /max-width:\$\{w-30\}px/);
  assert.doesNotMatch(html, /String\(tool\?\.source\|\|tool\?\.type\|\|'LOCAL'\)/);
});

test('keeps activity counts in data while rendering the compact ring treatment', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'rings',
          status: 'partial',
          source: 'publisher.activity_snapshot',
          estimated: true,
          quality: { label: '本地推导 + Taku' },
          value: {
            metrics: [
              { id: 'prompts', label: 'PROMPTS', count: 137, display: '137', available: true, periodLabel: 'This Month', confidence: 'medium' },
              { id: 'builds', label: 'BUILDS', count: 42, display: '42', available: true, periodLabel: 'This Month', confidence: 'medium' },
              { id: 'ships', label: 'SHIPS', count: 3, display: '3', available: true, periodLabel: 'All Time', confidence: 'high', verified: true },
            ],
            streakToday: 4,
            streakLabel: 'LOCAL BUILD-DAY STREAK',
            periodLabel: 'This Month',
            sourceLabel: 'LOCAL LOGS + TAKU',
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, { editor: { enabled: true } });

  assert.match(html, /DAILY ACTIVITY/);
  assert.match(html, /const cx=w\/2,cy=h\*0\.5,M=Math\.min\(w,h\)/);
  assert.match(html, /radius:\[M\*0\.345,M\*0\.255,M\*0\.165\]\[i\]/);
  assert.match(html, /decorativeFill:\[0\.82,0\.55,0\.3\]\[i\]/);
  assert.match(html, /stroke-width="\$\{M\*0\.062\}"/);
  assert.match(html, /stroke-linecap="round"/);
  assert.match(html, /y="\$\{cy\+h\*0\.075\}"[^>]+font-size="\$\{F\(h\*0\.036\)\}" letter-spacing="1"[^>]*>STREAK<\/text>/);
  assert.match(html, /bottom:\$\{h\*0\.045\}px/);
  assert.doesNotMatch(html, /decorativeFill:\[0\.82,0\.62,0\.36\]\[i\]/);
  assert.match(html, /LOCAL BUILD-DAY STREAK/);
  assert.match(html, /LOCAL LOGS \+ TAKU/);
  assert.match(html, /"id":"prompts","label":"PROMPTS","count":137,"display":"137"/);
  assert.match(html, /"id":"ships","label":"SHIPS","count":3,"display":"3".*"verified":true/);
  assert.doesNotMatch(html, /daily goals for prompts\/builds\/ships/);
});

test('renders unknown heatmap dates separately from observed local build days', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'heat',
          status: 'partial',
          source: 'publisher.local_activity',
          value: {
            days: [
              { date: '2026-07-21', observed: true, builds: 1 },
              { date: '2026-07-22', observed: true, builds: 2 },
            ],
            observedDayCount: 2,
            currentStreak: 2,
            bestStreak: 12,
            coverage: {
              startsOn: '2026-07-21',
              endsOn: '2026-07-22',
              observedDayCount: 2,
              complete90Days: false,
            },
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, { editor: { enabled: true } });

  assert.match(html, /DAILY BUILDS · 90D/);
  assert.match(html, /BEST STREAK/);
  assert.match(html, /const cols=13,rows=7,cs=Math\.min\(\(w-34\)\/cols,\(h\*0\.6\)\/rows\)-2/);
  assert.match(html, /const opacity=\[\.08,\.3,\.6,1\]/);
  assert.match(html, /const level=day\.builds<=0\?0:Math\.min\(3,Math\.max\(1,Math\.ceil\(day\.builds\/max\*3\)\)\)/);
  assert.match(html, /y="\$\{h\*0\.26\+y\*\(cs\+2\)\}"/);
  assert.match(html, /stroke-dasharray="2 2"/);
  assert.match(html, /"date":"2026-07-21","observed":true,"builds":1/);
  assert.doesNotMatch(html, /LOCAL BUILD ACTIVITY/);
  assert.doesNotMatch(html, /CURRENT STREAK/);
});

test('renders rank water level from Worker data and marks staging cohorts as test-only', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'water',
          status: 'supported',
          source: 'server',
          value: {
            topPercent: 0.42,
            metric: 'installs',
            cohortSize: 142,
            minimumCohortSize: 100,
            environment: 'staging',
            publicRankReady: false,
            testOnly: true,
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: { authenticated: true, canPublish: true },
    },
  });

  assert.match(html, /"topPercent":0\.42,"metric":"installs","cohortSize":142/);
  assert.match(html, /const raw=Number\(data\.topPercent\)/);
  assert.match(html, /RANK · TEST/);
  assert.match(html, /BY \$\{metric\}/);
  assert.match(html, /const pctY=wy-8/);
  assert.match(html, /const waterLevel=valid\?Math\.max\(\.06,Math\.min\(\.94,1-raw\)\):\.92/);
  assert.match(html, /const wy=h\*waterLevel/);
  assert.match(html, /font-size="\$\{w\*0\.34\}"[^>]+fill="\$\{C\.violet\}">\$\{pctLabel\}<\/text>/);
  assert.doesNotMatch(html, /clip-path="url\(#wa\$\{id\}\)"/);
  assert.doesNotMatch(html, /clip-path="url\(#wb\$\{id\}\)"/);
  assert.match(html, /"environment":"staging"/);
  assert.match(html, /String\(data\.environment\|\|'unknown'\)\.toUpperCase\(\)/);
  assert.doesNotMatch(html, /const pct=\.62/);
  assert.doesNotMatch(html, />12%<\/text>/);
});

test('renders a locked rank card when the comparable cohort is below 100', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'water',
          status: 'unsupported',
          source: 'server',
          lockLabel: 'RANK SOON',
          reason: 'Test ranking is calibrating. Check back soon.',
          value: {
            topPercent: 0.0189,
            metric: 'installs',
            cohortSize: 53,
            minimumCohortSize: 100,
            environment: 'staging',
            publicRankReady: false,
            testOnly: true,
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: { authenticated: true, canPublish: true },
    },
  });

  assert.match(html, /"status":"unsupported"/);
  assert.match(html, /"lockLabel":"RANK SOON"/);
  assert.match(html, /"lockReason":"Test ranking is calibrating\. Check back soon\."/);
  assert.match(html, /valid\?'RANK · TOP':'RANK · LOCKED'/);
  assert.match(html, /const lockLabel=String\(data\.lockLabel\|\|'CALIBRATING'\)\.toUpperCase\(\)/);
  assert.match(html, /clipPath id="wk\$\{id\}"/);
  assert.match(html, /stroke-dasharray="4 4"/);
  assert.match(html, /valid\?pctLabel:lockLabel/);
  assert.match(html, /valid\?pctLabel:lockLabel/);
  assert.doesNotMatch(html, /\$\{cohort\}\/\$\{minimum\}/);
  assert.doesNotMatch(html, /creators in the rank cohort/);
  assert.doesNotMatch(html, /\[cohort,minimum\]\.join/);
  assert.match(html, /CURRENT<\/span>: rank cohort is calibrating/);
  assert.match(html, /valid\?'OF BUILDERS':'COMMUNITY RANK'/);
  assert.match(html, /if\(key==='water'\)PD=\{\.\.\.PD,water:value\}/);
});

test('renders active hours from observed hourly buckets without a sample peak fallback', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'clock',
          status: 'supported',
          source: 'publisher.local_activity',
          value: {
            peakH: 14,
            peakLabel: 'PEAK 14:00',
            bird: 'BURST',
            hourBuckets: Array.from({ length: 24 }, (_, hour) => (hour === 14 ? 12 : hour === 13 ? 6 : 0)),
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, { editor: { enabled: true } });

  assert.match(html, /"peakH":14,"peakLabel":"PEAK 14:00","bird":"BURST"/);
  assert.match(html, /hourBuckets: Array\.isArray\(clockValue\.hourBuckets\)/);
  assert.match(html, /const cx=w\/2,cy=h\*0\.56,R1=Math\.min\(w,h\)\*0\.27/);
  assert.match(html, /for\(let i=0;i<24;i\+\+\)/);
  assert.match(html, /Rb=R1\*1\.12/);
  assert.match(html, /\[\[0,'00'\],\[6,'06'\],\[12,'12'\],\[18,'18'\]\]/);
  assert.match(html, /Rn=R1\*1\.38/);
  assert.match(html, /const ah=\(peakHour\/24\)/);
  assert.match(html, /left:15px;top:\$\{h\*0\.16\}px/);
  assert.doesNotMatch(html, /dialBuckets\.forEach/);
  assert.doesNotMatch(html, /bottom:\$\{h\*0\.05\}px[^>]+\$\{PD\.peakLabel\}/);
  assert.doesNotMatch(html, /peakLabel: text\(clockValue\.peakLabel, MASON\.peakLabel\)/);
});

test('passes trusted monthly quota data into the Stax app model', () => {
  const draft = draftFixture();
  draft.staxProfile.blocks.cgauge = {
    status: 'supported',
    source: 'server.billing_quota',
    value: {
      usedPercent: 72,
      usedCredits: 720,
      totalCredits: 1000,
      resetAt: '2026-08-01',
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: { authenticated: true, canPublish: true },
    },
  });
  const data = staxDataFromHtml(html);
  const cgauge = data.blocks.find((block) => block.key === 'cgauge');

  assert.equal(cgauge.status, 'supported');
  assert.equal(cgauge.source, 'server.billing_quota');
  assert.deepEqual(cgauge.value, {
    usedPercent: 72,
    usedCredits: 720,
    totalCredits: 1000,
    resetAt: '2026-08-01',
  });
  assert.ok(data.selectedKeys.includes('cgauge'));
  assert.match(html, /const cgaugeValue = value\("cgauge"\)/);
});

test('allows model mix and per-model API equivalent blocks to be selected together', () => {
  const draft = draftFixture();
  draft.staxBlocks = {
    schemaVersion: 'taku.stax.blocks.v1',
    blocks: [
      { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Daemon Daddy' } },
      {
        key: 'pie',
        status: 'partial',
        source: 'publisher.local_usage',
        value: { modelMix: [{ name: 'GPT-5', share: 1, percentage: '100%' }] },
      },
      {
        key: 'modelcost',
        status: 'partial',
        source: 'publisher.local_usage',
        estimated: true,
        value: {
          models: [{ modelId: 'gpt-5', name: 'GPT-5', provider: 'OpenAI', priceSource: 'uniapi', totalUsd: 35 }],
          totalUsd: 35,
          coverageRatio: 1,
          partial: false,
          periodLabel: 'This Month',
          priceTableUpdatedAt: '2026-08',
        },
      },
    ],
  };

  const html = renderPreview(draft, { editor: { enabled: true } });
  const data = staxDataFromHtml(html);
  const modelcost = data.blocks.find((block) => block.key === 'modelcost');

  assert.ok(data.selectedKeys.includes('pie'));
  assert.ok(data.selectedKeys.includes('modelcost'));
  assert.equal(modelcost.estimated, true);
  assert.equal(modelcost.value.models[0].totalUsd, 35);
  assert.match(html, /const modelcostValue = value\("modelcost"\)/);
  assert.match(html, /models: Array\.isArray\(modelcostValue\.models\)/);
});

test('renders an optional QR block with separately selectable profile and Stax targets', () => {
  const draft = draftFixture();
  draft.card.qrTarget = 'profile';
  draft.staxBlocks = {
    schemaVersion: 'taku.stax.blocks.v1',
    blocks: [
      { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Daemon Daddy' } },
      { key: 'qr', status: 'supported', source: 'publisher.profile_link', value: { target: 'profile', username: 'ldx' } },
    ],
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: { authenticated: true, canPublish: true, siteUrl: 'https://taku.ai' },
    },
  });
  const data = staxDataFromHtml(html);
  const qr = data.blocks.find((block) => block.key === 'qr');

  assert.equal(qr.status, 'supported');
  assert.equal(qr.value.target, 'profile');
  assert.equal(qr.value.url, 'https://taku.ai/profile/ldx');
  assert.deepEqual(qr.size, [1, 1]);
  assert.ok(qr.value.size >= 21);
  assert.equal(qr.value.matrix.length, qr.value.size ** 2);
  assert.deepEqual(data.qrOptions.map((option) => [option.id, option.url]), [
    ['profile', 'https://taku.ai/profile/ldx'],
    ['stax', 'https://taku.ai/stax/ldx'],
  ]);
  assert.notEqual(data.qrOptions[0].matrix, data.qrOptions[1].matrix);
  assert.equal(data.selectedKeys.includes('qr'), false);
  assert.match(html, /id="qrselect"/);
  assert.match(html, /R\.qr=\(w,h\)=>/);
  assert.match(html, /const padding=11,side=Math\.max\(0,Math\.min\(w,h\)-padding\*2\)/);
  assert.match(html, /rx="\$\{\(module\*0\.28\)\.toFixed\(2\)\}"/);
  assert.match(html, /shadowed\(rr\(w,h\),C\.lime\)/);
  assert.match(html, /qr:\[1,1\]/);
  assert.doesNotMatch(html, /const target=String\(data\.target/);
  assert.doesNotMatch(html, />\$\{target\}<\/text>/);
  assert.doesNotMatch(html, /SCAN MY STAX/);
  assert.doesNotMatch(html, /SELECT LINK/);
  assert.match(html, /card: \{ qrTarget: selectedQr\.id \}/);
  assertInlineScriptsParse(html);
});

test('offers a verified GitHub candidate for confirmation without exposing it in readonly output', () => {
  const draft = draftFixture();
  delete draft.staxProfile.social;
  draft.socialCandidates = {
    github: {
      username: 'karr77',
      profileUrl: 'https://github.com/karr77',
      source: 'github-cli',
      verified: true,
      requiresConfirmation: true,
    },
  };

  const editorHtml = renderPreview(draft, { editor: { enabled: true, publish: {} } });
  const readonlyHtml = renderPreview(draft, { readonlyPreview: true });

  assert.match(editorHtml, /id="githubconnect"/);
  assert.match(editorHtml, /"socialCandidate":\{"platform":"github","username":"karr77"/);
  assert.match(editorHtml, /"unlockKind":"social-confirm"/);
  assert.match(editorHtml, /const isAction=key==='social'&&\(lockKind==='social-confirm'\|\|lockHint==='ADD GITHUB'\)/);
  assert.match(editorHtml, /d\.setAttribute\('role','button'\);d\.tabIndex=0/);
  assert.match(editorHtml, /confirmedSocial: \{ github: githubCandidate \}/);
  assert.match(editorHtml, /window\.__TAKU_STAX_POST__\("settings-change"/);
  assert.match(editorHtml, /applyConfirmedGithub\(\)/);
  assert.match(editorHtml, /githubConfirmSubmit\.textContent = saving \? "CONNECTING\.\.\." : "ADD GITHUB"/);
  assert.match(editorHtml, /githubConfirmSubmit\.setAttribute\("aria-busy", saving \? "true" : "false"\)/);
  assert.match(editorHtml, /githubConfirmCancel\.disabled = saving/);
  assert.match(editorHtml, /id="githubconfirm" role="dialog"/);
  assert.match(editorHtml, /githubConfirm\.classList\.add\("on"\)/);
  assert.match(editorHtml, /window\.__TAKU_OPEN_GITHUB_CONFIRM__ = openGithubConfirm/);
  assert.match(editorHtml, /#scanov\.off,#revealov\.off\{opacity:0;pointer-events:none;visibility:hidden\}/);
  assert.doesNotMatch(editorHtml, /window\.confirm/);
  assert.doesNotMatch(readonlyHtml, /"socialCandidate":\{"platform":"github","username":"karr77"/);
});

test('uses a confirmed GitHub account as the local draft footer handle', () => {
  const draft = draftFixture();
  draft.card.confirmedSocial = { github: 'karr77' };
  draft.staxProfile = {};

  const html = renderPreview(draft, { editor: { enabled: true, publish: {} } });

  assert.match(html, /"cardHandle":"@karr77"/);
  assert.doesNotMatch(html, /"cardHandle":"LOCAL DRAFT"/);
});

test('renders empty community rank blocks as locked growth prompts', () => {
  const draft = {
    ...draftFixture(),
    staxProfile: {},
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'tier1',
          status: 'unsupported',
          source: 'server',
          reason: 'Publish a tool or gain subscribers on Taku to unlock community rank.',
          lockLabel: 'GROW ON TAKU',
        },
      ],
    },
  };

  const html = renderPreview(draft, { editor: { enabled: true } });

  assert.match(html, /"key":"tier1"/);
  assert.match(html, /"lockLabel":"GROW ON TAKU"/);
  assert.match(html, /"reason":"Publish a tool or gain subscribers on Taku to unlock community rank\."/);
  assert.match(html, /label: String\(block\.lockLabel \|\| "LOCKED"\)\.toUpperCase\(\)/);
  assert.match(html, /message: String\(block\.lockReason \|\| block\.reason \|\| "Not available yet\."\)/);
});

test('does not use the display name as a handle when the trusted profile is missing', () => {
  const draft = {
    ...draftFixture(),
    staxProfile: {},
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
        loginUrl: 'https://taku.ai/profile?source=taku_creator',
      },
    },
  });

  assert.match(html, /"needsTakuAuth":false/);
  assert.match(html, /"needsTakuProfile":true/);
  assert.match(html, /"isTakuAuthorized":true/);
  assert.match(html, /"cardHandle":"SIGNED IN DRAFT"/);
  assert.doesNotMatch(html, /"cardHandle":"LOCAL DRAFT"/);
  assert.match(html, /"loginUrl":"https:\/\/taku.ai\/profile\?source=taku_creator"/);
});

test('labels an authorized draft without synced identity as signed-in draft', () => {
  const draft = {
    ...draftFixture(),
    creator: {},
    card: {},
    staxProfile: {},
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
      },
    },
  });

  assert.match(html, /"cardHandle":"SIGNED IN DRAFT"/);
  assert.doesNotMatch(html, /"cardHandle":"LOCAL DRAFT"/);
});

test('stops automatic publish authorization after one redirect', () => {
  const html = renderPreview(draftFixture(), {
    editor: {
      enabled: true,
      publish: {
        authenticated: false,
        canPublish: false,
        loginUrl: 'https://taku.ai/profile?source=taku_creator',
      },
    },
  });

  assert.match(html, /takuStaxAuthRedirectCount/);
  assert.match(html, /if\(!manual&&redirectCount>=1\)/);
  assert.match(html, /TAKU AUTH DID NOT MATCH THIS DRAFT/);
  assert.match(html, /publishStax\(document\.getElementById\('mpost'\),\{manual:false\}\)/);
});

test('finishes a pending Stax publish on the server after Taku authorization', () => {
  const html = renderPreview(draftFixture(), {
    editor: {
      enabled: true,
      publish: {
        authenticated: false,
        canPublish: false,
        loginUrl: 'https://taku.ai/profile?source=taku_creator',
      },
    },
  });

  assert.match(html, /if\(result\.autoPublishAttempted\)/);
  assert.match(html, /result\.autoPublishSucceeded/);
  assert.match(html, /setStaxPublication\(result\.publishedStax\)/);
});

test('uses a published Stax username when the trusted serial profile has not synced yet', () => {
  const draft = {
    ...draftFixture(),
    creator: { name: 'Commpanyproductt' },
    staxProfile: {},
    publishedStax: {
      published: true,
      publicUrl: 'https://taku.ai/stax/1784325610',
      creatorPageUrl: 'https://taku.ai/stax/1784325610',
      username: '1784325610',
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
      },
    },
  });

  assert.match(html, /"cardHandle":"@1784325610"/);
  assert.doesNotMatch(html, /"cardHandle":"LOCAL DRAFT"/);
  assert.match(html, /"cardSerial":"UNMINTED"/);
  assert.match(html, /"profilePageUrl":"https:\/\/taku\.ai\/profile\/1784325610"/);
  assert.match(html, /"staxCardPageUrl":"https:\/\/taku\.ai\/stax\/1784325610"/);
});

test('uses trusted Taku identity and rank only after local auth is present', () => {
  const html = renderPreview(draftFixture(), {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
        loginUrl: 'https://taku.ai/profile?source=taku_creator',
      },
    },
  });

  assert.match(html, /"handle":"@ldx"/);
  assert.match(html, /"serial":"No\. 000417"/);
  assert.match(html, /"cardHandle":"@ldx"/);
  assert.match(html, /"cardSerial":"No\. 000417"/);
  assert.match(html, /"rankTopPercentLabel":"4%"/);
  assert.match(html, /"cardFinish":"gold"/);
  assert.match(html, /"needsTakuAuth":false/);
  assert.match(html, /"hasTrustedTakuIdentity":true/);
});

test('maps trusted rank to the three Stax card finishes', () => {
  const silverDraft = draftFixture();
  silverDraft.staxProfile.rank.rankGrade.topPercent = 0.2;
  const silverHtml = renderPreview(silverDraft, {
    editor: { enabled: true, publish: { authenticated: true, canPublish: true } },
  });
  assert.match(silverHtml, /"cardFinish":"silver"/);
  assert.match(silverHtml, /finish: text\(data\.cardFinish, "ink"\)/);
  assert.match(silverHtml, /function applyFinish\(finish\)/);
  assert.match(silverHtml, /class="ctex"><\/div><div class="cspot"><\/div><div class="cfin"><\/div><div class="csheen">/);
  assert.match(silverHtml, /f==='gold'\?'TOP 5%':f==='silver'\?'TOP 30%'/);

  const untrustedHtml = renderPreview(silverDraft, {
    editor: { enabled: true, publish: { authenticated: false, canPublish: false } },
  });
  assert.match(untrustedHtml, /"cardFinish":"ink"/);

  silverDraft.publishedStax = {
    published: true,
    username: 'ldx',
    staxCardPageUrl: 'https://taku.ai/stax/ldx',
  };
  const publishedHtml = renderPreview(silverDraft, { readonlyPreview: true });
  assert.match(publishedHtml, /"cardFinish":"silver"/);

  const publishedEditorHtml = renderPreview(silverDraft, {
    editor: { enabled: true, publish: { authenticated: false, canPublish: false } },
  });
  assert.match(publishedEditorHtml, /"cardFinish":"silver"/);

  silverDraft.staxProfile.rank.rankGrade.topPercent = 0.5;
  const inkHtml = renderPreview(silverDraft, {
    editor: { enabled: true, publish: { authenticated: true, canPublish: true } },
  });
  assert.match(inkHtml, /"cardFinish":"ink"/);
});

test('renders the Worker-backed published Stax count instead of a template sample', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        { key: 'tally', status: 'supported', source: 'server', value: { shipped: 3 } },
      ],
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
      },
    },
  });

  assert.match(html, /"key":"tally","label":"Published Count","size":\[2,1\],"status":"supported","display":"3"/);
  assert.match(html, /const shipped=Math\.max\(0,Math\.floor\(Number\(PD\.tally\?\.shipped\)\|\|0\)\)/);
  assert.match(html, /shipped: Math\.max\(0, Math\.floor\(Number\(tallyValue\.shipped\) \|\| 0\)\)/);
  assert.match(html, /SHIPPED · ALL TIME/);
  assert.doesNotMatch(html, /WORKS SHIPPED · ALL TIME/);
  assert.doesNotMatch(html, /STAX SHIPPED/);
  assert.match(html, /const groupStep=groups\.length<=3\?52:Math\.min\(42,\(w\*0\.7\)\/groups\.length\)/);
  assert.match(html, /\$\{safeText\(shipped\)\}<\/div>/);
  assert.doesNotMatch(html, />12<\/div>/);
});

test('renders the Worker-backed Builder Score instead of the template score sample', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'dial',
          status: 'supported',
          source: 'server.builder_score',
          value: {
            score: 73,
            maxScore: 100,
            version: 'builder-score.v1',
            breakdown: {
              marketplaceAdoption: { score: 28, maxScore: 35, value: 1200 },
            },
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
      },
    },
  });

  assert.match(html, /"key":"dial","label":"Builder Score","size":\[2,1\],"status":"supported","display":"73"/);
  assert.match(html, /score: dialValue\.score !== undefined.*Math\.round\(Number\(dialValue\.score\)\)/);
  assert.match(html, /const cx=w\/2,cy=h\*0\.86,Rr=h\*0\.66,val=score\/max/);
  assert.match(html, /for\(let i=0;i<=10;i\+\+\)/);
  assert.match(html, /'SCORE','rgba\(255,255,255,.55\)'/);
  assert.match(html, /`MAX \$\{safeText\(max\)\}`,'rgba\(255,255,255,.4\)'/);
  assert.match(html, /\$\{hasScore\?safeText\(score\):'—'\}/);
  assert.match(html, /CURRENT SCORE/);
  assert.match(html, /local scans do not directly set or inflate it/);
  assert.doesNotMatch(html, /val=\.88/);
  assert.doesNotMatch(html, />88<\/text>/);
});

test('renders observed build rhythm instead of a static quarterly sprint sample', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'wave',
          status: 'partial',
          source: 'publisher.local_activity',
          value: {
            waves: [
              { id: 'w4', label: '7/19-7/24', buildSessionCount: 42, activeDayCount: 6 },
              { id: 'w5', label: '7/25-7/30', buildSessionCount: 50, activeDayCount: 6 },
            ],
            totalBuildSessions: 92,
            observedDayCount: 12,
            metric: 'buildSessions',
            periodId: 'last30Days',
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
      },
    },
  });

  assert.match(html, /"key":"wave","label":"Build Rhythm","size":\[2,1\],"status":"partial"/);
  assert.match(html, /"buildSessionCount":42,"activeDayCount":6/);
  assert.match(html, /"buildSessionCount":50,"activeDayCount":6/);
  assert.match(html, /"totalBuildSessions":92,"observedDayCount":12/);
  assert.match(html, /const waveValue = value\("wave"\)/);
  assert.match(html, /\.slice\(-3\)/);
  assert.match(html, /const visible=\[\.\.\.Array\(Math\.max\(0,3-sprintCount\)\)\.fill/);
  assert.match(html, />S\$\{i\+1\}<\/text>/);
  assert.match(html, /SPRINTS · QTR/);
  assert.match(html, />\$\{sprintCount\}<\/div>/);
  assert.doesNotMatch(html, /BUILD RHYTHM · LOCAL/);
  assert.doesNotMatch(html, /SPRINTS · THIS QUARTER/);
});

test('renders the observed best day instead of a static token peak sample', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'peaks',
          status: 'partial',
          source: 'publisher.local_activity',
          value: {
            bestDay: '368.2M',
            date: '2026-07-19',
            metric: 'tokens',
            observedDayCount: 12,
            peakShape: [368211343, 86651143, 242310041],
            peakDates: ['2026-07-19', '2026-07-20', '2026-07-21'],
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
      },
    },
  });

  assert.match(html, /"key":"peaks","label":"Peak Day","size":\[2,1\],"status":"partial"/);
  assert.match(html, /"bestDay":"368.2M","date":"2026-07-19","metric":"tokens","observedDayCount":12/);
  assert.match(html, /const peaksValue = value\("peaks"\)/);
  assert.match(html, /PD\.peaks\.peakShape\.slice\(-7\)\.map/);
  assert.match(html, /PEAKS · BEST DAY/);
  assert.match(html, /top:\$\{h-base\*0\.5\}px/);
  assert.match(html, /font-size:\$\{h\*0\.22\}px/);
  assert.match(html, /\$\{safeText\(amount\)\}/);
  assert.doesNotMatch(html, /TOKEN PEAK/);
  assert.doesNotMatch(html, /BEST · \$\{safeText\(dateLabel/);
  assert.doesNotMatch(html, />84<small>K<\/small>/);
});

test('renders the observed input and output tokens instead of static samples', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'ratio',
          status: 'partial',
          source: 'publisher.local_usage',
          value: {
            tokensIn: '2.7B',
            tokensOut: '7.7M',
            tokensInValue: 2700000000,
            tokensOutValue: 7700000,
            inShare: 0.997,
            periodId: 'thisMonth',
            periodLabel: 'This Month',
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
      },
    },
  });

  assert.match(html, /"key":"ratio","label":"Input Output Ratio","size":\[2,1\],"status":"partial"/);
  assert.match(html, /"tokensIn":"2.7B","tokensOut":"7.7M","tokensInValue":2700000000,"tokensOutValue":7700000,"inShare":0.997/);
  assert.match(html, /const ratioValue = value\("ratio"\)/);
  assert.match(html, /const rawShare=Number\(PD\.ratio\?\.inShare\)/);
  assert.match(html, /gap=3,usable=bw-gap/);
  assert.match(html, /const inW=usable\*inShare,outW=usable\*outShare,outX=bx\+inW\+gap/);
  assert.match(html, /rx="\$\{Math\.min\(4,inW\/2\)\}" fill="\$\{C\.violet\}"/);
  assert.match(html, /rx="\$\{Math\.min\(4,outW\/2\)\}" fill="\$\{C\.teal\}"/);
  assert.match(html, /\$\{tokensIn\} <span/);
  assert.match(html, /OUT <\/span>\$\{tokensOut\}/);
  assert.match(html, /LBL\('left:15px','top:12px','TOKENS · IN \/ OUT'.*h\*0\.088\)/);
  assert.doesNotMatch(html, /\$\{period\} · LOCAL/);
  assert.doesNotMatch(html, /ratio-bar-clip/);
  assert.doesNotMatch(html, /const bx=15,bw=w-30,ratio=\.62/);
  assert.doesNotMatch(html, />790K <span/);
  assert.doesNotMatch(html, />OUT <\/span>490K/);
});

test('renders the observed all-time token total instead of the selected-period sample', () => {
  const draft = {
    ...draftFixture(),
    staxBlocks: {
      schemaVersion: 'taku.stax.blocks.v1',
      blocks: [
        { key: 'hero', status: 'supported', source: 'publisher.persona', value: { n1: 'Indie Sigma' } },
        {
          key: 'stadium',
          status: 'partial',
          source: 'publisher.local_usage',
          value: {
            tokensAllTime: '12.4M',
            tokensTotal: '12.4M',
            allTimeTokens: 12400000,
            totalTokens: 12400000,
            periodId: 'allTimeLocal',
            periodLabel: 'All Time',
          },
        },
      ],
    },
  };

  const html = renderPreview(draft, {
    editor: {
      enabled: true,
      publish: {
        authenticated: true,
        canPublish: true,
      },
    },
  });

  assert.match(html, /"key":"stadium","label":"Token Stadium","size":\[2,1\],"status":"partial"/);
  assert.match(html, /"tokensAllTime":"12\.4M","tokensTotal":"12\.4M","allTimeTokens":12400000,"totalTokens":12400000,"periodId":"allTimeLocal","periodLabel":"All Time"/);
  assert.match(html, /const stadiumValue = value\("stadium"\)/);
  assert.match(html, /const rawDisplay=String\(PD\.stadium\?\.tokensAllTime\|\|PD\.stadium\?\.tokensTotal\|\|'0'\)/);
  assert.match(html, /`TOKENS · \$\{period\}`/);
  assert.match(html, /function stadiumPeriodLabel\(value\)/);
  assert.match(html, /\$\{display\}\$\{unit\?/);
  assert.match(html, /if\(\/all\[-\\s\]\?time\/i\.test\(label\)\)return 'ALL TIME'/);
  assert.doesNotMatch(html, />12\.4<small>M<\/small>/);
});

test('renders static persona previews as read-only fallback artifacts', () => {
  const html = renderPreview(draftFixture(), { readonlyPreview: true });

  assert.match(html, /· Stax/);
  assert.match(html, /window\.__TAKU_STAX_DATA__/);
  assert.match(html, /window\.__TAKU_STAX_BOOTSTRAP__/);
  assert.doesNotMatch(html, /Taku Creator 数据维度/);
  assert.doesNotMatch(html, /persona-page/);
  assert.doesNotMatch(html, /local-activity-panel/);
  assert.doesNotMatch(html, /id="addLocalPackageButton"/);
  assert.doesNotMatch(html, /id="publishProfileButton"/);
  assert.doesNotMatch(html, /id="toolReviewPanel"/);
  assert.doesNotMatch(html, /api\/local-package/);
  assert.doesNotMatch(html, /data-remove-local-tool/);
  assert.doesNotMatch(html, /api\/publish/);
  assert.match(html, /openShare\("visitor"\)/);
  assert.match(html, /class="btn2 sh-visitor" id="shshare">SHARE ↗<\/button>/);
  assert.match(html, /class="btn2 pri sh-visitor" id="shcta">COOK MY OWN ▸<\/button>/);
  assert.match(html, /class="btn2 pri sh-owner" id="shedit">EDIT IN STUDIO ▸<\/button>/);
  assert.match(html, /body\.share-readonly \.hud,body\.share-readonly \.stagev,body\.share-readonly \.dock\{display:none\}/);
  assert.doesNotMatch(html, /id="shback"/);
  assert.doesNotMatch(html, /id="shcook"/);
});
