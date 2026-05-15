import { CdpError, cdpError, preflightCheck } from "./lib.mjs";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    std.out.puts(`  PASS: ${msg}\n`);
  } else {
    failed++;
    std.out.puts(`  FAIL: ${msg}\n`);
  }
}

function assertEq(a, b, msg) {
  if (a === b) {
    passed++;
    std.out.puts(`  PASS: ${msg}\n`);
  } else {
    failed++;
    std.out.puts(`  FAIL: ${msg} (expected ${b}, got ${a})\n`);
  }
}

std.out.puts("=== CdpError Tests ===\n");

const err1 = new CdpError("TEST_ERROR", "Test detail", null, "Test hint");
assertEq(err1.name, "CdpError", "CdpError.name");
assertEq(err1.code, "TEST_ERROR", "CdpError.code");
assertEq(err1.detail, "Test detail", "CdpError.detail");
assertEq(err1.message, "Test detail", "CdpError.message");
assertEq(err1.hint, "Test hint", "CdpError.hint");
assertEq(err1.ok, false, "CdpError.ok === false");
assert(err1.docRef.includes("TEST_ERROR"), "CdpError.docRef contains code");

const json1 = err1.toJSON();
assertEq(json1.ok, false, "CdpError.toJSON().ok === false");
assertEq(json1.code, "TEST_ERROR", "CdpError.toJSON().code");
assertEq(json1.hint, "Test hint", "CdpError.toJSON().hint");

const err2 = cdpError("SHORT_ERROR", "Short detail");
assertEq(err2.code, "SHORT_ERROR", "cdpError() sets code");
assertEq(err2.docRef.includes("SHORT_ERROR"), true, "cdpError() sets docRef");

std.out.puts("\n=== preflightCheck Tests (mock) ===\n");

std.out.puts("NOTE: preflightCheck requires actual Chrome CDP endpoint.\n");
std.out.puts("These tests verify the function structure, not actual HTTP calls.\n");

assert(typeof preflightCheck === "function", "preflightCheck is a function");
assertEq(preflightCheck.length, 4, "preflightCheck takes 4 arguments (addr, port, url, opts)");

std.out.puts("\n=== Summary ===\n");
std.out.puts(`Passed: ${passed}\n`);
std.out.puts(`Failed: ${failed}\n`);

if (failed > 0) {
  std.exit(1);
}
