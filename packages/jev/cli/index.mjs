import { askJevNoul, askJevChoice, JevError, JevContractError } from "../src/client.mjs";

const apiKey = process.env.JEV_API_KEY;

async function main() {
  let input = "";

  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let request;
  try {
    request = JSON.parse(input);
  } catch (e) {
    const result = {
      error: "invalid_json",
      message: `Failed to parse stdin as JSON: ${e.message}`,
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(1);
  }

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    const result = {
      error: "invalid_request",
      message: "Request must be an object",
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(1);
  }

  const { type, text, choices, instructions } = request;

  try {
    if (!apiKey) {
      throw new JevError("auth_missing", "JEV_API_KEY environment variable not set");
    }

    let result;

    if (type === "noul") {
      const { model, noul } = await askJevNoul(apiKey, text, instructions);
      result = { model, noul };
    } else if (type === "choice") {
      if (!choices || typeof choices !== "object") {
        throw new JevError("input_invalid", "choices must be object with name and keys");
      }
      const { name, keys } = choices;
      if (!name || !Array.isArray(keys)) {
        throw new JevError("input_invalid", "choices.name and choices.keys are required");
      }
      const { model, choice, confidence, probabilities } = await askJevChoice(apiKey, text, name, keys, instructions);
      result = { model, [name]: { choice, confidence, probabilities } };
    } else {
      throw new JevError("input_invalid", `Unknown request type: ${type}`);
    }

    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(0);
  } catch (error) {
    let result;

    if (error instanceof JevError) {
      result = {
        error: error.code,
        message: error.message,
      };
    } else if (error instanceof JevContractError) {
      result = {
        error: "contract_error",
        message: error.message,
      };
    } else {
      result = {
        error: "internal_error",
        message: error.message,
      };
    }

    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error.message}\n`);
  process.exit(2);
});
