const OpenAI = require('openai');
const {
    DEFAULT_GROQ_BASE_URL,
    DEFAULT_GROQ_MODEL,
    MISSU_SYSTEM_PROMPT,
} = require('./constants');

const createLlmResponder = (env) => {
    const client = new OpenAI({
        apiKey: env.groqApiKey,
        baseURL: env.groqBaseURL || DEFAULT_GROQ_BASE_URL,
    });

    const model = env.groqModel || DEFAULT_GROQ_MODEL;

    const generateAssistantReply = async (inputText) => {
        const completion = await client.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: MISSU_SYSTEM_PROMPT },
                { role: 'user', content: inputText },
            ],
            temperature: 0.3,
            max_tokens: 120,
        });

        const reply = completion.choices[0]?.message?.content?.trim();

        if (!reply) {
            throw new Error('LLM returned an empty response.');
        }

        return reply;
    };

    const extractRetryDelayMs = (error) => {
        const retryAfterHeader = error?.headers?.get?.('retry-after');
        if (!retryAfterHeader) return null;

        const seconds = parseInt(retryAfterHeader, 10);
        if (Number.isNaN(seconds)) return null;

        return seconds * 1000;
    };

    return {
        generateAssistantReply,
        extractRetryDelayMs,
    };
};

module.exports = { createLlmResponder };
