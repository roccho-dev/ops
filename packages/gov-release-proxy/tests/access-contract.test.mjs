import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const emailBootstrap = fs.readFileSync(new URL("../scripts/bootstrap-access.mjs", import.meta.url), "utf8");
const serviceProof = fs.readFileSync(new URL("../scripts/prove-access.mjs", import.meta.url), "utf8");

test("human Access bootstrap is exact-email OTP only", () => {
  assert.match(emailBootstrap, /type: "self_hosted"/u);
  assert.match(emailBootstrap, /allowedEmails\.map\(email => \(\{ email: \{ email \} \}\)\)/u);
  assert.match(emailBootstrap, /require: \[\{ login_method: \{ id: otpIdpId \} \}\]/u);
  assert.doesNotMatch(emailBootstrap, /everyone/u);
  assert.doesNotMatch(emailBootstrap, /email_domain/u);
  assert.doesNotMatch(emailBootstrap, /bypass/u);
});

test("CI Access proof creates exact service-token policy and always cleans up", () => {
  assert.match(serviceProof, /decision: "non_identity"/u);
  assert.match(serviceProof, /service_token: \{ token_id: serviceToken\.id \}/u);
  assert.match(serviceProof, /\/access\/apps\/\$\{application\.id\}/u);
  assert.match(serviceProof, /\/access\/service_tokens\/\$\{serviceToken\.id\}/u);
  assert.doesNotMatch(serviceProof, /any_valid_service_token/u);
  assert.doesNotMatch(serviceProof, /everyone/u);
  assert.doesNotMatch(serviceProof, /bypass/u);
});
