const { QueryTypes } = require('sequelize');

const { sequelize } = require('../../../config/database');
const {
    retrieveLexicallyRelevantChunks,
    retrieveSemanticallyRelevantChunks,
} = require('./retriever');
const { embedText } = require('./embedder');
const { ensureVectorSchema } = require('./vectorStore');
const {
    MEDIUM_SIMILARITY_THRESHOLD,
    MAX_CLARIFICATION_CHOICES,
} = require('./constants');
const {
    getTopRetrievalScore,
    classifyRetrievalConfidence,
    mergeRankedChunks,
    normalizeForMatch,
} = require('./ranker');

const formatPolicyTypeOption = (value) => String(value || '').replace(/_/g, ' ');

const QUESTION_SPECIFICITY_TERMS = [
    'probation',
    'probationary',
    'regularization',
    'allowance',
    'allowances',
    'benefit',
    'benefits',
    'payroll',
    'salary',
    'leave',
    'remote work',
    'remote',
    'attendance',
    'overtime',
    'complaint',
    'grievance',
    'disciplinary',
    'resignation',
    'clearance',
    'training',
    'performance',
    'reimbursement',
];

const uniqueValues = (values = []) => {
    return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
};

const getAvailablePolicyTypes = async (networkId) => {
    const rows = await sequelize.query(
        `
        SELECT DISTINCT policy_type
        FROM documents
        WHERE status IN ('active', 'published')
          AND network_id = :networkId
          AND policy_type IS NOT NULL
          AND TRIM(policy_type) <> ''
        ORDER BY policy_type ASC;
        `,
        {
            replacements: { networkId },
            type: QueryTypes.SELECT,
        }
    );

    return rows.map((row) => row.policy_type).filter(Boolean);
};

const getAvailableDepartments = async (networkId) => {
    const rows = await sequelize.query(
        `
        SELECT DISTINCT c.metadata->>'department' AS department
        FROM document_chunks c
        INNER JOIN documents d ON d.id = c.document_id
        WHERE d.status IN ('active', 'published')
          AND d.network_id = :networkId
          AND c.metadata->>'department' IS NOT NULL
          AND TRIM(c.metadata->>'department') <> ''
        ORDER BY department ASC;
        `,
        {
            replacements: { networkId },
            type: QueryTypes.SELECT,
        }
    );

    return rows.map((row) => row.department).filter(Boolean);
};

