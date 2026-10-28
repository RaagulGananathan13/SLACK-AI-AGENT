import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';

import config from '../config.js';
import log from '../logger.js';

export function createChatModel() {
    const { model, apiKey } = config.openai;
    return new ChatOpenAI({
        model,
        temperature: 0.3,
        apiKey,
        // gpt-6 models reject temperature/tools on chat completions unless reasoning is off
        ...(model.startsWith('gpt-6') && { modelKwargs: { reasoning_effort: 'none' } })
    });
}

export async function analyzeMember(model, memberInfo, researchData) {
    const prompt = ChatPromptTemplate.fromTemplate(
        `Analyze this new community member for fit with our commercial
    product.

    Company: ${config.company.name}
    Product: ${config.company.product}

    Member:
    - Name: {name}
    - Email: {email}
    - Title: {title}

    Research Data:
    {research}

    Provide a JSON response with:
    - fitScore (0-100): likelihood they'd be interested in our product
    - insights: array of 3-5 key observations
    - recommendations: array of 2-4 engagement suggestions

    Consider job title, company size, technical background, and budget
    authority.`
    );

    try {
        const researchSummary = researchData.length > 0
            ? researchData.map(r => `${r.title}: ${r.content}`).join('\n')
            : 'Limited research data available'

        const chain = prompt.pipe(model);
        const result = await chain.invoke({
            name: memberInfo.name,
            email: memberInfo.email || 'Not provided',
            title: memberInfo.title || 'not provided',
            research: researchSummary
        });

        const responseText = result.content || result;

        const cleanedResponse =
            responseText.replace(/```json\n?|\n?```/g, '').trim()

        const analysis = JSON.parse(cleanedResponse)
        const score = Number(analysis.fitScore)

        return {
            fitScore: Number.isFinite(score) ? Math.round(Math.max(0, Math.min(100, score))) : 50,
            insights: Array.isArray(analysis.insights) ? analysis.insights : ['Analysis completed'],
            recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : ['Follow up recommended']
        }

    } catch (error) {
        log.error('AI analysis error:', error.message);
        return {
            fitScore: 50,
            insights: ['Unable to complete full analysis'],
            recommendations: ['Manual review recommended']
        }
    }
}
