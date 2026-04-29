const OpenAI = require('openai');

const env = require('../../../config/env');
const { buildGroundedMessages } = require('./prompt');
const { UNSUPPORTED_NEGATION_PATTERNS } = require('./constants');

const llm = new OpenAI({
    apiKey: env.groqApiKey,
    baseURL: env.groqBaseURL,
});

const UNVERIFIABLE_ANSWER =
    'I could not verify that from the current policy context.';

const parseJsonResponse = (text) => {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Model returned invalid JSON: ${text}`);
    }
};

const answerLooksUnsupported = (answer = '') =>
    UNSUPPORTED_NEGATION_PATTERNS.some((pattern) =>
        pattern.test(String(answer || ''))
    );

const normalizeForMatch = (value = '') => {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, ' ');
};

const chunkTextForMatch = (chunk = {}) =>
    normalizeForMatch(
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

const hasExplicitScopeEvidence = (question = '', retrievedChunks = []) => {
    const normalizedQuestion = normalizeForMatch(question);
    const topChunks = retrievedChunks.slice(0, 3);

    const genericScopeTerms = [
        'explicit',
        'specifically',
        'all departments',
        'company-wide',
        'company wide',
        'all restricted areas',
        'employees',
        'full-time employees',
        'part-time employees',
        'probationary employees',
        'departments may',
    ];

    const questionSpecificTerms = [];

    if (
        normalizedQuestion.includes('all employees') ||
        normalizedQuestion.includes('every employee')
    ) {
        questionSpecificTerms.push(
            'employees',
            'full-time employees',
            'part-time employees',
            'probationary employees'
        );
    }

    if (
        normalizedQuestion.includes('department') ||
        normalizedQuestion.includes('shift')
    ) {
        questionSpecificTerms.push(
            'departments may',
            'shift schedules',
            'different shift schedules',
            'outside standard office hours'
        );
    }

    if (
        normalizedQuestion.includes('late') ||
        normalizedQuestion.includes('absent') ||
        normalizedQuestion.includes('notify')
    ) {
        questionSpecificTerms.push(
            'notify',
            'immediate supervisor',
            'before the start of the shift',
            'corrective action'
        );
    }

    if (normalizedQuestion.includes('overtime')) {
        questionSpecificTerms.push(
            'overtime',
            'approved in advance',
            'immediate supervisor',
            'time-off in lieu'
        );
    }

    const evidenceTerms = [...new Set([...genericScopeTerms, ...questionSpecificTerms])];

    return topChunks.some((chunk) => {
        const text = chunkTextForMatch(chunk);
        return evidenceTerms.some((term) => text.includes(term));
    });
};

const requiresStricterEvidence = (question = '') => {
    const normalized = normalizeForMatch(question);

    return (
        normalized.includes('if ') ||
        normalized.includes('if there is no') ||
        normalized.includes('if the policy doesnt mention') ||
        normalized.includes('if the policy does not mention') ||
        normalized.includes('tomorrow') ||
        normalized.includes('explicitly') ||
        normalized.includes('assume') ||
        normalized.includes('does that mean') ||
        normalized.includes('does this mean') ||
        normalized.includes('imply') ||
        normalized.includes('company wide') ||
        normalized.includes('company-wide') ||
        normalized.includes('all restricted areas') ||
        normalized.includes('all departments') ||
        normalized.includes('one department') ||
        normalized.includes('deadline stated')
    );
};

const formatNaturalAnswer = ({ answer = '', question = '' }) => {
    const trimmedAnswer = String(answer || '').trim();
    const trimmedQuestion = String(question || '').trim();
    const normalizedQuestion = normalizeForMatch(trimmedQuestion);

    if (!trimmedAnswer || trimmedAnswer === UNVERIFIABLE_ANSWER) {
        return trimmedAnswer;
    }

    if (/^[a-z][a-z\s/&-]*$/i.test(trimmedAnswer) && normalizedQuestion.startsWith('who ')) {
        return `${trimmedAnswer.replace(/\.$/, '')} approves it.`;
    }

    if (
        !/[.!?]$/.test(trimmedAnswer) &&
        !trimmedAnswer.includes('\n')
    ) {
        return `${trimmedAnswer}.`;
    }

    return trimmedAnswer;
};

const detectQuestionDomain = (question = '') => {
    const normalized = normalizeForMatch(question);

    if (
        normalized.includes('visitor') ||
        normalized.includes('escort') ||
        normalized.includes('restricted areas') ||
        normalized.includes('access pass') ||
        normalized.includes('without an escort')
    ) {
        return 'visitor_access';
    }

    if (
        normalized.includes('mfa') ||
        normalized.includes('multi factor') ||
        normalized.includes('vpn') ||
        normalized.includes('remote work') ||
        normalized.includes('device') ||
        normalized.includes('devices')
    ) {
        return 'remote_work_security';
    }

    if (
        normalized.includes('who approves') ||
        normalized.includes('approval') ||
        normalized.includes('approve')
    ) {
        return 'approval';
    }

    if (
        normalized.includes('incident') ||
        normalized.includes('report') ||
        normalized.includes('notify') ||
        normalized.includes('how fast')
    ) {
        return 'incident_reporting';
    }

    if (normalized.includes('leave')) {
        return 'leave';
    }

    return null;
};

const hasDirectEvidence = (question = '', retrievedChunks = []) => {
    const normalizedQuestion = normalizeForMatch(question);
    const domain = detectQuestionDomain(question);

    if (!normalizedQuestion || !Array.isArray(retrievedChunks) || !retrievedChunks.length) {
        return false;
    }

    const topChunks = retrievedChunks.slice(0, 3);

    const domainTerms = {
        visitor_access: [
            'visitor',
            'escort',
            'restricted areas',
            'without escort',
            'temporary access pass',
            'approved by security',
        ],
        remote_work_security: [
            'mfa',
            'multi factor',
            'multi-factor',
            'vpn',
            'device',
            'devices',
            'required',
            'must',
        ],
        approval: [
            'approve',
            'approval',
            'approved by',
            'manager',
            'department head',
            'director',
            'designee',
        ],
        incident_reporting: [
            'incident',
            'report',
            'notify',
            'immediately',
            'hours',
            'security team',
        ],
        leave: [
            'leave',
            'approval',
            'manager',
            'supervisor',
            'department head',
            'hr',
        ],
    };

    const requiredTerms = domainTerms[domain] || [];

    if (!requiredTerms.length) {
        if (!requiresStricterEvidence(question)) {
            return true;
        }

        return hasExplicitScopeEvidence(question, topChunks);
    }

    const hasDomainEvidence = topChunks.some((chunk) => {
        const text = chunkTextForMatch(chunk);
        return requiredTerms.some((term) => text.includes(term));
    });

    if (!hasDomainEvidence) {
        return false;
    }

    if (!requiresStricterEvidence(question)) {
        return true;
    }

    return hasExplicitScopeEvidence(question, topChunks);
};

const generateGroundedAnswer = async ({
    question,
    retrievedChunks = [],
    retrievalConfidence = 'low',
    policyType = null,
    department = null,
}) => {
    if (!Array.isArray(retrievedChunks) || !retrievedChunks.length) {
        return {
            answer: UNVERIFIABLE_ANSWER,
            confidence: 'low',
            escalationNeeded: true,
            citations: [],
            resolvedPolicyType: policyType,
            resolvedDepartment: department,
        };
    }

    if (!hasDirectEvidence(question, retrievedChunks)) {
        return {
            answer: UNVERIFIABLE_ANSWER,
            confidence: 'low',
            escalationNeeded: true,
            citations: [],
            resolvedPolicyType: policyType,
            resolvedDepartment: department,
        };
    }

    const messages = buildGroundedMessages({
        question,
        chunks: retrievedChunks,
    });

    messages[0].content = [
        messages[0].content,
        'Answer naturally, directly, and briefly, but only from the provided policy context.',
        'Answer in one or two complete sentences, not fragments.',
        'If the question starts with who, what, when, where, why, how, can, is, are, or does, mirror that naturally in the answer.',
        'Use plain conversational wording instead of policy-jargon when possible.',
        `If the context does not explicitly support the answer, respond exactly: "${UNVERIFIABLE_ANSWER}"`,
        'Do not convert missing information into prohibition, permission, requirement, approval, or exceptions.',
        'Do not answer implication questions unless the implication is explicitly stated in the source.',
        'Do not answer "does that mean", "can I assume", "company-wide", or "explicitly" questions unless those exact ideas are supported.',
        'Only answer approval questions if the context explicitly names an approver or approving role.',
        'Only answer requirement questions if the context explicitly states the requirement.',
        'Only answer incident-reporting questions if the context explicitly says who to notify or how quickly to report.',
        'Only answer visitor-exception questions if the context explicitly states an exception.',
        'If the user explicitly named a department, do not answer from another department.',
        'Prefer precision over helpfulness. If the evidence is weak, refuse.',
        'Do not mention the policy context, provided context, or retrieval process unless you are refusing.',
        'Return valid JSON with keys: answer, escalationNeeded, citations.',
    ].join(' ');

    const completion = await llm.chat.completions.create({
        model: env.groqModel,
        messages,
        temperature: 0.02,
        max_tokens: 500,
        response_format: { type: 'json_object' },
    });

    const rawText = completion.choices[0]?.message?.content?.trim();

    if (!rawText) {
        throw new Error('RAG answer model returned an empty response.');
    }

    const parsed = parseJsonResponse(rawText);
    const parsedAnswer = formatNaturalAnswer({
        answer: parsed.answer || UNVERIFIABLE_ANSWER,
        question,
    });

    if (answerLooksUnsupported(parsedAnswer)) {
        return {
            answer: UNVERIFIABLE_ANSWER,
            confidence: 'low',
            escalationNeeded: true,
            citations: [],
            resolvedPolicyType: policyType,
            resolvedDepartment: department,
        };
    }

    return {
        answer: parsedAnswer,
        confidence: retrievalConfidence === 'high' ? 'high' : 'medium',
        escalationNeeded:
            retrievalConfidence !== 'high'
                ? true
                : parsed.escalationNeeded !== false,
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        resolvedPolicyType: policyType,
        resolvedDepartment: department,
    };
};

module.exports = {
    generateGroundedAnswer,
    UNVERIFIABLE_ANSWER,
};
