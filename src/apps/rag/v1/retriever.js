const normalizeText = (text) =>
    text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const STOP_WORDS = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'for',
    'to',
    'of',
    'in',
    'on',
    'at',
    'by',
    'with',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'do',
    'does',
    'did',
    'can',
    'could',
    'should',
    'would',
    'will',
    'may',
    'might',
    'i',
    'we',
    'you',
    'they',
    'he',
    'she',
    'it',
    'this',
    'that',
    'these',
    'those',
    'what',
    'when',
    'where',
    'why',
    'how',
]);

const tokenize = (text) =>
    normalizeText(text)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token && !STOP_WORDS.has(token));

const scoreChunk = (question, chunk) => {
    const questionTokens = tokenize(question);
    const chunkText = normalizeText(
        [
            chunk.section_title, 
            chunk.content, 
            chunk.document_title, 
            chunk.policy_type].filter(Boolean).join(' ')
    );

    if (!questionTokens.length || !chunkText) {
        return 0;
    }

    let score = 0;

    for (const token of questionTokens) {
        if (chunkText.includes(token)) {
            score += 2;
        }
    }

    const exactQuestion = normalizeText(question);
    if (exactQuestion && chunkText.includes(exactQuestion)) {
        score += 10;
    }

    if (chunk.policy_type && question.toLowerCase().includes(String(chunk.policy_type).toLowerCase())) {
        score += 3;
    }

    return score;
};

const retrieveRelevantChunks = ({ 
    question, 
    chunks, 
    topK = 5, 
    minScore = 2 
}) => {
    return chunks
        .map((chunk) => ({
            ...chunk,
            retrieval_score: scoreChunk(question, chunk),
        }))
        .filter((chunk) => chunk.retrieval_score >= minScore)
        .sort((a, b) => b.retrieval_score - a.retrieval_score)
        .slice(0, topK);
};

module.exports = {
    retrieveRelevantChunks,
};
