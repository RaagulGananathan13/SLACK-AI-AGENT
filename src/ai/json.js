import { HumanMessage } from '@langchain/core/messages';

function closingBrace(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const char = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
        } else if (char === '"') {
            inString = true;
        } else if (char === '{') {
            depth++;
        } else if (char === '}' && --depth === 0) {
            return i;
        }
    }
    return -1;
}

// Models wrap JSON in code fences, put a sentence in front of it, or (reasoning models)
// dump their thinking first. Take the first {...} block that actually parses.
export function extractJson(text) {
    const cleaned = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '');

    let start = cleaned.indexOf('{');
    while (start !== -1) {
        const end = closingBrace(cleaned, start);
        if (end !== -1) {
            try {
                return JSON.parse(cleaned.slice(start, end + 1));
            } catch {
                // not valid json, try the next brace
            }
        }
        start = cleaned.indexOf('{', start + 1);
    }
    throw new Error('no JSON object found in the response');
}

const describeIssues = error => error.issues
    .slice(0, 5)
    .map(issue => `${issue.path.join('.') || 'value'}: ${issue.message}`)
    .join('; ');

// Plain prompting + validation works with every provider, including the free models that
// don't support tool calling or json mode, which is why this doesn't use withStructuredOutput.
export async function invokeStructured(model, messages, schema, { repairs = 1 } = {}) {
    const history = [...messages];
    let problem;

    for (let attempt = 0; attempt <= repairs; attempt++) {
        const response = await model.invoke(history);
        try {
            const result = schema.safeParse(extractJson(response.text));
            if (result.success) return result.data;
            problem = describeIssues(result.error);
        } catch (error) {
            problem = error.message;
        }

        history.push(response, new HumanMessage(
            `That reply could not be used (${problem}). Answer again with only the corrected JSON object.`
        ));
    }
    throw new Error(`Model returned invalid output: ${problem}`);
}
