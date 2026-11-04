/* Shared behavior for the price-board review harness. */
(function () {
  const DB = "https://fins-and-pins-click-to-claim-default-rtdb.firebaseio.com/priceBoardReview/20261105/pins";
  const LOCAL_KEY = "priceBoardReview20261105";
  const NAME_KEY = "priceBoardReviewName";

  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.style.display = "none"; }, 1600);
  }

  function money(label) {
    if (label == null || label === "") return "";
    return String(label).startsWith("$") ? String(label) : "$" + label;
  }

  function userName() {
    return localStorage.getItem(NAME_KEY) || "";
  }

  function bindName() {
    const input = document.getElementById("user-name");
    if (!input) return;
    input.value = userName();
    input.addEventListener("change", () => localStorage.setItem(NAME_KEY, input.value.trim()));
  }

  function bindHam() {
    const ham = document.getElementById("ham-btn");
    const menu = document.getElementById("nav-menu");
    if (!ham || !menu) return;
    ham.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("open");
    });
    menu.addEventListener("click", (e) => {
      if (e.target === menu) menu.classList.remove("open");
    });
    bindName();
  }

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  function saveLocal(decisions) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(decisions));
  }

  async function hydrate() {
    const decisions = loadLocal();
    try {
      const resp = await fetch(DB + ".json");
      if (resp.ok) {
        const remote = (await resp.json()) || {};
        Object.keys(remote).forEach((key) => { decisions[key] = remote[key]; });
        saveLocal(decisions);
      }
    } catch (e) {
      toast("Could not load saved taps. This phone's copy is showing.");
    }
    return decisions;
  }

  async function writeDecision(decisions, pin, fields) {
    const prev = decisions[pin.id] ? Object.assign({}, decisions[pin.id]) : null;
    if (!fields) {
      delete decisions[pin.id];
      saveLocal(decisions);
      try { await fetch(DB + "/" + pin.id + ".json", { method: "DELETE" }); }
      catch (e) { toast("Save failed. Check the network."); }
      return prev;
    }
    const body = Object.assign({
      pin_key: pin.id,
      board: pin.board,
      pin_n: pin.pin_n,
      board_price: pin.price_label,
      agree: !!pin.agree,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userName()
    }, fields);
    decisions[pin.id] = body;
    saveLocal(decisions);
    try {
      const resp = await fetch(DB + "/" + pin.id + ".json", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!resp.ok) toast("Save failed (" + resp.status + ")");
    } catch (e) {
      toast("Save failed. Check the network.");
    }
    return prev;
  }

  function statusOf(decisions, pin) {
    const row = decisions[pin.id];
    return row && row.match_status ? row.match_status : "unreviewed";
  }

  function sortedPins(data) {
    return data.pins.slice().sort((a, b) => {
      if (a.agree !== b.agree) return a.agree ? -1 : 1;
      if (a.board !== b.board) return a.board < b.board ? -1 : 1;
      return a.pin_n - b.pin_n;
    });
  }

  function choiceFile(choice) {
    return choice.file;
  }

  function choiceCaption(choice) {
    const price = choice.ctr != null ? money(choice.ctr) : "";
    return (choice.show || "") + (price ? " · " + price : "");
  }

  bindHam();

  const page = document.body.dataset.page;
  const data = window.BOARD_REVIEW;
  if (!data || !page) return;

  hydrate().then((decisions) => {
    if (page === "ctm") startCtm(data, decisions);
    else if (page === "ctp") startCtp(data, decisions);
    else if (page === "contact") startContact(data, decisions);
    else if (page === "overlay") startOverlay(data, decisions);
  });

  function startCtm(data, decisions) {
    const pins = sortedPins(data);
    let idx = pins.findIndex((pin) => statusOf(decisions, pin) === "unreviewed");
    if (idx < 0) idx = 0;
    let selected = 0;
    const params = new URLSearchParams(location.search);
    if (params.get("pin")) {
      const at = pins.findIndex((pin) => pin.id === params.get("pin"));
      if (at >= 0) idx = at;
    }

    const cropImg = document.getElementById("crop-img");
    const choiceCol = document.getElementById("choice-col");
    const progress = document.getElementById("progress");
    const fill = document.getElementById("prog-fill");
    const done = document.getElementById("done-banner");

    function unreviewed(group) {
      return pins.filter((pin) => (group == null || pin.agree === group) && statusOf(decisions, pin) === "unreviewed");
    }

    function render() {
      const pin = pins[idx];
      const leftAgree = unreviewed(true).length;
      const leftSplit = unreviewed(false).length;
      const doneCount = pins.length - leftAgree - leftSplit;
      fill.style.width = Math.round((doneCount / pins.length) * 100) + "%";
      if (!pin || leftAgree + leftSplit === 0) {
        done.classList.add("show");
        progress.textContent = "Done";
        return;
      }
      done.classList.remove("show");
      const groupLeft = pin.agree ? leftAgree : leftSplit;
      const groupName = pin.agree ? "Agree" : "Two choices";
      progress.textContent = groupName + " · " + groupLeft + " left";
      cropImg.src = pin.our;
      cropImg.alt = pin.board + " pin " + pin.pin_n;
      selected = pin.agree ? 0 : -1;
      choiceCol.innerHTML = "";
      pin.options.forEach((choice, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "choice" + (pin.agree ? " sel" : "");
        btn.innerHTML =
          '<img alt="Old pin" src="' + choice.file + '">' +
          '<div class="choice-label">Old pin</div>' +
          '<div class="conf-badge ' + (pin.agree ? "agree" : "split") + '">' + (pin.agree ? "Agree" : (choice.by === "clip" ? "Clip" : "Dino")) + "</div>" +
          '<div class="price-badge">' + choiceCaption(choice) + "</div>";
        btn.addEventListener("click", () => {
          if (pin.agree) {
            commit("match", choice);
            return;
          }
          selected = i;
          Array.from(choiceCol.children).forEach((el, n) => el.classList.toggle("sel", n === i));
          commit("match", choice);
        });
        choiceCol.appendChild(btn);
      });
    }

    function commit(status, choice) {
      const pin = pins[idx];
      if (!pin) return;
      const fields = { match_status: status };
      if (status === "match" && choice) {
        fields.chosen_stem = choice.stem;
        fields.chosen_show = choice.show;
        fields.chosen_price = choice.ctr;
        fields.chosen_file = choice.file;
      }
      writeDecision(decisions, pin, fields);
      const next = pins.findIndex((row, n) => n > idx && statusOf(decisions, row) === "unreviewed");
      if (next >= 0) idx = next;
      else {
        const earlier = pins.findIndex((row) => statusOf(decisions, row) === "unreviewed");
        idx = earlier >= 0 ? earlier : idx;
      }
      if (unreviewed(null).length === 0) {
        render();
        done.classList.add("show");
        return;
      }
      render();
    }

    document.getElementById("btn-match").addEventListener("click", () => {
      const pin = pins[idx];
      if (!pin) return;
      if (selected < 0) {
        toast("Tap the pin that matches");
        return;
      }
      commit("match", pin.options[selected]);
    });
    document.getElementById("btn-nomatch").addEventListener("click", () => commit("no_match", null));
    document.getElementById("btn-notpin").addEventListener("click", () => commit("not_a_pin", null));
    document.getElementById("btn-skip").addEventListener("click", () => {
      const next = pins.findIndex((row, n) => n > idx && statusOf(decisions, row) === "unreviewed");
      if (next >= 0) idx = next;
      render();
    });
    document.getElementById("btn-back").addEventListener("click", () => {
      if (idx > 0) idx -= 1;
      const pin = new URLSearchParams(location.search).get("pin");
      if (pin) history.replaceState(null, "", "new_ctm.html");
      render();
    });
    render();
  }

  function startCtp(data, decisions) {
    const pins = sortedPins(data);
    const params = new URLSearchParams(location.search);
    let filter = params.get("filter") || "nomatch";
    if (params.get("pin")) filter = "all";
    if (filter === "no_match") filter = "nomatch";
    let list = [];
    let sel = 0;
    let undo = null;

    function passes(pin) {
      const st = statusOf(decisions, pin);
      if (filter === "nomatch") return st === "no_match";
      if (filter === "unrev") return st === "unreviewed";
      if (filter === "agree") return pin.agree;
      if (filter === "split") return !pin.agree;
      return true;
    }

    function apply(keepId) {
      list = pins.filter(passes);
      const wanted = keepId || params.get("pin");
      sel = 0;
      if (wanted) {
        const at = list.findIndex((pin) => pin.id === wanted);
        if (at >= 0) sel = at;
      }
      document.querySelectorAll(".filt-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.filter === filter);
        const count = pins.filter((pin) => {
          const st = statusOf(decisions, pin);
          if (btn.dataset.filter === "nomatch") return st === "no_match";
          if (btn.dataset.filter === "unrev") return st === "unreviewed";
          if (btn.dataset.filter === "agree") return pin.agree;
          if (btn.dataset.filter === "split") return !pin.agree;
          return true;
        }).length;
        const base = btn.dataset.label;
        btn.textContent = base + " " + count;
      });
      render();
    }

    function render() {
      const grid = document.getElementById("tile-grid");
      const empty = document.getElementById("empty");
      const title = document.getElementById("pd-title");
      const idx = document.getElementById("pd-idx");
      const undoBtn = document.getElementById("undo-btn");
      grid.innerHTML = "";
      if (!list.length) {
        empty.style.display = "block";
        empty.querySelector("p").textContent = filter === "nomatch"
          ? "No pins here yet. ClickToMatch puts a pin here when you tap No Match."
          : "Nothing in this filter.";
        title.textContent = "";
        idx.textContent = "";
        undoBtn.style.display = undo ? "inline" : "none";
        return;
      }
      empty.style.display = "none";
      const pin = list[sel];
      const decision = decisions[pin.id];
      const passNote = pin.second_pass ? " · new suggestions" : (pin.agree ? " · agree" : " · two choices");
      title.textContent = pin.board + " pin " + pin.pin_n + " · board " + money(pin.price_label) + passNote;
      idx.textContent = (sel + 1) + " / " + list.length;
      undoBtn.style.display = undo && undo.id === pin.id ? "inline" : "none";

      const mine = document.createElement("div");
      mine.className = "tile pin-tile";
      mine.innerHTML = '<img alt="Our pin" src="' + pin.our + '"><div class="tile-sn">My Pin</div><div class="tile-pbar"><span class="tile-price">' + money(pin.price_label) + '</span><span class="tile-note">ours</span></div>';
      grid.appendChild(mine);
      if (pin.second_pass && !(pin.alts || []).length) {
        const note = document.createElement("p");
        note.style.padding = "16px";
        note.style.color = "#aaa";
        note.textContent = "No unused old pin is left at this price.";
        grid.appendChild(note);
      }

      pin.alts.forEach((choice) => {
        const chosen = decision && decision.match_status === "match" && decision.chosen_stem === choice.stem && decision.chosen_show === choice.show;
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "tile" + (chosen ? " chosen" : "") + (choice.by === "both" ? " both" : "");
        tile.innerHTML =
          '<img alt="Old pin" src="' + choiceFile(choice) + '">' +
          '<div class="tile-sn">' + (choice.by === "both" ? "Both" : choice.by === "dino" ? "Dino" : "Clip") + "</div>" +
          '<div class="tile-pbar"><span class="tile-price">' + (choice.ctr != null ? money(choice.ctr) : "") + '</span><span class="tile-note">' + (choice.show || "") + "</span></div>";
        tile.addEventListener("click", async () => {
          const nextId = list[sel + 1] ? list[sel + 1].id : null;
          undo = { id: pin.id, prev: decisions[pin.id] ? Object.assign({}, decisions[pin.id]) : null };
          await writeDecision(decisions, pin, {
            match_status: "match",
            chosen_stem: choice.stem,
            chosen_show: choice.show,
            chosen_price: choice.ctr,
            chosen_file: choice.file
          });
          apply(nextId);
        });
        grid.appendChild(tile);
      });
    }

    document.querySelectorAll(".filt-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.dataset.filter;
        params.delete("pin");
        history.replaceState(null, "", "new_ctp.html?filter=" + filter);
        sel = 0;
        apply();
      });
    });
    document.getElementById("show-all").addEventListener("click", () => {
      filter = "all";
      apply();
    });
    document.getElementById("back-btn").addEventListener("click", () => {
      if (sel > 0) sel -= 1;
      render();
    });
    document.getElementById("next-btn").addEventListener("click", () => {
      if (sel < list.length - 1) sel += 1;
      render();
    });
    document.getElementById("nap-btn").addEventListener("click", async () => {
      const pin = list[sel];
      if (!pin) return;
      const nextId = list[sel + 1] ? list[sel + 1].id : null;
      undo = { id: pin.id, prev: decisions[pin.id] ? Object.assign({}, decisions[pin.id]) : null };
      await writeDecision(decisions, pin, { match_status: "not_a_pin" });
      apply(nextId);
    });
    document.getElementById("undo-btn").addEventListener("click", async () => {
      if (!undo) return;
      const pin = pins.find((row) => row.id === undo.id);
      if (!pin) return;
      await writeDecision(decisions, pin, undo.prev);
      undo = null;
      apply();
    });
    apply();
  }

  function startContact(data, decisions) {
    const pins = sortedPins(data);
    let filter = "";

    function counts() {
      const tally = { match: 0, no_match: 0, not_a_pin: 0, unreviewed: 0 };
      pins.forEach((pin) => { tally[statusOf(decisions, pin)] += 1; });
      document.getElementById("cnt-match").textContent = tally.match;
      document.getElementById("cnt-nomatch").textContent = tally.no_match;
      document.getElementById("cnt-notpin").textContent = tally.not_a_pin;
      document.getElementById("cnt-unreviewed").textContent = tally.unreviewed;
      document.getElementById("cnt-total").textContent = pins.length;
      document.getElementById("hdr-count").textContent = pins.length + " pins";
    }

    function render() {
      const grid = document.getElementById("grid");
      grid.innerHTML = "";
      pins.forEach((pin) => {
        const st = statusOf(decisions, pin);
        if (filter === "needs_review" && st !== "unreviewed" && st !== "no_match") return;
        if (filter === "agree" && !pin.agree) return;
        if (filter === "split" && pin.agree) return;
        if (filter === "no_match" && st !== "no_match") return;
        if (filter === "match" && st !== "match") return;
        const a = document.createElement("a");
        a.className = "cell " + st;
        a.href = "new_ctp.html?pin=" + encodeURIComponent(pin.id);
        a.innerHTML = '<img alt="" src="' + pin.our + '"><span class="cap">' + pin.board.replace("IMG_", "") + " · " + pin.pin_n + " · " + money(pin.price_label) + "</span>";
        grid.appendChild(a);
      });
      counts();
    }

    document.querySelectorAll(".fb").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.dataset.f;
        document.querySelectorAll(".fb").forEach((el) => el.classList.toggle("active", el === btn));
        render();
      });
    });
    render();
  }

  function startOverlay(data, decisions) {
    let mode = "all";
    const root = document.getElementById("boards");

    function render() {
      root.innerHTML = "";
      data.boards.forEach((board) => {
        const wrap = document.createElement("div");
        wrap.className = "board";
        wrap.innerHTML = '<img class="board-img" alt="' + board.file + '" src="' + board.file + '"><div class="board-label">' + board.name + " · " + money(board.price_label) + "</div>";
        board.pins.forEach((box) => {
          const pin = data.pins.find((row) => row.id === box.id);
          if (!pin) return;
          const st = statusOf(decisions, pin);
          const showPrice = mode === "all" || (mode === "matched" && st === "match") || (mode === "unmatched" && st !== "match" && st !== "not_a_pin");
          const a = document.createElement("a");
          a.className = "pin " + st + (showPrice ? "" : " price-hide");
          a.href = "new_ctp.html?pin=" + encodeURIComponent(pin.id);
          a.style.left = box.x + "%";
          a.style.top = box.y + "%";
          a.style.width = box.w + "%";
          a.style.height = box.h + "%";
          const price = document.createElement("span");
          price.className = "price";
          if (st === "match" && decisions[pin.id] && decisions[pin.id].chosen_price != null) price.textContent = money(decisions[pin.id].chosen_price);
          else price.textContent = money(pin.price_label);
          a.appendChild(price);
          wrap.appendChild(a);
        });
        root.appendChild(wrap);
      });
      document.querySelectorAll(".ov-filter").forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
    }

    document.querySelectorAll(".ov-filter").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.mode;
        render();
      });
    });
    render();
  }
})();
