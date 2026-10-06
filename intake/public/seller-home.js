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

  function unlockStep2() {
    if (!step2) return;
    step2.classList.remove("is-locked");
    step2.removeAttribute("aria-hidden");
    if (contactFields) contactFields.disabled = false;
    if (almost) almost.hidden = false;
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

  function formValid() {
    if (!form) return false;
    const name = (form.seller_name.value || "").trim();
    const email = (form.seller_email.value || "").trim();
    const asking = (form.asking.value || "").trim();
    const delivery = (form.delivery.value || "").trim();
    const agree = form.agree && form.agree.checked;
    return Boolean(name && email && asking && delivery && agree);
  }

  async function submitCollection() {
    if (submitted) return;
    showErr("");
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
    if (!formValid()) {
      showErr("Please fill name, email, your price, how you'll get the pins to us, and the privacy box.");
      return;
    }
    submitted = true;
    updateSubmit();
    setStatus("Submitting…");
    try {
      const body = new FormData(form);
      body.set("agree", "yes");
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
    form.addEventListener("input", () => updateSubmit());
  }
  updateSubmit();
})();
