// Copia la lógica pura de la app (tipos, contrato y fechas) a la carpeta
// compartida de las Edge Functions, para que el agente calcule exactamente
// igual que la interfaz. Las Edge Functions solo empaquetan lo que está
// dentro de supabase/functions, por eso se copian los archivos.
//
// Uso: npm run agent:sync   (ejecutar cada vez que cambien esos archivos)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = resolve(root, 'supabase/functions/_shared/finance');

const files = [
  { from: 'src/types/finance.ts', to: 'finance.ts' },
  { from: 'src/utils/date.ts', to: 'date.ts' },
  { from: 'src/utils/contract.ts', to: 'contract.ts' },
  { from: 'src/utils/debtPlanner.ts', to: 'debtPlanner.ts' },
  { from: 'src/utils/payrollAdvisor.ts', to: 'payrollAdvisor.ts' },
  { from: 'src/utils/antLearner.ts', to: 'antLearner.ts' },
];

// Deno exige la extensión en los imports relativos.
const rewrites = [
  [/from '\.\.\/types\/finance'/g, "from './finance.ts'"],
  [/from '\.\/date'/g, "from './date.ts'"],
  [/from '\.\/contract'/g, "from './contract.ts'"],
  [/from '\.\/debtPlanner'/g, "from './debtPlanner.ts'"],
];

mkdirSync(target, { recursive: true });

for (const file of files) {
  let source = readFileSync(resolve(root, file.from), 'utf8');
  for (const [pattern, replacement] of rewrites) {
    source = source.replace(pattern, replacement);
  }
  const header = `// ARCHIVO GENERADO desde ${file.from} con "npm run agent:sync". No editar aquí.\n\n`;
  writeFileSync(resolve(target, file.to), header + source);
  console.log(`copiado ${file.from} -> supabase/functions/_shared/finance/${file.to}`);
}
