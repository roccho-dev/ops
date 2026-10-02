import { evaluateAll } from "../src/index.mjs";
console.log(JSON.stringify(evaluateAll({kind:process.argv[2]??"source"})));
