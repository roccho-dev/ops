import fs from 'node:fs';
import { validateCliInput } from '../../packages/jev-review/bin/jev-review.mjs';

const input = JSON.parse(
  fs.readFileSync(new URL('./iteration.json', import.meta.url), 'utf8'),
);

validateCliInput(input);
process.stdout.write('jev iteration input: ok\n');
