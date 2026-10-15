// Recent CDRs are authoritative; the saved archive can be missing or partial.
function createReportCallReader({ fetchCalls, savedCalls }) {
  const pending = new Map();
  return function reportCalls(date, now, archiveOnly = false) {
    const key = date + ':' + archiveOnly;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      if (archiveOnly) return savedCalls(date);
      const age = (Date.parse(now.date) - Date.parse(date)) / 86400000;
      const cdr = { read: () => fetchCalls(date, now), confirmsEmpty: true };
      const archive = { read: () => savedCalls(date), confirmsEmpty: false };
      const readers = age >= 0 && age < 15 ? [cdr, archive] : [archive, cdr];
      let emptyConfirmed = false, lastError;
      for (const { read, confirmsEmpty } of readers) {
        try {
          const calls = await read();
          if (calls.length) return calls;
          emptyConfirmed ||= confirmsEmpty;
        } catch (error) { lastError = error; }
      }
      if (emptyConfirmed) return [];
      throw lastError;
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}

module.exports = { createReportCallReader };
