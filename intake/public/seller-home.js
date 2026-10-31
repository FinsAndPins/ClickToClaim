(() => {
  const cfg = window.INTAKE || {};
  const maxPhotos = Number(cfg.maxPhotos || 100);
  const maxBytes = Number(cfg.maxBytes || 15728640);
  const filesEl = document.getElementById("files");
  const thumbsEl = document.getElementById("thumbs");
  const statusEl = document.getElementById("uploadStatus");
  const step2 = document.getElementById("step2");
  const contactFields = document.getElementById("contactFields");
  const almost = document.getElementById("almostDone");
  const submitBtn = document.getElementById("submitAll");
  const formErr = document.getElementById("formErr");
  const form = document.getElementById("contactForm");

  let sessionId = "";
  let sessionPromise = null;
  let uploading = 0;
  let submitted = false;
  const items = [];

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function showErr(msg) {
    if (!formErr) return;
    formErr.textContent = msg || "";
    formErr.hidden = !msg;
  }

  async function readJson(res) {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (_) {
      throw new Error(
        res.ok
          ? "Unexpected response from server."
          : "Something went wrong (HTTP " + res.status + "). Please try again."
      );
    }
  }

  /** Safari/iOS often paints autofill without firing input or syncing .value until touched. */
  function commitAutofillValues() {
    if (!form) return;
    form.querySelectorAll("input, textarea").forEach((el) => {
      try {
        if (el.type === "checkbox" || el.type === "radio" || el.type === "file") return;
        const v = el.value;
        if (v) el.value = v;
      } catch (_) {
        /* ignore */
      }
    });
  }

  function scheduleAutofillSync() {
    commitAutofillValues();
    updateSubmit();
    [50, 200, 500, 1000, 2000].forEach((ms) => {
      setTimeout(() => {
        commitAutofillValues();
        updateSubmit();
      }, ms);
    });
  }

  function unlockStep2() {
    if (!step2) return;
    step2.classList.remove("is-locked");
    step2.removeAttribute("aria-hidden");
    if (contactFields) contactFields.disabled = false;
    if (almost) almost.hidden = false;
    scheduleAutofillSync();
  }

  function updateSubmit() {
    const okPhotos = items.filter((it) => it.status === "ok").length;
    const busy = uploading > 0;
    const failed = items.some((it) => it.status === "err");
    if (!submitBtn) return;
    submitBtn.disabled = submitted || okPhotos < 1 || busy;
    if (submitted) {
      submitBtn.textContent = "Submitting…";
    } else if (busy) {
      submitBtn.textContent = "Uploading photos…";
    } else if (failed && okPhotos >= 1) {
      submitBtn.textContent = "Submit collection";
    } else if (okPhotos >= 1) {
      submitBtn.textContent = "Submit collection";
    } else {
      submitBtn.textContent = "Submit collection";
    }
  }

  function renderItem(it) {
    if (!it.el) {
      it.el = document.createElement("div");
      it.el.className = "thumb";
      thumbsEl.appendChild(it.el);
    }
    const name = it.file ? it.file.name : it.filename || "photo";
    let media = "";
    if (it.previewUrl) {
      media = '<img alt="" src="' + it.previewUrl + '">';
    }
    const st =
      it.status === "ok"
        ? "Uploaded"
        : it.status === "err"
          ? it.error || "Failed"
          : "Uploading…";
    it.el.innerHTML =
      media +
      '<div class="st">' +
      st +
      "</div>" +
      (it.status === "ok" || it.status === "err"
        ? '<button type="button" class="remove" data-id="' +
          (it.photoId || it.localId) +
          '" aria-label="Remove ' +
          name +
          '">Remove</button>'
        : "");
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      const res = await fetch("/api/upload-sessions", { method: "POST" });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Could not start upload.");
      sessionId = data.sessionId;
      try {
        sessionStorage.setItem("intakeSession", sessionId);
      } catch (_) {
        /* ignore */
      }
      return sessionId;
    })();
    try {
      return await sessionPromise;
    } catch (e) {
      sessionPromise = null;
      throw e;
    }
  }

  /** Resume an in-progress upload after refresh / reopen (same tab sessionStorage). */
  async function restoreSessionIfAny() {
    let saved = "";
    try {
      saved = sessionStorage.getItem("intakeSession") || "";
    } catch (_) {
      saved = "";
    }
    if (!saved || sessionId) return;
    try {
      const res = await fetch("/api/submissions/" + saved + "/photos");
      const data = await readJson(res);
      if (!res.ok) {
        try {
          sessionStorage.removeItem("intakeSession");
        } catch (_) {
          /* ignore */
        }
        return;
      }
      sessionId = saved;
      const photos = Array.isArray(data.photos) ? data.photos : [];
      for (const p of photos) {
        const it = {
          localId: "restored-" + p.photoId,
          file: null,
          filename: p.filename || "photo",
          status: "ok",
          previewUrl: p.previewUrl || "",
          photoId: p.photoId,
          el: null,
          error: "",
        };
        items.push(it);
        renderItem(it);
      }
      if (photos.length) {
        unlockStep2();
        restoreUploadStatus();
      }
      updateSubmit();
    } catch (_) {
      try {
        sessionStorage.removeItem("intakeSession");
      } catch (__) {
        /* ignore */
      }
    }
  }

  async function uploadOne(it) {
    uploading += 1;
    updateSubmit();
    renderItem(it);
    try {
      const sid = await ensureSession();
      if (it.file.size > maxBytes) {
        throw new Error("Over the size limit.");
      }
      const body = new FormData();
      body.append("photo", it.file);
      const res = await fetch("/api/submissions/" + sid + "/photos", { method: "POST", body });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Upload failed");
      it.photoId = data.photoId;
      it.status = "ok";
    } catch (e) {
      it.status = "err";
      it.error = e && e.message ? e.message : "Upload failed";
    } finally {
      uploading -= 1;
      const ok = items.filter((x) => x.status === "ok").length;
      const total = items.length;
      const pending = items.filter((x) => x.status === "up").length;
      if (pending) setStatus("Uploading " + (total - pending + 1) + " of " + total + "…");
      else if (ok === total && total) setStatus(ok + " photo" + (ok === 1 ? "" : "s") + " uploaded. You're almost done.");
      else setStatus(ok + " uploaded. You can remove a failed photo and add another.");
      renderItem(it);
      updateSubmit();
    }
  }

  async function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const have = items.filter((it) => it.status !== "err").length;
    if (have + incoming.length > maxPhotos) {
      showErr("Please choose at most " + maxPhotos + " photos.");
      return;
    }
    showErr("");
    unlockStep2();
    setStatus("Starting upload…");
    try {
      await ensureSession();
    } catch (e) {
      showErr(e && e.message ? e.message : "Could not start upload.");
      return;
    }
    for (const file of incoming) {
      const it = {
        localId: "local-" + Math.random().toString(36).slice(2),
        file,
        filename: file.name,
        status: "up",
        previewUrl: "",
        photoId: "",
        el: null,
        error: "",
      };
      try {
        it.previewUrl = URL.createObjectURL(file);
      } catch (_) {
        /* ignore */
      }
      items.push(it);
      renderItem(it);
    }
    for (const it of items) {
      if (it.status === "up" && it.file) {
        // Sequential: more reliable on iPhone than many parallel POSTs.
        await uploadOne(it);
      }
    }
  }

  async function removeItem(id) {
    const it = items.find((x) => x.photoId === id || x.localId === id);
    if (!it) return;
    if (it.photoId && sessionId) {
      try {
        const res = await fetch("/api/submissions/" + sessionId + "/photos/" + it.photoId, {
          method: "DELETE",
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || "Could not remove photo");
      } catch (e) {
        showErr(e && e.message ? e.message : "Could not remove photo.");
        return;
      }
    }
    if (it.previewUrl) {
      try {
        URL.revokeObjectURL(it.previewUrl);
      } catch (_) {
        /* ignore */
      }
    }
    if (it.el) it.el.remove();
    const idx = items.indexOf(it);
    if (idx >= 0) items.splice(idx, 1);
    const ok = items.filter((x) => x.status === "ok").length;
    setStatus(ok ? ok + " photo" + (ok === 1 ? "" : "s") + " uploaded." : "Choose board photos to get started.");
    updateSubmit();
  }

  function parseAskingDollars(raw) {
    const cleaned = String(raw || "")
      .trim()
      .replace(/[$,\s]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  function looksLikeEmail(raw) {
    const s = String(raw || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  /** List every blank / invalid required field so the seller knows exactly what to fix. */
  function formProblem() {
    if (!form) return "Form is missing. Refresh and try again.";
    commitAutofillValues();
    const name = (form.seller_name.value || "").trim();
    const email = (form.seller_email.value || "").trim();
    const askingRaw = (form.asking.value || "").trim();
    const askingOk = parseAskingDollars(askingRaw) != null;
    const delivery = (form.delivery && form.delivery.value ? form.delivery.value : "").trim();
    const agree = form.agree && form.agree.checked;
    const missing = [];
    const other = [];
    if (!name) missing.push("Name");
    if (!email) missing.push("Email address");
    else if (!looksLikeEmail(email)) other.push("Email address looks invalid.");
    if (!askingRaw) missing.push("Price you have in mind");
    else if (!askingOk) other.push("Price must be greater than $0 (for example 1000, not 0).");
    if (!delivery) missing.push("How you'll get the pins to us");
    if (!agree) missing.push("Privacy and terms checkbox");
    if (!missing.length && !other.length) return "";
    const parts = [];
    if (missing.length === 1) parts.push("Please fill in: " + missing[0] + ".");
    else if (missing.length > 1) parts.push("Please fill in: " + missing.join(", ") + ".");
    parts.push(...other);
    return parts.join(" ");
  }

  function restoreUploadStatus() {
    const ok = items.filter((it) => it.status === "ok").length;
    const total = items.length;
    const pending = items.filter((it) => it.status === "up").length;
    if (pending) setStatus("Uploading…");
    else if (ok === total && total)
      setStatus(ok + " photo" + (ok === 1 ? "" : "s") + " uploaded. You're almost done.");
    else if (ok)
      setStatus(ok + " uploaded. You can remove a failed photo and add another.");
    else setStatus("Choose board photos to get started.");
  }

  async function submitCollection() {
    if (submitted) return;
    showErr("");
    commitAutofillValues();
    const okPhotos = items.filter((it) => it.status === "ok");
    if (!okPhotos.length) {
      showErr("Please upload at least one photo.");
      return;
    }
    if (items.some((it) => it.status === "up") || uploading > 0) {
      showErr("Photos are still uploading. Submit will be ready in a moment.");
      return;
    }
    if (items.some((it) => it.status === "err")) {
      showErr("Remove failed photos, or add replacements, then submit.");
      return;
    }
    const problem = formProblem();
    if (problem) {
      showErr(problem);
      restoreUploadStatus();
      return;
    }
    submitted = true;
    updateSubmit();
    setStatus("Submitting…");
    try {
      const body = new FormData(form);
      body.set("agree", "yes");
      // Prefer live field values in case FormData missed a painted autofill / radio.
      body.set("seller_name", (form.seller_name.value || "").trim());
      body.set("seller_email", (form.seller_email.value || "").trim());
      body.set("asking", (form.asking.value || "").trim());
      const delivery = form.delivery && form.delivery.value ? String(form.delivery.value) : "";
      if (delivery) body.set("delivery", delivery);
      const res = await fetch("/api/submissions/" + sessionId + "/finish", { method: "POST", body });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Could not finish");
      try {
        sessionStorage.removeItem("intakeSession");
      } catch (_) {
        /* ignore */
      }
      setStatus("Done. Opening thank-you page…");
      location.href = "/thanks";
    } catch (e) {
      submitted = false;
      updateSubmit();
      restoreUploadStatus();
      showErr(e && e.message ? e.message : "Could not submit. Please try again.");
    }
  }

  if (filesEl) {
    filesEl.addEventListener("change", () => {
      const list = filesEl.files;
      addFiles(list);
      filesEl.value = "";
    });
  }
  if (thumbsEl) {
    thumbsEl.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("button.remove") : null;
      if (!btn) return;
      removeItem(btn.getAttribute("data-id"));
    });
  }
  if (form) {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      submitCollection();
    });
    // Autofill often skips "input"; also listen for change/blur and WebKit autofill animation.
    ["input", "change", "blur", "focusin"].forEach((evt) => {
      form.addEventListener(evt, () => {
        commitAutofillValues();
        updateSubmit();
      }, true);
    });
    form.addEventListener("animationstart", (ev) => {
      if (ev.animationName === "intakeAutofill") {
        commitAutofillValues();
        updateSubmit();
      }
    });
  }
  // Page may restore autofill after load / bfcache.
  window.addEventListener("pageshow", scheduleAutofillSync);
  restoreSessionIfAny().finally(() => {
    scheduleAutofillSync();
    updateSubmit();
  });
})();
