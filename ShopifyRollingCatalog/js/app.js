/* Fins & Pins rolling catalog — Shopping Board + Buy Now + Virtual Pin Board
   Tap = add/remove Shopping Board. Drawer: Buy all / Virtual board / Clear.
   Click capture: claims/rolling_sandbox (sandbox show slug, NOT a real YYYYMMDD show)
   + catalogInterest/rolling_sandbox + shopifyBuyNowTaps/rolling_catalog.
*/
(function () {
  const CATALOG_KEY = "fp_rolling_catalog_v2";
  const TRAY_KEY = `${CATALOG_KEY}_tray`;
  const GUEST_KEY = `${CATALOG_KEY}_guest`;
  const SHOPIFY_CART_ID_KEY = `${CATALOG_KEY}_shopify_cart_id`;
  const INTEREST_KEY = `${CATALOG_KEY}_interest`;
  const FB_INTEREST_ROOT = "catalogInterest/rolling_sandbox";
  const FB_TAP_ROOT = "shopifyBuyNowTaps/rolling_catalog";
  /** Sandbox claims bucket — same shape as CTR claims/{show}/… but never a live show date. */
  const FB_CLAIMS_SHOW = "rolling_sandbox";
  const VB_MAX_PER_PAGE = 24;

  let db = null;
  let showDefs = [];
  let mappingByPinKey = {};
  let allPins = [];
  let tray = loadTray();
  let interest = loadInterest();
  const guestId = ensureGuestId();
  const identityKey = ensureIdentity();
  let displayName = loadDisplayName();
  const cfg = () => window.FP_SHOPIFY_CONFIG || {};
  let searchHits = [];
  let searchFocus = 0;
  let vbRunning = false;
  let vbCancel = false;

  const $ = (id) => document.getElementById(id);

  function sanitizeUserKey(id) {
    return String(id || "").replace(/[.#$\[\]\/]/g, "_");
  }

  function normalizeUserDisplayName(raw) {
    if (raw == null || raw === "") return "";
    const s = String(raw).trim();
    if (/^Guest_/i.test(s)) return s;
    const inner = s.replace(/^@+/, "").trim();
    if (!inner) return s;
    return "@" + inner.toLowerCase();
  }

  function ensureIdentity() {
    let id = localStorage.getItem("fp_identity");
    if (!id) {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        id =
          "id_" +
          [...crypto.getRandomValues(new Uint8Array(12))]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
      } else {
        id = "id_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      }
      localStorage.setItem("fp_identity", id);
    }
    return id;
  }

  function loadDisplayName() {
    let name = localStorage.getItem("fp_display_name") || "";
    if (!name && localStorage.getItem("fp_username")) {
      name = localStorage.getItem("fp_username");
      localStorage.setItem("fp_display_name", name);
    }
    if (name) {
      const n = normalizeUserDisplayName(name);
      if (n !== name) {
        name = n;
        localStorage.setItem("fp_display_name", name);
      }
    }
    return name;
  }

  function ensureGuestId() {
    let id = localStorage.getItem(GUEST_KEY);
    if (!id) {
      id =
        (crypto.randomUUID && crypto.randomUUID()) ||
        `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(GUEST_KEY, id);
    }
    return id;
  }

  /** Cross-show unique pin id under claims/rolling_sandbox (avoids IMG_ collisions). */
  function claimsPinKey(pin) {
    const showId = (pin && pin.showId) || "unknown";
    const pinKey = (pin && pin.pinKey) || (pin && pin.catalogKey) || "pin";
    return sanitizeUserKey(`${showId}__${pinKey}`);
  }

  function requireDisplayName() {
    if (displayName) return true;
    const overlay = $("loginOverlay");
    if (overlay) overlay.style.display = "flex";
    toast("Enter your Whatnot or Instagram username first");
    return false;
  }

  function saveUsername() {
    const raw = (($("usernameInput") && $("usernameInput").value) || "").trim();
    if (!raw) {
      displayName = "Guest_" + Math.random().toString(36).substring(2, 6).toUpperCase();
    } else {
      displayName = normalizeUserDisplayName("@" + raw.replace(/^@+/, "").trim());
    }
    localStorage.setItem("fp_display_name", displayName);
    localStorage.removeItem("fp_username");
    const overlay = $("loginOverlay");
    if (overlay) overlay.style.display = "none";
    if ($("guestLabel")) $("guestLabel").textContent = displayName;
    if (db && tray.length) {
      tray.forEach((p) => writeInterest(p, { status: "tray", channel: "tray" }));
    }
    toast(`Signed in as ${displayName}`);
  }

  function writeClaim(pin, active) {
    if (!db || !pin) return;
    const userKey = sanitizeUserKey(identityKey);
    if (!userKey) return;
    const ref = db.ref(`claims/${FB_CLAIMS_SHOW}/${claimsPinKey(pin)}/${userKey}`);
    if (!active) {
      ref.set(null);
      return;
    }
    ref.set({
      time: firebase.database.ServerValue.TIMESTAMP,
      label: displayName || guestId,
      showId: pin.showId || null,
      pinKey: pin.pinKey || null,
      catalogKey: pin.catalogKey || null,
      crop_stem: pin.crop_stem || pin.sku || null
    });
  }

  function loadTray() {
    try {
      return JSON.parse(localStorage.getItem(TRAY_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function loadInterest() {
    try {
      return JSON.parse(localStorage.getItem(INTEREST_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveTray() {
    localStorage.setItem(TRAY_KEY, JSON.stringify(tray));
    renderTray();
    syncPinClasses();
    updateStats();
  }

  function saveInterest() {
    localStorage.setItem(INTEREST_KEY, JSON.stringify(interest));
    updateStats();
  }

  function toast(msg) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function shopifyLive() {
    const c = cfg();
    return !!(c.enabled && c.shopDomain && c.storefrontAccessToken && !c.forceMock);
  }

  function modeLabel() {
    return shopifyLive() ? "Shopify live cart" : "Mock cart (no Shopify token yet)";
  }

  function formatPrice(n) {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return "$?";
    return v % 1 === 0 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`;
  }

  /** Prefer mapping imageSrc; else common PreparingInventory crop URL from crop_stem. */
  function cropImageSrc(pin) {
    const direct = (pin && pin.imageSrc) || "";
    if (direct) return direct;
    const stem = (pin && (pin.crop_stem || pin.sku)) || "";
    if (!stem) return "";
    // Same show family as 20261106 priced crops (works for unpriced stems in that collection).
    if (/^img1[89]\d{2}_pin\d+$/i.test(stem) || /^img20\d{2}_pin\d+$/i.test(stem)) {
      return `https://raw.githubusercontent.com/FinsAndPins/PreparingInventory/main/PriceCollection_20261103_1408/crops/${stem}.jpg`;
    }
    return "";
  }

  function resolvePinPrice(pin) {
    const v = Number(pin && pin.priceUsd);
    return isFinite(v) && v > 0 ? v : 0;
  }

  /** No Whatnot/Shopify row (already sold or never listed) → not tappable. */
  function isSoldPin(pin) {
    if (!pin) return true;
    if (pin.status === "no_whatnot_price" || pin.status === "sold") return true;
    if (!resolvePinPrice(pin)) return true;
    if (!pin.shopifyVariantGid) return true;
    return false;
  }

  /** Refresh tray rows from live mapping (fixes stale $1 / blank thumbs after hard refresh). */
  function rehydrateTrayFromMapping() {
    let changed = false;
    const nextTray = [];
    tray.forEach((item) => {
      const live = mappingByPinKey[item.catalogKey] || item;
      if (isSoldPin(live)) {
        changed = true;
        return;
      }
      const next = {
        ...item,
        priceUsd: resolvePinPrice(live) || resolvePinPrice(item),
        imageSrc: cropImageSrc(live) || cropImageSrc(item) || item.imageSrc || "",
        shopifyVariantGid: live.shopifyVariantGid || item.shopifyVariantGid || null,
        listing_title: live.listing_title || item.listing_title || "",
        crop_stem: live.crop_stem || item.crop_stem,
        sku: live.sku || item.sku
      };
      if (
        next.priceUsd !== item.priceUsd ||
        next.imageSrc !== item.imageSrc ||
        next.shopifyVariantGid !== item.shopifyVariantGid
      ) {
        changed = true;
      }
      nextTray.push(next);
    });
    if (nextTray.length !== tray.length) changed = true;
    tray = nextTray;
    if (changed) localStorage.setItem(TRAY_KEY, JSON.stringify(tray));
  }

  function catalogPinKey(showId, pinKey) {
    return `${showId}::${pinKey}`;
  }

  function shortTitle(pin) {
    const t = pin.listing_title || pin.title || pin.sku || pin.crop_stem || "Pin";
    return String(t).split(" Requested")[0].split(" Board")[0];
  }

  async function shopifyGraphql(query, variables) {
    const c = cfg();
    const url = `https://${c.shopDomain}/api/${c.apiVersion || "2025-10"}/graphql.json`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": c.storefrontAccessToken
      },
      body: JSON.stringify({ query, variables })
    });
    const json = await res.json();
    if (!res.ok || json.errors) {
      throw new Error(
        (json.errors && json.errors[0] && json.errors[0].message) || `Shopify HTTP ${res.status}`
      );
    }
    return json.data;
  }

  async function ensureShopifyCart() {
    let cartId = sessionStorage.getItem(SHOPIFY_CART_ID_KEY);
    if (cartId) return cartId;
    const data = await shopifyGraphql(
      `mutation cartCreate($input: CartInput!) {
        cartCreate(input: $input) {
          cart { id checkoutUrl }
          userErrors { message }
        }
      }`,
      { input: {} }
    );
    const payload = data.cartCreate;
    if (payload.userErrors && payload.userErrors.length) {
      throw new Error(payload.userErrors.map((e) => e.message).join("; "));
    }
    cartId = payload.cart.id;
    sessionStorage.setItem(SHOPIFY_CART_ID_KEY, cartId);
    return cartId;
  }

  async function addShopifyLine(variantGid) {
    const cartId = await ensureShopifyCart();
    const data = await shopifyGraphql(
      `mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cartId, lines: $lines) {
          cart { id checkoutUrl totalQuantity }
          userErrors { message }
        }
      }`,
      { cartId, lines: [{ quantity: 1, merchandiseId: variantGid }] }
    );
    const payload = data.cartLinesAdd;
    if (payload.userErrors && payload.userErrors.length) {
      throw new Error(payload.userErrors.map((e) => e.message).join("; "));
    }
    return payload.cart;
  }

  async function fetchCheckoutUrl() {
    const cartId = sessionStorage.getItem(SHOPIFY_CART_ID_KEY);
    if (!cartId) throw new Error("No Shopify cart yet");
    const data = await shopifyGraphql(`query ($id: ID!) { cart(id: $id) { checkoutUrl } }`, {
      id: cartId
    });
    return data.cart && data.cart.checkoutUrl;
  }

  function writeInterest(pin, patch) {
    const key = pin.catalogKey;
    const prev = interest[key] || {};
    const next = {
      catalogKey: key,
      showId: pin.showId,
      pinKey: pin.pinKey,
      crop_stem: pin.crop_stem,
      sku: pin.sku,
      boardStem: pin.boardStem,
      guestId,
      identityKey,
      channel: "tray",
      status: "tray",
      ...prev,
      ...patch,
      label: displayName || prev.label || guestId,
      updatedAt: Date.now()
    };
    if (!next.createdAt) next.createdAt = Date.now();
    interest[key] = next;
    saveInterest();

    const status = String(next.status || "");
    const activeClaim =
      status === "tray" || status === "buy_now" || status === "requested";
    writeClaim(pin, activeClaim);

    if (db) {
      const userKey = sanitizeUserKey(identityKey);
      const payload = {
        ...next,
        time: firebase.database.ServerValue.TIMESTAMP
      };
      db.ref(`${FB_INTEREST_ROOT}/${pin.showId}/${pin.pinKey}/${userKey}`).set(payload);
      db.ref(`${FB_TAP_ROOT}/${sanitizeUserKey(key)}/${userKey}`).set(payload);
    }
  }

  function updateStats() {
    if ($("statTray")) $("statTray").textContent = String(tray.length);
    if ($("statTrayBar")) $("statTrayBar").textContent = String(tray.length);
    if ($("statMode")) $("statMode").textContent = modeLabel();
    if ($("guestLabel")) {
      $("guestLabel").textContent = displayName || `@${guestId.slice(0, 8)}`;
    }
    if ($("statMapped")) $("statMapped").textContent = String(allPins.length);
    if ($("statVariants")) {
      $("statVariants").textContent = String(allPins.filter((p) => p.shopifyVariantGid).length);
    }
    if ($("statShows")) $("statShows").textContent = String(showDefs.length);
  }

  function syncPinClasses() {
    document.querySelectorAll(".pin").forEach((el) => {
      const key = el.dataset.catalogKey;
      const item = tray.find((t) => t.catalogKey === key);
      el.classList.toggle("in-tray", !!item);
      el.classList.remove("mark-buy");
    });
  }

  function renderTray() {
    const list = $("trayList");
    if (!list) return;
    list.innerHTML = "";
    if (!tray.length) {
      list.innerHTML = `<p class="muted">Shopping Board is empty. Tap pins on the boards to add them.</p>`;
    } else {
      tray.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "tray-row";
        row.dataset.catalogKey = item.catalogKey;
        const src = cropImageSrc(item);
        const img = src
          ? `<img src="${src}" alt="" loading="lazy" crossorigin="anonymous">`
          : `<div class="tray-thumb-missing" aria-hidden="true"></div>`;
        const label = shortTitle(item) || "Pin";
        row.innerHTML = `
          ${img}
          <div class="tray-meta">
            <strong>You'll receive the pin in the photo</strong>
            <div class="muted">${label}</div>
            <div class="muted">${item.showId || ""} · ${formatPrice(resolvePinPrice(item))}</div>
          </div>
          <button type="button" class="remove" data-remove="${i}">Remove</button>`;
        list.appendChild(row);
      });
    }
    list.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const item = tray[Number(btn.dataset.remove)];
        if (item) writeInterest(item, { status: "removed_from_tray", channel: "tray" });
        tray.splice(Number(btn.dataset.remove), 1);
        saveTray();
        toast("Removed from Shopping Board");
      };
    });
    const vbBtn = $("btnVirtualBoard");
    if (vbBtn) vbBtn.disabled = !tray.length;
    const buyBtn = $("btnBuyAll");
    if (buyBtn) buyBtn.disabled = !tray.length;
    updateStats();
  }

  function handlePinClick(pin, pinEl) {
    if (!requireDisplayName()) return;
    const existing = tray.findIndex((t) => t.catalogKey === pin.catalogKey);

    if (existing >= 0) {
      writeInterest(pin, { status: "removed_from_tray", channel: "tray" });
      tray.splice(existing, 1);
      saveTray();
      toast("Removed from Shopping Board");
      return;
    }

    addToTray(pin);
    toast("Added to Shopping Board");
  }

  function addToTray(pin) {
    if (!requireDisplayName()) return;
    if (isSoldPin(pin)) {
      toast("That pin is sold");
      return;
    }
    const priceUsd = resolvePinPrice(pin);
    const imageSrc = cropImageSrc(pin);
    const line = {
      catalogKey: pin.catalogKey,
      showId: pin.showId,
      pinKey: pin.pinKey,
      crop_stem: pin.crop_stem,
      sku: pin.sku,
      priceUsd,
      shopifyVariantGid: pin.shopifyVariantGid || null,
      boardStem: pin.boardStem,
      imageSrc,
      listing_title: pin.listing_title || ""
    };
    tray.push(line);
    writeInterest(pin, {
      status: "tray",
      channel: "tray",
      listing_title: shortTitle(pin)
    });
    saveTray();
  }

  async function buyPins(pins, checkoutTab) {
    if (!pins.length) {
      toast("No Buy Now pins selected");
      if (checkoutTab && !checkoutTab.closed) checkoutTab.close();
      return;
    }
    const linked = pins.filter((p) => p.shopifyVariantGid);
    const unlinked = pins.filter((p) => !p.shopifyVariantGid);
    if (!linked.length) {
      toast(
        shopifyLive()
          ? "These pins aren’t in Shopify yet. Try Show 20261019 (linked), or import this show’s CSV first."
          : "Shopify not connected (mock: would checkout)"
      );
      if (checkoutTab && !checkoutTab.closed) checkoutTab.close();
      if (!shopifyLive()) {
        linked.push(...pins);
      } else {
        return;
      }
    }

    pins.forEach((p) =>
      writeInterest(p, { status: "buy_now", channel: "buy_now", buyIntentAt: Date.now() })
    );

    if (!shopifyLive()) {
      toast(`Mock checkout for ${pins.length} pin(s)`);
      removePinsFromTray(pins.map((p) => p.catalogKey));
      if (checkoutTab && !checkoutTab.closed) checkoutTab.close();
      return;
    }

    try {
      sessionStorage.removeItem(SHOPIFY_CART_ID_KEY);
      for (const line of linked) {
        await addShopifyLine(line.shopifyVariantGid);
      }
      const url = await fetchCheckoutUrl();
      if (!url) throw new Error("No checkoutUrl from Shopify");
      if (unlinked.length) {
        toast(`${unlinked.length} pin(s) not linked; checking out ${linked.length}`);
      }
      removePinsFromTray(linked.map((p) => p.catalogKey));
      // Tab must be opened in the click handler (below). Assign URL after async Shopify work
      // so Safari does not treat it as a blocked popup and fall back to same-tab navigation.
      if (checkoutTab && !checkoutTab.closed) {
        checkoutTab.location.href = url;
        toast("Checkout opened in a new tab");
        $("trayDrawer").classList.add("open");
      } else {
        const w = window.open(url, "_blank");
        if (!w) {
          toast("Popup blocked. Allow popups for this site, then try again.");
        } else {
          toast("Checkout opened in a new tab");
          $("trayDrawer").classList.add("open");
        }
      }
    } catch (err) {
      console.error(err);
      if (checkoutTab && !checkoutTab.closed) checkoutTab.close();
      toast(`Checkout error: ${err.message}`);
    }
  }

  function openCheckoutTabForGesture() {
    if (!shopifyLive()) return null;
    const w = window.open("about:blank", "_blank");
    if (w) {
      try {
        w.document.write(
          "<!doctype html><title>Checkout</title><body style='font-family:sans-serif;padding:24px'>Preparing Shopify checkout…</body>"
        );
        w.document.close();
      } catch (_) {
        /* cross-origin / empty tab is fine */
      }
    }
    return w;
  }

  function removePinsFromTray(keys) {
    const set = new Set(keys);
    tray = tray.filter((t) => !set.has(t.catalogKey));
    saveTray();
  }

  function setupBoard(show, name, boardIndex, pinsForBoard, sectionEl) {
    const container = document.createElement("div");
    container.className = "board-container";
    container.dataset.showId = show.showId;
    container.dataset.board = name;
    container.innerHTML = `
      <div class="board-header">
        <span class="board-title">Board ${boardIndex + 1}</span>
      </div>
      <p class="board-count">${pinsForBoard.length} pins · ${name}</p>
      <div class="board-wrapper" id="wrapper-${show.showId}-${name}">
        <img class="board-img" id="img-${show.showId}-${name}" src="${show.boardsBase}/${name}.JPG" alt="${name}">
      </div>`;
    sectionEl.appendChild(container);

    const img = document.getElementById(`img-${show.showId}-${name}`);
    const render = async () => {
      const response = await fetch(`${show.boardsBase}/${name}.json`, { cache: "no-store" });
      const data = await response.json();
      const pins = data.predictions || [];
      const wrapper = document.getElementById(`wrapper-${show.showId}-${name}`);
      let ORIG_W = (data.image && data.image.width) || img.naturalWidth;
      let ORIG_H = (data.image && data.image.height) || img.naturalHeight;
      const rotated = (ORIG_W > ORIG_H) !== (img.clientWidth > img.clientHeight);
      const scale = img.clientWidth / (rotated ? ORIG_H : ORIG_W);
      pins.forEach((pin, idx) => {
        const pinKey = `${name}-${idx}`;
        const catalogKey = catalogPinKey(show.showId, pinKey);
        const meta = mappingByPinKey[catalogKey] || {
          showId: show.showId,
          pinKey,
          catalogKey,
          crop_stem: pin.crop_stem,
          sku: pin.crop_stem,
          boardStem: name,
          priceUsd: 0,
          search_text: `${show.showId} ${pin.crop_stem || ""}`.toLowerCase(),
          listing_title: pin.crop_stem || "",
          imageSrc: "",
          shopifyVariantGid: null
        };
        meta.catalogKey = catalogKey;
        meta.showId = show.showId;
        if (!meta.imageSrc) meta.imageSrc = cropImageSrc(meta);

        const div = document.createElement("div");
        div.className = "pin";
        div.id = `pin-${catalogKey}`;
        div.dataset.pinKey = pinKey;
        div.dataset.showId = show.showId;
        div.dataset.catalogKey = catalogKey;
        div.dataset.search =
          meta.search_text ||
          `${meta.listing_title || ""} ${meta.sku || ""} ${show.showId} ${show.label || ""}`.toLowerCase();
        div.style.left =
          ((rotated ? ORIG_H - pin.y : pin.x) - (rotated ? pin.height : pin.width) / 2) * scale + "px";
        div.style.top =
          ((rotated ? pin.x : pin.y) - (rotated ? pin.width : pin.height) / 2) * scale + "px";
        div.style.width = (rotated ? pin.height : pin.width) * scale + "px";
        div.style.height = (rotated ? pin.width : pin.height) * scale + "px";
        const sold = isSoldPin(meta);
        if (sold) {
          div.classList.add("sold");
          div.setAttribute("aria-label", "Sold");
          const stamp = document.createElement("span");
          stamp.className = "sold-stamp";
          stamp.textContent = "Sold";
          div.appendChild(stamp);
        } else {
          if (tray.some((c) => c.catalogKey === catalogKey)) div.classList.add("in-tray");
          div.onclick = (e) => {
            e.preventDefault();
            handlePinClick(meta, div);
          };
          const price = document.createElement("span");
          price.className = "price-badge";
          price.textContent = formatPrice(meta.priceUsd);
          div.appendChild(price);
        }
        wrapper.appendChild(div);
      });
      applySearch($("pinSearchInput") ? $("pinSearchInput").value : "");
    };
    if (img.complete && img.naturalWidth) render();
    else img.onload = render;
    img.onerror = () => {
      if (!img.dataset.triedJpg) {
        img.dataset.triedJpg = "1";
        img.src = `${show.boardsBase}/${name}.jpg`;
      }
    };
  }

  async function renderShow(show) {
    const root = $("catalogRoot");
    const section = document.createElement("section");
    section.className = "show-section";
    section.dataset.showId = show.showId;
    section.id = `show-${show.showId}`;

    const mapRes = await fetch(show.mappingPath, { cache: "no-store" });
    const mapping = await mapRes.json();
    const pins = mapping.pins || [];
    pins.forEach((p) => {
      const catalogKey = catalogPinKey(show.showId, p.pinKey);
      p.showId = show.showId;
      p.catalogKey = catalogKey;
      if (!p.search_text) {
        p.search_text =
          `${p.listing_title || ""} ${p.sku || ""} ${p.pinKey || ""} ${show.showId} ${show.label || ""}`.toLowerCase();
      } else if (!String(p.search_text).includes(show.showId)) {
        p.search_text = `${p.search_text} ${show.showId} ${show.label || ""}`.toLowerCase();
      }
      mappingByPinKey[catalogKey] = p;
      allPins.push(p);
    });

    const linked = pins.filter((p) => p.shopifyVariantGid).length;
    section.innerHTML = `
      <div class="show-header">
        <h2>${show.label || `Show ${show.showId}`}</h2>
        <div class="show-meta">${pins.length} pins · ${linked} Shopify-linked · ${show.status || "live"}</div>
      </div>`;
    root.appendChild(section);

    const manifest = await (await fetch(`${show.boardsBase}/manifest.json`, { cache: "no-store" })).json();
    let boards = Array.isArray(manifest) ? manifest : manifest.boards || [];
    if (show.boardLimit) boards = boards.slice(0, show.boardLimit);
    boards.forEach((name, i) => {
      const pinsForBoard = pins.filter((p) => p.boardStem === name);
      setupBoard(show, name, i, pinsForBoard, section);
    });
  }

  function applySearch(raw) {
    const q = String(raw || "")
      .trim()
      .toLowerCase();
    const pins = Array.from(document.querySelectorAll(".pin"));
    const boards = Array.from(document.querySelectorAll(".board-container"));
    const sections = Array.from(document.querySelectorAll(".show-section"));
    searchHits = [];
    if ($("pinSearchClear")) $("pinSearchClear").hidden = !q;

    if (!q) {
      pins.forEach((el) => {
        el.classList.remove("pin-search-dim", "pin-search-hit", "pin-search-current");
      });
      boards.forEach((b) => b.classList.remove("search-hide"));
      sections.forEach((s) => s.classList.remove("search-hide"));
      $("pinSearchStatus").textContent = "";
      $("pinSearchNav").hidden = true;
      return;
    }

    pins.forEach((el) => {
      const hay = el.dataset.search || "";
      const hit = hay.includes(q);
      el.classList.toggle("pin-search-dim", !hit);
      el.classList.toggle("pin-search-hit", hit);
      el.classList.remove("pin-search-current");
      if (hit) searchHits.push(el);
    });

    boards.forEach((board) => {
      board.classList.toggle("search-hide", !board.querySelector(".pin-search-hit"));
    });
    sections.forEach((section) => {
      section.classList.toggle("search-hide", !section.querySelector(".pin-search-hit"));
    });

    searchFocus = 0;
    $("pinSearchStatus").textContent = searchHits.length
      ? `${searchHits.length} pin${searchHits.length === 1 ? "" : "s"} match “${raw.trim()}”`
      : `No matches for “${raw.trim()}”`;
    $("pinSearchNav").hidden = searchHits.length < 2;
    if (searchHits.length) focusSearchHit(0, false);
  }

  function focusSearchHit(i, scroll) {
    if (!searchHits.length) return;
    searchFocus = ((i % searchHits.length) + searchHits.length) % searchHits.length;
    searchHits.forEach((el, idx) => el.classList.toggle("pin-search-current", idx === searchFocus));
    if (scroll !== false) {
      searchHits[searchFocus].scrollIntoView({ behavior: "smooth", block: "center" });
    }
    $("pinSearchStatus").textContent = `${searchFocus + 1} of ${searchHits.length} matches`;
  }

  function setupSearch() {
    const input = $("pinSearchInput");
    let t = null;
    input.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => applySearch(input.value), 120);
    };
    $("pinSearchClear").onclick = () => {
      input.value = "";
      applySearch("");
      input.focus();
    };
    $("pinSearchPrev").onclick = () => focusSearchHit(searchFocus - 1, true);
    $("pinSearchNext").onclick = () => focusSearchHit(searchFocus + 1, true);
  }

  async function initFirebaseBestEffort() {
    try {
      if (!window.firebase || !window.FP_FIREBASE_CONFIG) throw new Error("Firebase missing");
      if (!firebase.apps.length) firebase.initializeApp(window.FP_FIREBASE_CONFIG);
      db = firebase.database();
      const sync = $("syncStatus");
      if (sync) {
        sync.textContent = "Connected";
        sync.classList.add("sync-connected");
      }
      // Re-publish any pins already on the Shopping Board so sandbox claims stay current.
      if (displayName && tray.length) {
        tray.forEach((p) => writeInterest(p, { status: "tray", channel: "tray" }));
      }
    } catch (err) {
      console.warn(err);
      const sync = $("syncStatus");
      if (sync) {
        sync.textContent = "Local only";
        sync.classList.remove("sync-connected");
      }
    }
  }

  async function init() {
    updateStats();
    renderTray();
    setupSearch();

    const manifest = await (await fetch("./shows/manifest.json", { cache: "no-store" })).json();
    showDefs = manifest.shows || [];
    allPins = [];
    mappingByPinKey = {};

    for (const show of showDefs) {
      await renderShow(show);
    }

    rehydrateTrayFromMapping();
    renderTray();
    syncPinClasses();

    await initFirebaseBestEffort();
    updateStats();
    syncPinClasses();

    $("btnOpenTray").onclick = () => $("trayDrawer").classList.add("open");
    $("btnCloseTray").onclick = () => $("trayDrawer").classList.remove("open");
    $("btnClearTray").onclick = () => {
      tray.forEach((p) => writeInterest(p, { status: "removed_from_tray" }));
      tray = [];
      saveTray();
      toast("Shopping Board cleared");
    };
    $("btnBuyAll").onclick = () => {
      const tab = openCheckoutTabForGesture();
      buyPins(tray.slice(), tab).catch((e) => toast(e.message));
    };
    $("btnVirtualBoard").onclick = () => {
      runVirtualBoardExport().catch((e) => {
        console.error(e);
        toast(e.message || "Virtual board failed");
        closeVbOverlay();
      });
    };
    $("virtualBoardExportCancelBtn").onclick = () => {
      vbCancel = true;
      // During save wait, waitForVbSave polls vbCancel and finishes as aborted.
      // If export is not running, close immediately.
      if (!vbRunning) closeVbOverlay();
    };
    const loginBtn = $("btnSaveUsername");
    if (loginBtn) loginBtn.onclick = () => saveUsername();
    const usernameInput = $("usernameInput");
    if (usernameInput) {
      usernameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveUsername();
        }
      });
    }
    if (displayName) {
      const overlay = $("loginOverlay");
      if (overlay) overlay.style.display = "none";
    } else {
      const overlay = $("loginOverlay");
      if (overlay) overlay.style.display = "flex";
    }
  }

  function loadCropImage(url) {
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error("No crop image"));
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load crop: ${url}`));
      img.src = url;
    });
  }

  function vbMulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildVirtualPageCanvas(images, pageSeed) {
    const n = images.length;
    const rand = vbMulberry32((pageSeed || 1) * 9973 + n * 131);
    const gap = 10;
    const maxDim = n <= 6 ? 240 : n <= 16 ? 200 : 168;
    const items = images.map((crop, i) => {
      const scale = Math.min(maxDim / crop.width, maxDim / crop.height) * (0.92 + rand() * 0.16);
      const dw = Math.max(1, crop.width * scale);
      const dh = Math.max(1, crop.height * scale);
      // Pins stay upright (same as CTR 20261117).
      const rot = 0;
      const c = Math.abs(Math.cos(rot));
      const s = Math.abs(Math.sin(rot));
      return { i, crop, dw, dh, rot, aw: dw * c + dh * s, ah: dw * s + dh * c };
    });
    items.sort((a, b) => b.aw * b.ah - a.aw * a.ah);

    function overlaps(cx, cy, aw, ah, placed) {
      const l = cx - aw / 2 - gap / 2;
      const r = cx + aw / 2 + gap / 2;
      const t = cy - ah / 2 - gap / 2;
      const b = cy + ah / 2 + gap / 2;
      return placed.some((p) => {
        const pl = p.cx - p.aw / 2 - gap / 2;
        const pr = p.cx + p.aw / 2 + gap / 2;
        const pt = p.cy - p.ah / 2 - gap / 2;
        const pb = p.cy + p.ah / 2 + gap / 2;
        return l < pr && r > pl && t < pb && b > pt;
      });
    }

    const placed = [];
    const startPad = 24;
    items.forEach((it, idx) => {
      let best = null;
      if (idx === 0) {
        best = { cx: startPad + it.aw / 2, cy: startPad + it.ah / 2 };
      } else {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        placed.forEach((p) => {
          minX = Math.min(minX, p.cx - p.aw / 2);
          minY = Math.min(minY, p.cy - p.ah / 2);
          maxX = Math.max(maxX, p.cx + p.aw / 2);
          maxY = Math.max(maxY, p.cy + p.ah / 2);
        });
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const candidates = [];
        placed.forEach((p) => {
          const ox = (rand() - 0.5) * 14;
          const oy = (rand() - 0.5) * 14;
          candidates.push(
            { cx: p.cx + (p.aw + it.aw) / 2 + gap + ox, cy: p.cy + oy },
            { cx: p.cx + ox, cy: p.cy + (p.ah + it.ah) / 2 + gap + oy },
            { cx: p.cx - (p.aw + it.aw) / 2 - gap + ox, cy: p.cy + oy },
            { cx: p.cx + ox, cy: p.cy - (p.ah + it.ah) / 2 - gap + oy }
          );
        });
        candidates.sort((a, b) => {
          const da = (a.cx - midX) ** 2 + (a.cy - midY) ** 2;
          const db = (b.cx - midX) ** 2 + (b.cy - midY) ** 2;
          return da - db;
        });
        for (const c of candidates) {
          if (c.cx - it.aw / 2 < 8 || c.cy - it.ah / 2 < 8) continue;
          if (!overlaps(c.cx, c.cy, it.aw, it.ah, placed)) {
            best = c;
            break;
          }
        }
        if (!best) {
          best = { cx: maxX + gap + it.aw / 2 + 4, cy: startPad + it.ah / 2 };
        }
      }
      placed.push({ ...it, cx: best.cx, cy: best.cy });
    });

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    placed.forEach((p) => {
      minX = Math.min(minX, p.cx - p.aw / 2);
      minY = Math.min(minY, p.cy - p.ah / 2);
      maxX = Math.max(maxX, p.cx + p.aw / 2);
      maxY = Math.max(maxY, p.cy + p.ah / 2);
    });
    const margin = 28;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(maxX - minX + margin * 2);
    canvas.height = Math.ceil(maxY - minY + margin * 2);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#c9b8d8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    placed.forEach((p) => {
      const x = p.cx - minX + margin;
      const y = p.cy - minY + margin;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.drawImage(p.crop, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
      ctx.restore();
    });
    return canvas;
  }

  function openVbOverlay() {
    const el = $("virtualBoardExportOverlay");
    if (el) el.classList.add("open");
  }

  function closeVbOverlay() {
    const el = $("virtualBoardExportOverlay");
    if (el) el.classList.remove("open");
    vbRunning = false;
    vbCancel = false;
    const preview = $("virtualBoardExportPreview");
    if (preview && preview.src && preview.src.startsWith("blob:")) {
      URL.revokeObjectURL(preview.src);
      preview.removeAttribute("src");
    }
    const wrap = $("virtualBoardExportPreviewWrap");
    const actions = $("virtualBoardExportSaveActions");
    if (wrap) wrap.classList.remove("show");
    if (actions) actions.classList.remove("show");
  }

  function setVbProgress(done, total, status) {
    const bar = $("virtualBoardExportBar");
    const st = $("virtualBoardExportStatus");
    const eta = $("virtualBoardExportEta");
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    if (bar) bar.style.width = `${pct}%`;
    if (st) st.textContent = status || "";
    if (eta) eta.textContent = `${pct}%`;
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality || 0.92);
    });
  }

  async function saveVbBlob(blob, filename) {
    const file = new File([blob], filename, { type: "image/jpeg" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      } catch (e) {
        if (e && e.name === "AbortError") return "aborted";
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return "download";
  }

  async function waitForVbSave(blob, filename, pageIndex, pageCount) {
    return new Promise((resolve) => {
      const previewUrl = URL.createObjectURL(blob);
      const preview = $("virtualBoardExportPreview");
      const wrap = $("virtualBoardExportPreviewWrap");
      const actions = $("virtualBoardExportSaveActions");
      const saveBtn = $("virtualBoardExportSaveBtn");
      const skipBtn = $("virtualBoardExportSkipBtn");
      const title = $("virtualBoardExportTitle");
      const st = $("virtualBoardExportStatus");
      const eta = $("virtualBoardExportEta");
      if (title) title.textContent = `Save photo ${pageIndex} of ${pageCount}`;
      if (st) st.textContent = `Ready: ${filename}`;
      if (eta) {
        eta.textContent =
          pageCount > 1
            ? "Save, Skip this photo, or Cancel to stop."
            : "Save to Photos, or Cancel to close.";
      }
      if (preview) preview.src = previewUrl;
      if (wrap) wrap.classList.add("show");
      if (actions) actions.classList.add("show");
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save to Photos";
      }
      if (skipBtn) {
        // One board: Skip just means "don't save"; Cancel closes. Hide Skip to avoid confusion.
        if (pageCount <= 1) {
          skipBtn.hidden = true;
          skipBtn.onclick = null;
        } else {
          skipBtn.hidden = false;
          skipBtn.textContent = "Skip this photo";
        }
      }

      let settled = false;
      const cleanup = () => {
        if (saveBtn) saveBtn.onclick = null;
        if (skipBtn) skipBtn.onclick = null;
        clearInterval(poll);
        URL.revokeObjectURL(previewUrl);
        if (preview) preview.removeAttribute("src");
        if (wrap) wrap.classList.remove("show");
        if (actions) actions.classList.remove("show");
      };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const poll = setInterval(() => {
        if (vbCancel) finish("aborted");
      }, 200);

      if (saveBtn) {
        saveBtn.onclick = async () => {
          if (vbCancel) return finish("aborted");
          saveBtn.disabled = true;
          const how = await saveVbBlob(blob, filename);
          if (how === "aborted") {
            saveBtn.disabled = false;
            if (st) st.textContent = "Save cancelled. Tap Save again, or Cancel.";
            return;
          }
          finish(how);
        };
      }
      if (skipBtn && pageCount > 1) skipBtn.onclick = () => finish("skipped");
    });
  }

  async function runVirtualBoardExport() {
    if (vbRunning) return;
    if (!tray.length) {
      toast("Add pins to your Shopping Board first");
      return;
    }
    vbRunning = true;
    vbCancel = false;
    openVbOverlay();
    const title = $("virtualBoardExportTitle");
    if (title) title.textContent = "Building virtual pin board";
    setVbProgress(0, 1, "Gathering pins from your Shopping Board…");

    const pins = tray.slice();
    const pagesNeeded = Math.max(1, Math.ceil(pins.length / VB_MAX_PER_PAGE));
    const totalUnits = pins.length + pagesNeeded;
    let done = 0;
    const crops = [];

    try {
      for (let i = 0; i < pins.length; i++) {
        if (vbCancel) throw new Error("cancelled");
        setVbProgress(done, totalUnits, `Loading pin ${i + 1} of ${pins.length}…`);
        const src = cropImageSrc(pins[i]);
        try {
          const img = await loadCropImage(src);
          crops.push(img);
        } catch (e) {
          console.warn(e);
        }
        done++;
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!crops.length) throw new Error("Could not load pin images for the virtual board");

      for (let page = 0; page < pagesNeeded; page++) {
        if (vbCancel) throw new Error("cancelled");
        const slice = crops.slice(page * VB_MAX_PER_PAGE, (page + 1) * VB_MAX_PER_PAGE);
        setVbProgress(done, totalUnits, `Composing board photo ${page + 1} of ${pagesNeeded}…`);
        const canvas = buildVirtualPageCanvas(slice, page + 1);
        const blob = await canvasToJpegBlob(canvas, 0.92);
        done++;
        setVbProgress(done, totalUnits, `Board photo ${page + 1} of ${pagesNeeded} ready`);
        const filename = `FinsAndPins-VirtualBoard-${page + 1}of${pagesNeeded}.jpg`;
        const result = await waitForVbSave(blob, filename, page + 1, pagesNeeded);
        if (result === "aborted" || vbCancel) throw new Error("cancelled");
      }
      toast("Virtual pin board ready");
      closeVbOverlay();
    } catch (e) {
      if (String(e.message || e) === "cancelled") {
        toast("Virtual board cancelled");
        closeVbOverlay();
        return;
      }
      throw e;
    } finally {
      vbRunning = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => {
      console.error(err);
      toast(`Init failed: ${err.message}`);
    });
  });
})();
