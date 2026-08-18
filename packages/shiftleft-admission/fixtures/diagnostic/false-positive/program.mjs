import { writeDiagnostic } from "../../../../structured-diagnostic/adapters/node.mjs";

process.stdout.write("result\n");
writeDiagnostic({
  schema: "diagnostic/1",
  code: "fixture.words",
  level: "debug",
  message: "event_id timestamp status are ordinary words",
  fields: { note: "run_id is ordinary text" },
});
