const env = require('../../../config/env');

const buildEmbedUrl = () => `${env.ollama.baseUrl.replace(/\/$/, '')}/api/embed`;

const embedTexts = async (inputs = []) => {
    if (!Array.isArray(inputs) || inputs.length === 0) {
        return [];
    }

    const response = await fetch(buildEmbedUrl(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: env.ollama.embedModel,
            input: inputs,
            truncate: true,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama embedding request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data.embeddings)) {
        throw new Error('Ollama embedding response did not contain an embeddings array.');
    }

    return data.embeddings;
};

const embedText = async (input) => {
    const embeddings = await embedTexts([input]);
    const embedding = embeddings[0];

    if (!Array.isArray(embedding)) {
        throw new Error('Ollama embedding response did not contain a valid embedding.');
    }

    return embedding;
};

module.exports = {
    embedText,
    embedTexts,
};
