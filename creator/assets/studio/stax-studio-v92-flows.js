/* Stax Studio v9.2 presentation helpers.
   Include after the runtime's inline scripts. Safe to call init again after bootstrap. */
(function () {
  function init() {
    const scan = document.getElementById('scanov');
    const reveal = document.getElementById('revealov');
    const share = document.getElementById('shareov');
    const modal = document.getElementById('modal');
    if (!scan || !reveal || !share || !modal) return false;
    if (scan.dataset.v92FlowsReady === '1') return true;
    scan.dataset.v92FlowsReady = '1';

    // The runtime uses a light lockup on its dark surfaces. These two new
    // light surfaces use the repository's dark lockup, including its orange dot.
    const darkLogo = new URL('/studio/stax-studio-v92-logo-dark.svg', document.baseURI).href;
    for (const logo of [scan.querySelector('.scanlogo'), share.querySelector('.shlogo')]) {
      if (!logo) continue;
      const refreshLogo = () => { if (logo.src !== darkLogo) logo.src = darkLogo; };
      new MutationObserver(refreshLogo).observe(logo, { attributes: true, attributeFilter: ['src'] });
      refreshLogo();
    }

    const scanBox = scan.querySelector('.scanbox');
    scan.querySelector('.scantitle').textContent = 'Cooking your Stax';
    const cooker = document.createElement('div');
    cooker.className = 'v92-cook-device';
    const screen = document.createElement('div');
    screen.className = 'v92-cook-screen';
    const status = document.createElement('span');
    status.className = 'v92-screen-status';
    status.textContent = 'Cooking';
    const code = document.createElement('canvas');
    code.className = 'v92-screen-code';
    code.width = 188;
    code.height = 56;
    code.setAttribute('role', 'img');
    const halftoneCanvas = document.createElement('canvas');
    halftoneCanvas.className = 'v92-halftone';
    halftoneCanvas.width = 640;
    halftoneCanvas.height = 640;
    halftoneCanvas.setAttribute('aria-hidden', 'true');
    const art = document.createElement('img');
    art.alt = '';
    art.setAttribute('aria-hidden', 'true');
    screen.append(status, code, halftoneCanvas, art);
    scanBox.before(cooker);
    cooker.append(screen, scanBox);

    const scanLines = document.getElementById('scanlines');
    const visualRows = document.createElement('div');
    visualRows.className = 'v92-scan-rows';
    visualRows.setAttribute('aria-live', 'off');
    scanLines.before(visualRows);

    const progress = document.createElement('span');
    progress.className = 'v92-progress-label';
    progress.textContent = '0%';
    const progressWrap = document.createElement('div');
    progressWrap.className = 'v92-cook-progress';
    const scanBar = scanBox.querySelector('.scanbar');
    scanBar.before(progressWrap);
    progressWrap.append(scanBar, progress);
    const scanHint = document.createElement('div');
    scanHint.className = 'v92-scan-hint';
    scanHint.innerHTML = 'Press <span class="v92-kbd">Space</span> to jump ahead';
    scan.append(scanHint);
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'v92-scan-skip';
    skip.textContent = 'Skip intro';
    skip.setAttribute('aria-label', 'Skip intro');
    skip.addEventListener('click', (event) => {
      event.stopPropagation();
      const skipIntro = window.__TAKU_STAX_SKIP_INTRO__;
      if (typeof skipIntro === 'function') skipIntro();
      else scan.click();
    });
    scan.append(skip);

    const dotContext = halftoneCanvas.getContext('2d');
    const codeContext = code.getContext('2d');
    const glyphs = {
      A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
      E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
      H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
      I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
      L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
      M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
      O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
      W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    };
    function paintCode(value) {
      const lettersToDraw = String(value || 'AI').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      code.setAttribute('aria-label', lettersToDraw);
      codeContext.clearRect(0, 0, code.width, code.height);
      const pitch = 5.9;
      const x0 = code.width - lettersToDraw.length * 6 * pitch + 1;
      for (let index = 0; index < lettersToDraw.length; index++) {
        const glyph = glyphs[lettersToDraw[index]];
        if (!glyph) continue;
        for (let y = 0; y < glyph.length; y++) {
          for (let x = 0; x < glyph[y].length; x++) {
            if (glyph[y][x] !== '1') continue;
            codeContext.beginPath();
            codeContext.fillStyle = '#252525';
            codeContext.arc(x0 + index * 6 * pitch + x * pitch, 8 + y * pitch, 2.25, 0, Math.PI * 2);
            codeContext.fill();
          }
        }
      }
    }
    const imageDots = new Map();
    const poolKeys = [
      'invsm', 'nighthacker', 'daemondaddy', 'uimaxxer', 'vibegoblin', 'madsci',
      'chaoseng', 'vampcrafter', 'brainrotter', 'automax', 'rookie', 'robot', 'goblin', 'daemon',
    ]
      .filter((key) => typeof ART !== 'undefined' && ART[key]);
    let poolIndex = Math.floor(Math.random() * poolKeys.length);
    let currentArtKey = poolKeys[poolIndex] || '';
    let cycleTimer = 0;
    let activeProfile = null;
    let resolvedCode = 'EILW';
    let activeIntroRun = -1;
    let rowDefinitions = [];
    const letters = [['E', 'A'], ['M', 'I'], ['L', 'O'], ['W', 'H']];
    const randomCode = () => letters.map((pair) => pair[Math.floor(Math.random() * pair.length)]).join('');
    const sand = '#ECE5CF';
    const familyTints = {
      HACKERS: '#F3CEB9',
      'VIBE MAKERS': '#C4DFCB',
      ARCHITECTS: '#D8D5F1',
      CRAFTSMEN: sand,
      BUILDERS: '#F3CEB9',
      MAKERS: '#C4DFCB',
      DAEMONS: '#D8D5F1',
    };
    function familyTint(profile) {
      const family = String(profile?.family || '').toUpperCase();
      if (familyTints[family]) return familyTints[family];
      const color = String(profile?.fam || '');
      if (!/^#[0-9a-f]{6}$/i.test(color)) return sand;
      const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
      return `rgb(${rgb.map((channel) => Math.round(channel * .25 + 236 * .75)).join(', ')})`;
    }

    function personalityCode(profile, persona) {
      const candidates = [
        profile?.type,
        persona?.type,
        typeof window.__TAKU_STAX_DATA__?.code === 'string' ? window.__TAKU_STAX_DATA__.code : '',
      ];
      const valid = candidates.find((value) => /^[A-Z]{4}$/i.test(String(value || '').trim()));
      if (valid) return String(valid).trim().toUpperCase();
      const artFallbacks = { inv: 'EILW', invsm: 'EILW', robot: 'AMLH', goblin: 'EMLH', daemon: 'AILW' };
      return artFallbacks[String(profile?.art || '').toLowerCase()] || 'EILW';
    }

    function loadDots(key) {
      if (!key || imageDots.has(key) || !ART[key]) return;
      imageDots.set(key, null);
      const image = new Image();
      image.src = ART[key];
      const process = () => {
        if (!image.naturalWidth) return;
        const size = 58;
        const source = document.createElement('canvas');
        source.width = size;
        source.height = size;
        const context = source.getContext('2d');
        const original = document.createElement('canvas');
        original.width = image.naturalWidth;
        original.height = image.naturalHeight;
        const originalContext = original.getContext('2d');
        originalContext.drawImage(image, 0, 0);
        const pixels = originalContext.getImageData(0, 0, original.width, original.height).data;
        let minX = original.width, minY = original.height, maxX = 0, maxY = 0;
        for (let y = 0; y < original.height; y++) {
          for (let x = 0; x < original.width; x++) {
            if (pixels[(y * original.width + x) * 4 + 3] < 32) continue;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
        const sourceWidth = maxX >= minX ? maxX - minX + 1 : original.width;
        const sourceHeight = maxY >= minY ? maxY - minY + 1 : original.height;
        const scale = Math.min(size * .9 / sourceWidth, size * .9 / sourceHeight);
        const width = sourceWidth * scale;
        const height = sourceHeight * scale;
        context.drawImage(image, minX < original.width ? minX : 0, minY < original.height ? minY : 0,
          sourceWidth, sourceHeight, (size - width) / 2, size - height - 2, width, height);
        const rgba = context.getImageData(0, 0, size, size).data;
        const dots = new Float32Array(size * size);
        for (let index = 0; index < dots.length; index++) {
          const alpha = rgba[index * 4 + 3] / 255;
          if (alpha < .1) continue;
          const luminance = (.299 * rgba[index * 4] + .587 * rgba[index * 4 + 1] + .114 * rgba[index * 4 + 2]) / 255;
          dots[index] = alpha * (.12 + 1.25 * Math.pow(1 - luminance, 1.15));
        }
        imageDots.set(key, dots);
        if (currentArtKey === key && !screen.classList.contains('is-landed')) paintDots(key);
      };
      if (image.complete && image.naturalWidth) process();
      else image.onload = process;
    }

    function paintDots(key) {
      const size = 58;
      const pitch = halftoneCanvas.width / size;
      const values = imageDots.get(key);
      dotContext.clearRect(0, 0, halftoneCanvas.width, halftoneCanvas.height);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const value = values ? values[y * size + x] : 0;
          dotContext.beginPath();
          dotContext.fillStyle = value > 0 ? 'rgba(27, 27, 27, .86)' : 'rgba(0, 0, 0, .07)';
          dotContext.arc(x * pitch + pitch / 2, y * pitch + pitch / 2,
            value > 0 ? Math.min(pitch * .47, pitch * (.1 + value * .34)) : pitch * .1,
            0, Math.PI * 2);
          dotContext.fill();
        }
      }
    }

    function formatLabel(raw) {
      const source = String(raw || '').trim().replace(/\s*(?:\.{2,}|…)+\s*$/, '');
      const known = {
        'FIRING UP THE KITCHEN': 'Firing up the kitchen',
        'READING LOCAL USAGE': 'Reading local usage',
        'READING CONTEXT': 'Reading context',
        'TASTING YOUR RHYTHM': 'Tasting your rhythm',
        'SEASONING TYPE': 'Seasoning your type',
        'PLATING FAMILY': 'Plating your family',
        'STAMPING SERIAL': 'Stamping your serial',
        'SYNCING TAKU IDENTITY': 'Syncing Taku identity',
        'PULLING REAL HANDLE': 'Pulling real handle',
        'MINTING STAX SERIAL': 'Minting Stax serial',
      };
      if (known[source]) return known[source];
      if (source.startsWith('TOSSING IN ')) {
        const name = source.slice(11).toLowerCase().replace(/^./, (character) => character.toUpperCase());
        return `Tossing in ${name}`;
      }
      return source.toLowerCase().replace(/^./, (character) => character.toUpperCase())
        .replace(/\b(taku|codex|claude|stax)\b/g, (word) => word[0].toUpperCase() + word.slice(1));
    }

    function formatResult(raw) {
      const source = String(raw || '').trim();
      if (/^[A-Z]{2,5}$/.test(source) && !['LIT', 'READY', 'LOCAL', 'AUTH'].includes(source)) return source;
      return source.toLowerCase().replace(/^./, (character) => character.toUpperCase())
        .replace(/\b(taku|codex|claude|stax)\b/g, (word) => word[0].toUpperCase() + word.slice(1));
    }

    function appendVisualRow(label) {
      const row = document.createElement('div');
      row.className = 'v92-srow';
      const dot = document.createElement('i');
      dot.className = 'v92-dot';
      dot.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      copy.textContent = formatLabel(label);
      const value = document.createElement('b');
      row.append(dot, copy, value);
      visualRows.append(row);
      return row;
    }

    function startVisualRun() {
      activeIntroRun = window.__TAKU_STAX_INTRO_RUN__ || 0;
      screen.classList.remove('is-landed');
      screen.classList.remove('is-tinted');
      screen.style.backgroundColor = sand;
      status.textContent = 'Cooking';
      clearInterval(cycleTimer);
      const persona = typeof PERSONAS !== 'undefined' ? PERSONAS[CURP] : null;
      const profile = persona?.pd || (typeof PD !== 'undefined' ? PD : null);
      activeProfile = profile;
      resolvedCode = personalityCode(profile, persona);
      rowDefinitions = Array.isArray(persona?.scanLines) && persona.scanLines.length
        ? persona.scanLines
        : [
          ['FIRING UP THE KITCHEN', 'LIT'],
          [`TOSSING IN ${profile?.team?.[0] || 'AI'}`, 'IN THE POT'],
          ['SIMMERING 90-DAY USAGE', persona?.scan?.[0] || ''],
          ['TASTING YOUR RHYTHM', persona?.scan?.[1] || ''],
          ['SEASONING TYPE', profile?.type || ''],
          ['PLATING FAMILY', profile?.family || ''],
          ['STAMPING SERIAL', persona?.ser || ''],
        ];
      const syncLabels = [
        'SYNCING TAKU IDENTITY',
        'PULLING REAL HANDLE',
        'MINTING STAX SERIAL',
        'LOCKING TRUSTED STATS',
      ];
      visualRows.replaceChildren(...[...rowDefinitions.map(([label]) => label), ...syncLabels].map(appendVisualRow));
      visualRows.scrollTop = 0;
      if (profile && ART[profile.art]) art.src = ART[profile.art];
      poolIndex = Math.floor(Math.random() * poolKeys.length);
      currentArtKey = poolKeys[poolIndex] || profile?.art || '';
      loadDots(currentArtKey);
      paintDots(currentArtKey);
      paintCode(randomCode());
      cycleTimer = setInterval(() => {
        if (scan.classList.contains('off')) { clearInterval(cycleTimer); return; }
        poolIndex = (poolIndex + 1 + Math.floor(Math.random() * 3)) % poolKeys.length;
        currentArtKey = poolKeys[poolIndex] || profile?.art || '';
        loadDots(currentArtKey);
        paintDots(currentArtKey);
        paintCode(randomCode());
      }, 150);
    }

    function refreshCook() {
      if (activeIntroRun !== (window.__TAKU_STAX_INTRO_RUN__ || 0)) startVisualRun();
      const actualRows = [...scanLines.querySelectorAll('.sline')];
      for (let index = visualRows.children.length; index < actualRows.length; index++) {
        appendVisualRow(actualRows[index].querySelector('span')?.textContent || 'Scanning');
      }
      [...visualRows.children].forEach((row, index) => {
        row.classList.toggle('done', index < actualRows.length);
        row.classList.toggle('now', index === actualRows.length && !scan.classList.contains('authmode'));
        const value = actualRows[index]?.querySelector('b')?.textContent || '';
        row.querySelector('b').textContent = value ? formatResult(value) : '';
      });
      const activeRow = visualRows.children[Math.min(actualRows.length, visualRows.children.length - 1)];
      if (activeRow && activeRow.offsetTop + 29 > visualRows.scrollTop + visualRows.clientHeight) {
        visualRows.scrollTop = activeRow.offsetTop + 29 - visualRows.clientHeight;
      }
      const lockAt = Math.max(1, Math.round(rowDefinitions.length * 4 / 7));
      if (actualRows.length >= lockAt && cycleTimer) {
        clearInterval(cycleTimer);
        cycleTimer = 0;
        const key = activeProfile?.art || currentArtKey;
        currentArtKey = key;
        loadDots(key);
        paintDots(key);
        paintCode(resolvedCode);
      }
      const tintAt = Math.max(lockAt + 1, Math.round(rowDefinitions.length * 5 / 7));
      if (actualRows.length >= tintAt && !screen.classList.contains('is-tinted')) {
        screen.style.backgroundColor = familyTint(activeProfile);
        screen.classList.add('is-tinted');
      }
      const width = parseFloat(document.getElementById('scanfill')?.style.width || '0');
      progress.textContent = `${Math.max(0, Math.min(100, Math.round(width || 0)))}%`;
      if (!scan.classList.contains('authmode') && actualRows.length > rowDefinitions.length && width >= 99) {
        screen.classList.add('is-landed');
      }
      status.textContent = scan.classList.contains('authmode') ? 'Ready to connect'
        : screen.classList.contains('is-landed') ? 'Type found' : 'Cooking';
    }
    document.addEventListener('keydown', (event) => {
      if (scan.classList.contains('off') || scan.classList.contains('authmode') || event.repeat || event.code !== 'Space') return;
      if (event.target instanceof Element && event.target.closest('button, input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const jumpAhead = window.__TAKU_STAX_JUMP_INTRO__;
      if (typeof jumpAhead === 'function') jumpAhead();
      else scan.click();
    });
    new MutationObserver(refreshCook).observe(scan, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(refreshCook).observe(scanLines, { childList: true });
    new MutationObserver(refreshCook).observe(document.getElementById('scanfill'), { attributes: true, attributeFilter: ['style'] });
    refreshCook();

    const slide = document.getElementById('cslide');
    const footer = reveal.querySelector('.cfooter');
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn2 v92-next';
    next.innerHTML = '<span>Next</span><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.8242 18.4311C14.4284 18.8161 13.7953 18.8073 13.4102 18.4115C13.0251 18.0157 13.0339 17.3826 13.4297 16.9975L17.5381 13.0004H4C3.44786 13.0004 3.00023 12.5525 3 12.0004C3 11.4481 3.44772 11.0004 4 11.0004H17.5391L13.4297 7.00235C13.0339 6.61722 13.025 5.98413 13.4102 5.58829C13.7952 5.19251 14.4284 5.18378 14.8242 5.56876L20.6973 11.2836C20.8907 11.4719 21 11.7305 21 12.0004C20.9999 12.2701 20.8905 12.5281 20.6973 12.7162L14.8242 18.4311Z"/></svg>';
    next.addEventListener('click', (event) => {
      event.stopPropagation();
      next.blur();
      // The runtime owns slide order, auto advance, and completion.
      slide.click();
    });
    const hint = document.createElement('span');
    hint.className = 'v92-hint';
    hint.textContent = 'or press Space';
    footer.append(next, hint);
    document.addEventListener('keydown', (event) => {
      if (!reveal.classList.contains('on') || event.repeat) return;
      if (event.code !== 'Space' && event.key !== 'Enter') return;
      if (event.target instanceof Element && event.target.closest('#revealov button, #scanov button, input, textarea, select, [contenteditable]')) return;
      // Opening Intro leaves its background button focused. Prevent Space from
      // clicking it again, while keeping the overlay buttons' native keys.
      if (document.activeElement instanceof HTMLElement && document.activeElement.matches('button')) {
        document.activeElement.blur();
      }
      event.preventDefault();
      slide.click();
    });
    function refreshReveal() {
      const count = slide.querySelector('.ccount')?.textContent || '';
      next.querySelector('span').textContent = count.includes('ENTER STUDIO') ? 'Enter Studio' : 'Next';
      const block = slide.querySelector(':scope > .cblock');
      if (block) {
        const originalWidth = parseFloat(block.style.width) || block.offsetWidth;
        block.style.zoom = Math.min(1, (window.innerWidth - 48) / originalWidth).toString();
      }
    }
    new MutationObserver(refreshReveal).observe(slide, { childList: true });
    refreshReveal();

    function fitShareCard() {
      if (!share.classList.contains('on')) return;
      const box = document.getElementById('shcard');
      const inner = box?.firstElementChild;
      if (!box || !inner) return;
      const scale = Math.max(.1, Math.min(1, (window.innerWidth - 32) / 980, (window.innerHeight - 176) / 660));
      box.style.width = `${980 * scale}px`;
      box.style.height = `${660 * scale}px`;
      inner.style.transform = `scale(${scale})`;
    }
    new MutationObserver(fitShareCard).observe(share, { attributes: true, attributeFilter: ['class'] });

    function fitPublishPreview() {
      if (!modal.classList.contains('on')) return;
      const preview = document.getElementById('pv');
      const box = document.getElementById('pvbox');
      const content = preview?.firstElementChild;
      if (!preview || !box || !content) return;
      const mini = content.classList.contains('staxmini');
      const width = mini ? 660 : 980;
      const height = mini ? 300 : 660;
      const scale = Math.max(.1, Math.min(mini ? .95 : .66,
        (window.innerHeight - 250) / height, (window.innerWidth - 120) / width));
      preview.style.transform = `scale(${scale})`;
      box.style.width = `${width * scale}px`;
      box.style.height = `${height * scale}px`;
    }
    new MutationObserver(fitPublishPreview).observe(modal, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(fitPublishPreview).observe(document.getElementById('pv'), { childList: true });
    window.addEventListener('resize', () => { fitShareCard(); fitPublishPreview(); refreshReveal(); });
    return true;
  }

  window.__TAKU_STAX_V92_FLOWS_INIT__ = init;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
