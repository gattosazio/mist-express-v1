const OpenAI = require('openai');
const { Op } = require('sequelize');

const env = require('../../../config/env');
const { sequelize } = require('../../../config/database');
const Document = require('../../../models/document');
const DocumentChunk = require('../../../models/document_chunk');

const { chunkDocumentText } = require('./chunker');
const { retrieveRelevantChunks } = require('./retriever');
const { buildGroundedMessages } = require('./prompt');

const llm = new OpenAI({
    apiKey: env.groqApiKey,
    baseURL: env.groqBaseURL
});

const parseJsonResponse = (text) => {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Model returned invalid JSON: ${text}`);
    }
};

const ingestDocument = async (payload = {}) => {
    const {
        title,
        content,
        source_url = null,
        policy_type = null,
        version = null,
        effective_date = null,
        status = 'active',
        metadata = {},
        section_title = null,
    } = payload;

    if (!title || !content) {
        throw new Error('Both title and content are required.');
    }

    const chunks = chunkDocumentText({
        text: content,
        sectionTitle: section_title,
    });

    if (!chunks.length) {
        throw new Error('No chunks were created from the provided content.');
    }

    const transaction = await sequelize.transaction();

    try {
        const document = await Document.create(
            {
                title,
                source_url,
                policy_type,
                version,
                effective_date,
                status,
                metadata,
            },
            { transaction }
        );

        await DocumentChunk.bulkCreate(
            chunks.map((chunk) => ({
                document_id: document.id,
                chunk_index: chunk.chunk_index,
                section_title: chunk.section_title,
                content: chunk.content,
                token_count: chunk.token_count,
                metadata: {
                    source_url,
                    policy_type,
                    version,
                    effective_date,
                    ...metadata,
                },
            })),
            { transaction }
        );

        await transaction.commit();

        return {
            documentId: document.id,
            chunkCount: chunks.length,
        };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

const getCandidateChunks = async ({ policy_type = null, limit = 300 }) => {
    const documentWhere = {
        status: {
            [Op.in]: ['active', 'published'],
        },
    };

    if (policy_type) {
        documentWhere.policy_type = policy_type;
    }

    const documents = await Document.findAll({
        where: documentWhere,
        order: [['updated_at', 'DESC']],
        limit: 100,
    });

    if (!documents.length) {
        return [];
    }

    const documentMap = new Map(documents.map((doc) => [doc.id, doc]));
    const documentIds = documents.map((doc) => doc.id);

    const chunks = await DocumentChunk.findAll({
        where: {
            document_id: {
                [Op.in]: documentIds,
            },
        },
        order: [
            ['document_id', 'ASC'],
            ['chunk_index', 'ASC'],
        ],
        limit,
    });

    return chunks.map((chunk) => {
        const document = documentMap.get(chunk.document_id);

        return {
            id: chunk.id,
            document_id: chunk.document_id,
            chunk_index: chunk.chunk_index,
            section_title: chunk.section_title,
            content: chunk.content,
            token_count: chunk.token_count,
            metadata: chunk.metadata || {},
            document_title: document?.title || null,
            policy_type: document?.policy_type || null,
            version: document?.version || null,
            source_url: document?.source_url || null,
        };
    });
};

const askPolicyQuestion = async (payload = {}) => {

    const normalizedPayload =
        payload.data && typeof payload.data === 'object'
            ? payload.data
            : payload;
    const { question, policy_type = null } = normalizedPayload;

    if (!question) {
        throw new Error('Question is required.');
    }

    const candidateChunks = await getCandidateChunks({ policy_type });

    if (!candidateChunks.length) {
        return {
            answer: 'I could not verify that because no active policy documents are currently available.',
            confidence: 'low',
            escalationNeeded: true,
            citations: [],
            retrievedChunks: [],
        };
    }

    const retrievedChunks = retrieveRelevantChunks({
        question,
        chunks: candidateChunks,
        topK: 5,
        minScore: 2,
    });

    if (!retrievedChunks.length) {
        return {
            answer: 'I could not verify that from the current policy context.',
            confidence: 'low',
            escalationNeeded: true,
            citations: [],
            retrievedChunks: [],
        };
    }

    const messages = buildGroundedMessages({
        question,
        chunks: retrievedChunks,
    });

    const completion = await llm.chat.completions.create({
        model: env.groqModel || 'llama-3.1-8b-instant',
        messages,
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: 'json_object' },
    });

    const rawText = completion.choices[0]?.message?.content?.trim();

    if (!rawText) {
        throw new Error('RAG answer model returned an empty response.');
    }

    const parsed = parseJsonResponse(rawText);

    return {
        answer: parsed.answer || 'I could not verify that from the current policy context.',
        confidence: parsed.confidence || 'low',
        escalationNeeded: parsed.escalationNeeded !== false,
        citations: Array.isArray(parsed.citations)
            ? parsed.citations.map((citation) => ({
                ...citation,
                policyType: policy_type || null,
            }))
            : [],
        retrievedChunks: retrievedChunks.map((chunk) => ({
            id: chunk.id,
            documentTitle: chunk.document_title,
            sectionTitle: chunk.section_title,
            chunkIndex: chunk.chunk_index,
            retrievalScore: chunk.retrieval_score,
            policyType: chunk.policy_type,
            sourceUrl: chunk.source_url,
            version: chunk.version,
        })),
    };

};

module.exports = {
    ingestDocument,
    askPolicyQuestion,
};