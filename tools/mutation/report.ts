import fs from 'node:fs';
import path from 'node:path';
function mutationScore(results: MutantResult[]): number {
  const scorable = results.filter(
    (result) => result.status === 'killed' || result.status === 'survived',
  );
  if (scorable.length === 0) return 100;
  const killed = scorable.filter((result) => result.status === 'killed').length;
  return Math.round((killed / scorable.length) * 1000) / 10;
}
import type { MutantResult } from './types.ts';

const RESULT_DIR = 'mutation';
const RESULT_FILE = 'results.json';

interface ReportBucket {
  killed: number;
  survived: number;
  compileError: number;
  timeout: number;
  noTests: number;
}

interface ReportData {
  generatedAt: string;
  total: number;
  scorable: number;
  killed: number;
  survived: number;
  compileError: number;
  timeout: number;
  noTests: number;
  score: number;
  byOperator: { operator: string; killed: number; survived: number; total: number; score: number }[];
  byFile: { file: string; killed: number; survived: number; total: number; score: number }[];
  survivors: MutantResult[];
}

/** Lê os resultados da varredura que já estão em disco. */
export function readMutationResults(root = process.cwd()): MutantResult[] {
  const file = path.join(root, RESULT_DIR, RESULT_FILE);
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { results?: MutantResult[] };
  return raw.results ?? [];
}

