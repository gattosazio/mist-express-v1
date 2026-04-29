const { UNVERIFIABLE_ANSWER } = require('./answerGenerator');

const buildPolicyRedirectResponse = () => {
    return {
        mode: 'policy_redirect',
        answer:
            'I can help with company policies and procedures. Ask me a policy question, and include the department if it matters, for example: "What is the visitor policy for Security?"',
        confidence: 'low',
        escalationNeeded: false,
        needsClarification: false,
        clarificationType: null,
        clarificationOptions: [],
        citations: [],
        retrievedChunks: [],
        retrievalMethod: 'policy_redirect',
        resolvedPolicyType: null,
        resolvedDepartment: null,
        conversationState: null,
    };
};

const buildRetrievedChunkResponse = (retrievedChunks = [], retrievalMethod) =>
    retrievedChunks.map((chunk) => ({
        id: chunk.id,
        documentTitle: chunk.document_title,
        sectionTitle: chunk.section_title,
        chunkIndex: chunk.chunk_index,
        retrievalScore: chunk.retrieval_score,
        retrievalMethod: chunk.retrieval_method || retrievalMethod,
        policyType: chunk.policy_type,
        sourceUrl: chunk.source_url,
        version: chunk.version,
        department: chunk.metadata?.department || null,
    }));

const buildUnverifiablePolicyResponse = ({
    retrievalMethod = 'semantic',
    retrievedChunks = [],
    answer = UNVERIFIABLE_ANSWER,
    resolvedPolicyType = null,
    resolvedDepartment = null,
} = {}) => {
    return {
        answer,
        confidence: 'low',
        escalationNeeded: true,
        needsClarification: false,
        clarificationType: null,
        clarificationOptions: [],
        citations: [],
        retrievedChunks: buildRetrievedChunkResponse(
            retrievedChunks,
            retrievalMethod
        ),
        retrievalMethod,
        resolvedPolicyType,
        resolvedDepartment,
    };
};

module.exports = {
    buildPolicyRedirectResponse,
    buildRetrievedChunkResponse,
    buildUnverifiablePolicyResponse,
};
