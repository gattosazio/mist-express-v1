const OpenAI = require('openai');
const { QueryTypes, Op } = require('sequelize');

const env = require('../../../config/env');
const { sequelize } = require('../../../config/database');
const Document = require('../../../models/document');
const DocumentChunk = require('../../../models/document_chunk');

const { chunkDocumentText } = require('./chunker');
const {
    retrieveLexicallyRelevantChunks,
    retrieveSemanticallyRelevantChunks,
} = require('./retriever');
const { buildGroundedMessages } = require('./prompt');
const { embedText, embedTexts } = require('./embedder');
const { ensureVectorSchema, upsertChunkEmbeddings } = require('./vectorStore');

const HIGH_SIMILARITY_THRESHOLD = 0.65;
const MEDIUM_SIMILARITY_THRESHOLD = 0.45;
const AMBIGUITY_GAP_THRESHOLD = 0.12;
const MAX_CLARIFICATION_CHOICES = 3;

const POLICY_GUIDANCE_SUFFIX =
    'If you want, I can also check the official company policy for that.';

const POLICY_KEYWORDS = [
    'policy',
    'procedure',
    'guideline',
    'rule',
    'compliance',
    'company',
    'official',
    'allowed',
    'required',
    'restricted',
    'approval',
    'report',
    'incident',
    'visitor',
    'escort',
    'security',
    'hr',
    'safety',
    'jurisdiction',
    'department',
    'site',
];

const classifyQuestionIntentHeuristically = (question = '') => {
    const normalized = String(question || '').toLowerCase().trim();

    if (!normalized) {
        return 'policy_specific';
    }

    const policyMatches = POLICY_KEYWORDS.filter((keyword) =>
        normalized.includes(keyword)
    ).length;

    const generalStarts = [
        'what is',
        'what are',
        'how does',
        'explain',
        'define',
        'tell me about',
        'why does',
        'how do i',
    ];

    const looksGeneral = generalStarts.some((prefix) => normalized.startsWith(prefix));

    if (policyMatches >= 2) {
        return 'policy_specific';
    }

    if (policyMatches === 1 && looksGeneral) {
        return 'mixed';
    }

    if (policyMatches === 1) {
        return 'policy_specific';
    }

    return 'general_ai';
};

const buildGeneralAnswerMessages = ({ question }) => {
    return [
        {
            role: 'system',
            content: [
                'You are MISSU, a helpful enterprise assistant.',
                'Answer using general knowledge only.',
                'Do not invent or imply company-specific policy.',
                'If the topic could depend on internal policy, end by briefly offering to check the official company policy.',
                'Return valid JSON with keys: answer, shouldOfferPolicyCheck.',
            ].join(' '),
        },
        {
            role: 'user',
            content: question,
        },
    ];
};

const answerGeneralQuestion = async ({ question }) => {
    const completion = await llm.chat.completions.create({
        model: env.groqModel,
        messages: buildGeneralAnswerMessages({ question }),
        temperature: 0.3,
        max_tokens: 350,
        response_format: { type: 'json_object' },
    });

    const rawText = completion.choices[0]?.message?.content?.trim();

    if (!rawText) {
        throw new Error('General answer model returned an empty response.');
    }

    const parsed = parseJsonResponse(rawText);
   const answer = parsed.answer || 'I can help with that.';
const finalAnswer =
    parsed.shouldOfferPolicyCheck === false
        ? answer
        : `${answer} ${POLICY_GUIDANCE_SUFFIX}`;

    return {
        mode: 'general_ai',
        answer: finalAnswer,
        confidence: 'medium',
        escalationNeeded: false,
        needsClarification: false,
        clarificationType: null,
        clarificationOptions: [],
        citations: [],
        retrievedChunks: [],
        retrievalMethod: 'general_ai',
        shouldOfferPolicyCheck: parsed.shouldOfferPolicyCheck !== false,
    };

};

const answerMixedQuestion = async ({ question }) => {
    const completion = await llm.chat.completions.create({
        model: env.groqModel,
        messages: [
            {
                role: 'system',
                content: [
                    'You are MISSU, a helpful enterprise assistant.',
                    'Answer the general part of the user question using general knowledge.',
                    'Do not claim any company-specific policy unless retrieved from policy documents.',
                    'End by inviting the user to let you check the official company policy if relevant.',
                    'Return valid JSON with keys: answer.',
                ].join(' '),
            },
            {
                role: 'user',
                content: question,
            },
        ],
        temperature: 0.3,
        max_tokens: 350,
        response_format: { type: 'json_object' },
    });

    const rawText = completion.choices[0]?.message?.content?.trim();

    if (!rawText) {
        throw new Error('Mixed answer model returned an empty response.');
    }

    const parsed = parseJsonResponse(rawText);

    return {
        mode: 'mixed',
        answer: parsed.answer || POLICY_GUIDANCE_SUFFIX,
        confidence: 'medium',
        escalationNeeded: false,
        needsClarification: false,
        clarificationType: null,
        clarificationOptions: [],
        citations: [],
        retrievedChunks: [],
        retrievalMethod: 'general_ai',
        shouldOfferPolicyCheck: true,
    };
};


