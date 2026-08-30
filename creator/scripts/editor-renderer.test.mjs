import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { renderPreview, renderStaxStudioRuntime } from './editor-renderer.mjs';

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
    card: { name: 'ldx', visibility: 'public', serialNumber: 'TAKU-000123' },
    staxProfile: {
      handle: 'ldx',
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

function staxDataFromHtml(html) {
  const match = String(html).match(/window\.__TAKU_STAX_DATA__ = (.*?);\nwindow\.__TAKU_STAX_BOOTSTRAP__/s);
  assert.ok(match, 'Stax data bootstrap is missing from the preview HTML');
  return JSON.parse(match[1]);
}

test('cloud Studio runtime captures a PNG snapshot before publishing', () => {
  const html = renderStaxStudioRuntime();

  assert.match(html, /target\.textContent='CAPTURING\.\.\.'/);
  assert.match(html, /const staxCardSnapshot=await currentStaxCardSnapshot\(\)/);
  assert.match(html, /post\('publish',\{layout:currentLayout\(\),staxCardSnapshot\}\)/);
  assert.match(html, /renderExportPayloadInBrowser/);
  assert.match(html, /window\.parent!==window&&typeof window\.__TAKU_STAX_POST__==='function'/);
  assert.match(html, /id="githubconnect"/);
  assert.match(html, /id="githubconfirm"/);
  assert.match(html, /window\.__TAKU_STAX_POST__\("settings-change"/);
  assert.match(html, /settings: \{ confirmedSocial: \{ github: githubCandidate \} \}/);
  assert.match(html, /settings: \{ primaryAi: selectedTeam\.id \}/);
  assert.match(html, /settings: \{ qrTarget: selectedQr\.id \}/);
  assert.match(html, /message\.type===MESSAGE_PREFIX\+'settings-saved'/);
  assert.match(html, /window\.__TAKU_GITHUB_SAVE_SUCCESS__/);
  assert.doesNotMatch(html, /gh auth token|readGitHubToken|githubToken/i);

  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  scripts.forEach((match, index) => {
    new vm.Script(match[1], { filename: `cloud-runtime-${index + 1}.js` });
  });
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
        { key: 'tools', status: 'partial', source: 'publisher.inventory', quality: { label: '待用户选择' }, value: { tools: [{ name: 'youtube-to-ebook' }] } },
        { key: 'ctxring', status: 'partial', source: 'publisher.local_usage', quality: { label: '本地日志' }, value: { avgInputTokens: 66000, requestCount: 24, display: '66K' } },
        { key: 'dots', status: 'partial', source: 'publisher.local_activity.tool_calls', quality: { label: '本地日志' }, value: { toolCallCount: 20542, display: '20.5K', periodLabel: 'This Month', dailyToolCalls: [{ date: '2026-07-28', count: 84 }, { date: '2026-07-29', count: 126 }] } },
        { key: 'knock', status: 'partial', source: 'publisher.local_usage', quality: { label: '本地日志' }, value: { label: 'EVENTS', value: '19.1K' } },
        { key: 'bracket', status: 'partial', source: 'publisher.local_usage', estimated: true, quality: { label: '估算' }, value: { label: 'EST. SPEND', value: '$1188', estimated: true, periodId: 'thisMonth', periodLabel: 'This Month' } },
        { key: 'node', status: 'partial', source: 'publisher.inventory', quality: { label: '本地扫描' }, value: { totalCount: 114, categories: [{ id: 'slash-command', label: 'COMMANDS', count: 44 }, { id: 'skill', label: 'SKILLS', count: 30 }, { id: 'plugin', label: 'PLUGINS', count: 20 }, { id: 'mcp-server', label: 'MCP', count: 11 }], otherCount: 9 } },
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
  assert.match(html, /function planBuildLayout\(keys,randomize=false\)/);
  assert.match(html, /const preferred=\['hero','type'\]/);
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
  assert.match(html, /"familyColor":"#2E9BFF"/);
  assert.match(html, /LBL\('left:18px','top:14px','ARCHETYPE',dm,h\*0\.05\)/);
  assert.match(html, /LBL\('right:18px','top:14px',safeText\(PD\.family\),dm,h\*0\.05\)/);
  assert.match(html, /font-weight:700;font-size:\$\{h\*0\.105\}px[^>]+>\$\{safeText\(PD\.handle\)\}/);
  assert.match(html, /"tokens90d":\[0\.1,0\.2,0\.3\]/);
  assert.match(html, /"visualBuckets":\[0\.3,0\.45,0\.4,0\.6\]/);
  assert.match(html, /"tokens90dTotal":"2\.6B"/);
  assert.match(html, /"dayCount":12/);
  assert.match(html, /"isPartialSample":true/);
  assert.match(html, /TOKENS · \$\{period\}/);
  assert.match(html, /"toolCallCount":20542,"display":"20\.5K","periodLabel":"This Month"/);
  assert.match(html, /LOCAL TOOL CALLS/);
  assert.match(html, /dailyToolCalls: Array\.isArray\(dotsValue\.dailyToolCalls\)/);
  assert.match(html, /compactDisplay=rawDisplay\.match/);
  assert.match(html, /compactDisplay\?compactDisplay\[2\]/);
  assert.match(html, /left:\$\{w\*0\.6\}px;right:2px/);
  assert.match(html, /font-size:\$\{F\(h\*0\.12\)\}px/);
  assert.match(html, /"creatorTokens":3460000,"communityMedian":1000000,"deltaPercent":246/);
  assert.match(html, /const median=Math\.max\(0,Number\(PD\.vsavg\?\.communityMedian\)\|\|0\)/);
  assert.match(html, />MEDIAN<\/text>/);
  assert.match(html, /\$\{display\}<\/div>/);
  assert.doesNotMatch(html, />\+246%<\/div>/);
  assert.match(html, />LOCAL TREND<\/div>/);
  assert.doesNotMatch(html, /LOCAL<br>TREND/);
  assert.match(html, /VS PREV 6D/);
  assert.match(html, /"currentBuilds":48,"previousBuilds":59,"comparison":"48 VS 59"/);
  assert.match(html, /currentPeriodLabel: text\(trendValue\.currentPeriodLabel/);
  assert.match(html, /WHAT IT MEANS/);
  assert.match(html, /not server-verified and not a quality or productivity score/);
  assert.doesNotMatch(html, /API CALLS · 90 DAYS/);
  assert.doesNotMatch(html, /const cols=15,rows=6,total=86/);
  assert.match(html, /"rankTopPercentLabel":""/);
  assert.match(html, /"lockLabel":"GROW ON TAKU"/);
  assert.match(html, /"unlockSummary":\{"localReady":\d+,"takuAuth":\d+,"unavailable":\d+,"total":\d+\}/);
  assert.match(html, /"unlockKind":"taku-auth"/);
  assert.match(html, /function ceremonyBlocks\(P\)/);
  assert.match(html, /block\.key==='badges'/);
  assert.match(html, /String\(block\.status\|\|'supported'\)\.toLowerCase\(\)==='unsupported'/);
  assert.match(html, /const blocks=ceremonyBlocks\(P\)/);
  assert.match(html, /GUIDE_DESCRIPTIONS\[block\.key\]\|\|guideSourceDetail\(block\.source,block\)/);
  assert.match(html, /ONE OF 16 ARCHETYPES/);
  assert.match(html, /UNLOCKED · \$\{String\(position\)\.padStart\(2,'0'\)\} \/ \$\{String\(total\)\.padStart\(2,'0'\)\}/);
  assert.match(html, /\$\{guidePreviewFor\(block\)\}/);
  assert.match(html, /CLICK TO ENTER STUDIO/);
  assert.match(html, /document\.getElementById\('bintro'\)\.addEventListener\('click',\(\)=>ceremony\(CURP\)\)/);
  assert.doesNotMatch(html, /id="renter"/);
  assert.match(html, /lockKind==='taku-auth'\?'Connect Taku to unlock':'Not available yet'/);
  assert.match(html, /topPercentLabel: text\(tier1Value\.topPercentLabel, data\.rankTopPercentLabel\)/);
  assert.doesNotMatch(html, /data\.rankTopPercentLabel \|\| "25%"/);
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
  assert.match(html, />GENESIS EDITION<\/text>/);
  assert.match(html, /safeText\(PD\.basicLbl\|\|'DAYS · ON TAKU'\)/);
  assert.match(html, /font-size:\$\{h\*0\.4\}px;color:#17123A">\$\{safeText\(PD\.basicVal\|\|'0'\)\}/);
  assert.doesNotMatch(html, />LIVE<\/text>/);
  assert.match(html, /pie:\[2,2\]/);
  assert.match(html, /MODEL MIX · \$\{periodShortLabel\(PD\.pie\?\.periodLabel\)\}/);
  assert.match(html, /top:\$\{h\*\(0\.635\+i\*0\.115\)\}px;display:flex;align-items:center;gap:8px/);
  assert.match(html, /border-bottom:1px dotted rgba\(255,255,255,\.16\)/);
  assert.match(html, /return \{label:'CLAUDE',icon:'ic_claude'\}/);
  assert.match(html, /return \{label:'CODEX',icon:'ic_codex'\}/);
  assert.match(html, /return \{label:'CURSOR',icon:'ic_cursor'\}/);
  assert.match(html, /"ic_cursor":"data:image\/svg\+xml;base64,/);
  assert.match(html, /background:\$\{col\};color:#111217/);
  assert.match(html, /flex-wrap:wrap/);
  assert.match(html, /top:\$\{h\*0\.825\}px/);
  assert.match(html, /async function exportPreviewPng\(\)/);
  assert.match(html, /fetch\('\/api\/export\/png'/);
  assert.match(html, /const png=await createExportPngBlob\(\{\.\.\.previewCardExportPayload\(2\),filename\}\)/);
  assert.match(html, /canvas\.toBlob/);
  assert.match(html, /const filename='taku-stax-'\+publicSlug\(PD\.handle\)\+'\.png'/);
  assert.match(html, /link\.download=filename/);
  assert.doesNotMatch(html, /PNG EXPORT · wired in prod/);
  assert.match(html, /PUBLISH STAX/);
  assert.match(html, /api\/stax\/publication/);
  assert.match(html, /api\/stax\/share/);
  assert.doesNotMatch(html, /POST TO FEED/);
  assert.doesNotMatch(html, /LIVE AT stax\.taku\.ai/);
  assert.match(html, /const EARNED=\[\['aura'\]/);
  assert.doesNotMatch(html, /const EARNED=.*\['badges'\]/);
  assert.match(html, /"axes":\[\["EXPLORER","ARCHITECT","#7C6CF6",2\]/);
  assert.match(html, /\["MAKER","INFRA","#2BD4C0",7\]/);
  assert.match(html, /\["LARK","OWL","#C9F24C",8\]/);
  assert.match(html, /\["WOLF","HOARDER","#FFC93D",7\]/);
  assert.doesNotMatch(html, /ARCHITECT ↔ EXPLORER/);
  assert.match(html, /hero/);
  assert.match(html, /ctxring/);
  assert.match(html, /TOKENS \/ REQUEST/);
  assert.doesNotMatch(html, /AVG INPUT · REQUEST/);
  assert.match(html, /top:\$\{h\*0\.19\}px;font-family:\$\{SM\}/);
  assert.match(html, /font-size:\$\{Math\.max\(7,h\*0\.037\)\}px/);
  assert.match(html, />LOCAL TREND<\/div>/);
  assert.doesNotMatch(html, /LOCAL<br>TREND/);
  assert.match(html, /VS PREV 6D/);
  assert.doesNotMatch(html, /bottom:\$\{h\*0\.025\}px;text-align:center/);
  assert.doesNotMatch(html, /Δ 30 DAYS/);
  assert.match(html, /LOCAL EVENTS/);
  assert.doesNotMatch(html, /API CALLS/);
  assert.match(html, /19\.1K/);
  assert.match(html, /EST\. SPEND/);
  assert.match(html, /THIS MONTH/);
  assert.match(html, /\$1188/);
  assert.doesNotMatch(html, /SPEND · 90D/);
  assert.match(html, /LOCAL STACK/);
  assert.doesNotMatch(html, /LOCAL STACK · \$\{total\} FOUND/);
  assert.match(html, /COMMANDS/);
  assert.match(html, /"totalCount":114/);
  assert.doesNotMatch(html, /PROMPT CRM/);
  assert.doesNotMatch(html, /YOUR STACK · 4 WIRED/);
  assert.match(html, /SESSION MIX/);
  assert.match(html, /\$\{period\} · EST\./);
  assert.match(html, /\$\{safeText\(total\)\} SESSIONS/);
  assert.match(html, /"chatSessionCount":6/);
  assert.match(html, /"buildSessionCount":92/);
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
  assert.match(html, /decorativeFill:\[0\.82,0\.62,0\.36\]\[i\]/);
  assert.match(html, /stroke-linecap="round"/);
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

  assert.match(html, /LOCAL BUILD ACTIVITY/);
  assert.match(html, /CURRENT STREAK/);
  assert.match(html, /DAYS FOUND/);
  assert.match(html, /top:\$\{h\*0\.14\}px/);
  assert.match(html, /font-size:\$\{F\(h\*0\.029\)\}px/);
  assert.match(html, /stroke-dasharray="2 2"/);
  assert.match(html, /"date":"2026-07-21","observed":true,"builds":1/);
  assert.doesNotMatch(html, /BEST STREAK/);
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
  assert.match(html, /clipPath id="wlb\$\{id\}"/);
  assert.match(html, /stroke-dasharray="4 4"/);
  assert.match(html, /valid\?pctLabel:lockLabel/);
  assert.match(html, /fill="\$\{C\.violet\}" opacity="\.96"/);
  assert.doesNotMatch(html, /\$\{cohort\}\/\$\{minimum\}/);
  assert.doesNotMatch(html, /creators in the rank cohort/);
  assert.doesNotMatch(html, /\[cohort,minimum\]\.join/);
  assert.match(html, /CURRENT<\/span>: rank cohort is calibrating/);
  assert.match(html, /valid\?'OF ALL BUILDERS':'COMMUNITY RANK'/);
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
  assert.match(html, /const afternoon=peakHour>=13/);
  assert.match(html, /afternoon\?\[\[0,'00'\],\[3,'15'\],\[6,'18'\],\[9,'21'\]\]:\[\[0,'12'\],\[3,'03'\],\[6,'06'\],\[9,'09'\]\]/);
  assert.match(html, /dialBuckets\.forEach\(\(count,slot\)=>/);
  assert.match(html, /const ah=\(\(peakHour-dialStart\)\/12\)/);
  assert.match(html, /Math\.sqrt\(count\/maxHour\)/);
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

test('continues past the Taku gate when local auth is present but the trusted profile is missing', () => {
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
  assert.match(html, /"cardHandle":"ldx"/);
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
  assert.match(html, /"needsTakuAuth":false/);
  assert.match(html, /"hasTrustedTakuIdentity":true/);
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
  assert.match(html, /WORKS SHIPPED · ALL TIME/);
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
  assert.match(html, /'SCORE','rgba\(255,255,255,.78\)'/);
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
  assert.match(html, /BUILD RHYTHM · LOCAL/);
  assert.match(html, /\$\{observedDays\} DAYS FOUND/);
  assert.match(html, /\$\{total\}<small/);
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
  assert.match(html, /\$\{metric\} PEAK · \$\{observedDays\}D/);
  assert.match(html, /BEST · \$\{safeText\(dateLabel\|\|'—'\)\}/);
  assert.match(html, /\$\{safeText\(amount\)\}/);
  assert.doesNotMatch(html, /PEAKS · BEST DAY/);
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
  assert.match(html, /\$\{tokensIn\} <span/);
  assert.match(html, /OUT <\/span>\$\{tokensOut\}/);
  assert.match(html, /top:\$\{h\*0\.2\}px/);
  assert.match(html, /font-size:\$\{F\(h\*0\.044\)\}px/);
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
});
