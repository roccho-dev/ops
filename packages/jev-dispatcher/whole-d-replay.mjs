import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { askJev } from '../jev-review/jev.mjs';
import { JEV_MODEL } from '../jev-review/core.mjs';
import { compareWholeD, projectWholeDInput, reviewWholeDDecisionPlane, sha256 } from './whole-d-shadow.mjs';

// A finite file replay, not a dispatcher. The envs-owned caller supplies auth.
export async function runWholeDReplay(inputPath, outputPath, { sourceHead, key, ask } = {}) {
  if (!/^[a-f0-9]{40}$/.test(sourceHead ?? '')) throw new Error('EXACT_SOURCE_HEAD_REQUIRED');
  const bytes = fs.readFileSync(inputPath, 'utf8');
  if (Buffer.byteLength(bytes) > 512000) throw new Error('REPLAY_BUDGET_EXCEEDED');
  const cases = bytes.trim().split('\n').map((line) => JSON.parse(line));
  if (!cases.length || cases.length > 8) throw new Error('REPLAY_CASE_LIMIT');
  const ids = new Set(); const incomplete = [];
  for (const row of cases) {
    if (!row || Object.keys(row).sort().join(',') !== 'id,input,reference' || typeof row.id !== 'string'
      || !row.id.trim() || row.id.length > 128 || ids.has(row.id)) throw new Error('INVALID_REPLAY_CASE');
    ids.add(row.id);
    const projected = projectWholeDInput(row.input);
    const inputEvidence = { policySha256: row.input.policy.sha256, observationSha256: row.input.observation.sha256,
      candidatesSha256: sha256(projected.candidates), candidateUniverse: projected.candidates, candidates: projected.candidates.length };
    const bound = compareWholeD(inputEvidence, row.reference);
    if (bound.status === 'BLOCK') {
      if (bound.reason !== 'CANDIDATE_UNIVERSE_INCOMPLETE') throw new Error(bound.reason);
      incomplete.push({ id: row.id, status: 'BLOCK', execution: 'NOT_RUN', callsAttempted: 0, inputEvidence, comparison: bound });
    }
  }
  // Reserve before provider calls; refuse to overwrite evidence or pay twice.
  const fd = fs.openSync(outputPath, 'wx', 0o600);
  const rows = [];
  const append = (row) => { fs.writeSync(fd, JSON.stringify(row) + '\n'); fs.fsyncSync(fd); rows.push(row); };
  try {
    append({ schema: 'ops.wholeDReplay.v1', sourceHead, inputSha256: sha256(bytes), model: JEV_MODEL,
      execution: ask ? 'injected-adapter' : 'real-jev-requested', cases: cases.length,
      authority: false, effect: false, referenceIsGroundTruth: false });
    // Retain inadmissibility evidence without expanding candidates or calling Jev.
    if (incomplete.length) {
      incomplete.forEach(append);
      append({ status: 'BLOCK', reason: 'CANDIDATE_UNIVERSE_INCOMPLETE', recordedCases: 0, plannedCases: cases.length,
        semanticPassClaim: false, liveEffectCalls: 0 });
      return rows;
    }
    if (!ask && (typeof key !== 'string' || !key.trim())) {
      append({ status: 'BLOCK', execution: 'NOT_RUN', reason: 'JEV_API_KEY_REQUIRED', callsAttempted: 0, evaluated: 0 });
      return rows;
    }
    const provider = ask ?? ((state, questions) => askJev(state, questions, {
      key, endpoint: 'https://api.typesafe.ai/v1/systemone', timeoutMs: 15000,
    }));
    for (const row of cases) {
      const result = await reviewWholeDDecisionPlane(row.input, provider);
      append({ id: row.id, result, comparison: compareWholeD(result, row.reference) });
      if (result.callsCompleted === 0) break; // Transport/response failure: no retry or further paid calls.
    }
    append({ status: rows.length - 1 === cases.length ? 'RECORDED' : 'BLOCK',
      recordedCases: rows.length - 1, plannedCases: cases.length,
      semanticPassClaim: false, liveEffectCalls: 0 });
    return rows;
  } finally { fs.closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) {
    console.error('usage: node whole-d-replay.mjs CASES.jsonl NEW_EVIDENCE.jsonl');
    process.exitCode = 2;
  } else runWholeDReplay(process.argv[2], process.argv[3], { sourceHead: process.env.OPS_SOURCE_HEAD, key: process.env.JEV_API_KEY })
    .then((rows) => {
      const incomplete = rows.some((row) => row.status === 'BLOCK' || row.comparison?.status === 'BLOCK' || row.result?.status === 'UNKNOWN');
      console.log(JSON.stringify({ status: incomplete ? 'BLOCK_OR_UNKNOWN' : 'RECORDED_NOT_ACCEPTED', records: rows.length }));
      process.exitCode = incomplete ? 2 : 0;
    }).catch(() => { console.error('WHOLE_D_REPLAY_BLOCKED'); process.exitCode = 2; });
}
