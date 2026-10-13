window.__TAKU_STAX_BOOTSTRAP__ = function(){
  const data = window.__TAKU_STAX_DATA__ || {};
  const blocks = Array.isArray(data.blocks) ? data.blocks.filter((block) => block?.key !== "knock") : [];
  const fallbackLogo = ART.logo_mark || FALLBACK_LOGO;
  ART.logo_mark = fallbackLogo;
  if (data.art && data.artDataUrl) ART[data.art] = data.artDataUrl;
  document.querySelectorAll(".scanlogo,.shlogo,[data-logo],#lockup").forEach((img) => {
    if (!img) return;
    if (typeof setLogo === "function") setLogo(img);
    else img.src = fallbackLogo;
  });
  const byKey = new Map(blocks.map((block) => [block.key, block]));
  const supportedKeys = blocks.filter((block) => block && block.status !== "unsupported").map((block) => block.key);
  const hasSelectedKeys = Array.isArray(data.selectedKeys);
  const selected = [...new Set((hasSelectedKeys ? data.selectedKeys : supportedKeys).map((key) => key === "aura" || key === "tier4" ? "tier1" : key))].filter((key) => byKey.get(key)?.status !== "unsupported" && SIZES[key]);
  const locks = {};
  blocks.forEach((block) => {
    if (!block || block.status !== "unsupported" || !SIZES[block.key] || block.key === "aura" || block.key === "tier4") return;
    locks[block.key] = {
      label: String(block.lockLabel || "LOCKED").toUpperCase(),
      message: String(block.lockReason || block.reason || "Not available yet."),
      kind: String(block.unlockKind || "unavailable"),
    };
  });
  const value = (key) => byKey.get(key)?.value || {};
  const text = (input, fallback) => String(input || fallback || "").trim();
  const teamValue = value("team");
  const qrValue = value("qr");
  const socialValue = value("social");
  const clockValue = value("clock");
  const basicValue = value("basic");
  const heroValue = value("hero");
  const typeValue = value("type");
  const badgesValue = value("badges");
  const bars90Value = value("bars90");
  const pieValue = value("pie");
  const modelcostValue = value("modelcost");
  const cgaugeValue = value("cgauge");
  const ringsValue = value("rings");
  const ctxringValue = value("ctxring");
  const heatValue = value("heat");
  const dotsValue = value("dots");
  const waterValue = value("water");
  const vsavgValue = value("vsavg");
  const trendValue = value("trend");
  const tallyValue = value("tally");
  const dialValue = value("dial");
  const waveValue = value("wave");
  const peaksValue = value("peaks");
  const ratioValue = value("ratio");
  const toolsValue = value("tools");
  const stadiumValue = value("stadium");
  const bracketValue = value("bracket");
  const nodeValue = value("node");
  const splitringValue = value("splitring");
  const tier1Value = value("tier1");
  const auraValue = value("aura");
  const tier4Value = value("tier4");
  const rankValues = [tier1Value, auraValue, tier4Value];
  const rankTopPercentLabel = rankValues
    .map((rank) => text(rank.topPercentLabel))
    .find(Boolean) || text(data.rankTopPercentLabel);
  const parseRankPercent = (input, isRatio = false) => {
    const match = String(input || "").match(/(?:top\s*)?(\d*\.?\d+)\s*%?/i);
    const parsed = match ? Number(match[1]) : NaN;
    // Publisher rank numbers are ratios: 0.0306 means 3.06%, not 0.0306%.
    // Explicit percent labels and legacy values above 1 are already percentages.
    const percent = isRatio && !String(input).includes("%") && parsed <= 1 ? parsed * 100 : parsed;
    return Number.isFinite(percent) && percent > 0 && percent <= 100 ? percent : null;
  };
  const rankTopPercent = rankValues
    .map((rank) => parseRankPercent(rank.topPercent, true))
    .find((percent) => percent !== null) ??
    parseRankPercent(data.rankTopPercent, true) ??
    parseRankPercent(rankTopPercentLabel);
  const rankTierInput = rankValues
    .map((rank) => text(rank.tier).toUpperCase())
    .find(Boolean) || text(data.rankTier).toUpperCase();
  const rankTier = rankTopPercent !== null
    ? rankTopPercent <= 0.1
      ? "LASER"
      : rankTopPercent <= 1
        ? "NEON"
        : "STANDARD"
    : rankTierInput;
  const labelPercent = parseRankPercent(rankTopPercentLabel);
  const roundedRankTopPercent = rankTopPercent === null ? null : Number(rankTopPercent.toFixed(rankTopPercent < 0.1 ? 2 : 1));
  const resolvedRankTopPercentLabel = rankTopPercent !== null
    ? labelPercent !== null && Number(labelPercent.toFixed(rankTopPercent < 0.1 ? 2 : 1)) === roundedRankTopPercent
      ? rankTopPercentLabel
      : `Top ${roundedRankTopPercent || '<0.01'}%`
    : rankTopPercentLabel;
  const sealValue = value("seal");
  const persona = {
    ...MASON,
    n1: text(data.title, "AI"),
    n2: text(data.subtitle, "Builder"),
    handle: text(data.cardHandle, text(data.handle, "@builder")),
    family: text(data.family, "BUILDERS").toUpperCase(),
    fam: text(data.familyColor, "#F0641E"),
    signature: text(heroValue.signature, data.heroDefinition || ""),
    heroBadge: text(heroValue.heroBadge, data.heroBadge || ""),
    heroTags: Array.isArray(heroValue.heroTags) && heroValue.heroTags.length ? heroValue.heroTags : (Array.isArray(data.heroTags) ? data.heroTags : []),
    heroBadgeColor: text(heroValue.heroBadgeColor, data.heroBadgeColor || "#C9F24C"),
    art: text(data.art, "inv"),
    team: [text(data.team || teamValue.team, "CODEX").toUpperCase(), text(data.teamIcon || teamValue.teamIcon, "codex")],
    type: text(typeValue.type || heroValue.type, data.code || "AI"),
    seal: { serial: text(sealValue.serial, data.cardSerial || data.serial || "UNMINTED") },
    qr: { target: text(qrValue.target, data.qrTarget || "stax"), url: text(qrValue.url, ""), username: text(qrValue.username, ""), size: Math.max(0, Math.floor(Number(qrValue.size) || 0)), matrix: text(qrValue.matrix, ""), errorCorrectionLevel: text(qrValue.errorCorrectionLevel, "M") },
    staxUrl: text(data.staxCardPageUrl, ""),
    social: { x: text(socialValue.x, ""), github: text(socialValue.github, "") },
    axes: Array.isArray(typeValue.axes) && typeValue.axes.length ? typeValue.axes : (Array.isArray(data.axes) && data.axes.length ? data.axes : MASON.axes),
    basicVal: text(basicValue.basicVal, data.basicValue || data.tokenLabel || "0"),
    band: Array.isArray(clockValue.band) ? clockValue.band : MASON.band,
    hourBuckets: Array.isArray(clockValue.hourBuckets) ? clockValue.hourBuckets.slice(0, 24) : [],
    peakH: Number.isFinite(Number(clockValue.peakH)) ? Number(clockValue.peakH) : MASON.peakH,
    bird: text(clockValue.bird, data.rhythm || MASON.bird),
    peakLabel: text(clockValue.peakLabel, Number.isFinite(Number(clockValue.peakH)) ? "PEAK " + String(Number(clockValue.peakH)).padStart(2, "0") + ":00" : MASON.peakLabel),
    badges: Array.isArray(badgesValue.badges) && badgesValue.badges.length ? badgesValue.badges : (Array.isArray(data.badges) ? data.badges : MASON.badges),
    bars90: {
      tokens90d: Array.isArray(bars90Value.tokens90d) ? bars90Value.tokens90d : [],
      visualBuckets: Array.isArray(bars90Value.visualBuckets) ? bars90Value.visualBuckets : [],
      tokens90dTotal: text(bars90Value.tokens90dTotal, data.tokenLabel || "0"),
      dayCount: Number.isFinite(Number(bars90Value.dayCount)) ? Number(bars90Value.dayCount) : 0,
      observedBucketCount: Number.isFinite(Number(bars90Value.observedBucketCount)) ? Number(bars90Value.observedBucketCount) : 0,
      isPartialSample: Boolean(bars90Value.isPartialSample),
      periodLabel: text(bars90Value.periodLabel, data.usageLabel || "This Month"),
    },
    pie: {
      modelMix: Array.isArray(pieValue.modelMix) ? pieValue.modelMix : [],
      periodLabel: text(bars90Value.dayCount ? bars90Value.dayCount + " DAYS" : "", data.usageLabel || bars90Value.periodLabel || "LOCAL"),
    },
    modelcost: {
      models: Array.isArray(modelcostValue.models) ? modelcostValue.models.slice(0, 3).map((model) => ({ modelId: text(model?.modelId, ""), name: text(model?.name, model?.modelId || "MODEL"), provider: text(model?.provider, ""), pricingModel: text(model?.pricingModel, ""), priceSource: text(model?.priceSource, ""), totalUsd: Math.max(0, Number(model?.totalUsd) || 0) })) : [],
      totalUsd: Math.max(0, Number(modelcostValue.totalUsd) || 0),
      coverageRatio: Math.max(0, Math.min(1, Number(modelcostValue.coverageRatio) || 0)),
      partial: Boolean(modelcostValue.partial),
      unpricedModelCount: Math.max(0, Math.floor(Number(modelcostValue.unpricedModelCount) || 0)),
      unpricedTokenCount: Math.max(0, Math.floor(Number(modelcostValue.unpricedTokenCount) || 0)),
      periodId: text(modelcostValue.periodId, data.usagePeriodId || "thisMonth"),
      periodLabel: text(modelcostValue.periodLabel, data.usageLabel || "This Month"),
      priceTableUpdatedAt: text(modelcostValue.priceTableUpdatedAt, ""),
    },
    cgauge: {
      usedPercent: Number.isFinite(Number(cgaugeValue.usedPercent)) ? Number(cgaugeValue.usedPercent) : null,
      usedCredits: Number.isFinite(Number(cgaugeValue.usedCredits)) ? Number(cgaugeValue.usedCredits) : null,
      totalCredits: Number.isFinite(Number(cgaugeValue.totalCredits)) ? Number(cgaugeValue.totalCredits) : null,
      remainingCredits: Number.isFinite(Number(cgaugeValue.remainingCredits)) ? Number(cgaugeValue.remainingCredits) : null,
      resetAt: text(cgaugeValue.resetAt, ""),
      periodStart: text(cgaugeValue.periodStart, ""),
      periodEnd: text(cgaugeValue.periodEnd, ""),
      periodId: text(cgaugeValue.periodId, data.usagePeriodId || "thisMonth"),
      planName: text(cgaugeValue.planName, ""),
    },
    rings: {
      metrics: Array.isArray(ringsValue.metrics) ? ringsValue.metrics.slice(0, 3) : [],
      streakToday: Number.isFinite(Number(ringsValue.streakToday)) ? Number(ringsValue.streakToday) : 0,
      streakLabel: text(ringsValue.streakLabel, "LOCAL BUILD-DAY STREAK"),
      periodLabel: text(ringsValue.periodLabel, data.usageLabel || "LOCAL PERIOD"),
      sourceLabel: text(ringsValue.sourceLabel, "LOCAL LOGS"),
      coverage: ringsValue.coverage && typeof ringsValue.coverage === "object" ? ringsValue.coverage : {},
      estimated: Boolean(byKey.get("rings")?.estimated),
    },
    ctxring: {
      ctxAvg: Number.isFinite(Number(ctxringValue.ctxAvg)) ? Number(ctxringValue.ctxAvg) : null,
      avgInputTokens: Number(ctxringValue.avgInputTokens) || 0,
      requestCount: Number(ctxringValue.requestCount) || 0,
      display: text(ctxringValue.display, ""),
    },
    heat: {
      days: Array.isArray(heatValue.days) ? heatValue.days.map((day) => ({ date: text(day?.date, ""), observed: day?.observed !== false, builds: Number(day?.builds) || 0 })) : [],
      buildsDaily: Array.isArray(heatValue.buildsDaily) ? heatValue.buildsDaily : [],
      observedDayCount: Number(heatValue.observedDayCount) || 0,
      activeDayCount: Number(heatValue.activeDayCount) || 0,
      currentStreak: Number(heatValue.currentStreak) || 0,
      bestStreak: Number(heatValue.bestStreak) || 0,
      coverage: heatValue.coverage && typeof heatValue.coverage === "object" ? heatValue.coverage : {},
    },
    dots: {
      apiCalls90d: Number.isFinite(Number(dotsValue.apiCalls90d)) ? Number(dotsValue.apiCalls90d) : null,
      toolCallCount: Number(dotsValue.toolCallCount) || 0,
      display: text(dotsValue.display, "0"),
      periodLabel: text(dotsValue.periodLabel, data.usageLabel || "LOCAL SCAN"),
      dailyToolCalls: Array.isArray(dotsValue.dailyToolCalls) ? dotsValue.dailyToolCalls.slice(-15).map((day) => ({ date: text(day?.date, ""), count: Number(day?.count) || 0 })) : [],
    },
    water: {
      topPercent: Number(waterValue.topPercent) || 0,
      metric: text(waterValue.metric, ""),
      cohortSize: Number(waterValue.cohortSize) || 0,
      minimumCohortSize: Number(waterValue.minimumCohortSize) || 0,
      environment: text(waterValue.environment, "unknown").toLowerCase(),
      publicRankReady: Boolean(waterValue.publicRankReady),
      testOnly: Boolean(waterValue.testOnly),
    },
    vsavg: {
      creatorTokens: Number(vsavgValue.creatorTokens) || 0,
      communityMedian: Number(vsavgValue.communityMedian) || 0,
      deltaPercent: Number(vsavgValue.deltaPercent) || 0,
      display: text(vsavgValue.display, "—"),
      baseline: text(vsavgValue.baseline, "median"),
      periodLabel: text(vsavgValue.periodLabel, data.usageLabel || "This Month"),
    },
    trend: {
      delta: Number(trendValue.delta) || 0,
      display: text(trendValue.display, ""),
      currentBuilds: Number(trendValue.currentBuilds) || 0,
      previousBuilds: Number(trendValue.previousBuilds) || 0,
      comparison: text(trendValue.comparison, ""),
      currentPeriodLabel: text(trendValue.currentPeriodLabel, ""),
      previousPeriodLabel: text(trendValue.previousPeriodLabel, ""),
    },
    tally: {
      shipped: Math.max(0, Math.floor(Number(tallyValue.shipped) || 0)),
    },
    dial: {
      score: dialValue.score !== undefined && dialValue.score !== null && dialValue.score !== "" && Number.isFinite(Number(dialValue.score)) ? Math.max(0, Math.min(100, Math.round(Number(dialValue.score)))) : null,
      maxScore: Math.max(1, Math.round(Number(dialValue.maxScore) || 100)),
      version: text(dialValue.version, ""),
      breakdown: dialValue.breakdown && typeof dialValue.breakdown === "object" ? dialValue.breakdown : {},
    },
    wave: {
      waves: Array.isArray(waveValue.waves) ? waveValue.waves.slice(-5).map((wave) => ({ id: text(wave?.id, ""), label: text(wave?.label, ""), buildSessionCount: Math.max(0, Math.floor(Number(wave?.buildSessionCount) || 0)), activeDayCount: Math.max(0, Math.floor(Number(wave?.activeDayCount) || 0)) })) : [],
      totalBuildSessions: Math.max(0, Math.floor(Number(waveValue.totalBuildSessions) || 0)),
      observedDayCount: Math.max(0, Math.floor(Number(waveValue.observedDayCount) || 0)),
      periodId: text(waveValue.periodId, "last30Days"),
    },
    peaks: {
      bestDay: text(peaksValue.bestDay, ""),
      date: text(peaksValue.date, ""),
      metric: text(peaksValue.metric, "tokens"),
      observedDayCount: Math.max(0, Math.floor(Number(peaksValue.observedDayCount) || 0)),
      peakShape: Array.isArray(peaksValue.peakShape) ? peaksValue.peakShape.slice(-30).map((value) => Math.max(0, Number(value) || 0)) : [],
      peakDates: Array.isArray(peaksValue.peakDates) ? peaksValue.peakDates.slice(-30).map((date) => text(date, "")) : [],
    },
    ratio: {
      tokensIn: text(ratioValue.tokensIn, "0"),
      tokensOut: text(ratioValue.tokensOut, "0"),
      tokensInValue: Math.max(0, Number(ratioValue.tokensInValue) || 0),
      tokensOutValue: Math.max(0, Number(ratioValue.tokensOutValue) || 0),
      inShare: Math.max(0, Math.min(1, Number(ratioValue.inShare) || 0)),
      periodId: text(ratioValue.periodId, data.usagePeriodId || "thisMonth"),
      periodLabel: text(ratioValue.periodLabel, data.usageLabel || "This Month"),
    },
    tools: {
      tools: Array.isArray(toolsValue.tools) ? toolsValue.tools : [],
      capabilities: Array.isArray(toolsValue.capabilities) ? toolsValue.capabilities : undefined,
    },
    stadium: {
      tokensAllTime: text(stadiumValue.tokensAllTime, ""),
      tokensTotal: text(stadiumValue.tokensTotal || stadiumValue.tokensAllTime, data.tokenLabel || "0"),
      allTimeTokens: Math.max(0, Number(stadiumValue.allTimeTokens) || 0),
      totalTokens: Math.max(0, Number(stadiumValue.totalTokens) || 0),
      periodId: text(stadiumValue.periodId, data.usagePeriodId || "thisMonth"),
      periodLabel: text(stadiumValue.periodLabel, data.usageLabel || "This Month"),
    },
    bracket: {
      label: text(bracketValue.label, bracketValue.estimated ? "API EQUIV." : "TOKENS"),
      value: text(bracketValue.value, "0"),
      estimated: Boolean(bracketValue.estimated || byKey.get("bracket")?.estimated),
      periodId: text(bracketValue.periodId, data.usagePeriodId || "thisMonth"),
      periodLabel: text(bracketValue.periodLabel, data.usageLabel || "This Month"),
    },
    node: {
      integrations: (Array.isArray(nodeValue.integrations) ? nodeValue.integrations : (Array.isArray(nodeValue.categories) ? nodeValue.categories.map((category, index) => ({ name: category?.label, color: ["#C9F24C", "#2BD4C0", "#7C6CF6", "#FFC93D", "#F0641E"][index % 5] })) : [])).slice(0, 5).map((integration, index) => ({ name: text(integration?.name, "Tool"), color: text(integration?.color, ["#C9F24C", "#2BD4C0", "#7C6CF6", "#FFC93D", "#F0641E"][index % 5]) })),
    },
    splitring: {
      chatShare: splitringValue.chatShare!==null&&splitringValue.chatShare!==undefined&&splitringValue.chatShare!==''&&Number.isFinite(Number(splitringValue.chatShare)) ? Math.max(0, Math.min(1, Number(splitringValue.chatShare))) : null,
      buildShare: splitringValue.buildShare!==null&&splitringValue.buildShare!==undefined&&splitringValue.buildShare!==''&&Number.isFinite(Number(splitringValue.buildShare)) ? Math.max(0, Math.min(1, Number(splitringValue.buildShare))) : null,
      sessionCount: Math.max(0, Math.floor(Number(splitringValue.sessionCount) || 0)),
      chatSessionCount: Math.max(0, Math.floor(Number(splitringValue.chatSessionCount) || 0)),
      buildSessionCount: Math.max(0, Math.floor(Number(splitringValue.buildSessionCount) || 0)),
      periodId: text(splitringValue.periodId, data.usagePeriodId || "thisMonth"),
      periodLabel: text(splitringValue.periodLabel, data.usageLabel || "This Month"),
      estimated: Boolean(byKey.get("splitring")?.estimated),
    },
    tier1: {
      tier: rankTier || "STANDARD",
      topPercent: rankTopPercent || 0,
      topPercentLabel: resolvedRankTopPercentLabel,
    },
  };
  PERSONAS.publisher = {
    pd: persona,
    // The shell's Top 5% / Top 30% finishes use the real percentile, independently
    // of the rank component's Top 1% / Top 0.1% treatments. Unknown rank stays standard.
    finish: rankTopPercent !== null ? (rankTopPercent <= 5 ? "gold" : rankTopPercent <= 30 ? "silver" : "ink") : "ink",
    ser: text(data.cardSerial, text(data.serial, "UNMINTED")),
    user: [persona.handle, persona.type, persona.family, text(data.tag, data.usageLabel)].filter(Boolean).join(" · "),
    hudRank: resolvedRankTopPercentLabel,
    title: text(data.shareTitle, data.title || "Your Stax is ready."),
    tag: text(data.tag, data.usageLabel || "LOCAL"),
    scan: [text(data.tokenLabel, "0") + " TOKENS", text(data.scanLabel, data.rhythm || "LOCAL SCAN")],
    scanLines: Array.isArray(data.scanLines) ? data.scanLines : [],
    loginUrl: text(data.loginUrl || data.auth?.loginUrl, ""),
    needsTakuAuth: Boolean(data.needsTakuAuth),
    needsTakuProfile: Boolean(data.needsTakuProfile),
    auth: data.auth || {},
    unlockSummary: data.unlockSummary || (data.auth && data.auth.unlockSummary) || {},
    cap: text(data.caption, "Built from local publisher scan. Estimated fields are marked in the dock."),
    fullset: Array.isArray(data.studioLayout?.blocks) ? data.studioLayout.blocks.map(block => block.key) : selected,
    layout: Array.isArray(data.studioLayout?.blocks) ? Object.fromEntries(data.studioLayout.blocks.map(block => [block.key, [block.cx, block.cy]])) : null,
    locks,
    blocks,
  };
  const sw = document.getElementById("pswitch");
  if (sw) {
    sw.innerHTML = "";
    const avatar = document.createElement("span");
    avatar.className = "pav on";
    avatar.dataset.p = "publisher";
    avatar.style.background = persona.fam;
    avatar.innerHTML = "<img src=\"" + (ART[persona.art] || ART.inv || "") + "\" alt=\"\">";
    avatar.title = persona.handle;
    avatar.addEventListener("click", () => setPersona("publisher"));
    sw.appendChild(avatar);
  }
  setPersona("publisher");
  const teamSelect = document.getElementById("teamselect");
  const teamOptions = Array.isArray(data.teamOptions) ? data.teamOptions : [];
  if (teamSelect && teamOptions.length) {
    teamSelect.replaceChildren(...teamOptions.map((option) => new Option(text(option.label, option.id).toUpperCase(), text(option.id, option.icon))));
    const activeTeam = teamOptions.find((option) => option.selected) || teamOptions[0];
    teamSelect.value = text(activeTeam.id, activeTeam.icon);
    teamSelect.disabled = Boolean(data.readonly) || teamOptions.length < 2;
    teamSelect.closest(".teamswitch")?.classList.remove("is-hidden");
    teamSelect.addEventListener("change", async () => {
      const selectedTeam = teamOptions.find((option) => text(option.id, option.icon) === teamSelect.value);
      if (!selectedTeam) return;
      persona.team = [text(selectedTeam.label, "CODEX").toUpperCase(), text(selectedTeam.icon, "codex")];
      const teamBlock = byKey.get("team");
      if (teamBlock) teamBlock.value = { ...(teamBlock.value || {}), team: persona.team, teamIcon: persona.team[1], identityBasis: "user-selection" };
      PERSONAS.publisher.pd = persona;
      PD = persona;
      for (const placed of placedP.filter((item) => item.key === "team")) {
        placed.el.innerHTML = R.team(placed.cw * U - GAP, placed.ch * U - GAP);
      }
      for (const key in chipRefs) delete chipRefs[key];
      document.getElementById("dockscroll").innerHTML = "";
      buildDock();
      for (const placed of placedP) chipRefs[placed.key]?.classList.add("on");
      toast("PRIMARY AI · " + persona.team[0]);
      if (!data.readonly) {
        try {
          if (typeof window.__TAKU_STAX_POST__ === "function") {
            window.__TAKU_STAX_POST__("settings-change", { requestId: "primary-ai-" + Date.now() + "-" + Math.random().toString(36).slice(2), settings: { primaryAi: selectedTeam.id } });
          } else {
            await fetch("/api/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: { primaryAi: selectedTeam.id } }) });
          }
        } catch {}
      }
    });
  }
  const qrSelect = document.getElementById("qrselect");
  const qrOptions = Array.isArray(data.qrOptions) ? data.qrOptions : [];
  if (qrSelect && qrOptions.length) {
    qrSelect.replaceChildren(...qrOptions.map((option) => new Option(text(option.label, option.id).toUpperCase(), text(option.id, "stax"))));
    const activeQr = qrOptions.find((option) => text(option.id, "stax") === text(data.qrTarget, persona.qr.target)) || qrOptions[0];
    qrSelect.value = text(activeQr.id, "stax");
    qrSelect.disabled = Boolean(data.readonly);
    qrSelect.closest(".qrswitch")?.classList.remove("is-hidden");
    qrSelect.addEventListener("change", async () => {
      const selectedQr = qrOptions.find((option) => text(option.id, "stax") === qrSelect.value);
      if (!selectedQr) return;
      persona.qr = { target: text(selectedQr.id, "stax"), url: text(selectedQr.url, ""), username: text(selectedQr.username, qrValue.username), size: Math.max(0, Math.floor(Number(selectedQr.size) || 0)), matrix: text(selectedQr.matrix, ""), errorCorrectionLevel: text(selectedQr.errorCorrectionLevel, "M") };
      const qrBlock = byKey.get("qr");
      if (qrBlock) qrBlock.value = { ...(qrBlock.value || {}), ...persona.qr };
      PERSONAS.publisher.pd = persona;
      PD = persona;
      for (const placed of placedP.filter((item) => item.key === "qr")) {
        placed.el.innerHTML = R.qr(placed.cw * U - GAP, placed.ch * U - GAP);
      }
      for (const key in chipRefs) delete chipRefs[key];
      document.getElementById("dockscroll").innerHTML = "";
      buildDock();
      for (const placed of placedP) chipRefs[placed.key]?.classList.add("on");
      toast("QR LINK · " + text(selectedQr.label, selectedQr.id).toUpperCase());
      if (!data.readonly) {
        try {
          if (typeof window.__TAKU_STAX_POST__ === "function") {
            window.__TAKU_STAX_POST__("settings-change", { requestId: "qr-target-" + Date.now() + "-" + Math.random().toString(36).slice(2), settings: { qrTarget: selectedQr.id } });
          } else {
            await fetch("/api/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: { qrTarget: selectedQr.id } }) });
          }
        } catch {}
      }
    });
  }
  const githubConnect = document.getElementById("githubconnect");
  const githubConfirm = document.getElementById("githubconfirm");
  const githubConfirmHandle = document.getElementById("githubconfirmhandle");
  const githubConfirmCancel = document.getElementById("githubconfirmcancel");
  const githubConfirmSubmit = document.getElementById("githubconfirmsubmit");
  const socialCandidate = data.socialCandidate && typeof data.socialCandidate === "object" ? data.socialCandidate : null;
  const githubCandidate = text(socialCandidate?.username, "").replace(/^@+/, "");
  if (githubConnect && githubConfirm && githubConfirmSubmit && githubCandidate && !persona.social.github && !data.readonly) {
    document.getElementById("githubcandidate").textContent = "@" + githubCandidate;
    if (githubConfirmHandle) githubConfirmHandle.textContent = "@" + githubCandidate;
    githubConnect.classList.remove("is-hidden");
    const closeGithubConfirm = () => githubConfirm.classList.remove("on");
    const openGithubConfirm = () => { githubConfirm.classList.add("on"); githubConfirmSubmit.focus(); };
    window.__TAKU_OPEN_GITHUB_CONFIRM__ = openGithubConfirm;
    githubConnect.addEventListener("click", openGithubConfirm);
    githubConfirmCancel?.addEventListener("click", closeGithubConfirm);
    githubConfirm.addEventListener("click", (event) => { if (event.target === githubConfirm) closeGithubConfirm(); });
    let pendingGithubRequestId = "";
    const setGithubSaving = (saving) => {
      githubConfirmSubmit.disabled = saving;
      githubConfirmSubmit.textContent = saving ? "CONNECTING..." : "ADD GITHUB";
      githubConfirmSubmit.setAttribute("aria-busy", saving ? "true" : "false");
      if (githubConfirmCancel) githubConfirmCancel.disabled = saving;
    };
    const applyConfirmedGithub = () => {
      setGithubSaving(false);
      persona.social.github = githubCandidate;
      const socialBlock = byKey.get("social");
      if (socialBlock) { socialBlock.status = "supported"; socialBlock.source = "publisher.confirmed_social"; socialBlock.value = { ...(socialBlock.value || {}), github: githubCandidate }; }
      delete locks.social;
      if (!selected.includes("social")) selected.splice(Math.min(1, selected.length), 0, "social");
      PERSONAS.publisher.fullset = [...selected];
      PERSONAS.publisher.pd = persona;
      githubConnect.classList.add("is-hidden");
      closeGithubConfirm();
      setPersona("publisher");
      toast("GITHUB @" + githubCandidate + " ADDED");
    };
    window.__TAKU_GITHUB_SAVE_SUCCESS__ = (message) => {
      if (pendingGithubRequestId && message?.requestId !== pendingGithubRequestId) return;
      pendingGithubRequestId = "";
      applyConfirmedGithub();
    };
    window.__TAKU_GITHUB_SAVE_ERROR__ = (message) => {
      if (pendingGithubRequestId && message?.requestId !== pendingGithubRequestId) return;
      pendingGithubRequestId = "";
      setGithubSaving(false);
      toast(text(message?.message, "Could not add GitHub account."));
    };
    githubConfirmSubmit.addEventListener("click", async () => {
      setGithubSaving(true);
      if (typeof window.__TAKU_STAX_POST__ === "function") {
        pendingGithubRequestId = "github-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        window.__TAKU_STAX_POST__("settings-change", { requestId: pendingGithubRequestId, settings: { confirmedSocial: { github: githubCandidate } } });
        return;
      }
      try {
        const response = await fetch("/api/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card: { confirmedSocial: { github: githubCandidate } } }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error(result.error || "Could not add GitHub account.");
        applyConfirmedGithub();
      } catch (error) {
        setGithubSaving(false);
        toast(error instanceof Error ? error.message : "COULD NOT ADD GITHUB");
      }
    });
  }
  if (data.readonly) {
    document.getElementById("scanov")?.classList.add("off");
    document.getElementById("revealov")?.classList.remove("on");
    openShare("visitor");
  } else {
    playIntro("publisher");
  }
};
