export const SAFE_BACKUP_CLASSIFICATIONS = new Set(["equal", "missing-remote", "source-ahead"]);

export function classificationCounts(rows) {
  const counts = {};
  for (const row of rows) counts[row.classification] = (counts[row.classification] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

export function reconcileRefSets(expectedRows, observedRows, relationByRemoteRef = new Map()) {
  const expected = new Map(expectedRows.map((row) => [row.remoteRef, row]));
  const observed = new Map(observedRows.map((row) => [row.remoteRef, row]));
  const refs = [...new Set([...expected.keys(), ...observed.keys()])].sort();
  const rows = [];

  for (const remoteRef of refs) {
    const exp = expected.get(remoteRef) || null;
    const obs = observed.get(remoteRef) || null;
    if (exp && obs) {
      if (exp.sourceOid === obs.remoteOid) {
        rows.push({ ...exp, ...obs, classification: "equal" });
      } else {
        const relation = relationByRemoteRef.get(remoteRef) || { classification: "unclassified", reason: "relation-not-evaluated" };
        rows.push({ ...exp, ...obs, ...relation });
      }
      continue;
    }
    if (exp) {
      rows.push({ ...exp, remoteOid: null, parsed: null, classification: "missing-remote" });
      continue;
    }

    let classification = "unknown-managed-extra";
    if (obs.parsed?.schema === "current-r1") classification = "extra-current-schema";
    else if (obs.parsed?.schema?.startsWith("legacy-")) classification = "extra-legacy-schema";
    rows.push({ ...obs, classification });
  }

  const counts = classificationCounts(rows);
  return {
    rows,
    counts,
    ok: rows.every((row) => row.classification === "equal"),
    backupSafe: rows.every((row) => SAFE_BACKUP_CLASSIFICATIONS.has(row.classification)),
  };
}
