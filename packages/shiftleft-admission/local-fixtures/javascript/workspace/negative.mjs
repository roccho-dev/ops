import assert from "node:assert/strict";
import { parsePair } from "./core.mjs";

assert.throws(() => parsePair({ left: "17", right: 25 }), TypeError);
