import { askJevNoul, askJevChoice, askJevScore, JevError, JevContractError } from "../src/client.mjs";

// Exit codes: 0=success, 1=input/json error, 2=auth error, 3=provider error, 4=contract error, 5=internal/fatal
const EXIT_SUCCESS = 0;
const EXIT_INPUT_ERROR = 1;
const EXIT_AUTH_ERROR = 2;
const EXIT_PROVIDER_ERROR = 3;
const EXIT_CONTRACT_ERROR = 4;
const EXIT_FATAL = 5;

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
      message: "Failed to parse stdin as JSON",
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = EXIT_INPUT_ERROR;
    return;
  }

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    const result = {
      error: "invalid_request",
      message: "Request must be an object",
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = EXIT_INPUT_ERROR;
    return;
  }

  const { type, text, criteria, question } = request;

  try {
    if (!type || (type !== "noul" && type !== "choice" && type !== "score")) {
      throw new JevError("input_invalid", `Unknown request type: ${type}`);
    }

    if (!apiKey) {
      throw new JevError("auth_missing", "JEV_API_KEY environment variable not set");
    }

    let result;
    if (type === "noul") {
      const { model, noul } = await askJevNoul({
        text,
        question,
        apiKey,
        fetch: globalThis.fetch,
      });
      result = { model, noul };
    } else if (type === "choice") {
      const { model, choice } = await askJevChoice({
        text,
        criteria,
        instructions: question,
        apiKey,
        fetch: globalThis.fetch,
      });
      result = { model, choice };
    } else if (type === "score") {
      const { model, score } = await askJevScore({
        text,
        criteria,
        instructions: question,
        apiKey,
        fetch: globalThis.fetch,
      });
      result = { model, score };
    }

    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = EXIT_SUCCESS;
  } catch (error) {
    let result;
    let exitCode;

    if (error instanceof JevError) {
      result = {
        error: error.code,
        message: error.message,
      };
      if (error.code === "auth_missing") {
        exitCode = EXIT_AUTH_ERROR;
      } else if (error.code === "provider_unreachable" || error.code === "provider_error" || error.code === "provider_invalid_response") {
        exitCode = EXIT_PROVIDER_ERROR;
      } else {
        exitCode = EXIT_INPUT_ERROR;
      }
    } else if (error instanceof JevContractError) {
      result = {
        error: "contract_error",
        message: error.message,
      };
      exitCode = EXIT_CONTRACT_ERROR;
    } else {
      result = {
        error: "internal_error",
        message: error.message,
      };
      exitCode = EXIT_FATAL;
    }

    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = exitCode;
  }
}

main().catch((error) => {
  const result = {
    error: "fatal",
    message: error.message,
  };
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exitCode = EXIT_FATAL;
});
