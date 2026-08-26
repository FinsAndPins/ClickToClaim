/** Shared title tokenization + seed suggestion (loads rules from title_seed_rules.json). */
(function (global) {
  function normalizeKey(t) {
    let k = String(t || "")
      .toLowerCase()
      .replace(/[!.,:;()]+$/g, "")
      .replace(/^adorbs!$/i, "adorbs")
      .replace(/^adorb$/i, "adorbs")
      .trim();
    if (/^le\s*-?\s*\d+$/.test(k) || /^le\d+$/.test(k)) return "le";
    return k;
  }

  function isLeKey(key) {
    return key === "le";
  }

  function tokenize(title) {
    const raw = String(title || "").trim();
    if (!raw) return [];
    const parts = [];
    const re = /LE\s*[-]?\s*\d+|[A-Za-z0-9][A-Za-z0-9'’.\-]*[!]?|[^\s]/gi;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const text = m[0].trim();
      if (!text) continue;
      if (/^[\-–—•|/]+$/.test(text)) continue;
      parts.push({ text, key: normalizeKey(text) });
    }
    const out = [];
    for (const p of parts) {
      if (out.length && out[out.length - 1].key === p.key) continue;
      out.push({
        id: `${out.length}_${p.key}`,
        text: p.text,
        key: p.key,
        state: "off",
        desc_only: false,
      });
    }
    return out;
  }

  function markPhraseTokens(tokens, phrases) {
    const keys = tokens.map((t) => t.key);
    for (const phrase of phrases || []) {
      const pwords = phrase.split(/\s+/).map(normalizeKey).filter(Boolean);
      if (!pwords.length) continue;
      for (let i = 0; i <= keys.length - pwords.length; i++) {
        let match = true;
        for (let j = 0; j < pwords.length; j++) {
          if (keys[i + j] !== pwords[j]) {
            match = false;
            break;
          }
        }
        if (!match) continue;
        for (let j = 0; j < pwords.length; j++) {
          tokens[i + j].state = "never";
          tokens[i + j].desc_only = true;
        }
      }
    }
  }

  function markMoviePhraseTokens(tokens, rules) {
    markPhraseTokens(tokens, rules.movie_phrases || []);
  }

  function markExpansionPhraseTokens(tokens, rules) {
    // Spelled-out acronym expansions (Walt Disney Imagineering, Studio Store Hollywood, …)
    markPhraseTokens(tokens, rules.expansion_phrases || []);
  }

  function applyConditionalDrops(tokens, rules) {
    const drops = rules.conditional_drops || [];
    if (!drops.length) return;
    const present = new Set(tokens.map((t) => t.key));
    for (const rule of drops) {
      const dropKey = normalizeKey(rule.drop);
      const triggers = (rule.if_any || []).map(normalizeKey);
      if (!triggers.some((t) => present.has(t))) continue;
      for (const tok of tokens) {
        if (tok.key === dropKey && tok.state !== "never") {
          tok.state = "never";
          tok.desc_only = true;
        }
      }
    }
  }

  /** Prefer aDorbs! / Adorbs over adorb when collapsing duplicates. */
  function preferredTokenForKey(candidates) {
    if (!candidates.length) return null;
    const score = (t) => {
      const x = String(t.text || "");
      if (/^a?dorbs!$/i.test(x)) return 4;
      if (/^a?dorbs$/i.test(x)) return 3;
      if (/^adorb$/i.test(x)) return 1;
      return 2 + Math.min(x.length, 20) / 100;
    };
    return candidates.slice().sort((a, b) => score(b) - score(a))[0];
  }

  function seedSuggestion(tokens, rules) {
    const never = new Set((rules.never_words || []).map(normalizeKey));
    const stop = new Set((rules.stop_words || []).map(normalizeKey));
    const makers = new Set((rules.makers || []).map(normalizeKey));
    const setHints = new Set((rules.set_hints || []).map(normalizeKey));

    markMoviePhraseTokens(tokens, rules);
    markExpansionPhraseTokens(tokens, rules);
    applyConditionalDrops(tokens, rules);

    const makerToks = [];
    const setToks = [];
    const leToks = [];
    const charToks = [];

    for (const tok of tokens) {
      const k = tok.key;
      if (tok.state === "never" && tok.desc_only) continue;
      if (never.has(k) || tok.state === "never") {
        tok.state = "never";
        continue;
      }
      if (isLeKey(k)) {
        leToks.push(tok);
        continue;
      }
      if (makers.has(k)) {
        makerToks.push(tok);
        continue;
      }
      if (setHints.has(k) || k === "adorbs") {
        setToks.push(tok);
        continue;
      }
      if (stop.has(k)) {
        tok.state = "off";
        continue;
      }
      charToks.push(tok);
    }

    // One normalized word once — repeating it does not help search.
    const ordered = [];
    const chosenByKey = new Map();
    for (const group of [charToks, makerToks, setToks, leToks]) {
      const byKey = new Map();
      for (const t of group) {
        if (!byKey.has(t.key)) byKey.set(t.key, []);
        byKey.get(t.key).push(t);
      }
      for (const [key, cands] of byKey) {
        if (chosenByKey.has(key)) continue;
        const pick = preferredTokenForKey(cands);
        chosenByKey.set(key, pick);
        if (pick.state !== "never") pick.state = "on";
        ordered.push(pick);
      }
    }

    // Extra occurrences of the same word → title-off
    for (const tok of tokens) {
      const chosen = chosenByKey.get(tok.key);
      if (chosen && tok.id !== chosen.id && tok.state !== "never") {
        tok.state = "never";
      }
    }

    return ordered.map((t) => t.id);
  }

  function guessSlots(includedTokens, rules) {
    const makers = new Set((rules.makers || []).map(normalizeKey));
    const setHints = new Set((rules.set_hints || []).map(normalizeKey));
    const character = [];
    const manufacturer = [];
    const set = [];
    for (const t of includedTokens) {
      const k = t.key;
      if (makers.has(k)) manufacturer.push(t.text);
      else if (setHints.has(k) || isLeKey(k)) set.push(t.text);
      else character.push(t.text);
    }
    return {
      character: character.join(" ") || "—",
      manufacturer: manufacturer.join(" ") || "—",
      set: set.join(" ") || "—",
    };
  }

  function displayText(token, rules) {
    const key = token.key;
    if (key === "adorbs") {
      return (rules && rules.adorbs_canonical) || "Adorbs";
    }
    if (isLeKey(key)) {
      return (rules && rules.le_in_title) || "LE";
    }
    let text = String(token.text || "");
    const strip = !rules || rules.strip_punctuation !== false;
    if (strip) {
      text = text.replace(/[!?,.;:()\"“”‘’]/g, "");
      text = text.replace(/\.(?=\s|$)/g, "");
    }
    return text.replace(/\s+/g, " ").trim();
  }

  const EDITION_NUMBERS = new Set(["100", "200", "250", "300", "400", "500", "600"]);

  function sanitizeCleanedTitle(ct, rules) {
    const words = String(ct || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const out = [];
    let seenLe = false;
    for (const w of words) {
      const k = normalizeKey(w);
      if (k === "chaser") continue;
      if (EDITION_NUMBERS.has(k)) continue;
      if (isLeKey(k)) {
        if (!seenLe) {
          out.push((rules && rules.le_in_title) || "LE");
          seenLe = true;
        }
        continue;
      }
      if (k === "adorbs" || k === "adorb") {
        out.push((rules && rules.adorbs_canonical) || "Adorbs");
        continue;
      }
      let text = w.replace(/[!?,.;:()\"“”‘’]/g, "");
      if (/^adorbs!?$/i.test(text)) text = (rules && rules.adorbs_canonical) || "Adorbs";
      if (/^adorb$/i.test(text)) text = (rules && rules.adorbs_canonical) || "Adorbs";
      out.push(text);
    }
    return out.join(" ").replace(/\s+/g, " ").trim();
  }

  function titleNeedsSanitize(cleaned) {
    const ct = String(cleaned || "");
    if (!ct) return false;
    if (/\bchaser\b/i.test(ct)) return true;
    if (/\bLE\s*\d+|\bLE\d+/i.test(ct)) return true;
    if (/\b(100|200|250|300|400|500|600)\b/.test(ct)) return true;
    return false;
  }

  function titleFromOrder(tokens, orderIds, rules) {
    const byId = Object.fromEntries(tokens.map((t) => [t.id, t]));
    const seenKeys = new Set();
    const parts = [];
    for (const id of orderIds) {
      const t = byId[id];
      if (!t) continue;
      if (seenKeys.has(t.key)) continue;
      seenKeys.add(t.key);
      const piece = displayText(t, rules || {});
      if (piece) parts.push(piece);
    }
    return sanitizeCleanedTitle(parts.join(" ").replace(/\s+/g, " ").trim(), rules);
  }

  function descriptionOnlyWords(tokens) {
    return tokens.filter((t) => t.desc_only && t.state === "never").map((t) => t.text);
  }

  function descriptionPreview(label, rules) {
    const parts = [];
    const descOnly = descriptionOnlyWords(label.tokens || []);
    if (descOnly.length) parts.push(descOnly.join(" "));
    const title = String(label.cleaned_title || titleFromOrder(label.tokens || [], label.include_order || [], rules) || "");
    if (/\bLE\b/i.test(title)) parts.push("Limited Edition");
    return parts.filter(Boolean).join(" · ");
  }

  global.TitleSeed = {
    normalizeKey,
    tokenize,
    markMoviePhraseTokens,
    markExpansionPhraseTokens,
    seedSuggestion,
    guessSlots,
    titleFromOrder,
    displayText,
    descriptionOnlyWords,
    descriptionPreview,
    sanitizeCleanedTitle,
    titleNeedsSanitize,
    isLeKey,
  };
})(typeof window !== "undefined" ? window : globalThis);