const getCandidateChunks = async ({
    networkId,
    policyType = null,
    department = null,
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
              AND d.network_id = :networkId
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
        WHERE (:department IS NULL OR c.metadata->>'department' = :department)
        ORDER BY c.document_id ASC, c.chunk_index ASC
        LIMIT :limit;
        `,
        {
            replacements: {
                policyType,
                department,
                limit,
                networkId,
            },
            type: QueryTypes.SELECT,
        }
    );

    return rows;
};

const buildClarificationFromChunks = ({
    normalizedQuestion = '',
    retrievedChunks = [],
    explicitPolicyType = false,
    explicitDepartment = false,
}) => {
    if (!Array.isArray(retrievedChunks) || retrievedChunks.length < 2) {
        return null;
    }

    const topChunks = retrievedChunks.slice(0, 3);

    if (!explicitPolicyType) {
        const policyTypes = uniqueValues(
            topChunks.map((chunk) => chunk.policy_type).map(formatPolicyTypeOption)
        );

        if (
            policyTypes.length > 1 &&
            !hasStrongQuestionSpecificity(normalizedQuestion) &&
            !hasDominantPolicyType(topChunks)
        ) {
            return {
                needsClarification: true,
                clarificationType: 'policy_type',
                clarificationQuestion: `I found multiple policy types that may apply. Which policy is this for: ${policyTypes
                    .slice(0, MAX_CLARIFICATION_CHOICES)
                    .join(', ')}? You can also say "any" if you want me to search across all of them.`,
                clarificationOptions: policyTypes.slice(0, MAX_CLARIFICATION_CHOICES),
            };
        }
    }

    if (!explicitDepartment) {
        const departments = uniqueValues(
            topChunks.map((chunk) => chunk.metadata?.department || null)
        );

        if (departments.length > 1) {
            return {
                needsClarification: true,
                clarificationType: 'department',
                clarificationQuestion: `I found multiple department-specific policies. Which department is this for: ${departments
                    .slice(0, MAX_CLARIFICATION_CHOICES)
                    .join(', ')}? You can also say "any" if you want me to search across all of them.`,
                clarificationOptions: departments.slice(0, MAX_CLARIFICATION_CHOICES),
            };
        }
    }

    return null;
};

const shouldPreferClarification = ({
    normalizedQuestion = '',
    explicitPolicyType = false,
    explicitDepartment = false,
}) => {
    const normalized = normalizeForMatch(normalizedQuestion);

    if (explicitPolicyType || explicitDepartment) {
        return false;
    }

    return (
        normalized.includes('approval process') ||
        normalized.includes('what is the process') ||
        normalized.includes('what are the requirements') ||
        normalized.includes('is remote work allowed') ||
        normalized.includes('leave approval process') ||
        normalized === 'any'
    );
};

const runHybridRetrieval = async ({
    networkId,
    question,
    policyType = null,
    department = null,
}) => {
    const candidateChunks = await getCandidateChunks({
        networkId,
        policyType,
        department,
    });

    if (!candidateChunks.length) {
        return {
            retrievalMethod: 'no_candidates',
            retrievedChunks: [],
        };
    }

    try {
        await ensureVectorSchema();

        const questionEmbedding = await embedText(question);

        const semanticChunks = await retrieveSemanticallyRelevantChunks({
            networkId,
            questionEmbedding,
            policyType,
            department,
            topK: 12,
            minSimilarity: 0.08,
        });

        const lexicalChunks = retrieveLexicallyRelevantChunks({
            question,
            chunks: candidateChunks,
            topK: 12,
            minScore: 1,
        });

        return {
            retrievalMethod: 'hybrid',
            retrievedChunks: mergeRankedChunks({
                question,
                semanticChunks,
                lexicalChunks,
                topK: 6,
            }),
        };
    } catch (error) {
        const lexicalChunks = retrieveLexicallyRelevantChunks({
            question,
            chunks: candidateChunks,
            topK: 6,
            minScore: 1,
        });

        return {
            retrievalMethod: 'lexical_fallback',
            retrievedChunks: lexicalChunks,
        };
    }
};

const runFallbackFamilyRetrieval = async ({
    networkId,
    question,
    policyType = null,
    department = null,
}) => {
    const normalizedPolicyType = normalizeForMatch(policyType || '');

    const fallbackFamilies = [
        policyType,
        normalizedPolicyType.includes('remote')
            ? 'compliance'
            : null,
        normalizedPolicyType.includes('remote') || normalizedPolicyType.includes('compliance')
            ? 'security'
            : null,
        normalizedPolicyType.includes('security')
            ? 'compliance'
            : null,
        normalizedPolicyType.includes('leave')
            ? 'hr'
            : null,
    ].filter(Boolean);

    let bestResult = {
        retrievalMethod: 'no_candidates',
        retrievedChunks: [],
    };
    let bestScore = 0;

    for (const familyPolicyType of [...new Set(fallbackFamilies)]) {
        const result = await runHybridRetrieval({
            networkId,
            question,
            policyType: familyPolicyType,
            department,
        });

        const score = getTopRetrievalScore(result.retrievedChunks);

        if (score > bestScore) {
            bestScore = score;
            bestResult = {
                retrievalMethod: `${result.retrievalMethod}_family_fallback`,
                retrievedChunks: result.retrievedChunks,
            };
        }
    }

    return bestResult;
};

const retrievePolicyContext = async ({
    networkId,
    normalizedQuestion,
    policyType = null,
    department = null,
    explicitPolicyType = false,
    explicitDepartment = false,
    suppressClarification = false,
}) => {
    let { retrievalMethod, retrievedChunks } = await runHybridRetrieval({
        networkId,
        question: normalizedQuestion,
        policyType,
        department,
    });

    const scopedTopScore = getTopRetrievalScore(retrievedChunks);

    if (
        explicitPolicyType &&
        (!retrievedChunks.length || scopedTopScore < MEDIUM_SIMILARITY_THRESHOLD)
    ) {
        const fallbackFamilyResult = await runFallbackFamilyRetrieval({
            networkId,
            question: normalizedQuestion,
            policyType,
            department,
        });

        const fallbackFamilyScore = getTopRetrievalScore(
            fallbackFamilyResult.retrievedChunks
        );

        if (fallbackFamilyScore > scopedTopScore + 0.05) {
            retrievalMethod = fallbackFamilyResult.retrievalMethod;
            retrievedChunks = fallbackFamilyResult.retrievedChunks;
        }
    }

    if (
        !explicitPolicyType &&
        (!retrievedChunks.length || getTopRetrievalScore(retrievedChunks) < MEDIUM_SIMILARITY_THRESHOLD)
    ) {
        const broaderResult = await runHybridRetrieval({
            networkId,
            question: normalizedQuestion,
            policyType: null,
            department,
        });

        const broaderTopScore = getTopRetrievalScore(broaderResult.retrievedChunks);

        if (broaderTopScore > getTopRetrievalScore(retrievedChunks) + 0.05) {
            retrievalMethod = `${broaderResult.retrievalMethod}_broadened`;
            retrievedChunks = broaderResult.retrievedChunks;
        }
    }

    if (!retrievedChunks.length) {
        return {
            retrievalMethod,
            retrievalConfidence: 'low',
            retrievedChunks: [],
            needsClarification: false,
            clarificationType: null,
            clarificationQuestion: null,
            clarificationOptions: [],
            noMatchingDepartment: false,
        };
    }

    if (explicitDepartment && department) {
        const chunkDepartments = uniqueValues(
            retrievedChunks.map((chunk) => chunk.metadata?.department || null)
        );

        if (
            chunkDepartments.length &&
            !chunkDepartments.some(
                (chunkDepartment) =>
                    normalizeForMatch(chunkDepartment) === normalizeForMatch(department)
            )
        ) {
            return {
                retrievalMethod: `${retrievalMethod}_department_mismatch`,
                retrievalConfidence: 'low',
                retrievedChunks,
                needsClarification: false,
                clarificationType: null,
                clarificationQuestion: null,
                clarificationOptions: [],
                noMatchingDepartment: true,
            };
        }
    }

    const topScore = getTopRetrievalScore(retrievedChunks);
    const retrievalConfidence = classifyRetrievalConfidence(topScore);

    const clarification = suppressClarification
        ? null
        : buildClarificationFromChunks({
              normalizedQuestion,
              retrievedChunks,
              explicitPolicyType,
              explicitDepartment,
          });

    if (
        !clarification &&
        retrievalConfidence === 'low' &&
        shouldPreferClarification({
            normalizedQuestion,
            explicitPolicyType,
            explicitDepartment,
        })
    ) {
        const fallbackClarification = buildClarificationFromChunks({
            normalizedQuestion,
            retrievedChunks,
            explicitPolicyType: false,
            explicitDepartment: false,
        });

        if (fallbackClarification) {
            return {
                retrievalMethod,
                retrievalConfidence,
                retrievedChunks,
                needsClarification: true,
                clarificationType: fallbackClarification.clarificationType,
                clarificationQuestion: fallbackClarification.clarificationQuestion,
                clarificationOptions: fallbackClarification.clarificationOptions,
                noMatchingDepartment: false,
            };
        }
    }

    return {
        retrievalMethod,
        retrievalConfidence,
        retrievedChunks,
        needsClarification: Boolean(clarification),
        clarificationType: clarification?.clarificationType || null,
        clarificationQuestion: clarification?.clarificationQuestion || null,
        clarificationOptions: clarification?.clarificationOptions || [],
        noMatchingDepartment: false,
    };
};

module.exports = {
    getAvailablePolicyTypes,
    getAvailableDepartments,
    retrievePolicyContext,
};