const normalizeValue = (value) => {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    return normalized ? normalized : null;
};

const uniqueValues = (values = []) => {
    return [...new Set(values.map(normalizeValue).filter(Boolean))];
};

const buildClarificationPrompt = (retrievedChunks = []) => {
    const sites = uniqueValues(retrievedChunks.map((chunk) => chunk.metadata?.site || chunk.site));
    const departments = uniqueValues(retrievedChunks.map((chunk) => chunk.metadata?.department || chunk.department));
    const jurisdictions = uniqueValues(retrievedChunks.map((chunk) => chunk.metadata?.jurisdiction || chunk.jurisdiction));

    if (sites.length > 1) {
        return {
            clarificationType: 'site',
            clarificationQuestion: `I found multiple site-specific policies. Which site is this for: ${sites.slice(0, MAX_CLARIFICATION_CHOICES).join(', ')}?`,
            clarificationOptions: sites.slice(0, MAX_CLARIFICATION_CHOICES),
        };
    }

    if (departments.length > 1) {
        return {
            clarificationType: 'department',
            clarificationQuestion: `I found multiple department-specific policies. Which department is this for: ${departments.slice(0, MAX_CLARIFICATION_CHOICES).join(', ')}?`,
            clarificationOptions: departments.slice(0, MAX_CLARIFICATION_CHOICES),
        };
    }

    if (jurisdictions.length > 1) {
        return {
            clarificationType: 'jurisdiction',
            clarificationQuestion: `I found multiple jurisdiction-specific policies. Which jurisdiction is this for: ${jurisdictions.slice(0, MAX_CLARIFICATION_CHOICES).join(', ')}?`,
            clarificationOptions: jurisdictions.slice(0, MAX_CLARIFICATION_CHOICES),
        };
    }

    return {
        clarificationType: 'scope',
        clarificationQuestion: 'I found multiple plausible policy matches. Can you clarify the site, department, or jurisdiction?',
        clarificationOptions: [],
    };
};

const detectAmbiguity = (retrievedChunks = []) => {
    if (!Array.isArray(retrievedChunks) || retrievedChunks.length < 2) {
        return null;
    }

    const topChunks = retrievedChunks.slice(0, 3);

    const sites = uniqueValues(topChunks.map((chunk) => chunk.metadata?.site || chunk.site));
    const departments = uniqueValues(topChunks.map((chunk) => chunk.metadata?.department || chunk.department));
    const jurisdictions = uniqueValues(topChunks.map((chunk) => chunk.metadata?.jurisdiction || chunk.jurisdiction));

    if (sites.length > 1) {
        return {
            clarificationType: 'site',
            clarificationQuestion: `I found multiple site-specific policies. Which site is this for: ${sites.slice(0, MAX_CLARIFICATION_CHOICES).join(', ')}?`,
            clarificationOptions: sites.slice(0, MAX_CLARIFICATION_CHOICES),
        };
    }

    if (departments.length > 1) {
        return {
            clarificationType: 'department',
            clarificationQuestion: `I found multiple department-specific policies. Which department is this for: ${departments.slice(0, MAX_CLARIFICATION_CHOICES).join(', ')}?`,
            clarificationOptions: departments.slice(0, MAX_CLARIFICATION_CHOICES),
        };
    }

    if (jurisdictions.length > 1) {
        return {
            clarificationType: 'jurisdiction',
            clarificationQuestion: `I found multiple jurisdiction-specific policies. Which jurisdiction is this for: ${jurisdictions.slice(0, MAX_CLARIFICATION_CHOICES).join(', ')}?`,
            clarificationOptions: jurisdictions.slice(0, MAX_CLARIFICATION_CHOICES),
        };
    }

    return null;
};


const llm = new OpenAI({
    apiKey: env.groqApiKey,
    baseURL: env.groqBaseURL,
});

