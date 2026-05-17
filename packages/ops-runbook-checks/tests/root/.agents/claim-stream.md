# Claim Stream

`claim.completion.v1` is a completion claim, not approval.
Stopping claims carry `policyReadSnapshot`.

claim はどれだけ詳細でも command、approval、merge pass には昇格しません。
The only success terminal is `complete-approved`.
