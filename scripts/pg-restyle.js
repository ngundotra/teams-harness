/**
 * Playground-only restyle. Same table as the CHIP_JS block that
 * ungate-playground.mjs already injects: prefix copies (👀 / ⭐) become
 * chips on the target message. This file is that restyle, extracted so
 * the script is valid JS (the inlined template had a quote bug that
 * prevented boot) and so unit tests can call the matcher.
 *
 * Not a Teams/Graph control plane. Production inbound stays Bot Framework.
 */
(function (root, factory) {
  const api = factory();
  root.__pgRestyle = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof document !== "undefined") {
    api.boot(document);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MARK = /^(👀|⭐)(?:\s+([\s\S]*))?$/;
  const STYLE_ID = "pg-chip-style";
  const CSS =
    ".pg-chip{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;margin:4px 6px 0 0;padding:0 8px;border-radius:14px;border:1px solid #c7a512;background:#fff6cc;font-size:18px;line-height:28px;vertical-align:middle}" +
    ".pg-chip-row{display:flex;flex-wrap:wrap;align-items:center;margin-top:4px}" +
    ".ui-chat__message[data-pg-reactcopy='1'],.ui-chat__item:has(.ui-chat__message[data-pg-reactcopy='1']){display:none!important}";

  function parseReactCopy(text) {
    const t = String(text ?? "").trim();
    const m = t.match(MARK);
    if (!m) {
      return null;
    }
    return { emoji: m[1], copy: (m[2] ?? "").trim() };
  }

  function classifyCopies(texts) {
    return texts.map((text, i) => {
      const parsed = parseReactCopy(text);
      if (!parsed) {
        return null;
      }
      if (parsed.copy.length === 0) {
        return parsed;
      }
      for (let j = 0; j < i; j++) {
        if (String(texts[j] ?? "").trim() === parsed.copy) {
          return parsed;
        }
      }
      return null;
    });
  }

  function findTargetIndex(items, copyIndex, copy) {
    const want = String(copy ?? "").trim();
    if (want.length > 0) {
      for (let i = copyIndex - 1; i >= 0; i--) {
        if (items[i].isCopy) {
          continue;
        }
        if (String(items[i].text ?? "").trim() === want) {
          return i;
        }
      }
    }
    for (let i = copyIndex - 1; i >= 0; i--) {
      if (!items[i].isCopy) {
        return i;
      }
    }
    return -1;
  }

  function applyRestyle(texts) {
    const copies = classifyCopies(texts);
    const items = copies.map((c, i) => ({ text: texts[i], isCopy: c !== null }));
    const out = texts.map((text, i) => ({
      text,
      hidden: copies[i] !== null,
      chips: [],
    }));
    for (let i = 0; i < texts.length; i++) {
      const parsed = copies[i];
      if (!parsed) {
        continue;
      }
      const ti = findTargetIndex(items, i, parsed.copy);
      if (ti < 0) {
        continue;
      }
      if (!out[ti].chips.includes(parsed.emoji)) {
        out[ti].chips.push(parsed.emoji);
      }
    }
    return out;
  }

  function nodeText(node) {
    const bubble = node.querySelector(".ui-chat__message__bubble") || node;
    return String(bubble.innerText || bubble.textContent || "").trim();
  }

  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) {
      return;
    }
    const s = doc.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function ensureChip(doc, body, emoji) {
    const sel = '.pg-chip[data-emoji="' + emoji + '"]';
    if (body.querySelector(sel)) {
      return;
    }
    let row = body.querySelector(".pg-chip-row");
    if (!row) {
      row = doc.createElement("span");
      row.className = "pg-chip-row";
      body.appendChild(row);
    }
    const chip = doc.createElement("span");
    chip.className = "pg-chip";
    chip.setAttribute("data-emoji", emoji);
    chip.textContent = emoji;
    row.appendChild(chip);
  }

  function restyleDocument(doc) {
    ensureStyle(doc);
    const nodes = Array.from(doc.querySelectorAll(".ui-chat__message"));
    const texts = nodes.map(nodeText);
    const result = applyRestyle(texts);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const row = result[i];
      if (row.hidden) {
        node.setAttribute("data-pg-reactcopy", "1");
      } else {
        node.removeAttribute("data-pg-reactcopy");
      }
      if (row.chips.length === 0) {
        continue;
      }
      const body = node.querySelector(".ui-chat__message__body") || node;
      for (const emoji of row.chips) {
        ensureChip(doc, body, emoji);
      }
    }
  }

  function boot(doc) {
    const run = () => {
      try {
        restyleDocument(doc);
      } catch {
        /* playground chrome only */
      }
    };
    if (typeof MutationObserver === "function") {
      new MutationObserver(run).observe(doc.documentElement || doc.body, {
        childList: true,
        subtree: true,
      });
    }
    if (typeof setInterval === "function") {
      setInterval(run, 400);
    }
    run();
  }

  return {
    parseReactCopy,
    classifyCopies,
    findTargetIndex,
    applyRestyle,
    restyleDocument,
    boot,
    CSS,
  };
});