const parseJsonResponse = (text) => {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Model returned invalid JSON: ${text}`);
    }
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

    let document;
    let createdChunks;

    try {
        document = await Document.create(
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

        createdChunks = await DocumentChunk.bulkCreate(
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
        chunkCount: chunks.length,
        embeddingsCreated,
        embeddingStatus,
    };
};

const getCandidateChunks = async ({
    policy_type = null,
    site = null,
    department = null,
    jurisdiction = null,
    limit = 300,
}) => {
    const rows = await sequelize.query(
        `
        WITH current_documents AS (
            SELECT DISTINCT ON (
                COALESCE(d.source_url, d.title),
                COALESCE(d.policy_type, '')
            )
                d.id,
                d.title,
                d.policy_type,
                d.version,
                d.source_url,
                d.effective_date,
                d.updated_at
            FROM documents d
            WHERE d.status IN ('active', 'published')
              AND (d.effective_date IS NULL OR d.effective_date <= NOW())
              AND (:policyType IS NULL OR d.policy_type = :policyType)
            ORDER BY
                COALESCE(d.source_url, d.title),
                COALESCE(d.policy_type, ''),
                d.effective_date DESC NULLS LAST,
                d.updated_at DESC,
                d.id DESC
        )
        SELECT
            c.id,
            c.document_id,
            c.chunk_index,
            c.section_title,
            c.content,
            c.metadata,
            d.title AS document_title,
            d.policy_type,
            d.version,
            d.source_url
        FROM document_chunks c
        INNER JOIN current_documents d ON d.id = c.document_id
        WHERE (:site IS NULL OR c.metadata->>'site' = :site)
          AND (:department IS NULL OR c.metadata->>'department' = :department)
          AND (:jurisdiction IS NULL OR c.metadata->>'jurisdiction' = :jurisdiction)
        ORDER BY c.document_id ASC, c.chunk_index ASC
        LIMIT :limit;
        `,
        {
            replacements: {
                policyType: policy_type,
                site,
                department,
                jurisdiction,
                limit,
            },
            type: QueryTypes.SELECT,
        }
    );

    return rows;
};

const askPolicyQuestionStrict = async (payload = {}) => {

    const normalizedPayload =
        payload.data && typeof payload.data === 'object'
            ? payload.data
            : payload;

    const {
        question,
        policy_type = null,
        site = null,
        department = null,
        jurisdiction = null,
    } = normalizedPayload;

    if (!question) {
        throw new Error('Question is required.');
    }

    let retrievedChunks = [];
    let retrievalMethod = 'semantic';

    try {
        await ensureVectorSchema();

        const questionEmbedding = await embedText(question);

        retrievedChunks = await retrieveSemanticallyRelevantChunks({
            questionEmbedding,
            policyType: policy_type,
            site,
            department,
            jurisdiction,
            topK: 5,
            minSimilarity: 0.2,
        });
    } catch (error) {
        retrievalMethod = 'lexical_fallback';
        console.warn(
            '\x1b[33m[RAG RETRIEVAL WARNING]\x1b[0m Semantic retrieval unavailable, falling back to lexical.',
            error.message
        );
    }

    if (!retrievedChunks.length) {
        retrievalMethod = 'lexical_fallback';

        const candidateChunks = await getCandidateChunks({
            policy_type,
            site,
            department,
            jurisdiction,
        });

        if (!candidateChunks.length) {
            return {
                answer: 'I could not verify that because no active policy documents are currently available.',
                confidence: 'low',
                escalationNeeded: true,
                citations: [],
                retrievedChunks: [],
                retrievalMethod,
            };
        }

        retrievedChunks = retrieveLexicallyRelevantChunks({
            question,
            chunks: candidateChunks,
            topK: 5,
            minScore: 2,
        });
    }

    if (!retrievedChunks.length) {
        return {
            answer: 'I could not verify that from the current policy context.',
            confidence: 'low',
            escalationNeeded: true,
            citations: [],
            retrievedChunks: [],
            retrievalMethod,
        };
    }

    const topRetrievalScore = getTopRetrievalScore(retrievedChunks);
    const retrievalConfidence = classifyRetrievalConfidence(topRetrievalScore);
    const ambiguity = detectAmbiguity(retrievedChunks);

    if (ambiguity) {
        return {
            answer: ambiguity.clarificationQuestion,
            confidence: 'medium',
            escalationNeeded: false,
            needsClarification: true,
            clarificationType: ambiguity.clarificationType,
            clarificationOptions: ambiguity.clarificationOptions,
            citations: [],
            retrievedChunks: retrievedChunks.map((chunk) => ({
                id: chunk.id,
                documentTitle: chunk.document_title,
                sectionTitle: chunk.section_title,
                chunkIndex: chunk.chunk_index,
                retrievalScore: chunk.retrieval_score,
                retrievalMethod: chunk.retrieval_method || retrievalMethod,
                policyType: chunk.policy_type,
                sourceUrl: chunk.source_url,
                version: chunk.version,
                site: chunk.metadata?.site || null,
                department: chunk.metadata?.department || null,
                jurisdiction: chunk.metadata?.jurisdiction || null,
            })),
            retrievalMethod,
        };
    }

    if (retrievalConfidence === 'low') {
        return {
            answer: 'I could not verify that from the current policy context.',
            confidence: 'low',
            escalationNeeded: true,
            needsClarification: false,
            clarificationType: null,
            clarificationOptions: [],
            citations: [],
            retrievedChunks: retrievedChunks.map((chunk) => ({
                id: chunk.id,
                documentTitle: chunk.document_title,
                sectionTitle: chunk.section_title,
                chunkIndex: chunk.chunk_index,
                retrievalScore: chunk.retrieval_score,
                retrievalMethod: chunk.retrieval_method || retrievalMethod,
                policyType: chunk.policy_type,
                sourceUrl: chunk.source_url,
                version: chunk.version,
                site: chunk.metadata?.site || null,
                department: chunk.metadata?.department || null,
                jurisdiction: chunk.metadata?.jurisdiction || null,
            })),
            retrievalMethod,
        };
    }

    console.log(
        `\x1b[36m[RAG RETRIEVAL]\x1b[0m method=${retrievalMethod} topScore=${topRetrievalScore.toFixed(4)} confidence=${retrievalConfidence} policyType=${policy_type || 'any'} site=${site || 'any'} department=${department || 'any'} jurisdiction=${jurisdiction || 'any'}`
    );

    const messages = buildGroundedMessages({
        question,
        chunks: retrievedChunks,
    });

    const completion = await llm.chat.completions.create({
        model: env.groqModel,
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

    const groundedConfidence =
        retrievalConfidence === 'high'
            ? 'high'
            : 'medium';

    const groundedEscalationNeeded =
        retrievalConfidence !== 'high'
            ? true
            : parsed.escalationNeeded !== false;

    return {
        answer: parsed.answer || 'I could not verify that from the current policy context.',
        confidence: groundedConfidence,
        escalationNeeded: groundedEscalationNeeded,
        needsClarification: false,
        clarificationType: null,
        clarificationOptions: [],
        citations: Array.isArray(parsed.citations)
            ? parsed.citations.map((citation) => ({
                ...citation,
                policyType: policy_type || null,
                site,
                department,
                jurisdiction,
            }))
            : [],
        retrievedChunks: retrievedChunks.map((chunk) => ({
            id: chunk.id,
            documentTitle: chunk.document_title,
            sectionTitle: chunk.section_title,
            chunkIndex: chunk.chunk_index,
            retrievalScore: chunk.retrieval_score,
            retrievalMethod: chunk.retrieval_method || retrievalMethod,
            policyType: chunk.policy_type,
            sourceUrl: chunk.source_url,
            version: chunk.version,
            site: chunk.metadata?.site || null,
            department: chunk.metadata?.department || null,
            jurisdiction: chunk.metadata?.jurisdiction || null,
        })),
        retrievalMethod,
    };
};

const askPolicyQuestion = async (payload = {}) => {
    const normalizedPayload =
        payload.data && typeof payload.data === 'object'
            ? payload.data
            : payload;

    const {
        question,
        policy_type = null,
        site = null,
        department = null,
        jurisdiction = null,
        forcePolicy = false,
    } = normalizedPayload;

    if (!question) {
        throw new Error('Question is required.');
    }

    const hasExplicitScope =
        Boolean(policy_type) ||
        Boolean(site) ||
        Boolean(department) ||
        Boolean(jurisdiction);

    const intent = forcePolicy || hasExplicitScope
        ? 'policy_specific'
        : classifyQuestionIntentHeuristically(question);

    if (intent === 'general_ai') {
        return answerGeneralQuestion({ question });
    }

    if (intent === 'mixed') {
        return answerMixedQuestion({ question });
    }

    const policyResult = await askPolicyQuestionStrict(normalizedPayload);

    return {
        mode: 'policy_specific',
        ...policyResult,
    };
};

module.exports = {
    ingestDocument,
    askPolicyQuestion,
    askPolicyQuestionStrict,
};