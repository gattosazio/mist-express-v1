const normalizeWhitespace = (text) =>
    text
        .replace(/\r/g, '')
        .replace(/\t/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const estimateTokenCount = (text) => {
    if (!text) return 0;
    return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
};

const splitIntoParagraphs = (text) => {
    return normalizeWhitespace(text)
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
};

const chunkDocumentText = ({
    text,
    maxChunkChars = 1200,
    overlapChars = 200,
    sectionTitle = null,
}) => {
    const paragraphs = splitIntoParagraphs(text);
    const chunks = [];

    let current = '';

    for (const paragraph of paragraphs) {
        const candidate = current ? `${current}\n\n${paragraph}` : paragraph;

        if (candidate.length <= maxChunkChars) {
            current = candidate;
            continue;
        }

        if (current) {
            chunks.push({
                section_title: sectionTitle,
                content: current.trim(),
                token_count: estimateTokenCount(current),
            });
        }

        if (paragraph.length <= maxChunkChars) {
            current = paragraph;
            continue;
        }

        let start = 0;
        while (start < paragraph.length) {
            const end = start + maxChunkChars;
            const slice = paragraph.slice(start, end).trim();

            if (slice) {
                chunks.push({
                    section_title: sectionTitle,
                    content: slice,
                    token_count: estimateTokenCount(slice),
                });
            }

            if (end >= paragraph.length) {
                break;
            }

            start = Math.max(end - overlapChars, start + 1);
        }

        current = '';
    }

    if (current.trim()) {
        chunks.push({
            section_title: sectionTitle,
            content: current.trim(),
            token_count: estimateTokenCount(current),
        });
    }

    return chunks.map((chunk, index) => ({
        ...chunk,
        chunk_index: index,
    }));
};

module.exports = {
    chunkDocumentText,
    estimateTokenCount,
};
