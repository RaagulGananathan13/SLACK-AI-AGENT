// Scores the fixed personas in cases.json and checks each one lands in its expected band.
//
//   npm run eval
//   npm run eval -- --provider gemini --model gemini-3.8-flash --out results.json
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
    options: {
        provider: { type: 'string' },
        model: { type: 'string' },
        out: { type: 'string' },
        'min-pass': { type: 'string', default: '0.8' }
    }
});

const dataset = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));

// has to happen before config.js loads. Flags beat .env, and the eval pins its own
// company so runs against different models stay comparable.
if (values.provider) process.env.LLM_PROVIDER = values.provider;
if (values.model) process.env.LLM_MODEL = values.model;
process.env.COMPANY_NAME = dataset.company.name;
process.env.COMPANY_PRODUCT = dataset.company.product;
process.env.COMPANY_ICP = dataset.company.idealCustomer;
process.env.LOG_LEVEL ??= 'warn';

const { default: config, configErrors } = await import('../src/config.js');
const { createChatModel } = await import('../src/ai/llm.js');
const { runEval, summarize } = await import('./harness.js');

const llmErrors = configErrors().filter(error => /LLM|API key/.test(error));
if (llmErrors.length > 0) {
    console.error(llmErrors.join('\n'));
    process.exit(1);
}

const pad = (text, width) => String(text).padEnd(width);
const row = (...columns) => `  ${pad(columns[0], 24)}${pad(columns[1], 10)}${pad(columns[2], 7)}${pad(columns[3], 8)}${pad(columns[4], 8)}${columns[5]}`;

console.log(`\nEvaluating ${config.llm.provider} (${config.llm.model}) on ${dataset.cases.length} cases\n`);
console.log(row('case', 'expected', 'score', 'conf', 'time', 'result'));

const results = await runEval(createChatModel(), dataset.cases, {
    onResult: result => console.log(row(
        result.id,
        `${result.expect.min}-${result.expect.max}`,
        result.analysis?.fitScore ?? '-',
        result.analysis?.confidence ?? '-',
        `${(result.ms / 1000).toFixed(1)}s`,
        result.pass ? '✔' : `✖ ${result.problems.join('; ')}`
    ))
});

const summary = summarize(results);
const distance = summary.meanDistance === null ? 'n/a' : summary.meanDistance.toFixed(1);
console.log(`\n${summary.passed}/${summary.total} passed · ${distance} points outside the band on average · ${(summary.averageMs / 1000).toFixed(1)}s per case\n`);

if (values.out) {
    const report = { provider: config.llm.provider, model: config.llm.model, ranAt: new Date().toISOString(), summary, results };
    await writeFile(values.out, JSON.stringify(report, null, 2));
    console.log(`Saved ${values.out}`);
}

process.exit(summary.passRate >= Number(values['min-pass']) ? 0 : 1);
