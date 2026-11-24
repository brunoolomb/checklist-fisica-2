(() => {
  const phases = [
    ["lunes", "Lunes · Empezá a las 19:30", "Practicá tres métodos. Hacé una pausa corta después de cada par de ejercicios."],
    ["martes", "Martes · Cerrá los incisos y hacé el simulacro", "Protegé el bloque del simulacro aunque tengas poco tiempo."],
    ["variantes", "Martes · Variantes para apuntar al 100", "Seguí el orden de la lista hasta donde llegues."],
    ["apoyo", "Apoyo · Solo si te tranca la trigonometría", ""],
  ];
  const tasks = window.physicsChecklist.map(
    ([phase, id, source, page, title, minutes, topic, start, parts, hint]) =>
      ({ phase, id, source, page, title, minutes, topic, start, parts, hint }),
  );
  const core = tasks.filter((task) => task.phase !== "apoyo");
  const model = window.physicsProgress;
  const $ = (id) => document.getElementById(id);
  const views = new Map();
  const phaseViews = new Map();
  const pickerSupported = typeof window.showSaveFilePicker === "function" &&
    typeof window.showOpenFilePicker === "function";
  let progress = model.blank();
  let filter = "all";
  let localOK = true;
  let linkedFile;
  let next;
  let syncTimer;
  let pendingSync = Promise.resolve();

  try { progress = model.readLocal(); } catch { localOK = false; }

  function status(task, part) {
    return progress.records[model.statusKey(task.id, part)]?.value ?? "Pendiente";
  }

  function doneCount(task) {
    return task.parts.filter(([part]) => status(task, part) === "Rehecho").length;
  }

  function mount() {
    for (const [phase, title, desc] of phases) {
      const section = document.createElement("section");
      section.className = "phase";
      section.innerHTML = '<h3></h3><p class="small"></p>';
      section.querySelector("h3").textContent = title;
      section.querySelector("p").textContent = desc;
      phaseViews.set(phase, section);
      $("exercises").append(section);
    }

    for (const task of tasks) {
      const details = document.createElement("details");
      details.className = "task";
      details.id = task.id;
      details.innerHTML = `
        <summary>
          <span><span class="task-title"></span><span class="task-meta"></span></span>
          <span class="task-count"></span>
        </summary>
        <div class="task-content">
          <p class="start"></p>
          <details class="hint"><summary>Ver pista</summary><p></p></details>
          <ul class="incisos"></ul>
          <label class="note">Primer error o duda
            <textarea rows="1" maxlength="500" placeholder="En una línea"></textarea>
          </label>
        </div>`;
      details.querySelector(".task-title").textContent = task.title;
      details.querySelector(".task-meta").textContent =
        [task.source, task.page, task.topic, task.minutes + " min"].join(" · ");
      details.querySelector(".start").textContent = task.start;
      details.querySelector(".hint p").textContent = task.hint;
      const selects = new Map();

      for (const [part, title] of task.parts) {
        const item = document.createElement("li");
        const label = document.createElement("label");
        const tag = document.createElement("b");
        const select = document.createElement("select");
        select.id = task.id + "-" + part;
        label.htmlFor = select.id;
        tag.textContent = part === "único" ? "" : part.toUpperCase();
        label.append(tag, " " + title);
        for (const value of model.statuses) select.add(new Option(value, value));
        select.addEventListener("change", () => change(model.statusKey(task.id, part), select.value));
        item.append(label, select);
        details.querySelector(".incisos").append(item);
        selects.set(part, select);
      }

      const note = details.querySelector("textarea");
      note.addEventListener("input", () => change(model.noteKey(task.id), note.value));
      views.set(task.id, { details, selects, note, count: details.querySelector(".task-count") });
      phaseViews.get(task.phase).append(details);
    }
  }

  function refresh() {
    for (const task of tasks) {
      const view = views.get(task.id);
      const done = doneCount(task);
      view.count.textContent = done + "/" + task.parts.length;
      view.count.setAttribute("aria-label", done + " de " + task.parts.length + " incisos rehechos");
      view.details.classList.toggle("is-done", done === task.parts.length);
      view.details.hidden = filter === "pending" && (done === task.parts.length || task.phase === "apoyo");
      for (const [part, select] of view.selects) select.value = status(task, part);
      if (document.activeElement !== view.note) {
        view.note.value = progress.records[model.noteKey(task.id)]?.value ?? "";
      }
    }
    for (const section of phaseViews.values()) {
      section.hidden = !section.querySelector(".task:not([hidden])");
    }
    const done = core.reduce((sum, task) => sum + doneCount(task), 0);
    const total = core.reduce((sum, task) => sum + task.parts.length, 0);
    $("progress-count").textContent = done;
    $("progress-total").textContent = total;
    $("progress-meter").max = total;
    $("progress-meter").value = done;
    next = core.find((task) => doneCount(task) < task.parts.length);
    $("next-title").textContent = next ? next.title : "Terminaste el plan principal";
    $("next-detail").textContent = next
      ? [next.source, next.page, next.minutes + " min"].join(" · ")
      : "Repasá los errores que anotaste en el simulacro.";
    $("next-button").hidden = !next;
    $("empty").hidden = Boolean(next) || filter !== "pending";
  }

  function save() {
    try {
      model.saveLocal(progress);
      localOK = true;
    } catch { localOK = false; }
    if (!localOK) $("save-status").textContent = "Guardado local no disponible. Descargá una copia.";
    else if (!linkedFile) $("save-status").textContent = "Guardado en este navegador";
  }

  function change(key, value) {
    if (!model.update(progress, key, value)) return;
    save();
    refresh();
    if (linkedFile) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => sync(), 450);
    }
  }

  function linkedControls() {
    $("refresh-backup").hidden = !linkedFile;
    $("unlink-backup").hidden = !linkedFile;
  }

  function sync({ ask = false, allowEmpty = false } = {}) {
    const handle = linkedFile;
    if (!handle) return Promise.resolve(false);
    const permission = ask
      ? handle.requestPermission({ mode: "readwrite" })
      : handle.queryPermission({ mode: "readwrite" });
    permission.catch(() => {});
    const run = async () => {
      if (linkedFile !== handle) return false;
      try {
        if (await permission !== "granted") {
          $("save-status").textContent = "Archivo vinculado. Reanudá la sincronización.";
          $("backup-status").textContent = "Volvé a dar acceso con Sincronizar ahora.";
          return false;
        }
        const syncWithFile = () => model.syncFile(handle, progress, allowEmpty);
        if (navigator.locks) await navigator.locks.request(model.storageKey, syncWithFile);
        else await syncWithFile();
        save();
        refresh();
        $("save-status").textContent = "Archivo vinculado actualizado";
        $("backup-status").textContent = "Progreso guardado en " + handle.name + ".";
        return true;
      } catch (error) {
        $("save-status").textContent = localOK ? "Guardado local. El archivo requiere revisión." : "Error al guardar el progreso.";
        $("backup-status").textContent = error?.message || "No se pudo actualizar el archivo.";
        return false;
      }
    };
    pendingSync = pendingSync.then(run);
    return pendingSync;
  }

  async function pickFile(create) {
    const options = { types: [{ description: "Progreso de Física 1", accept: { "application/json": [".json"] } }] };
    const previousFile = linkedFile;
    try {
      const handle = create
        ? await window.showSaveFilePicker({ ...options, suggestedName: "progreso-fisica-2.json" })
        : (await window.showOpenFilePicker(options))[0];
      if (!handle) return;
      // Validate before binding a previously existing file.
      if (!create) model.parse(await (await handle.getFile()).text());
      linkedFile = handle;
      linkedControls();
      const ok = await sync({ ask: true, allowEmpty: create });
      if (!ok) {
        linkedFile = previousFile;
        linkedControls();
        return;
      }
      try {
        await model.putHandle(handle);
      } catch {
        $("backup-status").textContent = "Archivo actualizado. Volvé a vincularlo al abrir otra sesión.";
      }
    } catch (error) {
      if (error.name !== "AbortError") $("backup-status").textContent = error.message || "No se pudo vincular el archivo.";
    }
  }

  mount();
  refresh();
  if (!localOK) $("save-status").textContent = "Guardado local no disponible. Descargá una copia.";

  for (const button of document.querySelectorAll("[data-filter]")) {
    button.addEventListener("click", () => {
      filter = button.dataset.filter;
      for (const option of document.querySelectorAll("[data-filter]")) {
        option.setAttribute("aria-pressed", String(option === button));
      }
      refresh();
    });
  }
  $("next-button").addEventListener("click", () => {
    const view = views.get(next.id);
    view.details.open = true;
    view.details.querySelector("summary").focus({ preventScroll: true });
    view.details.scrollIntoView({ block: "start" });
  });
  $("backup-open").addEventListener("click", () => $("backup").showModal());
  $("new-backup").addEventListener("click", () => pickFile(true));
  $("link-backup").addEventListener("click", () => pickFile(false));
  $("refresh-backup").addEventListener("click", () => sync({ ask: true }));
  $("unlink-backup").addEventListener("click", async () => {
    linkedFile = undefined;
    clearTimeout(syncTimer);
    linkedControls();
    save();
    try {
      await model.removeHandle();
      $("backup-status").textContent = "Archivo desvinculado. Conservás el progreso local.";
    } catch {
      $("backup-status").textContent = "Desvinculado en esta sesión. El navegador no permitió guardar esa preferencia.";
    }
  });
  $("export-backup").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "progreso-fisica-2.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("import-backup").addEventListener("click", () => $("backup-input").click());
  $("backup-input").addEventListener("change", async ({ target }) => {
    if (!target.files.length) return;
    try {
      const imported = model.parse(await target.files[0].text());
      model.merge(progress, imported);
      save();
      refresh();
      if (linkedFile) await sync();
      else $("backup-status").textContent = localOK ? "Progreso importado." : "Progreso importado para esta sesión.";
    } catch (error) {
      $("backup-status").textContent = error instanceof SyntaxError ? "Elegí un archivo JSON válido de esta checklist." : error.message;
    } finally {
      target.value = "";
    }
  });
  addEventListener("storage", (event) => {
    if (event.key === model.storageKey && event.newValue) {
      model.merge(progress, model.parse(event.newValue));
      refresh();
    }
  });
  addEventListener("focus", () => sync());
  $("file-actions").hidden = !pickerSupported;
  $("file-fallback").hidden = pickerSupported;
  if (pickerSupported) {
    model.getHandle().then((handle) => {
      if (!handle || linkedFile) return;
      linkedFile = handle;
      linkedControls();
      return sync();
    }).catch(() => {});
  }
})();