/** Monta o relatório estruturado; é a fonte única dos three formatos. */
export function buildReport(results: MutantResult[]): ReportData {
  const scorable = results.filter(
    (result) => result.status === 'killed' || result.status === 'survived',
  ).length;
  const killed = results.filter((result) => result.status === 'killed').length;
  const survived = results.filter((result) => result.status === 'survived').length;
  const compileError = results.filter((result) => result.status === 'compileError').length;
  const timeout = results.filter((result) => result.status === 'timeout').length;
  const noTests = results.filter((result) => result.status === 'noTests').length;

  const operatorMap = new Map<string, ReportBucket>();
  const fileMap = new Map<string, ReportBucket>();

  for (const result of results) {
    const bucket =
      operatorMap.get(result.operator) ?? { killed: 0, survived: 0, compileError: 0, timeout: 0, noTests: 0 };
    const fileBucket =
      fileMap.get(result.relFile) ?? { killed: 0, survived: 0, compileError: 0, timeout: 0, noTests: 0 };
    if (result.status === 'killed') {
      bucket.killed += 1;
      fileBucket.killed += 1;
    } else if (result.status === 'survived') {
      bucket.survived += 1;
      fileBucket.survived += 1;
    } else if (result.status === 'compileError') {
      bucket.compileError += 1;
      fileBucket.compileError += 1;
    } else if (result.status === 'timeout') {
      bucket.timeout += 1;
      fileBucket.timeout += 1;
    } else {
      bucket.noTests += 1;
      fileBucket.noTests += 1;
    }
    operatorMap.set(result.operator, bucket);
    fileMap.set(result.relFile, fileBucket);
  }

  const byOperator = [...operatorMap]
    .map(([operator, bucket]) => {
      const total = bucket.killed + bucket.survived;
      return {
        operator,
        killed: bucket.killed,
        survived: bucket.survived,
        total,
        score: total === 0 ? 100 : Math.round((bucket.killed / total) * 1000) / 10,
      };
    })
    .sort((a, b) => a.score - b.score || a.operator.localeCompare(b.operator));

  const byFile = [...fileMap]
    .map(([file, bucket]) => {
      const total = bucket.killed + bucket.survived;
      return {
        file,
        killed: bucket.killed,
        survived: bucket.survived,
        total,
        score: total === 0 ? 100 : Math.round((bucket.killed / total) * 1000) / 10,
      };
    })
    .sort((a, b) => a.score - b.score || a.file.localeCompare(b.file));

  return {
    generatedAt: new Date().toISOString(),
    total: results.length,
    scorable,
    killed,
    survived,
    compileError,
    timeout,
    noTests,
    score: results.length === 0 ? 100 : mutationScore(results),
    byOperator,
    byFile,
    survivors: results
      .filter((result) => result.status === 'survived')
      .sort((a, b) => a.relFile.localeCompare(b.relFile) || a.line - b.line),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function writeJson(root: string, report: ReportData): void {
  const target = path.join(root, RESULT_DIR, 'report.json');
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}

function writeMarkdown(root: string, report: ReportData): void {
  const lines = [
    '# Mutação',
    '',
    `Score: **${report.score.toFixed(1)}%**`,
    '',
    `- mutantes medidos: ${report.total}`,
    `- sobreviventes: ${report.survived}`,
    `- fora do denominador (linha sem cobertura): ${report.noTests}`,
    `- compileError: ${report.compileError}`,
    `- timeout: ${report.timeout}`,
    `- gerado em: ${report.generatedAt}`,
    '',
  ];

  if (report.survivors.length > 0) {
    lines.push('## Sobreviventes', '', '| Arquivo | Linha | Operador | Troca | Código |', '| --- | --- | --- | --- | --- |');
    for (const result of report.survivors) {
      lines.push(
        `| \`${result.relFile}\` | ${result.line} | ${result.operator} | ` +
          `\`${result.original}\` → \`${result.replacement}\` | \`${result.context}\` |`,
      );
    }
    lines.push('');
  }

  lines.push('## Por arquivo', '', '| Arquivo | Score | Mortos | Sobreviventes |', '| --- | --- | --- | --- |');
  for (const row of report.byFile) {
    lines.push(`| \`${row.file}\` | ${row.score.toFixed(1)}% | ${row.killed} | ${row.survived} |`);
  }
  lines.push('');

  fs.writeFileSync(path.join(root, RESULT_DIR, 'report.md'), `${lines.join('\n')}\n`);
}

function writeHtml(root: string, report: ReportData): void {
  const rows = report.survivors
    .map(
      (result) =>
        `<tr><td>${escapeHtml(result.relFile)}</td><td>${result.line}</td><td>${escapeHtml(
          result.operator,
        )}</td><td><code>${escapeHtml(result.original)}</code> → <code>${escapeHtml(
          result.replacement,
        )}</code></td><td><code>${escapeHtml(result.context)}</code></td></tr>`,
    )
    .join('');

  const fileRows = report.byFile
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.file)}</td><td>${row.score.toFixed(1)}%</td><td>${row.killed}</td><td>${
          row.survived
        }</td></tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Relatório de mutação</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #e5e7eb; background: #0f172a; }
    h1, h2 { color: #34d399; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #334155; padding: 0.5rem; text-align: left; vertical-align: top; }
    th { background: #1e293b; }
    code { font-size: 0.85rem; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; }
    .card { background: #1e293b; border-radius: 0.75rem; padding: 1rem; }
  </style>
</head>
<body>
  <h1>Relatório de mutação</h1>
  <p>Gerado em ${escapeHtml(report.generatedAt)}</p>
  <div class="summary">
    <div class="card"><strong>Score</strong><div>${report.score.toFixed(1)}%</div></div>
    <div class="card"><strong>Medidos</strong><div>${report.total}</div></div>
    <div class="card"><strong>Mortos</strong><div>${report.killed}</div></div>
    <div class="card"><strong>Sobreviventes</strong><div>${report.survived}</div></div>
    <div class="card"><strong>Compile error</strong><div>${report.compileError}</div></div>
    <div class="card"><strong>Timeout</strong><div>${report.timeout}</div></div>
  </div>
  <h2>Por arquivo</h2>
  <table><thead><tr><th>Arquivo</th><th>Score</th><th>Mortos</th><th>Sobreviventes</th></tr></thead><tbody>${fileRows}</tbody></table>
  <h2>Sobreviventes</h2>
  <table><thead><tr><th>Arquivo</th><th>Linha</th><th>Operador</th><th>Troca</th><th>Código</th></tr></thead><tbody>${rows}</tbody></table>
</body>
</html>
`;

  fs.writeFileSync(path.join(root, RESULT_DIR, 'report.html'), html);
}

/** Gera todos os relatórios a partir dos resultados já gravados. */
export function writeReports(root = process.cwd()): ReportData {
  const results = readMutationResults(root);
  const report = buildReport(results);
  fs.mkdirSync(path.join(root, RESULT_DIR), { recursive: true });
  writeJson(root, report);
  writeMarkdown(root, report);
  writeHtml(root, report);
  return report;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const report = writeReports(root);
  process.stdout.write(
    `relatório gerado: ${report.killed}/${report.scorable} mortos (${report.score.toFixed(1)}%), ` +
      `${report.survived} sobreviventes\n` +
      `arquivos: mutation/report.json, mutation/report.md, mutation/report.html\n`,
  );
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], 'file://').href;
if (isMain) await main();