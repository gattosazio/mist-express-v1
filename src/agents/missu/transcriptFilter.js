const {
    MIN_TRANSCRIPT_CHARS,
    MIN_TRANSCRIPT_WORDS,
    DUPLICATE_WINDOW_MS,
    LLM_COOLDOWN_MS,
    REQUIRE_WAKE_WORD,
    WAKE_WORDS,
} = require('./constants');

const normalizeTranscript = (text) =>
    text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const countWords = (text) => {
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
};

const startsWithWakeWord = (text) => {
    const normalized = normalizeTranscript(text);
    return WAKE_WORDS.some((wakeWord) => normalized.startsWith(wakeWord));
};

const stripWakeWord = (text) => {
    const normalized = normalizeTranscript(text);

    for (const wakeWord of WAKE_WORDS) {
        if (normalized.startsWith(wakeWord)) {
            const pattern = new RegExp(`^${wakeWord}[,\\s:.-]*`, 'i');
            return text.replace(pattern, '').trim();
        }
    }

    return text.trim();
};

const createTranscriptGate = () => {
    let lastAcceptedTranscript = '';
    let lastAcceptedAt = 0;
    let nextLlmAllowedAt = 0;

    const evaluate = (transcript, now = Date.now()) => {
        if (REQUIRE_WAKE_WORD && !startsWithWakeWord(transcript)) {
            return { accepted: false, reason: 'missing_wake_word', transcript };
        }

        const cleanedTranscript = REQUIRE_WAKE_WORD
            ? stripWakeWord(transcript)
            : transcript;

        const normalizedCleanedTranscript = normalizeTranscript(cleanedTranscript);

        if (!normalizedCleanedTranscript) {
            return { accepted: false, reason: 'empty_after_cleanup' };
        }

        if (cleanedTranscript.length < MIN_TRANSCRIPT_CHARS) {
            return {
                accepted: false,
                reason: 'too_short',
                cleanedTranscript,
            };
        }

        if (countWords(cleanedTranscript) < MIN_TRANSCRIPT_WORDS) {
            return {
                accepted: false,
                reason: 'too_few_words',
                cleanedTranscript,
            };
        }

        if (
            normalizedCleanedTranscript === lastAcceptedTranscript &&
            now - lastAcceptedAt < DUPLICATE_WINDOW_MS
        ) {
            return {
                accepted: false,
                reason: 'duplicate',
                cleanedTranscript,
            };
        }

        if (now < nextLlmAllowedAt) {
            return {
                accepted: false,
                reason: 'cooldown',
                cleanedTranscript,
                waitSeconds: Math.ceil((nextLlmAllowedAt - now) / 1000),
            };
        }

        return {
            accepted: true,
            cleanedTranscript,
            normalizedCleanedTranscript,
        };
    };

    const markAccepted = (normalizedTranscript, now = Date.now()) => {
        lastAcceptedTranscript = normalizedTranscript;
        lastAcceptedAt = now;
        nextLlmAllowedAt = now + LLM_COOLDOWN_MS;
    };

    const defer = (delayMs, now = Date.now()) => {
        nextLlmAllowedAt = now + delayMs;
    };

    return {
        evaluate,
        markAccepted,
        defer,
    };
};

module.exports = {
    normalizeTranscript,
    countWords,
    startsWithWakeWord,
    stripWakeWord,
    createTranscriptGate,
};
