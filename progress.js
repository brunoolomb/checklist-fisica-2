(() => {
  const storageKey = "fisica-1-segundo-parcial-v1";
  const statuses = ["Pendiente", "Intentado", "Entendido", "Rehecho"];
  const allowedStatuses = new Set(window.physicsChecklist.flatMap(
    ([, id, , , , , , , parts]) => parts.map(([part]) => statusKey(id, part)),
  ));
  const allowedNotes = new Set(window.physicsChecklist.map(([, id]) => noteKey(id)));

  function statusKey(id, part) { return id + "/" + part; }
  function noteKey(id) { return id + "/nota"; }
  function blank() { return { version: 1, tracker: storageKey, records: {} }; }

  function parse(text) {
    const input = JSON.parse(text);
    if (input?.tracker !== storageKey || input.version !== 1 ||
        !input.records || typeof input.records !== "object" || Array.isArray(input.records)) {
      throw new Error("El archivo tiene que ser una copia de esta checklist.");
    }
    const result = blank();
    for (const [key, record] of Object.entries(input.records)) {
      if (!allowedStatuses.has(key) && !allowedNotes.has(key)) continue;
      if (!record || typeof record.value !== "string" ||
          !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0 ||
          (allowedStatuses.has(key) && !statuses.includes(record.value)) ||
          record.value.length > 500) {
        throw new Error("La copia contiene un registro de progreso inválido.");
      }
      result.records[key] = { value: record.value, updatedAt: record.updatedAt };
    }
    return result;
  }

  function merge(target, input) {
    let changed = false;
    for (const [key, record] of Object.entries(input.records)) {
      const current = target.records[key];
      if (!current || record.updatedAt > current.updatedAt ||
          (record.updatedAt === current.updatedAt && record.value > current.value)) {
        target.records[key] = { ...record };
        changed = true;
      }
    }
    return changed;
  }

  function readLocal() {
    const saved = localStorage.getItem(storageKey);
    return saved ? parse(saved) : blank();
  }

  function saveLocal(progress) {
    localStorage.setItem(storageKey, JSON.stringify(progress));
  }

  function update(progress, key, value) {
    const previous = progress.records[key];
    if (previous?.value === value) return false;
    progress.records[key] = { value, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1) };
    return true;
  }

  async function handleStore(mode, operation) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(storageKey, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("settings");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("settings", mode);
        const request = operation(transaction.objectStore("settings"));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  async function syncFile(handle, progress, allowEmpty = false) {
    const before = await (await handle.getFile()).text();
    const cloud = before.trim() === "" && allowEmpty ? blank() : parse(before);
    const localChanged = merge(progress, cloud);
    const fileChanged = merge(cloud, progress);
    if (fileChanged || before.trim() === "") {
      const writable = await handle.createWritable();
      try {
        await writable.write(JSON.stringify(cloud, null, 2));
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
    }
    return localChanged;
  }

  window.physicsProgress = {
    storageKey, statuses, statusKey, noteKey, blank, parse, merge, readLocal, saveLocal, update, syncFile,
    getHandle: () => handleStore("readonly", (store) => store.get("linkedFile")),
    putHandle: (handle) => handleStore("readwrite", (store) => store.put(handle, "linkedFile")),
    removeHandle: () => handleStore("readwrite", (store) => store.delete("linkedFile")),
  };
})();
