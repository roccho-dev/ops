import { writeDiagnostic } from "../../../../structured-diagnostic/adapters/node.mjs";

process.stdout.write("result\n");
writeDiagnostic({
  schema: "diagnostic/1",
  code: "fixture.ready",
  level: "info",
  message: "ready",
  fields: { count: 1 },
});
