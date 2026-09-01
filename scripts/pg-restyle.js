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
    "[data-pg-reactcopy='1']{display:none!important}";

  function parseReactCopy(text) {
    const t = String(text ?? "")
      .replace(/[\u200B-\u200D\uFEFF\uFE0F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const m = t.match(MARK);
    if (!m) {
      return null;
    }
    return { emoji: m[1], copy: (m[2] ?? "").trim() };
  }

  function copyLeafText(el) {
    return String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isCopyLeaf(el) {
    if (!el || (el.closest && el.closest(".pg-chip, .pg-chip-row, [data-pg-chip-row]"))) {
      return false;
    }
    return parseReactCopy(copyLeafText(el)) !== null;
  }

  function textHasCopy(text, copy) {
    const want = String(copy ?? "").trim();
    if (want.length === 0) {
      return false;
    }
    const t = String(text ?? "").trim();
    if (t === want) {
      return true;
    }
    return t.split(/\n+/).some((line) => line.trim() === want);
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
      // Seen-cursor 👀 copies. The follow-up original often lives in a
      // thread pane / nested fui-Card line, not as a prior sibling in the
      // same collected card list (loop 5 leftover).
      if (parsed.emoji === "👀") {
        return parsed;
      }
      for (let j = 0; j < texts.length; j++) {
        if (j === i) {
          continue;
        }
        if (parseReactCopy(texts[j])) {
          continue;
        }
        if (textHasCopy(texts[j], parsed.copy)) {
          return parsed;
        }
      }
      return null;
    });
  }

  function findTargetIndex(items, copyIndex, copy) {
    const want = String(copy ?? "").trim();
    if (want.length > 0) {
      for (let i = 0; i < items.length; i++) {
        if (i === copyIndex || items[i].isCopy) {
          continue;
        }
        if (textHasCopy(items[i].text, want)) {
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

  /**
   * Playground 0.2.28 chat chrome is Fluent v9 (`fai-OutputCard` for bot
   * bubbles, `fymqbz9` body wrap for user + bot). Older CHIP_JS looked for
   * Northstar `.ui-chat__message`, which is still in the bundle but unused
   * in this chrome — keep it as a fallback.
   */
  function collectMessages(doc) {
    const seen = new Set();
    const out = [];
    const add = (card, body) => {
      if (!card) {
        return;
      }
      const el = body || card;
      if (seen.has(el)) {
        return;
      }
      if (seen.has(card) && el !== card && !isCopyLeaf(el)) {
        return;
      }
      seen.add(el);
      if (!isCopyLeaf(el)) {
        seen.add(card);
      }
      out.push({ card, body: el });
    };
    for (const card of doc.querySelectorAll(".fai-OutputCard, .ui-chat__message")) {
      const body =
        card.querySelector(".fymqbz9, .ui-chat__message__body, .ui-chat__message__bubble") || card;
      add(card, body);
    }
    for (const card of doc.querySelectorAll(".fui-Card")) {
      if (card.closest(".fai-OutputCard, .ui-chat__message")) {
        continue;
      }
      const raw = String(card.innerText || "").trim();
      const hasCopy = /👀|⭐/.test(raw);
      if (raw.length === 0 || /Getting Started|Limitations/.test(raw)) {
        continue;
      }
      if (!hasCopy && (raw.length > 400 || /Start a new post/.test(raw))) {
        continue;
      }
      const body = card.querySelector(".fui-Text") || card;
      add(card, body);
      // In-thread replies are <p> / fui-Text rows nested in the same
      // fui-Card as the root. Collect each so hide can see them even
      // when the first fui-Text wraps the whole thread.
      for (const p of card.querySelectorAll("p")) {
        const t = String(p.innerText || p.textContent || "").trim();
        if (t.length === 0 || t.length > 400) {
          continue;
        }
        if (
          !parseReactCopy(t) &&
          body !== card &&
          typeof body.contains === "function" &&
          body.contains(p)
        ) {
          continue;
        }
        add(threadReplyCard(p), p);
      }
    }
    for (const body of doc.querySelectorAll(".fymqbz9")) {
      const hosted = typeof body.closest === "function" ? body.closest(".fai-OutputCard, .ui-chat__message") : null;
      if (hosted) {
        continue;
      }
      add(body.parentElement || body, body);
    }
    out.sort((a, b) => {
      if (a.card === b.card) {
        return 0;
      }
      const pos = a.card.compareDocumentPosition(b.card);
      if (pos & 2) {
        return 1;
      }
      if (pos & 4) {
        return -1;
      }
      return 0;
    });
    return out;
  }

  function nodeText(node) {
    const bubble = node.querySelector
      ? node.querySelector(".ui-chat__message__bubble, .fymqbz9") || node
      : node;
    if (!bubble.querySelector) {
      return String(bubble.innerText || bubble.textContent || "").trim();
    }
    const chips = bubble.querySelectorAll(".pg-chip, .pg-chip-row");
    if (chips.length === 0) {
      return String(bubble.innerText || bubble.textContent || "").trim();
    }
    const clone = bubble.cloneNode(true);
    for (const extra of clone.querySelectorAll(".pg-chip, .pg-chip-row")) {
      extra.remove();
    }
    return String(clone.innerText || clone.textContent || "").trim();
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

  function threadReplyCard(el) {
    let best = el;
    let n = el;
    for (let i = 0; i < 8 && n.parentElement; i++) {
      const parent = n.parentElement;
      const cls = String(parent.className || "");
      if (/\bfui-Card\b|\bfai-OutputCard\b|\bui-chat__message\b/.test(cls)) {
        break;
      }
      // Channel replies share one fui-Card. Never return a wrapper that
      // also holds sibling message <p> rows or other prefix copies.
      if (parent.querySelectorAll("p").length > 1) {
        break;
      }
      const otherCopies = [...parent.querySelectorAll("p, .fui-Text")].filter(
        (x) => x !== el && !n.contains(x) && isCopyLeaf(x),
      );
      if (otherCopies.length > 0) {
        break;
      }
      n = parent;
      best = n;
    }
    return best;
  }

  function hideCopy(card) {
    let n = card;
    for (let i = 0; i < 6 && n; i++) {
      n.setAttribute("data-pg-reactcopy", "1");
      const parent = n.parentElement;
      if (!parent || parent === n.ownerDocument?.body) {
        break;
      }
      const parentCls = String(parent.className || "");
      if (/\bfui-Card\b|\bfai-OutputCard\b|\bui-chat__message\b/.test(parentCls)) {
        break;
      }
      if (parent.querySelectorAll("p").length > 1) {
        break;
      }
      const cards = parent.querySelectorAll(".fai-OutputCard, .ui-chat__message, .fui-Card");
      if (cards.length > 1) {
        break;
      }
      n = parent;
    }
  }

  function collectCopyLeaves(doc) {
    const out = [];
    for (const root of doc.querySelectorAll(".fui-Card, .fai-OutputCard, .ui-chat__message")) {
      for (const el of root.querySelectorAll("p, .fui-Text, .fymqbz9")) {
        if (!isCopyLeaf(el)) {
          continue;
        }
        const nested = [...el.querySelectorAll("p, .fui-Text")].some((c) => c !== el && isCopyLeaf(c));
        if (nested) {
          continue;
        }
        out.push(el);
      }
    }
    return out;
  }

  function restyleDocument(doc) {
    ensureStyle(doc);
    const nodes = collectMessages(doc);
    const texts = nodes.map((n) => nodeText(n.body));
    const result = applyRestyle(texts);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const row = result[i];
      if (row.hidden) {
        const multi = node.card.querySelectorAll && node.card.querySelectorAll("p").length > 1;
        hideCopy(multi ? threadReplyCard(node.body) : node.card);
      } else if (node.card.getAttribute && node.card.getAttribute("data-pg-reactcopy") === "1") {
        /* keep hidden; React may rewrite siblings */
      } else {
        node.card.removeAttribute("data-pg-reactcopy");
      }
      if (row.chips.length === 0) {
        continue;
      }
      for (const emoji of row.chips) {
        ensureChip(doc, node.body, emoji);
      }
    }
    // Sweep leftover in-card prefix copies collectMessages missed
    // (first fui-Text wraps the thread, card skipped, shared wrapper).
    for (const el of collectCopyLeaves(doc)) {
      if (el.closest && el.closest("[data-pg-reactcopy='1']")) {
        continue;
      }
      hideCopy(threadReplyCard(el));
    }
  }

  function boot(doc) {
    let busy = false;
    const run = () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        restyleDocument(doc);
      } catch {
        /* playground chrome only */
      }
      busy = false;
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
