import { validateRecord } from './queue-validator.mjs';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonLine(lineText, line) {
  try {
    return { ok: true, record: JSON.parse(lineText) };
  } catch (error) {
    return {
      ok: false,
      error: { code: 'invalid-json', message: error.message, line },
    };
  }
}

function failedResult({ line, id = null, kind = null, errors }) {
  return {
    line,
    id,
    kind,
    status: 'failed',
    errorCodes: errors.map((error) => error.code),
    errors,
  };
}

export function initialWorkerState() {
  return {
    kind: 'hq.localWorkerState.v1',
    modelOperations: [],
    agentTasks: [],
  };
}

export function processRecord(record, state, { line = 1 } = {}) {
  const errors = validateRecord(record, { line });
  if (errors.length > 0) {
    return failedResult({
      line,
      id: isPlainObject(record) ? record.id ?? null : null,
      kind: isPlainObject(record) ? record.kind ?? null : null,
      errors,
    });
  }

  if (record.kind === 'hq.modelCommitQueued.v1') {
    const operation = {
      kind: 'hq.localModelOperation.v1',
      queueId: record.id,
      targetRef: record.targetRef,
      op: record.op,
      payload: record.payload,
      reason: record.reason ?? null,
      confirmedBy: record.confirmedBy,
      status: 'shadow-applied',
    };
    state.modelOperations.push(operation);
    return {
      line,
      id: record.id,
      kind: record.kind,
      status: 'processed',
      outputKind: operation.kind,
    };
  }

  if (record.kind === 'hq.agentTaskQueued.v1') {
    const task = {
      kind: 'hq.localAgentTask.v1',
      queueId: record.id,
      targetRef: record.targetRef,
      goal: record.goal,
      context: record.context ?? [],
      acceptance: record.acceptance ?? [],
      confirmedBy: record.confirmedBy,
      status: 'pending',
    };
    state.agentTasks.push(task);
    return {
      line,
      id: record.id,
      kind: record.kind,
      status: 'pending',
      outputKind: task.kind,
    };
  }

  if (record.kind === 'hq.receipt.v1') {
    return {
      line,
      id: record.id,
      kind: record.kind,
      status: 'ignored',
      reason: 'receipt rows are evidence-only and are not worker input',
    };
  }

  return failedResult({
    line,
    id: record.id ?? null,
    kind: record.kind ?? null,
    errors: [{ code: 'unsupported-worker-kind', message: `unsupported worker kind: ${record.kind}`, line }],
  });
}

export function runLocalWorkerJsonl(text) {
  const state = initialWorkerState();
  const results = [];
  const errors = [];
  const seenIds = new Map();
  let records = 0;

  text.split(/\r?\n/).forEach((lineText, index) => {
    const line = index + 1;
    const trimmed = lineText.trim();
    if (trimmed.length === 0) {
      return;
    }

    records += 1;
    const parsed = parseJsonLine(trimmed, line);
    if (!parsed.ok) {
      errors.push(parsed.error);
      results.push(failedResult({ line, errors: [parsed.error] }));
      return;
    }

    const record = parsed.record;
    if (isPlainObject(record) && typeof record.id === 'string' && record.id.trim().length > 0) {
      if (seenIds.has(record.id)) {
        const error = {
          code: 'duplicate-id',
          message: `duplicate id: ${record.id}`,
          id: record.id,
          line,
          firstLine: seenIds.get(record.id),
        };
        errors.push(error);
        results.push(failedResult({ line, id: record.id, kind: record.kind ?? null, errors: [error] }));
        return;
      }
      seenIds.set(record.id, line);
    }

    const result = processRecord(record, state, { line });
    results.push(result);
    if (result.status === 'failed') {
      errors.push(...result.errors);
    }
  });

  return {
    ok: errors.length === 0,
    records,
    processed: results.filter((result) => result.status === 'processed').length,
    pending: results.filter((result) => result.status === 'pending').length,
    ignored: results.filter((result) => result.status === 'ignored').length,
    failed: results.filter((result) => result.status === 'failed').length,
    state,
    results,
    errors,
  };
}
