/* SVG foreignObject exports cannot fetch images or fonts. Embed the same assets
   used by the live iframe before drawing it, including metallic textures. */
(() => {
  const assets = new Map();
  async function embed(reference) {
    if (!reference || /^(data:|#)/i.test(reference)) return reference;
    const url = new URL(reference, document.baseURI);
    if (url.origin !== location.origin && url.protocol !== 'blob:') {
      throw new Error('PNG ASSET MUST BE SAME ORIGIN');
    }
    if (!assets.has(url.href)) {
      const request = (async () => {
        const response = await fetch(url.href);
        if (!response.ok) throw new Error('PNG ASSET LOAD FAILED');
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('PNG ASSET READ FAILED'));
          response.blob().then(blob => reader.readAsDataURL(blob), reject);
        });
      })();
      assets.set(url.href, request);
      request.catch(() => assets.delete(url.href));
    }
    return assets.get(url.href);
  }
  window.__TAKU_STAX_EMBED_EXPORT_ASSETS__ = async payload => {
    let styles = String(payload.styles || '');
    const references = [...styles.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/g)]
      .map(match => [match[0], match[1] || match[2] || match[3]])
      .filter(([, reference]) => !/^(data:|#)/i.test(reference));
    const embedded = await Promise.all(references.map(async ([source, reference]) => [source, await embed(reference)]));
    for (const [source, data] of embedded) styles = styles.replaceAll(source, `url("${data}")`);
    const template = document.createElement('template');
    template.innerHTML = String(payload.cardHtml || '');
    await Promise.all([...template.content.querySelectorAll('img, image')].map(async node => {
      const attribute = node.localName === 'img' ? 'src' : 'href';
      const reference = node.getAttribute(attribute);
      if (reference) node.setAttribute(attribute, await embed(reference));
      node.removeAttribute('srcset');
    }));
    return { ...payload, styles, cardHtml: template.innerHTML };
  };
})();
