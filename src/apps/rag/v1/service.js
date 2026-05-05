const { chunkDocumentText } = require('./chunker');
const { embedTexts } = require('./embedder');
const { ensureVectorSchema, upsertChunkEmbeddings } = require('./vectorStore');
const { sequelize } = require('../../../config/database');
const Document = require('../../../models/document');
const DocumentChunk = require('../../../models/document_chunk');

const { understandUserTurn } = require('./turnUnderstanding');
const {
    getAvailablePolicyTypes,
    getAvailableDepartments,
    retrievePolicyContext,
} = require('./retrievalPipeline');
const { attachConversationState } = require('./conversationState');
const { generateGroundedAnswer } = require('./answerGenerator');
const {
    buildPolicyRedirectResponse,
    buildRetrievedChunkResponse,
    buildUnverifiablePolicyResponse,
} = require('./responseBuilders');

const normalizeValue = (value) => {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    return normalized ? normalized : null;
};

const normalizeDepartment = (value) => normalizeValue(value);

const buildIngestMetadata = ({
    department,
    policy_type = null,
    source_type = null,
    source_filename = null,
    source_url = null,
    version = null,
    effective_date = null,
    metadata = {},
}) => {
    return {
        department,
        policy_type: normalizeValue(policy_type),
        source_type: normalizeValue(source_type),
        source_filename: normalizeValue(source_filename),
        source_url: normalizeValue(source_url),
        version: normalizeValue(version),
        effective_date: normalizeValue(effective_date),
        ...metadata,
    };
};

