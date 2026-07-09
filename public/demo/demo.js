"use strict";
(() => {
  // src/content/dom-features.ts
  var MAX_DOM_NODES = 5e3;
  var MAX_TEXT_CHARS = 2e5;
  var MAX_HISTOGRAM_KEYS = 64;
  function isEditable(el) {
    const attr = el.getAttribute("contenteditable");
    return attr !== null && attr.toLowerCase() !== "false";
  }
  var IGNORE_ATTR = "data-wse-ignore";
  function traverseDom(doc) {
    const root = doc.documentElement;
    const elements = [];
    let truncated = false;
    if (!root) return { elements, truncated };
    const stack = [{ el: root, depth: 0 }];
    while (stack.length > 0) {
      const item = stack.pop();
      if (item.el.hasAttribute(IGNORE_ATTR)) continue;
      elements.push(item);
      if (elements.length >= MAX_DOM_NODES) {
        truncated = stack.length > 0;
        break;
      }
      if (isEditable(item.el)) continue;
      const children = item.el.children;
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ el: children[i], depth: item.depth + 1 });
      }
    }
    return { elements, truncated };
  }
  var TEXT_SKIP_PARENTS = /* @__PURE__ */ new Set(["script", "style", "noscript", "template", "textarea", "select", "option"]);
  var BUTTONISH_INPUT_TYPES = /* @__PURE__ */ new Set(["button", "submit", "reset"]);
  var SECTION_TAGS = /* @__PURE__ */ new Set(["section", "article", "main", "aside", "nav", "header", "footer"]);
  var HEADING_TAGS = /* @__PURE__ */ new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
  function computeDomFeatures(doc, traversal) {
    const histogram = {};
    let depthSum = 0;
    let maxDepth = 0;
    let linkCount = 0;
    let imageCount = 0;
    let buttonCount = 0;
    let formCount = 0;
    let sectionCount = 0;
    let headingCount = 0;
    for (const { el, depth } of traversal.elements) {
      const tag = el.tagName.toLowerCase();
      depthSum += depth;
      if (depth > maxDepth) maxDepth = depth;
      if (histogram[tag] !== void 0) {
        histogram[tag]++;
      } else if (Object.keys(histogram).length < MAX_HISTOGRAM_KEYS) {
        histogram[tag] = 1;
      } else {
        histogram["other"] = (histogram["other"] ?? 0) + 1;
      }
      if (tag === "a") linkCount++;
      else if (tag === "img") imageCount++;
      else if (tag === "button") buttonCount++;
      else if (tag === "form") formCount++;
      else if (tag === "input") {
        const type = (el.getAttribute("type") ?? "").toLowerCase();
        if (BUTTONISH_INPUT_TYPES.has(type)) buttonCount++;
      }
      if (SECTION_TAGS.has(tag)) sectionCount++;
      if (HEADING_TAGS.has(tag)) headingCount++;
    }
    let textLength = 0;
    let wordCount = 0;
    const body = doc.body;
    if (body) {
      const walker = doc.createTreeWalker(
        body,
        4
        /* NodeFilter.SHOW_TEXT */
      );
      let visited = 0;
      while (textLength < MAX_TEXT_CHARS && visited < MAX_DOM_NODES) {
        const node = walker.nextNode();
        if (!node) break;
        visited++;
        const parent = node.parentElement;
        if (!parent) continue;
        if (TEXT_SKIP_PARENTS.has(parent.tagName.toLowerCase())) continue;
        const editableHost = parent.closest("[contenteditable]");
        if (editableHost && isEditable(editableHost)) continue;
        if (parent.closest(`[${IGNORE_ATTR}]`)) continue;
        const text = node.nodeValue ?? "";
        const trimmed = text.trim();
        if (trimmed.length === 0) continue;
        textLength += trimmed.length;
        wordCount += trimmed.split(/\s+/).length;
      }
    }
    const total = traversal.elements.length;
    return {
      totalNodes: total,
      maxDepth,
      avgDepth: total > 0 ? depthSum / total : 0,
      tagHistogram: histogram,
      linkCount,
      imageCount,
      buttonCount,
      formCount,
      sectionCount,
      headingCount,
      textLength,
      wordCount,
      truncated: traversal.truncated
    };
  }

  // src/content/style-features.ts
  var MAX_STYLE_SAMPLES = 500;
  function parseColor(value) {
    if (!value) return null;
    const v = value.trim().toLowerCase();
    if (v === "transparent") return { h: 0, s: 0, l: 0, a: 0 };
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 1;
    const rgbMatch = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    const spaceMatch = v.match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)$/);
    const m = rgbMatch ?? spaceMatch;
    if (m) {
      r = parseFloat(m[1]);
      g = parseFloat(m[2]);
      b = parseFloat(m[3]);
      if (m[4] !== void 0) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    } else if (/^#[0-9a-f]{3,8}$/.test(v)) {
      const hex = v.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
        if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16) / 255;
      } else if (hex.length === 6 || hex.length === 8) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
      } else {
        return null;
      }
    } else {
      return null;
    }
    return { ...rgbToHsl(r, g, b), a };
  }
  function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / d + 2) * 60;
    else h = ((rn - gn) / d + 4) * 60;
    return { h, s, l };
  }
  function extractStyleFeatures(elements, win) {
    const stride = Math.max(1, Math.ceil(elements.length / MAX_STYLE_SAMPLES));
    let sampledCount = 0;
    let hueX = 0;
    let hueY = 0;
    let satSum = 0;
    let lightSum = 0;
    let colorSamples = 0;
    let fontSum = 0;
    let fontSamples = 0;
    let fixedCount = 0;
    let absoluteCount = 0;
    for (let i = 0; i < elements.length; i += stride) {
      const el = elements[i].el;
      let cs;
      try {
        cs = win.getComputedStyle(el);
      } catch {
        continue;
      }
      if (cs.display === "none") continue;
      sampledCount++;
      for (const [raw, weight] of [
        [cs.backgroundColor, 4],
        [cs.color, 1]
      ]) {
        const hsl = parseColor(raw);
        if (!hsl || hsl.a < 0.05) continue;
        const rad = hsl.h * Math.PI / 180;
        hueX += Math.cos(rad) * hsl.s * weight;
        hueY += Math.sin(rad) * hsl.s * weight;
        satSum += hsl.s * weight;
        lightSum += hsl.l * weight;
        colorSamples += weight;
      }
      const fs = parseFloat(cs.fontSize);
      if (Number.isFinite(fs) && fs > 0) {
        fontSum += fs;
        fontSamples++;
      }
      if (cs.position === "fixed") fixedCount++;
      else if (cs.position === "absolute") absoluteCount++;
    }
    let avgHue = 0;
    if (colorSamples > 0 && (hueX !== 0 || hueY !== 0)) {
      avgHue = Math.atan2(hueY, hueX) * 180 / Math.PI;
      if (avgHue < 0) avgHue += 360;
    }
    return {
      sampledCount,
      avgHue,
      avgSaturation: colorSamples > 0 ? satSum / colorSamples : 0,
      avgLightness: colorSamples > 0 ? lightSum / colorSamples : 0.5,
      avgFontSize: fontSamples > 0 ? fontSum / fontSamples : 16,
      fixedCount,
      absoluteCount
    };
  }

  // src/content/geometry-features.ts
  var MAX_GEOMETRY_SAMPLES = 500;
  var BUCKETS = 8;
  function extractGeometryFeatures(elements, win) {
    const doc = win.document;
    const viewportWidth = win.innerWidth || doc.documentElement?.clientWidth || 0;
    const viewportHeight = win.innerHeight || doc.documentElement?.clientHeight || 0;
    const pageHeight = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
      viewportHeight
    );
    const stride = Math.max(1, Math.ceil(elements.length / MAX_GEOMETRY_SAMPLES));
    const buckets = new Array(BUCKETS).fill(0);
    let areaSum = 0;
    let visible = 0;
    for (let i = 0; i < elements.length; i += stride) {
      const el = elements[i].el;
      let rect;
      try {
        rect = el.getBoundingClientRect();
      } catch {
        continue;
      }
      if (rect.width <= 0 || rect.height <= 0) continue;
      visible++;
      areaSum += rect.width * rect.height;
      if (viewportWidth > 0) {
        const center = rect.left + rect.width / 2;
        const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor(center / viewportWidth * BUCKETS)));
        buckets[idx]++;
      }
    }
    const total = buckets.reduce((a, b) => a + b, 0);
    const horizontalDistribution = total > 0 ? buckets.map((b) => Math.round(b / total * 1e3) / 1e3) : buckets;
    return {
      viewportWidth,
      viewportHeight,
      pageHeight,
      avgElementArea: visible > 0 ? Math.round(areaSum / visible) : 0,
      horizontalDistribution
    };
  }

  // src/content/extract.ts
  var MAX_SCRIPTS = 300;
  var MAX_TOKENS = 360;
  function extractTokens(traversal, cap = MAX_TOKENS) {
    const els = traversal.elements;
    const stride = Math.max(1, Math.ceil(els.length / cap));
    const tokens = [];
    for (let i = 0; i < els.length && tokens.length < cap; i += stride) {
      tokens.push({ tag: els[i].el.tagName.toLowerCase(), depth: Math.min(32, els[i].depth) });
    }
    return tokens;
  }
  function extractScriptFeatures(doc) {
    const scripts = doc.scripts;
    const total = scripts.length;
    let inline = 0;
    let external = 0;
    let moduleCount = 0;
    const domains = /* @__PURE__ */ new Set();
    const n = Math.min(total, MAX_SCRIPTS);
    for (let i = 0; i < n; i++) {
      const s = scripts[i];
      const src = s.getAttribute("src");
      if (src) {
        external++;
        try {
          domains.add(new URL(src, doc.baseURI).hostname);
        } catch {
        }
      } else {
        inline++;
      }
      if ((s.getAttribute("type") ?? "").toLowerCase() === "module") moduleCount++;
    }
    return {
      scriptCount: total,
      inlineScriptCount: inline,
      externalScriptCount: external,
      moduleScriptCount: moduleCount,
      scriptSrcDomainCount: domains.size
    };
  }
  function canonicalUrl(loc) {
    return `${loc.origin}${loc.pathname}`;
  }
  function extractPageFeatures(doc, win) {
    const traversal = traverseDom(doc);
    return {
      version: 1,
      url: canonicalUrl(win.location),
      dom: computeDomFeatures(doc, traversal),
      style: extractStyleFeatures(traversal.elements, win),
      geometry: extractGeometryFeatures(traversal.elements, win),
      script: extractScriptFeatures(doc),
      tokens: extractTokens(traversal)
    };
  }

  // src/mapping/deterministic-seed.ts
  function fnv1a32(input, seed = 2166136261) {
    let h = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function hash64hex(input) {
    const a = fnv1a32(input, 2166136261);
    const b = fnv1a32(input, 2538058380);
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
  }
  function mixSeed(seed, variation2) {
    let z = (seed ^ Math.imul(variation2 + 1, 2654435769)) >>> 0;
    z = Math.imul(z ^ z >>> 16, 569420461) >>> 0;
    z = Math.imul(z ^ z >>> 15, 1935289751) >>> 0;
    return (z ^ z >>> 15) >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function randInt(rng, n) {
    return Math.floor(rng() * n);
  }
  function pick(rng, items) {
    return items[randInt(rng, items.length)];
  }
  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  // src/mapping/fingerprint.ts
  function r3(x) {
    return Math.round(x * 1e3) / 1e3;
  }
  function canonicalFeatureString(f) {
    const tags = Object.keys(f.dom.tagHistogram).sort().map((t) => `${t}:${f.dom.tagHistogram[t]}`).join(",");
    const parts = [
      `v${f.version}`,
      `url=${f.url}`,
      `nodes=${f.dom.totalNodes}`,
      `maxDepth=${f.dom.maxDepth}`,
      `avgDepth=${r3(f.dom.avgDepth)}`,
      `tags=${tags}`,
      `links=${f.dom.linkCount}`,
      `imgs=${f.dom.imageCount}`,
      `buttons=${f.dom.buttonCount}`,
      `forms=${f.dom.formCount}`,
      `sections=${f.dom.sectionCount}`,
      `headings=${f.dom.headingCount}`,
      `text=${f.dom.textLength}`,
      `words=${f.dom.wordCount}`,
      `hue=${r3(f.style.avgHue)}`,
      `sat=${r3(f.style.avgSaturation)}`,
      `light=${r3(f.style.avgLightness)}`,
      `font=${r3(f.style.avgFontSize)}`,
      `fixed=${f.style.fixedCount}`,
      `abs=${f.style.absoluteCount}`,
      `pageH=${f.geometry.pageHeight}`,
      `area=${r3(f.geometry.avgElementArea)}`,
      `hdist=${f.geometry.horizontalDistribution.map(r3).join("|")}`,
      `scripts=${f.script.scriptCount}`,
      `inline=${f.script.inlineScriptCount}`,
      `ext=${f.script.externalScriptCount}`,
      `mod=${f.script.moduleScriptCount}`,
      `dom=${f.script.scriptSrcDomainCount}`
    ];
    return parts.join(";");
  }
  function computeFingerprint(features) {
    const canonical = canonicalFeatureString(features);
    return {
      version: 1,
      hash: hash64hex(canonical),
      seed: fnv1a32(canonical)
    };
  }

  // src/shared/types.ts
  var DEFAULT_TUNING = {
    tempoShift: 0,
    density: 1,
    brightness: 0.5,
    reverb: 0.5
  };

  // src/mapping/normalize.ts
  var CONTENT_TAGS = /* @__PURE__ */ new Set([
    "p",
    "article",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "code",
    "li",
    "td",
    "figcaption",
    "em",
    "strong"
  ]);
  var NAV_TAGS = /* @__PURE__ */ new Set(["a", "nav", "button"]);
  var MEDIA_TAGS = /* @__PURE__ */ new Set(["img", "picture", "video", "audio", "svg", "canvas", "figure"]);
  var FORM_TAGS = /* @__PURE__ */ new Set(["form", "input", "select", "textarea", "label", "option"]);
  function logNorm(value, cap) {
    if (cap <= 0) return 0;
    return clamp(Math.log(1 + Math.max(0, value)) / Math.log(1 + cap), 0, 1);
  }
  function ratio(numer, denom, cap) {
    if (denom <= 0) return 0;
    return clamp(numer / denom / cap, 0, 1);
  }
  function normalizeFeatures(f) {
    const n = f.dom.totalNodes;
    const nodes = logNorm(n, 5e3);
    const depth = clamp(f.dom.maxDepth / 32, 0, 1);
    const linkDensity = ratio(f.dom.linkCount, n, 0.3);
    const imageDensity = ratio(f.dom.imageCount, n, 0.08);
    const buttonDensity = ratio(f.dom.buttonCount, n, 0.05);
    const scriptDensity = ratio(f.script.scriptCount, n, 0.1);
    const text = logNorm(f.dom.textLength, 1e5);
    const hue = clamp(f.style.avgHue % 360 / 360, 0, 1);
    const saturation = clamp(f.style.avgSaturation, 0, 1);
    const lightness = clamp(f.style.avgLightness, 0, 1);
    const fontSize = clamp((f.style.avgFontSize - 10) / 14, 0, 1);
    const pageLength = logNorm(f.geometry.pageHeight, 3e4);
    const sectionCount = clamp(f.dom.sectionCount / 12, 0, 1);
    const dist = f.geometry.horizontalDistribution;
    let horizontalLean = 0;
    if (dist.length > 0) {
      const total = dist.reduce((a, b) => a + b, 0);
      if (total > 0) {
        let weighted = 0;
        for (let i = 0; i < dist.length; i++) {
          const center = (i + 0.5) / dist.length;
          weighted += dist[i] / total * (center * 2 - 1);
        }
        horizontalLean = clamp(weighted, -1, 1);
      }
    }
    const hist = f.dom.tagHistogram;
    const tags = Object.keys(hist);
    let entropy = 0;
    if (n > 0 && tags.length > 1) {
      let h = 0;
      for (const t of tags) {
        const p = hist[t] / n;
        if (p > 0) h -= p * Math.log(p);
      }
      entropy = clamp(h / Math.log(Math.min(tags.length, 32)), 0, 1);
    }
    let content = 0;
    let nav = 0;
    let media = 0;
    let form = 0;
    for (const t of tags) {
      if (CONTENT_TAGS.has(t)) content += hist[t];
      else if (NAV_TAGS.has(t)) nav += hist[t];
      else if (MEDIA_TAGS.has(t)) media += hist[t];
      else if (FORM_TAGS.has(t)) form += hist[t];
    }
    const contentLean = ratio(content, n, 0.45);
    const navLean = ratio(nav, n, 0.3);
    const mediaLean = ratio(media, n, 0.12);
    const formLean = ratio(form, n, 0.12);
    const complexity = clamp(
      0.3 * nodes + 0.2 * scriptDensity + 0.15 * linkDensity + 0.35 * entropy,
      0,
      1
    );
    return {
      nodes,
      depth,
      linkDensity,
      imageDensity,
      buttonDensity,
      scriptDensity,
      text,
      hue,
      saturation,
      lightness,
      fontSize,
      pageLength,
      sectionCount,
      horizontalLean,
      entropy,
      contentLean,
      navLean,
      mediaLean,
      formLean,
      complexity
    };
  }

  // src/mapping/orchestration.ts
  function detectCharacter(norm) {
    const entries = [
      ["content", norm.contentLean],
      ["navigation", norm.navLean],
      ["media", norm.mediaLean],
      ["form", norm.formLean]
    ];
    let best = entries[0];
    for (const e of entries.slice(1)) {
      if (e[1] > best[1] + 1e-9) best = e;
    }
    return best[0];
  }
  var PALETTES = {
    ambient: {
      melody: { content: "epiano", navigation: "xiao", media: "flute", form: "epiano" },
      arp: { content: "pluck", navigation: "pluck", media: "bell", form: "mallet" },
      bell: { content: "bell", navigation: "mallet", media: "bell", form: "bell" }
    },
    piano: {
      melody: { content: "piano", navigation: "guitar", media: "epiano", form: "piano" },
      arp: { content: "piano", navigation: "guitar", media: "piano", form: "piano" },
      bell: { content: "mallet", navigation: "mallet", media: "bell", form: "mallet" }
    },
    electronic: {
      melody: { content: "lead", navigation: "pluck", media: "epiano", form: "lead" },
      arp: { content: "pluck", navigation: "pluck", media: "bell", form: "pluck" },
      bell: { content: "bell", navigation: "bell", media: "bell", form: "mallet" }
    },
    orchestral: {
      melody: { content: "strings", navigation: "flute", media: "brass", form: "strings" },
      arp: { content: "pluck", navigation: "pluck", media: "mallet", form: "pluck" },
      bell: { content: "mallet", navigation: "mallet", media: "bell", form: "mallet" }
    },
    eastern: {
      melody: { content: "xiao", navigation: "pluck", media: "flute", form: "xiao" },
      arp: { content: "pluck", navigation: "guitar", media: "bell", form: "pluck" },
      bell: { content: "bell", navigation: "mallet", media: "bell", form: "bell" }
    }
  };
  function chooseOrchestration(norm, style) {
    const character = detectCharacter(norm);
    const palette = PALETTES[style];
    return {
      melody: palette.melody[character],
      arp: palette.arp[character],
      bell: palette.bell[character],
      character
    };
  }
  function euclid(k, n, rotation = 0) {
    const kk = Math.max(0, Math.min(n, Math.round(k)));
    const out2 = new Array(n).fill(false);
    if (kk === 0) return out2;
    for (let i = 0; i < n; i++) {
      out2[(i + rotation) % n] = i * kk % n < kk;
    }
    return out2;
  }

  // src/mapping/profile.ts
  var KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var SCALE_INTERVALS = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    minorPentatonic: [0, 3, 5, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10]
  };
  function deriveKey(norm, seed) {
    if (norm.saturation < 0.02) return seed % 12;
    return Math.floor(12 * norm.hue) % 12;
  }
  function deriveScale(norm, seed) {
    const l = norm.lightness;
    const s = norm.saturation;
    if (l >= 0.62) {
      if (s >= 0.5) return "major";
      if (s >= 0.25) return "lydian";
      return "mixolydian";
    }
    if (l <= 0.38) {
      if (s >= 0.5) return "minor";
      if (s >= 0.25) return "dorian";
      return "minorPentatonic";
    }
    if (s >= 0.45) return "pentatonic";
    if (s >= 0.2) return seed % 2 === 0 ? "dorian" : "mixolydian";
    return seed % 2 === 0 ? "major" : "minor";
  }
  function deriveBpm(norm, style, tempoShift = 0) {
    const base = 58 + 96 * norm.complexity;
    const styleAdj = { ambient: -12, piano: -5, electronic: 14, orchestral: 0, eastern: -8 }[style];
    return Math.round(clamp(base + styleAdj + tempoShift, 52, 176));
  }
  function deriveLengthSec(norm) {
    return Math.round(clamp(30 + 40 * norm.pageLength + 20 * norm.nodes, 30, 90));
  }
  function planSections(totalBars, hasHeader, hasFooter) {
    let intro = hasHeader ? Math.max(1, Math.round(totalBars * 0.12)) : 0;
    let outro = hasFooter ? Math.max(1, Math.round(totalBars * 0.12)) : 0;
    let body = totalBars - intro - outro;
    if (body < 3) {
      intro = 0;
      outro = 0;
      body = totalBars;
    }
    const a = Math.max(1, Math.round(body * 0.4));
    const b = Math.max(1, Math.round(body * 0.3));
    const a2 = Math.max(1, body - a - b);
    const plans = [];
    let cursor = 0;
    const push = (name, bars) => {
      if (bars > 0) {
        plans.push({ name, startBar: cursor, bars });
        cursor += bars;
      }
    };
    push("intro", intro);
    push("A", a);
    push("B", b);
    push("A2", a2);
    push("outro", outro);
    return plans;
  }
  function pct(x) {
    return `${Math.round(x * 100)}%`;
  }
  var CHARACTER_LABEL = {
    content: "content-led (text & articles)",
    navigation: "navigation-led (links & buttons)",
    media: "media-led (images & visuals)",
    form: "form-led (inputs & controls)"
  };
  function buildExplain(f, norm, profile, orchestration) {
    const items = [
      {
        feature: "Structure character",
        value: CHARACTER_LABEL[orchestration.character],
        effect: `lead voice: ${orchestration.melody}, arpeggio voice: ${orchestration.arp}`
      },
      {
        feature: "Tag diversity",
        value: pct(norm.entropy),
        effect: `feeds complexity ${pct(norm.complexity)} \u2192 ${profile.bpm} BPM`
      },
      {
        feature: "Node count",
        value: String(f.dom.totalNodes),
        effect: `piece density and tempo base`
      },
      {
        feature: "Average hue",
        value: `${Math.round(f.style.avgHue)}\xB0`,
        effect: `key ${profile.keyName}`
      },
      {
        feature: "Average lightness",
        value: pct(norm.lightness),
        effect: norm.lightness >= 0.62 ? "bright palette \u2192 major scale, brighter timbre" : norm.lightness <= 0.38 ? "dark palette \u2192 minor scale, darker timbre" : `mid palette \u2192 ${profile.scale} scale`
      },
      {
        feature: "DOM max depth",
        value: String(f.dom.maxDepth),
        effect: `pitch register width ${12 + Math.round(24 * norm.depth)} semitones`
      },
      {
        feature: "Link density",
        value: `${f.dom.linkCount} links`,
        effect: norm.linkDensity > 0.5 ? "high link density \u2192 busy arpeggios" : norm.linkDensity > 0.15 ? "moderate link density \u2192 light arpeggios" : "few links \u2192 sparse arpeggios"
      },
      {
        feature: "Images",
        value: String(f.dom.imageCount),
        effect: norm.imageDensity > 0.1 ? "bell accents enabled" : "few bell accents"
      },
      {
        feature: "Buttons",
        value: String(f.dom.buttonCount),
        effect: norm.buttonDensity > 0.1 ? "denser percussion layer" : "sparse percussion"
      },
      {
        feature: "Page height",
        value: `${f.geometry.pageHeight}px`,
        effect: `piece length ${profile.lengthSec}s`
      },
      {
        feature: "Sections",
        value: `${f.dom.sectionCount} semantic sections`,
        effect: "song form Intro\u2013A\u2013B\u2013A'\u2013Outro from header/main/footer"
      },
      {
        feature: "Text length",
        value: `${f.dom.textLength} chars`,
        effect: `phrase length ${3 + Math.round(4 * norm.text)} notes`
      }
    ];
    return items;
  }
  function deriveProfile(features, fingerprint, options) {
    const norm = normalizeFeatures(features);
    const tuning = options.tuning ?? DEFAULT_TUNING;
    const seed = mixSeed(fingerprint.seed, options.variation);
    const rng = mulberry32(seed);
    rng();
    const key = deriveKey(norm, seed);
    const scale = deriveScale(norm, seed);
    const bpm = deriveBpm(norm, options.style, tuning.tempoShift);
    const lengthSec = deriveLengthSec(norm);
    const orchestration = chooseOrchestration(norm, options.style);
    const barDur = 60 / bpm * 4;
    const barCount = Math.max(4, Math.round(lengthSec / barDur));
    const hist = features.dom.tagHistogram;
    const sections = planSections(barCount, (hist["header"] ?? 0) > 0, (hist["footer"] ?? 0) > 0);
    const actualBars = sections.reduce((a, s) => a + s.bars, 0);
    const partial = {
      key,
      keyName: `${KEY_NAMES[key]} ${scale}`,
      scale,
      bpm,
      lengthSec: Math.round(actualBars * barDur)
    };
    return {
      ...partial,
      style: options.style,
      mode: options.mode,
      barCount: actualBars,
      sections,
      character: orchestration.character,
      explain: buildExplain(features, norm, partial, orchestration)
    };
  }

  // src/mapping/quantize.ts
  function scalePitchClasses(key, scale) {
    return new Set(SCALE_INTERVALS[scale].map((i) => (key + i) % 12));
  }
  function quantizePitch(pitch, key, scale) {
    const classes = scalePitchClasses(key, scale);
    const rounded = Math.round(pitch);
    for (let d = 0; d <= 6; d++) {
      if (classes.has(((rounded - d) % 12 + 12) % 12)) return rounded - d;
      if (classes.has(((rounded + d) % 12 + 12) % 12)) return rounded + d;
    }
    return rounded;
  }
  function degreeToMidi(key, scale, degree, octave) {
    const intervals = SCALE_INTERVALS[scale];
    const n = intervals.length;
    const oct = Math.floor(degree / n);
    const idx = (degree % n + n) % n;
    return 12 * (octave + 1 + oct) + key + intervals[idx];
  }
  function quantizeTime(timeSec, bpm, gridDiv = 4) {
    const step = 60 / bpm / gridDiv;
    return Math.round(timeSec / step) * step;
  }
  function clampMidi(pitch, lo = 28, hi = 103) {
    let p = pitch;
    while (p < lo) p += 12;
    while (p > hi) p -= 12;
    return p;
  }

  // src/mapping/limits.ts
  var MAX_VOICES = 12;
  var MAX_EVENTS_PER_SECOND = 20;
  var PRIORITY = {
    bass: 5,
    lowpad: 4,
    pad: 4,
    piano: 3,
    epiano: 3,
    strings: 3,
    brass: 3,
    lead: 3,
    flute: 3,
    xiao: 3,
    guitar: 3,
    kick: 2,
    taiko: 2,
    bell: 2,
    mallet: 2,
    pluck: 1,
    hihat: 0,
    perc: 0
  };
  function keep(a, b) {
    const pa = (PRIORITY[a.instrument] ?? 1) + a.velocity;
    const pb = (PRIORITY[b.instrument] ?? 1) + b.velocity;
    if (pa !== pb) return pb - pa;
    if (a.time !== b.time) return a.time - b.time;
    return a.pitch - b.pitch;
  }
  function limitEventRate(events) {
    const buckets = /* @__PURE__ */ new Map();
    for (const ev of events) {
      const b = Math.floor(ev.time);
      let arr = buckets.get(b);
      if (!arr) buckets.set(b, arr = []);
      arr.push(ev);
    }
    const out2 = [];
    for (const [, arr] of [...buckets.entries()].sort((x, y) => x[0] - y[0])) {
      arr.sort(keep);
      out2.push(...arr.slice(0, MAX_EVENTS_PER_SECOND));
    }
    out2.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
    return out2;
  }
  function limitVoices(events) {
    const sorted = [...events].sort((a, b) => a.time - b.time || keep(a, b));
    const active = [];
    const out2 = [];
    for (const ev of sorted) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].time + active[i].duration <= ev.time + 1e-9) active.splice(i, 1);
      }
      if (active.length >= MAX_VOICES) {
        active.sort(keep);
        const weakest = active[active.length - 1];
        if (keep(ev, weakest) < 0) {
          weakest.duration = Math.max(0.05, ev.time - weakest.time);
          active.pop();
          active.push(ev);
          out2.push(ev);
        }
        continue;
      }
      active.push(ev);
      out2.push(ev);
    }
    out2.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
    return out2;
  }
  function applyLimits(events) {
    return limitVoices(limitEventRate(events));
  }

  // src/mapping/default-map.ts
  var PROGRESSIONS = {
    // Scale-degree roots, one chord per bar, cycled.
    major: [
      [0, 4, 5, 3],
      // I V vi IV
      [0, 3, 4, 3],
      // I IV V IV
      [5, 3, 0, 4],
      // vi IV I V
      [0, 5, 3, 4]
      // I vi IV V
    ],
    minor: [
      [0, 5, 2, 6],
      // i VI III VII
      [0, 3, 4, 0],
      // i iv v i
      [0, 6, 5, 6],
      // i VII VI VII
      [0, 3, 6, 4]
      // i iv VII v
    ],
    dorian: [
      [0, 3, 0, 6],
      // i IV i VII — the classic dorian vamp
      [0, 3, 4, 3],
      [0, 6, 3, 4]
    ],
    lydian: [
      [0, 1, 0, 4],
      // I II I V — floating lydian motion
      [0, 4, 5, 1],
      [0, 1, 4, 0]
    ],
    mixolydian: [
      [0, 6, 3, 0],
      // I bVII IV I
      [0, 3, 6, 4],
      [0, 6, 0, 4]
    ],
    // Degrees in pentatonic space: stacked thirds become open, quartal voicings.
    pentatonic: [
      [0, 3, 4, 1],
      [0, 2, 3, 1],
      [0, 4, 3, 1]
    ],
    minorPentatonic: [
      [0, 3, 4, 1],
      [0, 2, 4, 3],
      [0, 4, 0, 3]
    ]
  };
  var STYLES = {
    ambient: {
      melody: "epiano",
      pad: "pad",
      bass: "lowpad",
      arp: "pluck",
      bell: "bell",
      melodyOctave: 4,
      padOctave: 3,
      bassOctave: 2,
      arpOctave: 5,
      durScale: 1.6,
      melodyDensity: 0.6,
      perc: "sparse"
    },
    piano: {
      melody: "piano",
      pad: "strings",
      bass: "piano",
      arp: "piano",
      bell: "mallet",
      melodyOctave: 4,
      padOctave: 3,
      bassOctave: 2,
      arpOctave: 5,
      durScale: 1,
      melodyDensity: 1,
      perc: "none"
    },
    electronic: {
      melody: "lead",
      pad: "pad",
      bass: "bass",
      arp: "pluck",
      bell: "bell",
      melodyOctave: 4,
      padOctave: 3,
      bassOctave: 1,
      arpOctave: 5,
      durScale: 0.8,
      melodyDensity: 1.1,
      perc: "drive"
    },
    orchestral: {
      melody: "strings",
      pad: "lowpad",
      bass: "bass",
      arp: "pluck",
      bell: "mallet",
      melodyOctave: 4,
      padOctave: 2,
      bassOctave: 1,
      arpOctave: 5,
      durScale: 1.2,
      melodyDensity: 0.9,
      perc: "cinematic"
    },
    eastern: {
      melody: "xiao",
      pad: "strings",
      bass: "bass",
      arp: "pluck",
      bell: "bell",
      melodyOctave: 4,
      padOctave: 3,
      bassOctave: 2,
      arpOctave: 5,
      durScale: 1.3,
      melodyDensity: 0.85,
      perc: "eastern"
    }
  };
  var SECTION_GAIN = {
    intro: 0.8,
    A: 1,
    B: 0.95,
    A2: 1.05,
    outro: 0.75
  };
  var ORNAMENTED = /* @__PURE__ */ new Set(["xiao", "flute"]);
  function makeMotif(rng, phraseLen, maxDeg) {
    const slotPool = [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14];
    const slots = /* @__PURE__ */ new Set([0]);
    while (slots.size < phraseLen) slots.add(pick(rng, slotPool));
    const degrees = [];
    let deg = randInt(rng, 3);
    for (let i = 0; i < phraseLen; i++) {
      degrees.push(deg);
      const step = pick(rng, [-2, -1, -1, 0, 1, 1, 2, 3]);
      deg = clamp(deg + step, -2, maxDeg);
    }
    return { slots: [...slots].sort((a, b) => a - b), degrees };
  }
  function round6(x) {
    return Math.round(x * 1e6) / 1e6;
  }
  function generateScore(features, fingerprint, options) {
    const profile = deriveProfile(features, fingerprint, options);
    const norm = normalizeFeatures(features);
    const tuning = options.tuning ?? DEFAULT_TUNING;
    const seed = mixSeed(fingerprint.seed, options.variation);
    const rng = mulberry32(seed);
    const cfg = STYLES[options.style];
    const { key, scale, bpm } = profile;
    const mode = options.mode;
    const orch = chooseOrchestration(norm, options.style);
    const melodyInstr = orch.melody;
    const arpInstr = orch.arp;
    const bellInstr = orch.bell;
    const beat = 60 / bpm;
    const barDur = beat * 4;
    const events = [];
    const progression = pick(rng, PROGRESSIONS[scale]);
    const chordRootAtBar = (bar) => progression[bar % progression.length];
    const phraseLen = 3 + Math.round(4 * norm.text);
    const maxDeg = 2 + Math.round(6 * norm.depth);
    const motif = makeMotif(rng, phraseLen, maxDeg);
    const analyticalSteps = [];
    if (mode === "analytical") {
      const tags = Object.keys(features.dom.tagHistogram).sort();
      for (const t of tags.slice(0, 16)) {
        analyticalSteps.push(features.dom.tagHistogram[t] % 24);
      }
      if (analyticalSteps.length === 0) analyticalSteps.push(0);
    }
    const dens = clamp(tuning.density, 0.5, 1.5);
    const modeDensity = (mode === "musical" ? 0.85 : 1) * dens;
    const arpGate = norm.linkDensity;
    const bellChance = clamp(
      (norm.imageDensity * 1.2 + (options.style === "ambient" ? 0.15 : 0)) * dens,
      0,
      0.8
    );
    const percBoost = norm.buttonDensity;
    const lean = norm.horizontalLean;
    const baseVel = 0.45 + 0.25 * norm.lightness;
    const kickPattern = euclid(2 + Math.round(2 * percBoost), 8, seed % 8);
    const hatPattern = euclid(Math.round((3 + 4 * percBoost) * dens), 8, (seed >> 3) % 8);
    const taikoPattern = euclid(2 + Math.round(3 * percBoost), 8, seed % 8);
    const sparsePattern = euclid(1 + Math.round(2 * percBoost), 8, (seed >> 5) % 8);
    let melodyCounter = 0;
    for (const section of profile.sections) {
      const sGain = SECTION_GAIN[section.name];
      const isIntro = section.name === "intro";
      const isOutro = section.name === "outro";
      const isBody = !isIntro && !isOutro;
      for (let b = 0; b < section.bars; b++) {
        const bar = section.startBar + b;
        const barStart = bar * barDur;
        const rootDeg = chordRootAtBar(bar);
        const padSpread = [0, -0.35, 0.35];
        for (let v = 0; v < 3; v++) {
          events.push({
            time: barStart,
            duration: barDur * clamp(cfg.durScale, 0.9, 2),
            pitch: degreeToMidi(key, scale, rootDeg + v * 2, cfg.padOctave),
            velocity: (0.22 + 0.18 * norm.lightness) * sGain,
            instrument: cfg.pad,
            pan: padSpread[v],
            layer: "pad"
          });
        }
        events.push({
          time: barStart,
          duration: barDur * 0.9 * cfg.durScale,
          pitch: degreeToMidi(key, scale, rootDeg, cfg.bassOctave),
          velocity: (0.5 + 0.2 * norm.complexity) * sGain,
          instrument: cfg.bass,
          pan: 0,
          layer: "bass"
        });
        if (rng() < (0.25 + 0.4 * percBoost) * dens && !isOutro) {
          events.push({
            time: barStart + 2 * beat,
            duration: beat * 1.5 * cfg.durScale,
            pitch: degreeToMidi(key, scale, rootDeg + (rng() < 0.5 ? 4 : 2), cfg.bassOctave),
            velocity: (0.4 + 0.15 * norm.complexity) * sGain,
            instrument: cfg.bass,
            pan: 0,
            layer: "bass"
          });
        }
        if (isBody && bar % 2 === 0) {
          const windowStart = barStart;
          const transpose = chordRootAtBar(bar);
          const retrograde = section.name === "B";
          for (let i = 0; i < motif.slots.length; i++) {
            if (rng() >= cfg.melodyDensity * modeDensity) continue;
            const slot = motif.slots[i];
            const degIdx = retrograde ? motif.degrees.length - 1 - i : i;
            const t = windowStart + slot * (beat / 2);
            const nextSlot = motif.slots[i + 1] ?? motif.slots[i] + 4;
            const durBeats = clamp(((nextSlot - slot) * 0.5 - 0.05) * cfg.durScale, 0.2, 4);
            let pitch;
            if (mode === "analytical") {
              const stepVal = analyticalSteps[melodyCounter % analyticalSteps.length];
              pitch = 12 * (cfg.melodyOctave + 1) + key + stepVal % (12 + Math.round(24 * norm.depth));
            } else {
              pitch = degreeToMidi(key, scale, transpose + motif.degrees[degIdx], cfg.melodyOctave);
            }
            melodyCounter++;
            const accent = i === 0 ? 0.12 : 0;
            events.push({
              time: t,
              duration: durBeats * beat,
              pitch,
              velocity: clamp((baseVel + accent) * sGain, 0.05, 1),
              instrument: melodyInstr,
              pan: clamp(lean * 0.2, -0.4, 0.4),
              layer: "melody"
            });
            if (ORNAMENTED.has(melodyInstr) && mode !== "analytical" && t >= beat / 4) {
              if (rng() < 0.3) {
                events.push({
                  time: t - beat / 4,
                  duration: 0.12,
                  pitch: degreeToMidi(key, scale, transpose + motif.degrees[degIdx] + 1, cfg.melodyOctave),
                  velocity: clamp((baseVel - 0.2) * sGain, 0.05, 1),
                  instrument: melodyInstr,
                  pan: clamp(lean * 0.2, -0.4, 0.4),
                  layer: "melody"
                });
              }
            }
            if (section.name === "A2" && mode !== "analytical" && i % 2 === 0) {
              events.push({
                time: t,
                duration: durBeats * beat,
                pitch: degreeToMidi(key, scale, transpose + motif.degrees[degIdx] + 2, cfg.melodyOctave),
                velocity: clamp((baseVel - 0.15) * sGain, 0.05, 1),
                instrument: melodyInstr,
                pan: clamp(lean * 0.2 + 0.2, -0.6, 0.6),
                layer: "melody"
              });
            }
          }
        }
        if (isOutro && b === section.bars - 1) {
          events.push({
            time: barStart,
            duration: barDur * 1.5,
            pitch: degreeToMidi(key, scale, 0, cfg.melodyOctave),
            velocity: 0.5 * sGain,
            instrument: melodyInstr,
            pan: 0,
            layer: "melody"
          });
        }
        if (arpGate > 0.08 && !isOutro) {
          const sixteenth = options.style === "electronic" && arpGate > 0.5;
          const slots = sixteenth ? 16 : 8;
          const stepDur = barDur / slots;
          const arpDegrees = [0, 2, 4, 2 + 5];
          const kArp = Math.round(slots * clamp(0.2 + arpGate * 0.6, 0, 0.85) * (isIntro ? 0.5 : 1) * modeDensity);
          const arpPattern = euclid(kArp, slots, (seed >> 7) % slots);
          for (let s = 0; s < slots; s++) {
            const jitter = rng();
            if (!arpPattern[s] && jitter >= 0.1 * dens) continue;
            events.push({
              time: barStart + s * stepDur,
              duration: stepDur * 0.9 * cfg.durScale,
              pitch: degreeToMidi(key, scale, rootDeg + arpDegrees[s % arpDegrees.length], cfg.arpOctave),
              velocity: clamp((0.28 + 0.2 * arpGate) * sGain, 0.05, 1),
              instrument: arpInstr,
              pan: clamp(lean * 0.6 + (s % 2 === 0 ? -0.15 : 0.15), -1, 1),
              layer: "arp"
            });
          }
        }
        if (rng() < bellChance) {
          const onBeat3 = rng() < 0.5;
          events.push({
            time: barStart + (onBeat3 ? 2 * beat : 0),
            duration: 2 * beat * cfg.durScale,
            pitch: degreeToMidi(key, scale, rootDeg + pick(rng, [4, 6, 7]), 6),
            velocity: 0.32 * sGain,
            instrument: bellInstr,
            pan: clamp((rng() * 2 - 1) * 0.7, -1, 1),
            layer: "bell"
          });
        }
        if (cfg.perc === "drive" && isBody) {
          const fourOnFloor = bpm >= 118 && percBoost > 0.25;
          for (let s = 0; s < 8; s++) {
            const onBeat = s % 2 === 0;
            if (onBeat && (kickPattern[s] || s === 0) || fourOnFloor && onBeat) {
              events.push({
                time: barStart + s * (beat / 2),
                duration: 0.25,
                pitch: 36,
                velocity: 0.7 * sGain,
                instrument: "kick",
                pan: 0,
                layer: "perc"
              });
            }
            if (hatPattern[s]) {
              events.push({
                time: barStart + s * (beat / 2),
                duration: 0.08,
                pitch: 90,
                velocity: (onBeat ? 0.3 : 0.2) * sGain,
                instrument: "hihat",
                pan: 0.25,
                layer: "perc"
              });
            }
          }
        } else if (cfg.perc === "sparse" && isBody && bar % 2 === 0) {
          for (let s = 0; s < 8; s++) {
            if (!sparsePattern[s]) continue;
            if (rng() >= (0.35 + 0.4 * percBoost) * dens) continue;
            events.push({
              time: barStart + s * (beat / 2),
              duration: 0.4,
              pitch: 48,
              velocity: 0.3 * sGain,
              instrument: "perc",
              pan: -0.2,
              layer: "perc"
            });
          }
        } else if (cfg.perc === "cinematic" && b === 0 && !isIntro) {
          events.push({
            time: barStart,
            duration: 0.6,
            pitch: 33,
            velocity: 0.65 * sGain,
            instrument: "taiko",
            pan: 0,
            layer: "perc"
          });
          if (rng() < (0.3 + 0.5 * percBoost) * dens) {
            events.push({
              time: barStart + 3.5 * beat,
              duration: 0.3,
              pitch: 55,
              velocity: 0.35 * sGain,
              instrument: "perc",
              pan: 0.3,
              layer: "perc"
            });
          }
        } else if (cfg.perc === "eastern" && isBody) {
          for (let s = 0; s < 8; s++) {
            if (!taikoPattern[s]) continue;
            if (rng() >= (0.55 + 0.35 * percBoost) * dens) continue;
            events.push({
              time: barStart + s * (beat / 2),
              duration: 0.5,
              pitch: s === 0 ? 33 : 40,
              velocity: (s === 0 ? 0.6 : 0.4) * sGain,
              instrument: "taiko",
              pan: s % 2 === 0 ? -0.15 : 0.15,
              layer: "perc"
            });
          }
        }
      }
    }
    const UNPITCHED = /* @__PURE__ */ new Set(["kick", "hihat", "perc", "taiko"]);
    const lengthSec = profile.barCount * barDur;
    let processed = events.filter((ev) => ev.time < lengthSec - 1e-6).map((ev) => {
      let pitch = ev.pitch;
      if (!UNPITCHED.has(ev.instrument)) {
        const skipGuardrail = mode === "analytical" && ev.instrument === melodyInstr;
        if (!skipGuardrail) pitch = quantizePitch(pitch, key, scale);
        pitch = clampMidi(pitch);
      }
      return {
        ...ev,
        time: round6(quantizeTime(ev.time, bpm)),
        duration: round6(clamp(ev.duration, 0.05, 12)),
        pitch,
        velocity: round6(clamp(ev.velocity, 0.05, 1)),
        pan: round6(clamp(ev.pan, -1, 1))
      };
    });
    processed = applyLimits(processed);
    return {
      version: 1,
      fingerprint,
      variation: options.variation,
      profile,
      events: processed
    };
  }

  // src/audio/scheduler.ts
  var TICK_MS = 400;
  var HORIZON_SEC = 2.5;
  var TAIL_SEC = 3;
  var LookaheadScheduler = class {
    constructor(ctx, events, lengthSec, onEvent, onEnd) {
      this.ctx = ctx;
      this.events = events;
      this.lengthSec = lengthSec;
      this.onEvent = onEvent;
      this.onEnd = onEnd;
    }
    idx = 0;
    timer = null;
    endTimer = null;
    startCtxTime = 0;
    start(atCtxTime) {
      this.startCtxTime = atCtxTime;
      this.tick();
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
    /** Seconds into the score. */
    position() {
      return Math.max(0, this.ctx.currentTime - this.startCtxTime);
    }
    tick() {
      const horizon = this.ctx.currentTime + HORIZON_SEC;
      while (this.idx < this.events.length) {
        const ev = this.events[this.idx];
        const when = this.startCtxTime + ev.time;
        if (when >= horizon) break;
        this.onEvent(ev, Math.max(when, this.ctx.currentTime + 0.01));
        this.idx++;
      }
      if (this.idx >= this.events.length && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
        const remaining = this.startCtxTime + this.lengthSec + TAIL_SEC - this.ctx.currentTime;
        this.endTimer = setTimeout(() => this.onEnd?.(), Math.max(0, remaining * 1e3));
      }
    }
    stop() {
      if (this.timer !== null) clearInterval(this.timer);
      if (this.endTimer !== null) clearTimeout(this.endTimer);
      this.timer = null;
      this.endTimer = null;
    }
  };

  // src/audio/instruments.ts
  var REVERB_SEND = {
    pad: 0.5,
    lowpad: 0.45,
    strings: 0.4,
    piano: 0.18,
    epiano: 0.25,
    pluck: 0.3,
    bell: 0.6,
    mallet: 0.35,
    bass: 0.05,
    brass: 0.3,
    lead: 0.2,
    flute: 0.35,
    xiao: 0.45,
    guitar: 0.18,
    kick: 0.03,
    hihat: 0.08,
    perc: 0.25,
    taiko: 0.2
  };
  function brightScale(dest) {
    return 0.55 + 0.9 * (dest.brightness ?? 0.5);
  }
  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  var noiseCache = /* @__PURE__ */ new WeakMap();
  function noiseBuffer(ctx) {
    let buf = noiseCache.get(ctx);
    if (!buf) {
      buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noiseCache.set(ctx, buf);
    }
    return buf;
  }
  function makeOutput(ctx, dest, ev) {
    const env = ctx.createGain();
    env.gain.value = 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = ev.pan;
    env.connect(panner);
    panner.connect(dest.dry);
    const send = ctx.createGain();
    send.gain.value = REVERB_SEND[ev.instrument] ?? 0.2;
    panner.connect(send);
    send.connect(dest.reverb);
    return env;
  }
  function adsr(env, when, peak, attack, duration, release, sustainLevel = 0.7) {
    const g = env.gain;
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(peak, when + attack);
    const sustainTime = Math.max(when + attack, when + duration);
    g.setValueAtTime(peak * sustainLevel, sustainTime);
    g.linearRampToValueAtTime(1e-4, sustainTime + release);
    return sustainTime + release + 0.05;
  }
  function expDecay(env, when, peak, decay) {
    const g = env.gain;
    g.setValueAtTime(peak, when);
    g.exponentialRampToValueAtTime(5e-4, when + decay);
    g.linearRampToValueAtTime(0, when + decay + 0.02);
    return when + decay + 0.05;
  }
  function osc(ctx, type, freq, when, stopAt, detuneCents = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detuneCents !== 0) o.detune.value = detuneCents;
    o.start(when);
    o.stop(stopAt);
    return o;
  }
  function lowpass(ctx, cutoff, q = 0.8) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    f.Q.value = q;
    return f;
  }
  var padVoice = (cutoffBase) => (ctx, env, ev, when, bright) => {
    const freq = midiToFreq(ev.pitch);
    const attack = Math.min(1.2, ev.duration * 0.3);
    const release = 1.4;
    const stopAt = adsr(env, when, ev.velocity * 0.28, attack, ev.duration, release, 0.8);
    const filter = lowpass(ctx, (cutoffBase + ev.velocity * 2200) * bright);
    filter.connect(env);
    osc(ctx, "sawtooth", freq, when, stopAt, -7).connect(filter);
    osc(ctx, "sawtooth", freq, when, stopAt, 7).connect(filter);
    return { out: env, stopAt };
  };
  var VOICES = {
    pad: padVoice(700),
    lowpad: padVoice(420),
    strings: (ctx, env, ev, when, bright) => {
      const freq = midiToFreq(ev.pitch);
      const stopAt = adsr(env, when, ev.velocity * 0.3, 0.12, ev.duration, 0.5, 0.85);
      const filter = lowpass(ctx, (1100 + ev.velocity * 1800) * bright, 0.7);
      filter.connect(env);
      const o = osc(ctx, "sawtooth", freq, when, stopAt);
      o.connect(filter);
      const lfo = osc(ctx, "sine", 5, when, stopAt);
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 5;
      lfo.connect(lfoGain);
      lfoGain.connect(o.detune);
      return { out: env, stopAt };
    },
    piano: (ctx, env, ev, when, bright) => {
      const freq = midiToFreq(ev.pitch);
      const decay = Math.min(2.2, 0.5 + ev.duration);
      const stopAt = expDecay(env, when + 4e-3, ev.velocity * 0.5, decay);
      const filter = lowpass(ctx, (2200 + ev.velocity * 3e3) * bright, 0.5);
      filter.connect(env);
      osc(ctx, "triangle", freq, when, stopAt).connect(filter);
      const partial = ctx.createGain();
      partial.gain.value = 0.18;
      partial.connect(filter);
      osc(ctx, "sine", freq * 2, when, stopAt).connect(partial);
      return { out: env, stopAt };
    },
    epiano: (ctx, env, ev, when) => {
      const freq = midiToFreq(ev.pitch);
      const decay = Math.min(2.5, 0.8 + ev.duration);
      const stopAt = expDecay(env, when + 8e-3, ev.velocity * 0.42, decay);
      osc(ctx, "sine", freq, when, stopAt).connect(env);
      const partial = ctx.createGain();
      partial.gain.value = 0.08;
      partial.connect(env);
      osc(ctx, "sine", freq * 3, when, stopAt).connect(partial);
      return { out: env, stopAt };
    },
    pluck: (ctx, env, ev, when, bright) => {
      const freq = midiToFreq(ev.pitch);
      const decay = Math.min(0.5, 0.1 + ev.duration * 0.4);
      const stopAt = expDecay(env, when + 3e-3, ev.velocity * 0.4, decay);
      const filter = lowpass(ctx, 2600 * bright, 1);
      filter.connect(env);
      osc(ctx, "triangle", freq, when, stopAt).connect(filter);
      return { out: env, stopAt };
    },
    bell: (ctx, env, ev, when) => {
      const freq = midiToFreq(ev.pitch);
      const decay = 2.4;
      const stopAt = expDecay(env, when + 5e-3, ev.velocity * 0.35, decay);
      const carrier = osc(ctx, "sine", freq, when, stopAt);
      const mod = osc(ctx, "sine", freq * 3.53, when, stopAt);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(freq * 2.2, when);
      modGain.gain.exponentialRampToValueAtTime(1, when + decay * 0.6);
      mod.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(env);
      const shimmer = ctx.createGain();
      shimmer.gain.value = 0.12;
      shimmer.connect(env);
      osc(ctx, "sine", freq * 2.76, when, stopAt).connect(shimmer);
      return { out: env, stopAt };
    },
    mallet: (ctx, env, ev, when) => {
      const freq = midiToFreq(ev.pitch);
      const stopAt = expDecay(env, when + 3e-3, ev.velocity * 0.4, 0.5);
      osc(ctx, "sine", freq, when, stopAt).connect(env);
      const click = ctx.createBufferSource();
      click.buffer = noiseBuffer(ctx);
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(ev.velocity * 0.06, when);
      clickGain.gain.exponentialRampToValueAtTime(5e-4, when + 0.03);
      click.connect(clickGain);
      clickGain.connect(env);
      click.start(when);
      click.stop(when + 0.04);
      return { out: env, stopAt };
    },
    bass: (ctx, env, ev, when) => {
      const freq = midiToFreq(ev.pitch);
      const stopAt = adsr(env, when, ev.velocity * 0.5, 0.015, ev.duration * 0.8, 0.25, 0.6);
      const filter = lowpass(ctx, 480, 0.7);
      filter.connect(env);
      osc(ctx, "triangle", freq, when, stopAt).connect(filter);
      const sub = ctx.createGain();
      sub.gain.value = 0.5;
      sub.connect(filter);
      osc(ctx, "sine", freq / 2, when, stopAt).connect(sub);
      return { out: env, stopAt };
    },
    brass: (ctx, env, ev, when, bright) => {
      const freq = midiToFreq(ev.pitch);
      const stopAt = adsr(env, when, ev.velocity * 0.34, 0.07, ev.duration, 0.3, 0.8);
      const filter = lowpass(ctx, 400, 1.2);
      filter.frequency.setValueAtTime(400, when);
      filter.frequency.linearRampToValueAtTime((1800 + ev.velocity * 1500) * bright, when + 0.1);
      filter.connect(env);
      osc(ctx, "sawtooth", freq, when, stopAt).connect(filter);
      return { out: env, stopAt };
    },
    lead: (ctx, env, ev, when, bright) => {
      const freq = midiToFreq(ev.pitch);
      const stopAt = adsr(env, when, ev.velocity * 0.3, 0.02, ev.duration, 0.18, 0.75);
      const filter = lowpass(ctx, 2800 * bright, 1.1);
      filter.connect(env);
      osc(ctx, "square", freq, when, stopAt, -4).connect(filter);
      osc(ctx, "sawtooth", freq, when, stopAt, 4).connect(filter);
      return { out: env, stopAt };
    },
    flute: (ctx, env, ev, when, bright) => {
      const freq = midiToFreq(ev.pitch);
      const stopAt = adsr(env, when, ev.velocity * 0.32, 0.09, ev.duration, 0.35, 0.85);
      const filter = lowpass(ctx, 3200 * bright, 0.6);
      filter.connect(env);
      const o = osc(ctx, "sine", freq, when, stopAt);
      o.connect(filter);
      const lfo = osc(ctx, "sine", 5.2, when, stopAt);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0, when);
      lfoGain.gain.linearRampToValueAtTime(8, when + 0.35);
      lfo.connect(lfoGain);
      lfoGain.connect(o.detune);
      const breath = ctx.createBufferSource();
      breath.buffer = noiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = Math.min(6e3, freq * 2);
      bp.Q.value = 2;
      const bGain = ctx.createGain();
      bGain.gain.value = ev.velocity * 0.045;
      breath.connect(bp);
      bp.connect(bGain);
      bGain.connect(env);
      breath.start(when);
      breath.stop(stopAt);
      return { out: env, stopAt };
    },
    // 蕭 — darker, breathier vertical flute: slow attack, pitch scoop, deep vibrato.
    xiao: (ctx, env, ev, when, bright) => {
      const freq = midiToFreq(ev.pitch);
      const stopAt = adsr(env, when, ev.velocity * 0.34, 0.14, ev.duration, 0.5, 0.85);
      const filter = lowpass(ctx, 1900 * bright, 0.7);
      filter.connect(env);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(freq * 0.982, when);
      o.frequency.linearRampToValueAtTime(freq, when + 0.13);
      o.connect(filter);
      o.start(when);
      o.stop(stopAt);
      const body = ctx.createGain();
      body.gain.value = 0.12;
      body.connect(filter);
      osc(ctx, "triangle", freq, when, stopAt).connect(body);
      const lfo = osc(ctx, "sine", 4.4, when, stopAt);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0, when);
      lfoGain.gain.linearRampToValueAtTime(11, when + 0.4);
      lfo.connect(lfoGain);
      lfoGain.connect(o.detune);
      const breath = ctx.createBufferSource();
      breath.buffer = noiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = Math.min(4500, freq * 1.5);
      bp.Q.value = 3;
      const bGain = ctx.createGain();
      bGain.gain.value = ev.velocity * 0.07;
      breath.connect(bp);
      bp.connect(bGain);
      bGain.connect(env);
      breath.start(when);
      breath.stop(stopAt);
      return { out: env, stopAt };
    },
    // Karplus-Strong plucked string: noise burst into a tuned feedback delay.
    guitar: (ctx, env, ev, when, bright) => {
      const freq = midiToFreq(ev.pitch);
      const ringSec = Math.min(2.2, 0.6 + ev.duration);
      const stopAt = when + ringSec + 0.3;
      env.gain.setValueAtTime(ev.velocity * 0.55, when);
      env.gain.setValueAtTime(ev.velocity * 0.55, when + ringSec * 0.7);
      env.gain.linearRampToValueAtTime(0, when + ringSec);
      const burst = ctx.createBufferSource();
      burst.buffer = noiseBuffer(ctx);
      const burstGain = ctx.createGain();
      burstGain.gain.setValueAtTime(1, when);
      burstGain.gain.exponentialRampToValueAtTime(1e-3, when + 0.012);
      burst.connect(burstGain);
      burst.start(when);
      burst.stop(when + 0.02);
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 1 / freq;
      const damp = lowpass(ctx, Math.min(6500, freq * 6 * bright), 0.4);
      const feedback = ctx.createGain();
      feedback.gain.setValueAtTime(Math.pow(1e-3, 1 / (freq * ringSec)), when);
      feedback.gain.setValueAtTime(0, when + ringSec + 0.05);
      burstGain.connect(delay);
      delay.connect(damp);
      damp.connect(feedback);
      feedback.connect(delay);
      damp.connect(env);
      return { out: env, stopAt };
    },
    // 太鼓 — deep drum: pitch-dropping sine body + low noise thump.
    taiko: (ctx, env, ev, when) => {
      const deep = ev.pitch <= 35;
      const stopAt = expDecay(env, when, ev.velocity * (deep ? 1 : 0.7), deep ? 0.55 : 0.35);
      const o = ctx.createOscillator();
      o.type = "sine";
      const base = deep ? 42 : 60;
      o.frequency.setValueAtTime(base * 2.4, when);
      o.frequency.exponentialRampToValueAtTime(base, when + 0.16);
      o.connect(env);
      o.start(when);
      o.stop(stopAt);
      const thump = ctx.createBufferSource();
      thump.buffer = noiseBuffer(ctx);
      const lp = lowpass(ctx, 320, 0.7);
      const tGain = ctx.createGain();
      tGain.gain.setValueAtTime(ev.velocity * 0.35, when);
      tGain.gain.exponentialRampToValueAtTime(1e-3, when + 0.07);
      thump.connect(lp);
      lp.connect(tGain);
      tGain.connect(env);
      thump.start(when);
      thump.stop(when + 0.1);
      return { out: env, stopAt };
    },
    kick: (ctx, env, ev, when) => {
      const stopAt = expDecay(env, when, ev.velocity * 0.9, 0.28);
      const o = ctx.createOscillator();
      o.type = "sine";
      const base = ev.pitch <= 34 ? 34 : 45;
      o.frequency.setValueAtTime(base * 3, when);
      o.frequency.exponentialRampToValueAtTime(base, when + 0.11);
      o.connect(env);
      o.start(when);
      o.stop(stopAt);
      return { out: env, stopAt };
    },
    hihat: (ctx, env, ev, when) => {
      const stopAt = expDecay(env, when, ev.velocity * 0.28, 0.06);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 7e3;
      src.connect(hp);
      hp.connect(env);
      src.start(when);
      src.stop(when + 0.08);
      return { out: env, stopAt };
    },
    perc: (ctx, env, ev, when) => {
      const stopAt = expDecay(env, when, ev.velocity * 0.5, 0.16);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = Math.min(4e3, midiToFreq(ev.pitch) * 8);
      bp.Q.value = 1.5;
      src.connect(bp);
      bp.connect(env);
      src.start(when);
      src.stop(when + 0.2);
      return { out: env, stopAt };
    }
  };
  function playNote(ctx, dest, ev, when) {
    const env = makeOutput(ctx, dest, ev);
    const builder = VOICES[ev.instrument] ?? VOICES.pluck;
    builder(ctx, env, ev, when, brightScale(dest));
  }

  // src/audio/engine.ts
  function makeImpulseResponse(ctx) {
    const seconds = 1.8;
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
      }
    }
    return buf;
  }
  var WseAudioEngine = class {
    ctx = null;
    scheduler = null;
    master = null;
    currentScore = null;
    onEnded = null;
    async play(score, opts = {}) {
      await this.stop();
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.onEnded = opts.onEnded ?? null;
      const master = ctx.createGain();
      master.gain.value = 0.75;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.01;
      compressor.release.value = 0.2;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      this.master = master;
      const reverb = ctx.createConvolver();
      reverb.buffer = makeImpulseResponse(ctx);
      const reverbReturn = ctx.createGain();
      reverbReturn.gain.value = 0.15 + 1.3 * (opts.reverb ?? 0.5);
      reverb.connect(reverbReturn);
      reverbReturn.connect(master);
      const dest = { dry: master, reverb, brightness: opts.brightness ?? 0.5 };
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      this.currentScore = score;
      const scheduler = new LookaheadScheduler(
        ctx,
        score.events,
        score.profile.lengthSec,
        (ev, when) => playNote(ctx, dest, ev, when),
        () => {
          void this.stop();
          this.onEnded?.();
        }
      );
      this.scheduler = scheduler;
      scheduler.start(ctx.currentTime + 0.15);
    }
    async stop() {
      this.scheduler?.stop();
      this.scheduler = null;
      this.currentScore = null;
      const ctx = this.ctx;
      const master = this.master;
      this.ctx = null;
      this.master = null;
      if (ctx) {
        try {
          if (master && ctx.state === "running") {
            master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
            await new Promise((r) => setTimeout(r, 120));
          }
          await ctx.close();
        } catch {
        }
      }
    }
    getState() {
      if (!this.ctx || !this.scheduler) return { playing: false, position: 0 };
      return { playing: true, position: this.scheduler.position() };
    }
    getScore() {
      return this.currentScore;
    }
  };

  // src/viz/viz-core.ts
  var LAYER_COLORS = {
    pad: "#38bdf8",
    // sky      — containers / sections
    bass: "#f59e0b",
    // amber   — structural roots
    melody: "#a78bfa",
    // violet — text content
    arp: "#34d399",
    // emerald  — links
    bell: "#fbbf24",
    // gold    — images
    perc: "#f472b6"
    // pink    — buttons / forms
  };
  var LAYER_LABELS = {
    pad: "sections \u2192 pad",
    bass: "structure \u2192 bass",
    melody: "text \u2192 melody",
    arp: "links \u2192 arpeggio",
    bell: "images \u2192 bells",
    perc: "buttons \u2192 percussion"
  };
  var LAYER_TAGS = {
    arp: ["a"],
    bell: ["img", "picture", "source", "svg", "figure", "video"],
    perc: ["button", "input", "select", "form", "label", "textarea"],
    melody: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "span", "strong", "em", "blockquote", "pre", "code", "td", "th"],
    pad: ["div", "section", "article", "header", "nav", "aside", "figure"],
    bass: ["html", "body", "main", "footer", "table", "ul", "ol"]
  };
  function assignTokens(events, tokens) {
    const byLayer = {
      pad: [],
      bass: [],
      melody: [],
      arp: [],
      bell: [],
      perc: []
    };
    const all = [];
    tokens.forEach((tok, i) => {
      all.push(i);
      for (const layer of Object.keys(LAYER_TAGS)) {
        if (LAYER_TAGS[layer].includes(tok.tag)) byLayer[layer].push(i);
      }
    });
    const counters = { pad: 0, bass: 0, melody: 0, arp: 0, bell: 0, perc: 0 };
    let fallback = 0;
    return events.map((ev) => {
      const list = byLayer[ev.layer];
      if (list.length > 0) {
        const idx = list[counters[ev.layer] % list.length];
        counters[ev.layer]++;
        return idx;
      }
      if (all.length === 0) return -1;
      return all[fallback++ % all.length];
    });
  }
  var ROLL_BEHIND = 1.5;
  var ROLL_AHEAD = 6.5;
  function mountViz(opts) {
    const { tokensEl, canvas, score, tokens, getPosition, isPlaying } = opts;
    const events = score.events;
    const assignment = assignTokens(events, tokens);
    tokensEl.textContent = "";
    const tokenSpans = tokens.map((tok) => {
      const span = document.createElement("span");
      span.className = "wse-tok";
      span.textContent = `<${tok.tag}>`;
      let owner = null;
      for (const layer of Object.keys(LAYER_TAGS)) {
        if (LAYER_TAGS[layer].includes(tok.tag)) {
          owner = layer;
          break;
        }
      }
      if (owner) span.style.color = LAYER_COLORS[owner] + "88";
      span.style.opacity = String(Math.max(0.45, 1 - tok.depth * 0.03));
      tokensEl.appendChild(span);
      return span;
    });
    const ctx2d = canvas.getContext("2d");
    let nextIdx = 0;
    let raf = 0;
    let running = false;
    const fired = /* @__PURE__ */ new Set();
    const litTimeouts = [];
    let lastScrollAt = 0;
    function lightToken(evIdx, layer) {
      const tIdx = assignment[evIdx];
      if (tIdx < 0 || !tokenSpans[tIdx]) return;
      const span = tokenSpans[tIdx];
      span.classList.remove("lit");
      void span.offsetWidth;
      span.style.setProperty("--lit-color", LAYER_COLORS[layer]);
      span.classList.add("lit", "played");
      const now = performance.now();
      if (now - lastScrollAt > 350) {
        lastScrollAt = now;
        const target = span.offsetTop - tokensEl.clientHeight / 2;
        tokensEl.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      }
      const handle = window.setTimeout(() => span.classList.remove("lit"), 700);
      litTimeouts.push(handle);
    }
    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const pitches = events.map((e) => e.pitch);
    const pitchLo = Math.min(...pitches, 36) - 2;
    const pitchHi = Math.max(...pitches, 84) + 2;
    const barDur = 60 / score.profile.bpm * 4;
    function drawRoll(pos) {
      resizeCanvas();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx2d.clearRect(0, 0, w, h);
      const t0 = pos - ROLL_BEHIND;
      const t1 = pos + ROLL_AHEAD;
      const xOf = (t) => (t - t0) / (t1 - t0) * w;
      const yOf = (p) => h - (p - pitchLo) / (pitchHi - pitchLo) * (h - 10) - 5;
      const noteH = Math.max(3, (h - 10) / (pitchHi - pitchLo) + 2);
      ctx2d.strokeStyle = "rgba(148, 163, 184, 0.12)";
      ctx2d.lineWidth = 1;
      for (let bar = Math.max(0, Math.floor(t0 / barDur)); bar * barDur < t1; bar++) {
        const x = xOf(bar * barDur);
        ctx2d.beginPath();
        ctx2d.moveTo(x, 0);
        ctx2d.lineTo(x, h);
        ctx2d.stroke();
      }
      for (const [i, ev] of events.entries()) {
        if (ev.time + ev.duration < t0 || ev.time > t1) continue;
        const x = xOf(ev.time);
        const wNote = Math.max(3, xOf(ev.time + ev.duration) - x - 1);
        const y = yOf(ev.pitch);
        const color = LAYER_COLORS[ev.layer];
        const playing = ev.time <= pos && pos <= ev.time + ev.duration;
        const played = ev.time <= pos;
        ctx2d.globalAlpha = playing ? 1 : played ? 0.55 : 0.3 + 0.45 * ev.velocity;
        ctx2d.fillStyle = color;
        if (playing) {
          ctx2d.shadowColor = color;
          ctx2d.shadowBlur = 12;
        }
        ctx2d.beginPath();
        ctx2d.roundRect(x, y - noteH / 2, wNote, noteH, 2);
        ctx2d.fill();
        ctx2d.shadowBlur = 0;
        const age = pos - ev.time;
        if (age >= 0 && age < 0.25 && fired.has(i)) {
          ctx2d.globalAlpha = 1 - age / 0.25;
          ctx2d.strokeStyle = "#ffffff";
          ctx2d.lineWidth = 1.5;
          ctx2d.beginPath();
          ctx2d.roundRect(x - 2, y - noteH / 2 - 2, wNote + 4, noteH + 4, 3);
          ctx2d.stroke();
        }
      }
      ctx2d.globalAlpha = 1;
      const px = xOf(pos);
      const grad = ctx2d.createLinearGradient(px, 0, px, h);
      grad.addColorStop(0, "rgba(56, 189, 248, 0.9)");
      grad.addColorStop(1, "rgba(167, 139, 250, 0.9)");
      ctx2d.strokeStyle = grad;
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(px, 0);
      ctx2d.lineTo(px, h);
      ctx2d.stroke();
    }
    function frame() {
      if (!running) return;
      const pos = getPosition();
      while (nextIdx < events.length && events[nextIdx].time <= pos) {
        fired.add(nextIdx);
        lightToken(nextIdx, events[nextIdx].layer);
        nextIdx++;
      }
      drawRoll(pos);
      if (!isPlaying() && nextIdx >= events.length) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    return {
      start() {
        if (running) return;
        running = true;
        raf = requestAnimationFrame(frame);
      },
      stop() {
        running = false;
        cancelAnimationFrame(raf);
      },
      reset() {
        nextIdx = 0;
        fired.clear();
        for (const handle of litTimeouts) clearTimeout(handle);
        litTimeouts.length = 0;
        for (const span of tokenSpans) span.classList.remove("lit", "played");
        tokensEl.scrollTo({ top: 0 });
        drawRoll(0);
      }
    };
  }

  // demo/demo.ts
  var engine = new WseAudioEngine();
  var variation = 0;
  var $ = (id) => document.getElementById(id);
  var out = $("out");
  function currentTuning() {
    const v = (id) => Number($(id).value);
    return {
      tempoShift: v("s-tempo"),
      density: v("s-density") / 100,
      brightness: v("s-bright") / 100,
      reverb: v("s-reverb") / 100
    };
  }
  function currentOptions() {
    return {
      style: $("style").value,
      mode: $("mode").value,
      variation,
      tuning: currentTuning()
    };
  }
  function analyze() {
    out.textContent = "idle";
    const features = extractPageFeatures(document, window);
    const fingerprint = computeFingerprint(features);
    const score = generateScore(features, fingerprint, currentOptions());
    return { features, fingerprint, score };
  }
  var viz = null;
  function renderVizLegend() {
    const legend = $("viz-legend");
    if (legend.childElementCount > 0) return;
    for (const layer of Object.keys(LAYER_LABELS)) {
      const key = document.createElement("span");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = LAYER_COLORS[layer];
      key.append(dot, LAYER_LABELS[layer]);
      legend.appendChild(key);
    }
  }
  async function play() {
    const { features, fingerprint, score } = analyze();
    window.__wse = {
      features,
      fingerprint,
      score,
      engine,
      eventCount: score.events.length
    };
    const tuning = currentTuning();
    await engine.play(score, {
      brightness: tuning.brightness,
      reverb: tuning.reverb,
      onEnded: () => {
        out.textContent = "finished";
      }
    });
    $("viz").classList.add("on");
    renderVizLegend();
    viz?.stop();
    viz = mountViz({
      tokensEl: $("tokens"),
      canvas: $("roll"),
      score,
      tokens: features.tokens,
      getPosition: () => engine.getState().position,
      isPlaying: () => engine.getState().playing
    });
    window.__wseViz = viz;
    viz.start();
    out.textContent = `${score.profile.keyName} \xB7 ${score.profile.bpm} BPM \xB7 ${score.profile.lengthSec}s \xB7 ${score.events.length} notes \xB7 ${score.profile.character}-led \xB7 #${fingerprint.hash}` + (variation > 0 ? ` \xB7 var ${variation}` : "");
  }
  $("play").addEventListener("click", () => {
    variation = 0;
    void play();
  });
  $("regen").addEventListener("click", () => {
    variation++;
    void play();
  });
  $("stop").addEventListener("click", () => {
    void engine.stop();
    viz?.stop();
    out.textContent = "stopped";
  });
  window.__wseAnalyze = analyze;
})();
