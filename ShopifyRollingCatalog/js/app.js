/* Fins & Pins rolling catalog — tray + three actions
   Tap = add/remove tray (CTR muscle memory). Tray: Buy all / Request all / Split.
   Isolation: catalogRequests/ + shopifyBuyNowTaps/ only (not production claims/).
*/
(function () {
  const CATALOG_KEY = "fp_rolling_catalog_v2";
  const TRAY_KEY = `${CATALOG_KEY}_tray`;
  const GUEST_KEY = `${CATALOG_KEY}_guest`;
  const SHOPIFY_CART_ID_KEY = `${CATALOG_KEY}_shopify_cart_id`;
  const INTEREST_KEY = `${CATALOG_KEY}_interest`;
  const FB_INTEREST_ROOT = "catalogInterest/rolling_sandbox";
  const FB_TAP_ROOT = "shopifyBuyNowTaps/rolling_catalog";

  let db = null;
  let showDefs = [];
  let mappingByPinKey = {};
  let allPins = [];
  let tray = loadTray();
  let interest = loadInterest();
  let splitMode = false;
  const guestId = ensureGuestId();
  const cfg = () => window.FP_SHOPIFY_CONFIG || {};
  let searchHits = [];
  let searchFocus = 0;

  const $ = (id) => document.getElementById(id);

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
      channel: "tray",
      status: "tray",
      ...prev,
      ...patch,
      updatedAt: Date.now()
    };
    if (!next.createdAt) next.createdAt = Date.now();
    interest[key] = next;
    saveInterest();

    if (db) {
      const payload = {
        ...next,
        time: firebase.database.ServerValue.TIMESTAMP
      };
      db.ref(`${FB_INTEREST_ROOT}/${pin.showId}/${pin.pinKey}/${guestId}`).set(payload);
      db.ref(`${FB_TAP_ROOT}/${key}/${guestId}`).set(payload);
    }
  }

  function updateStats() {
    if ($("statTray")) $("statTray").textContent = String(tray.length);
    if ($("statTrayBar")) $("statTrayBar").textContent = String(tray.length);
    if ($("statMode")) $("statMode").textContent = modeLabel();
    if ($("guestLabel")) $("guestLabel").textContent = `@${guestId.slice(0, 8)}`;
    if ($("statMapped")) $("statMapped").textContent = String(allPins.length);
    if ($("statVariants")) {
      $("statVariants").textContent = String(allPins.filter((p) => p.shopifyVariantGid).length);
    }
    if ($("statShows")) $("statShows").textContent = String(showDefs.length);
    const requested = Object.values(interest).filter((x) => x.status === "whatnot_request").length;
    if ($("statRequests")) $("statRequests").textContent = String(requested);
  }

  function syncPinClasses() {
    document.querySelectorAll(".pin").forEach((el) => {
      const key = el.dataset.catalogKey;
      const item = tray.find((t) => t.catalogKey === key);
      el.classList.toggle("in-tray", !!item);
      el.classList.toggle("mark-buy", !!(item && item.buyNow));
    });
  }

  function setSplitMode(on) {
    splitMode = !!on;
    document.body.classList.toggle("split-mode", splitMode);
    $("trayActionsNormal").hidden = splitMode;
    $("trayActionsSplit").hidden = !splitMode;
    if (splitMode) {
      $("trayHint").textContent =
        "Tap a pin below (or on the board) to mark Buy Now (blue). Unmarked = Request for Whatnot.";
      $("trayDrawer").classList.add("open");
    } else {
      $("trayHint").textContent = "You’ll receive the pin in the photo for anything you buy.";
      tray.forEach((t) => {
        t.buyNow = false;
      });
      saveTray();
    }
    renderTray();
  }

  function renderTray() {
    const list = $("trayList");
    if (!list) return;
    list.innerHTML = "";
    if (!tray.length) {
      list.innerHTML = `<p class="muted">Tray is empty. Tap pins on the boards to add them.</p>`;
    } else {
      tray.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "tray-row" + (item.buyNow ? " mark-buy" : "");
        row.dataset.catalogKey = item.catalogKey;
        const src = cropImageSrc(item);
        const img = src
          ? `<img src="${src}" alt="" loading="lazy">`
          : `<div class="tray-thumb-missing" aria-hidden="true"></div>`;
        const label = shortTitle(item) || "Pin";
        row.innerHTML = `
          ${img}
          <div class="tray-meta">
            <strong>You'll receive the pin in the photo</strong>
            <div class="muted">${label}</div>
            <div class="muted">${item.showId || ""} · ${formatPrice(resolvePinPrice(item))}</div>
            ${item.buyNow ? `<span class="buy-tag">Buy Now</span>` : splitMode ? `<span class="muted">Will request</span>` : ""}
          </div>
          <button type="button" class="remove" data-remove="${i}">Remove</button>`;
        if (splitMode) {
          row.onclick = (e) => {
            if (e.target.closest("[data-remove]")) return;
            toggleBuyMark(item.catalogKey);
          };
        }
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
        toast("Removed from tray");
      };
    });
    updateStats();
  }

  function toggleBuyMark(catalogKey) {
    const item = tray.find((t) => t.catalogKey === catalogKey);
    if (!item) return;
    item.buyNow = !item.buyNow;
    writeInterest(item, {
      status: "tray",
      channel: item.buyNow ? "buy_now_marked" : "whatnot_request_pending"
    });
    saveTray();
  }

  function handlePinClick(pin, pinEl) {
    const existing = tray.findIndex((t) => t.catalogKey === pin.catalogKey);

    if (splitMode) {
      if (existing < 0) {
        // In split mode, tapping a board pin not in tray adds it marked Buy Now
        addToTray(pin, { buyNow: true });
        toast("Marked Buy Now");
        return;
      }
      toggleBuyMark(pin.catalogKey);
      toast(tray[existing].buyNow ? "Marked Buy Now" : "Will request for Whatnot");
      return;
    }

    if (existing >= 0) {
      writeInterest(pin, { status: "removed_from_tray", channel: "tray" });
      tray.splice(existing, 1);
      saveTray();
      toast("Removed from tray");
      return;
    }

    addToTray(pin, { buyNow: false });
    toast("Added to tray");
  }

  function addToTray(pin, opts) {
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
      listing_title: pin.listing_title || "",
      buyNow: !!(opts && opts.buyNow)
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
      setSplitMode(false);
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

  function requestPins(pins) {
    if (!pins.length) {
      toast("No pins to request");
      return;
    }
    pins.forEach((p) =>
      writeInterest(p, { status: "whatnot_request", channel: "whatnot_request", requestedAt: Date.now() })
    );
    removePinsFromTray(pins.map((p) => p.catalogKey));
    toast(`Requested ${pins.length} pin(s) for Whatnot`);
    setSplitMode(false);
    $("trayDrawer").classList.add("open");
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
          const trayItem = tray.find((c) => c.catalogKey === catalogKey);
          if (trayItem && trayItem.buyNow) div.classList.add("mark-buy");
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
      toast("Tray cleared");
    };
    $("btnBuyAll").onclick = () => {
      const tab = openCheckoutTabForGesture();
      buyPins(tray.slice(), tab).catch((e) => toast(e.message));
    };
    $("btnRequestAll").onclick = () => requestPins(tray.slice());
    $("btnSplitMode").onclick = () => setSplitMode(true);
    $("btnCancelSplit").onclick = () => setSplitMode(false);
    $("btnCheckoutMarked").onclick = () => {
      const marked = tray.filter((t) => t.buyNow);
      const tab = openCheckoutTabForGesture();
      buyPins(marked, tab).catch((e) => toast(e.message));
    };
    $("btnFinishSplit").onclick = () => {
      const rest = tray.filter((t) => !t.buyNow);
      requestPins(rest);
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => {
      console.error(err);
      toast(`Init failed: ${err.message}`);
    });
  });
})();
