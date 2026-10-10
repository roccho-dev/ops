import test from 'node:test';
import assert from 'node:assert/strict';
import {remaining,reserve,settle} from './progress.mjs';

const first = () => ({
  schema:'ops.sys1.progress.v1',limit:400,previous:80,runs:{},
  additionalGrants:{'issuecomment-6096896561':{
    calls:200,previousLimit:200,resultingLimit:400,
    receipt:'https://github.com/roccho-org/ops/issues/523#issuecomment-6096896561'
  }}
});
test('one-time added 200 is counted only once across repeated reads',()=>{
  const s=first();assert.equal(remaining(s),320);
  assert.equal(remaining(s),320);
  assert.equal(Object.keys(s.additionalGrants).length,1);
});
test('reservation and settlement do not inflate grant limit',()=>{
  const s=first();const r=reserve(s,'route-1','contract-sha',16).state;
  assert.equal(remaining(r),304);
  const committed=settle(r,'route-1','contract-sha',16,'ci:run/job');
  assert.equal(remaining(committed),304);
  assert.equal(remaining(settle(committed,'route-1','contract-sha',16,'ci:run/job')),304);
});
test('accidental second addition without second independent grant fails',()=>{
  const s=first();s.limit=600;assert.throws(()=>remaining(s),/GRANT_LEDGER_LIMIT_MISMATCH/);
});
test('reusing same grant receipt under another key fails',()=>{
  const s=first();s.additionalGrants['another-grant']={
    calls:200,previousLimit:400,resultingLimit:600,receipt:s.additionalGrants['issuecomment-6096896561'].receipt
  };s.limit=600;assert.throws(()=>remaining(s),/INVALID_GRANT_LEDGER/);
});
test('future distinct grant must form exact non-overlapping chain',()=>{
  const s=first();s.additionalGrants['issuecomment-unique-future']={
    calls:25,previousLimit:400,resultingLimit:425,receipt:'ci:future-authorized-grant'
  };s.limit=425;assert.equal(remaining(s),345);
  s.additionalGrants['issuecomment-unique-future'].previousLimit=300;
  assert.throws(()=>remaining(s),/INVALID_GRANT_LEDGER/);
});
test('invalid, empty and self-inconsistent grant histories are not silently ignored',()=>{
  for(const change of [
    s=>s.additionalGrants={},
    s=>s.additionalGrants=[],
    s=>s.additionalGrants['issuecomment-6096896561'].resultingLimit=401,
    s=>s.additionalGrants['issuecomment-6096896561'].calls=-200,
    s=>s.additionalGrants['issuecomment-6096896561'].receipt=''
  ]){const s=first();change(s);assert.throws(()=>remaining(s));}
});
test('legacy state without grant history still functions without a new ledger',()=>{
  const s={schema:'ops.sys1.progress.v1',limit:200,previous:80,runs:{}};
  assert.equal(remaining(s),120);
});
