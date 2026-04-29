const {
    HIGH_SIMILARITY_THRESHOLD,
    MEDIUM_SIMILARITY_THRESHOLD,
} = require('./constants');

const normalizeForMatch = (value = '') => {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, ' ');
};

const tokenizeQuestion = (text = '') => {
    return normalizeForMatch(text)
        .split(' ')
        .map((token) => token.trim())
        .filter(Boolean);
};

const getTopRetrievalScore = (retrievedChunks = []) => {
    if (!Array.isArray(retrievedChunks) || !retrievedChunks.length) {
        return 0;
    }

    return Number(retrievedChunks[0]?.retrieval_score || 0);
};

const classifyRetrievalConfidence = (topScore) => {
    if (topScore >= HIGH_SIMILARITY_THRESHOLD) {
        return 'high';
    }

    if (topScore >= MEDIUM_SIMILARITY_THRESHOLD) {
        return 'medium';
    }

    return 'low';
};

const scoreChunkWithQuestionSignals = (question, chunk) => {
    const normalizedQuestion = normalizeForMatch(question);
    const chunkText = normalizeForMatch(
        [
            chunk.section_title,
            chunk.content,
            chunk.document_title,
            chunk.policy_type,
            chunk.metadata?.department,
        ]
            .filter(Boolean)
            .join(' ')
    );

    if (!normalizedQuestion || !chunkText) {
        return 0;
    }

    const questionTokens = [...new Set(tokenizeQuestion(question))];
    let score = 0;

    for (const token of questionTokens) {
        if (token.length < 3) {
            continue;
        }

        if (chunkText.includes(token)) {
            score += 1.5;
        }
    }

    const exactPhrases = [
        'who approves',
        'approval',
        'mfa',
        'multi factor',
        'multi-factor',
        'vpn',
        'device',
        'devices',
        'security incident',
        'report',
        'notify',
        'without an escort',
        'temporary access pass',
        'stipend',
        'reimbursement',
        'leave approval',
    ];

    for (const phrase of exactPhrases) {
        if (normalizedQuestion.includes(phrase) && chunkText.includes(phrase)) {
            score += 4;
        }
    }

    if (
        normalizedQuestion.includes('approve') &&
        (
            chunkText.includes('approve') ||
            chunkText.includes('approval') ||
            chunkText.includes('manager') ||
            chunkText.includes('director') ||
            chunkText.includes('department head') ||
            chunkText.includes('designee')
        )
    ) {
        score += 5;
    }

    if (
        normalizedQuestion.includes('report') &&
        (
            chunkText.includes('report') ||
            chunkText.includes('notify') ||
            chunkText.includes('immediately') ||
            chunkText.includes('hours')
        )
    ) {
        score += 5;
    }

    return score;
};

const mergeRankedChunks = ({
    question,
    semanticChunks = [],
    lexicalChunks = [],
    topK = 5,
}) => {
    const merged = new Map();

    const lexicalMaxScore = Math.max(
        ...lexicalChunks.map((chunk) => Number(chunk.retrieval_score || 0)),
        0
    );

    for (const chunk of semanticChunks) {
        merged.set(chunk.id, {
            ...chunk,
            semanticScore: Number(chunk.retrieval_score || 0),
            lexicalScore: 0,
        });
    }

    for (const chunk of lexicalChunks) {
        const existing = merged.get(chunk.id);

        if (existing) {
            existing.lexicalScore = Number(chunk.retrieval_score || 0);
        } else {
            merged.set(chunk.id, {
                ...chunk,
                semanticScore: 0,
                lexicalScore: Number(chunk.retrieval_score || 0),
            });
        }
    }

    return Array.from(merged.values())
        .map((chunk) => {
            const normalizedLexical =
                lexicalMaxScore > 0 ? chunk.lexicalScore / lexicalMaxScore : 0;

            const semanticScore = chunk.semanticScore;
            const signalBoost = scoreChunkWithQuestionSignals(question, chunk) / 12;

            const combinedScore =
                semanticScore > 0
                    ? semanticScore * 0.6 + normalizedLexical * 0.25 + signalBoost
                    : normalizedLexical * 0.75 + signalBoost;

            return {
                ...chunk,
                retrieval_score: combinedScore,
                retrieval_method:
                    chunk.semanticScore > 0 && chunk.lexicalScore > 0
                        ? 'hybrid'
                        : chunk.semanticScore > 0
                          ? 'semantic'
                          : 'lexical',
            };
        })
        .sort((a, b) => b.retrieval_score - a.retrieval_score)
        .slice(0, topK);
};

module.exports = {
    normalizeForMatch,
    tokenizeQuestion,
    getTopRetrievalScore,
    classifyRetrievalConfidence,
    scoreChunkWithQuestionSignals,
    mergeRankedChunks,
};
