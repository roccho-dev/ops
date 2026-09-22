const text = (x) => typeof x === 'string' && x.trim().length > 0;
const list = (x) => Array.isArray(x) && Reflect.ownKeys(x).length === x.length + 1;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function rankJudgments(judgments, { topK, themes, items }) {
  if (!Number.isSafeInteger(topK) || topK < 0 || !list(themes) || !themes.length || !themes.every(text) || !list(items) || !list(judgments)) {
    throw new Error('INVALID_RANK_INPUT');
  }
  const groups = themes.map((theme) => {
    const candidates = items.filter((item) => item.theme === theme).length;
    return { theme, status: topK === 0 ? 'disabled' : candidates ? 'evaluated' : 'empty', candidates, evaluated: 0, returned: 0, findings: [] };
  });

  if (topK === 0) {
    if (judgments.length) throw new Error('DISABLED_RANK_HAS_JUDGMENTS');
    return groups;
  }

  const expected = new Set(items.map((item) => `${item.theme}\0${JSON.stringify(item.subject)}`));
  const seen = new Set();
  for (const row of judgments) {
    if (!row || !text(row.theme) || !list(row.subject) || !row.subject.length || !row.subject.every(text)
      || !Number.isFinite(row.noul) || row.noul < 0 || row.noul > 1) throw new Error('INVALID_JUDGMENT');
    const key = `${row.theme}\0${JSON.stringify(row.subject)}`;
    if (!expected.has(key) || seen.has(key)) throw new Error('JUDGMENT_SET_MISMATCH');
    seen.add(key);
    const group = groups.find((value) => value.theme === row.theme);
    if (!group) throw new Error('JUDGMENT_SET_MISMATCH');
    group.findings.push({ subject: row.subject, noul: row.noul });
  }
  if (seen.size !== expected.size) throw new Error('JUDGMENT_SET_MISMATCH');

  for (const group of groups) {
    group.evaluated = group.findings.length;
    group.findings.sort((a, b) => b.noul - a.noul || compare(JSON.stringify(a.subject), JSON.stringify(b.subject)));
    group.findings = group.findings.slice(0, topK);
    group.returned = group.findings.length;
  }
  return groups;
}
