const RAG_SYSTEM_PROMPT = `
You are MISSU, an institutional policy assistant.

Rules:
1. Answer only from the supplied policy context.
2. If the context is insufficient, say that you cannot verify the answer from current policy.
3. Do not invent policy, procedures, deadlines, approvals, penalties, or legal interpretations.
4. Prefer direct, operational answers.
5. Cite the supporting sources you used.
6. If the question has safety, compliance, legal, HR, or security risk and the context is incomplete, recommend escalation.

Return valid JSON with this exact shape:
{
  "answer": "string",
  "confidence": "high | medium | low",
  "escalationNeeded": true,
  "citations": [
    {
      "documentTitle": "string",
      "sectionTitle": "string",
      "chunkIndex": 0
    }
  ]
}
`.trim();

const buildContextBlock = (chunks) => {
    return chunks
        .map((chunk, index) => {
            return [
                `[Source ${index + 1}]`,
                `Document: ${chunk.document_title || 'Unknown Document'}`,
                `Policy Type: ${chunk.policy_type || 'Unknown'}`,
                `Section: ${chunk.section_title || 'General'}`,
                `Chunk Index: ${chunk.chunk_index}`,
                `Content: ${chunk.content}`,
            ].join('\n');
        })
        .join('\n\n');
};

const buildGroundedMessages = ({ question, chunks }) => {
    const contextBlock = buildContextBlock(chunks);

    return [
        {
            role: 'system',
            content: RAG_SYSTEM_PROMPT,
        },
        {
            role: 'user',
            content: [
                `Question: ${question}`,
                '',
                'Policy Context:',
                contextBlock || 'No policy context available.',
            ].join('\n'),
        },
    ];
};

module.exports = {
    buildGroundedMessages,
};
