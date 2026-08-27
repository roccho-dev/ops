import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/bootstrap-access.mjs", import.meta.url), "utf8");
test("Access bootstrap is exact-domain and exact-email OTP only", () => {
  assert.match(source, /type: "self_hosted"/u);
  assert.match(source, /allowedEmails\.map\(email => \(\{ email: \{ email \} \}\)\)/u);
  assert.match(source, /require: \[\{ login_method: \{ id: otpIdpId \} \}\]/u);
  assert.doesNotMatch(source, /everyone/u);
  assert.doesNotMatch(source, /email_domain/u);
  assert.doesNotMatch(source, /bypass/u);
});
