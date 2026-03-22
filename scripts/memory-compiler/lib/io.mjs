import fs from 'fs';

export function readJsonInput(inputPath) {
  const raw = inputPath
    ? fs.readFileSync(inputPath, 'utf8')
    : fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

export function printResult(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}
