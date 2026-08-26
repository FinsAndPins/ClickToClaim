/** Shared title tokenization + seed suggestion (loads rules from title_seed_rules.json). */
(function (global) {
  function normalizeKey(t) {
    return String(t || "")
      .toLowerCase()
      .replace(/[!.,:;()]+$/g, "")
      .replace(/^adorbs!$/i, "adorbs")
      .replace(/^adorb$/i, "adorbs")
      .trim();
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
      if (/^le\s*-?\s*\d+$/.test(k) || /^le\d+$/.test(k)) {
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

    const ordered = [];
    const seenKeys = new Set();
    for (const t of [...charToks, ...makerToks, ...setToks, ...leToks]) {
      if (seenKeys.has(t.key)) continue;
      seenKeys.add(t.key);
      if (t.state !== "never") t.state = "on";
      ordered.push(t);
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
      else if (setHints.has(k) || /^le\s*-?\s*\d+$/.test(k) || /^le\d+$/.test(k)) set.push(t.text);
      else character.push(t.text);
    }
    return {
      character: character.join(" ") || "—",
      manufacturer: manufacturer.join(" ") || "—",
      set: set.join(" ") || "—",
    };
  }

  function titleFromOrder(tokens, orderIds) {
    const byId = Object.fromEntries(tokens.map((t) => [t.id, t]));
    return orderIds
      .map((id) => byId[id]?.text)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function descriptionOnlyWords(tokens) {
    return tokens.filter((t) => t.desc_only || (t.state === "never" && t.desc_only)).map((t) => t.text);
  }

  global.TitleSeed = {
    normalizeKey,
    tokenize,
    markMoviePhraseTokens,
    seedSuggestion,
    guessSlots,
    titleFromOrder,
    descriptionOnlyWords,
  };
})(typeof window !== "undefined" ? window : globalThis);
