import assert from "node:assert/strict";
import { add, parsePair } from "./core.mjs";

assert.equal(add(parsePair({ left: 17, right: 25 })), 42);
