import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const emailBootstrap = fs.readFileSync(new URL("../scripts/bootstrap-access.mjs", import.meta.url), "utf8");

test("human Access bootstrap is exact-email OTP only", () => {
  assert.match(emailBootstrap, /type: "self_hosted"/u);
  assert.match(emailBootstrap, /allowedEmails\.map\(email => \(\{ email: \{ email \} \}\)\)/u);
  assert.match(emailBootstrap, /require: \[\{ login_method: \{ id: otpIdpId \} \}\]/u);
  assert.doesNotMatch(emailBootstrap, /everyone/u);
  assert.doesNotMatch(emailBootstrap, /email_domain/u);
  assert.doesNotMatch(emailBootstrap, /bypass/u);
});
