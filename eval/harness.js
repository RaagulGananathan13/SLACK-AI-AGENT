import { analyzeMember } from '../src/ai/analyzer.js';

export function checkCase(expect, analysis) {
    const problems = [];
    if (analysis.fitScore < expect.min || analysis.fitScore > expect.max) {
        problems.push(`score ${analysis.fitScore} outside ${expect.min}-${expect.max}`);
    }
    if (expect.confidence && analysis.confidence !== expect.confidence) {
        problems.push(`confidence ${analysis.confidence}, expected ${expect.confidence}`);
    }

    // how far outside the band it landed, 0 when inside
    const distance = Math.max(0, expect.min - analysis.fitScore, analysis.fitScore - expect.max);
    return { pass: problems.length === 0, problems, distance };
}

// sequential on purpose: free tiers rate limit hard and latency per case is part of the report
export async function runEval(model, cases, { onResult = () => {} } = {}) {
    const results = [];

    for (const testCase of cases) {
        const started = Date.now();
        let result;
        try {
            const analysis = await analyzeMember(model, testCase.member, testCase.research);
            result = { id: testCase.id, analysis, ...checkCase(testCase.expect, analysis) };
        } catch (error) {
            result = { id: testCase.id, pass: false, problems: [error.message], distance: null };
        }

        result.expect = testCase.expect;
        result.ms = Date.now() - started;
        results.push(result);
        onResult(result);
    }
    return results;
}

export function summarize(results) {
    const passed = results.filter(result => result.pass).length;
    const scored = results.filter(result => result.distance !== null);
    const average = (list, pick) => list.length ? list.reduce((sum, item) => sum + pick(item), 0) / list.length : null;

    return {
        passed,
        total: results.length,
        passRate: results.length ? passed / results.length : 0,
        meanDistance: average(scored, result => result.distance),
        averageMs: Math.round(average(results, result => result.ms) ?? 0)
    };
}