const ingestDocument = async (payload = {}) => {
    const {
        networkId,
        title,
        content,
        department,
        source_url = null,
        source_type = null,
        source_filename = null,
        policy_type = null,
        version = null,
        effective_date = null,
        status = 'active',
        metadata = {},
        section_title = null,
    } = payload;

    const normalizedTitle = normalizeValue(title);
    const normalizedContent = normalizeValue(content);
    const normalizedDepartment = normalizeDepartment(department);

    if (!networkId) {
        throw new Error('Network is required.');
    }

    if (!normalizedTitle || !normalizedContent) {
        throw new Error('Both title and content are required.');
    }

    if (!normalizedDepartment) {
        throw new Error('Department is required.');
    }

    const chunks = chunkDocumentText({
        text: normalizedContent,
        sectionTitle: section_title,
    });

    if (!chunks.length) {
        throw new Error('No chunks were created from the provided content.');
    }

    const ingestMetadata = buildIngestMetadata({
        department: normalizedDepartment,
        policy_type,
        source_type,
        source_filename,
        source_url,
        version,
        effective_date,
        metadata,
    });

    const transaction = await sequelize.transaction();

    let document;
    let createdChunks;

    try {
        document = await Document.create(
            {
                network_id: networkId,
                title: normalizedTitle,
                source_url,
                policy_type,
                version,
                effective_date,
                status,
                metadata: ingestMetadata,
            },
            { transaction }
        );

        createdChunks = await DocumentChunk.bulkCreate(
            chunks.map((chunk) => ({
                document_id: document.id,
                network_id: networkId,
                chunk_index: chunk.chunk_index,
                section_title: chunk.section_title,
                content: chunk.content,
                token_count: chunk.token_count,
                metadata: ingestMetadata,
            })),
            {
                transaction,
                returning: true,
            }
        );

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    let embeddingsCreated = 0;
    let embeddingStatus = 'not_started';

    try {
        await ensureVectorSchema();

        const chunkTexts = createdChunks.map((chunk) => chunk.content);
        const embeddings = await embedTexts(chunkTexts);

        await upsertChunkEmbeddings(
            createdChunks.map((chunk, index) => ({
                chunkId: chunk.id,
                documentId: document.id,
                embedding: embeddings[index],
            }))
        );

        embeddingsCreated = embeddings.length;
        embeddingStatus = 'completed';
    } catch (error) {
        embeddingStatus = `failed: ${error.message}`;
        console.error('\x1b[31m[EMBEDDING ERROR]\x1b[0m', error);
    }

    return {
        documentId: document.id,
        networkId,
        department: normalizedDepartment,
        chunkCount: chunks.length,
        embeddingsCreated,
        embeddingStatus,
        sourceType: source_type || 'json',
        sourceFilename: source_filename,
    };
};

const askPolicyQuestionStrict = async (payload = {}) => {
    return askPolicyQuestion(payload);
};

const askPolicyQuestion = async (payload = {}) => {
    const normalizedPayload =
        payload?.data && typeof payload.data === 'object'
            ? payload.data
            : payload || {};

    const {
        networkId,
        question,
        conversationState = null,
    } = normalizedPayload;

    if (!networkId) {
        throw new Error('Network is required.');
    }

    if (!question) {
        throw new Error('Question is required.');
    }

    const [availablePolicyTypes, availableDepartments] = await Promise.all([
        getAvailablePolicyTypes(networkId),
        getAvailableDepartments(networkId),
    ]);

    const turn = await understandUserTurn({
        question,
        conversationState,
        availablePolicyTypes,
        availableDepartments,
    });

    if (!turn.isPolicyQuestion) {
        return buildPolicyRedirectResponse();
    }

    if (turn.needsClarification) {
        return attachConversationState({
            response: {
                mode: 'policy_specific',
                answer: turn.clarificationQuestion,
                confidence: 'medium',
                escalationNeeded: false,
                needsClarification: true,
                clarificationType: turn.clarificationType,
                clarificationOptions: turn.clarificationOptions,
                citations: [],
                retrievedChunks: [],
                retrievalMethod: 'clarification',
                resolvedPolicyType: turn.policyType,
                resolvedDepartment: turn.department,
            },
            turn,
            previousState: conversationState,
        });
    }

    const retrieval = await retrievePolicyContext({
        networkId,
        normalizedQuestion: turn.normalizedQuestion,
        policyType: turn.policyType,
        department: turn.department,
        explicitPolicyType: turn.explicitPolicyType,
        explicitDepartment: turn.explicitDepartment,
        suppressClarification: turn.suppressClarification,
    });

    if (retrieval.needsClarification) {
        return attachConversationState({
            response: {
                mode: 'policy_specific',
                answer: retrieval.clarificationQuestion,
                confidence: 'medium',
                escalationNeeded: false,
                needsClarification: true,
                clarificationType: retrieval.clarificationType,
                clarificationOptions: retrieval.clarificationOptions,
                citations: [],
                retrievedChunks: buildRetrievedChunkResponse(
                    retrieval.retrievedChunks,
                    retrieval.retrievalMethod
                ),
                retrievalMethod: retrieval.retrievalMethod,
                resolvedPolicyType: turn.policyType,
                resolvedDepartment: turn.department,
            },
            turn,
            previousState: conversationState,
        });
    }

    if (!retrieval.retrievedChunks.length) {
        const answer = retrieval.noMatchingDepartment && turn.department
            ? `I could not verify a ${turn.department}-specific answer from the current policy context.`
            : 'I could not verify that from the current policy context.';

        return attachConversationState({
            response: {
                mode: 'policy_specific',
                ...buildUnverifiablePolicyResponse({
                    retrievalMethod: retrieval.retrievalMethod,
                    retrievedChunks: retrieval.retrievedChunks,
                    answer,
                    resolvedPolicyType: turn.policyType,
                    resolvedDepartment: turn.department,
                }),
            },
            turn,
            previousState: conversationState,
        });
    }

    if (retrieval.retrievalConfidence === 'low') {
        return attachConversationState({
            response: {
                mode: 'policy_specific',
                ...buildUnverifiablePolicyResponse({
                    retrievalMethod: retrieval.retrievalMethod,
                    retrievedChunks: retrieval.retrievedChunks,
                    answer: 'I could not verify that from the current policy context.',
                    resolvedPolicyType: turn.policyType,
                    resolvedDepartment: turn.department,
                }),
            },
            turn,
            previousState: conversationState,
        });
    }

    const answer = await generateGroundedAnswer({
        question: turn.normalizedQuestion,
        retrievedChunks: retrieval.retrievedChunks,
        retrievalConfidence: retrieval.retrievalConfidence,
        policyType: turn.policyType,
        department: turn.department,
    });

    return attachConversationState({
        response: {
            mode: 'policy_specific',
            answer: answer.answer,
            confidence: answer.confidence,
            escalationNeeded: answer.escalationNeeded,
            needsClarification: false,
            clarificationType: null,
            clarificationOptions: [],
            citations: Array.isArray(answer.citations)
                ? answer.citations.map((citation) => ({
                      ...citation,
                      policyType: turn.policyType || null,
                      department: turn.department || null,
                  }))
                : [],
            retrievedChunks: buildRetrievedChunkResponse(
                retrieval.retrievedChunks,
                retrieval.retrievalMethod
            ),
            retrievalMethod: retrieval.retrievalMethod,
            resolvedPolicyType: turn.policyType,
            resolvedDepartment: turn.department,
        },
        turn,
        previousState: conversationState,
    });
};

module.exports = {
    ingestDocument,
    askPolicyQuestion,
    askPolicyQuestionStrict,
};
