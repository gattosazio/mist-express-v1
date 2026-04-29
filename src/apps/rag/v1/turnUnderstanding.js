const OpenAI = require('openai');

const env = require('../../../config/env');
const {
    MAX_CLARIFICATION_CHOICES,
    POLICY_KEYWORDS,
    POLICY_INTENT_PATTERNS,
} = require('./constants');

const llm = new OpenAI({
    apiKey: env.groqApiKey,
    baseURL: env.groqBaseURL,
});

const CLARIFICATION_ANY_PATTERNS = [
    'any',
    'either',
    'all',
    'whichever',
    'whatever',
    'anything',
    'doesnt matter',
    "doesn't matter",
    'not sure',
    'you decide',
];

const ELLIPTICAL_FOLLOW_UP_PREFIXES = [
    'what about',
    'how about',
    'and ',
    'for ',
    'about ',
    'what if',
];

const STANDALONE_QUESTION_PATTERNS = [
    /^\bwho\s+/i,
    /^\bwhat\s+/i,
    /^\bwhen\s+/i,
    /^\bwhere\s+/i,
    /^\bwhy\s+/i,
    /^\bhow\s+/i,
    /^\bis\s+/i,
    /^\bare\s+/i,
    /^\bdo\s+/i,
    /^\bdoes\s+/i,
    /^\bcan\s+/i,
    /^\bshould\s+/i,
    /^\bmust\s+/i,
];

const DOMAIN_RULES = [
    {
        name: 'visitor_access',
        patterns: [
            'visitor',
            'visitors',
            'escort',
            'access pass',
            'restricted area',
            'restricted areas',
            'visitor access',
        ],
        preferredPolicyTypes: ['visitor_access', 'security', 'compliance'],
    },
    {
        name: 'remote_work_security',
        patterns: [
            'remote work',
            'work from home',
            'vpn',
            'mfa',
            'multi factor',
            'multi-factor',
            'device',
            'devices',
        ],
        preferredPolicyTypes: ['remote_work', 'compliance', 'security'],
    },
    {
        name: 'approval',
        patterns: ['approve', 'approves', 'approval', 'approver', 'who approves'],
        preferredPolicyTypes: ['remote_work', 'leave', 'compliance'],
    },
    {
        name: 'leave',
        patterns: ['leave', 'leave approval', 'leave process'],
        preferredPolicyTypes: ['leave', 'hr', 'compliance'],
    },
];

const NON_POLICY_PATTERNS = [
    /\btell me a joke\b/i,
    /\bwho are you\b/i,
    /\bwhat are you\b/i,
    /\bwhat can you do\b/i,
    /\bhello\b/i,
    /\bhi\b/i,
    /\bhey\b/i,
    /\bthanks\b/i,
    /\bthank you\b/i,
    /\bhow are you\b/i,
    /\bweather\b/i,
];

const parseJsonResponse = (text) => {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Model returned invalid JSON: ${text}`);
    }
};

const normalizeForMatch = (value = '') => {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-?]/g, '')
        .replace(/\s+/g, ' ');
};

const normalizePolicyTypeLabel = (value = '') =>
    normalizeForMatch(String(value || '').replace(/_/g, ' '));

const formatPolicyTypeLabel = (value = '') =>
    String(value || '').replace(/_/g, ' ');

const isClarificationAnyReply = (question = '') => {
    const normalized = normalizeForMatch(question);

    return CLARIFICATION_ANY_PATTERNS.some(
        (pattern) => normalized === normalizeForMatch(pattern)
    );
};

const findMatchingOption = (question = '', options = []) => {
    const normalizedQuestion = normalizeForMatch(question);

    if (!normalizedQuestion) {
        return null;
    }

    return (
        options.find((option) => {
            const normalizedOption = normalizeForMatch(option);

            return (
                normalizedQuestion === normalizedOption ||
                normalizedQuestion.includes(normalizedOption) ||
                normalizedOption.includes(normalizedQuestion)
            );
        }) || null
    );
};

const isStandalonePolicyQuestion = (question = '') => {
    const raw = String(question || '').trim();

    if (!raw) {
        return false;
    }

    return STANDALONE_QUESTION_PATTERNS.some((pattern) => pattern.test(raw));
};

const classifyQuestionIntentHeuristically = (question = '') => {
    const normalized = String(question || '').toLowerCase().trim();

    if (!normalized) {
        return 'policy_specific';
    }

    if (NON_POLICY_PATTERNS.some((pattern) => pattern.test(question))) {
        return 'redirect_to_policy';
    }

    const policyMatches = POLICY_KEYWORDS.filter((keyword) =>
        normalized.includes(keyword)
    ).length;

    if (policyMatches >= 1) {
        return 'policy_specific';
    }

    if (POLICY_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return 'policy_specific';
    }

    return 'redirect_to_policy';
};

const detectDepartmentMention = (question = '', availableDepartments = []) => {
    const normalizedQuestion = normalizeForMatch(question);

    return (
        availableDepartments.find((department) => {
            const normalizedDepartment = normalizeForMatch(department);
            return (
                normalizedQuestion === normalizedDepartment ||
                normalizedQuestion.includes(normalizedDepartment) ||
                normalizedDepartment.includes(normalizedQuestion)
            );
        }) || null
    );
};

const detectPolicyTypeMention = (question = '', availablePolicyTypes = []) => {
    const normalizedQuestion = normalizeForMatch(question);

    return (
        availablePolicyTypes.find((policyType) => {
            const normalizedPolicyType = normalizePolicyTypeLabel(policyType);
            return (
                normalizedQuestion === normalizedPolicyType ||
                normalizedQuestion.includes(normalizedPolicyType) ||
                normalizedPolicyType.includes(normalizedQuestion)
            );
        }) || null
    );
};

const detectDomainRule = (question = '') => {
    const normalized = normalizeForMatch(question);

    return (
        DOMAIN_RULES.find((rule) =>
            rule.patterns.some((pattern) => normalized.includes(pattern))
        ) || null
    );
};

const isObviouslyNonPolicyQuestion = (question = '') =>
    NON_POLICY_PATTERNS.some((pattern) => pattern.test(String(question || '')));

const isLikelyEllipticalFollowUp = (question = '') => {
    const normalized = normalizeForMatch(question);

    if (!normalized) {
        return false;
    }

    if (isObviouslyNonPolicyQuestion(question)) {
        return false;
    }

    if (
        ELLIPTICAL_FOLLOW_UP_PREFIXES.some((prefix) =>
            normalized.startsWith(prefix)
        )
    ) {
        return true;
    }

    if (isStandalonePolicyQuestion(question)) {
        return false;
    }

    return normalized.split(' ').length <= 4;
};

const buildClarificationQuestion = ({
    clarificationType,
    clarificationOptions = [],
}) => {
    const options = clarificationOptions.slice(0, MAX_CLARIFICATION_CHOICES);

    if (clarificationType === 'policy_type') {
        return `I found a few policy types that might fit. Which one do you want me to use: ${options.join(', ')}? You can also say "any" to search across them.`;
    }

    return `I found a few department-specific policies. Which department should I use: ${options.join(', ')}? You can also say "any" to search across them.`;
};

const buildClarificationTurn = ({
    question,
    lastPolicyQuestion,
    clarificationType,
    clarificationOptions,
    policyType = null,
    department = null,
}) => {
    return {
        originalQuestion: question,
        normalizedQuestion: lastPolicyQuestion,
        isPolicyQuestion: true,
        isFollowUp: true,
        policyType,
        department,
        explicitPolicyType: Boolean(policyType),
        explicitDepartment: Boolean(department),
        needsClarification: true,
        clarificationType,
        clarificationQuestion: buildClarificationQuestion({
            clarificationType,
            clarificationOptions,
        }),
        clarificationOptions: clarificationOptions.slice(
            0,
            MAX_CLARIFICATION_CHOICES
        ),
    };
};

const buildResolvedTurn = ({
    question,
    normalizedQuestion,
    policyType = null,
    department = null,
    isFollowUp = false,
    explicitPolicyType = false,
    explicitDepartment = false,
    suppressClarification = false,
}) => {
    return {
        originalQuestion: question,
        normalizedQuestion,
        isPolicyQuestion: true,
        isFollowUp,
        policyType,
        department,
        explicitPolicyType,
        explicitDepartment,
        suppressClarification,
        needsClarification: false,
        clarificationType: null,
        clarificationQuestion: null,
        clarificationOptions: [],
    };
};

const applyDomainPreference = ({
    question,
    policyType,
    availablePolicyTypes = [],
    force = false,
}) => {
    const rule = detectDomainRule(question);

    if (!rule) {
        return policyType;
    }

    if (policyType && !force) {
        return policyType;
    }

    for (const preferred of rule.preferredPolicyTypes) {
        const matched = availablePolicyTypes.find(
            (candidate) =>
                normalizePolicyTypeLabel(candidate) ===
                normalizePolicyTypeLabel(preferred)
        );

        if (matched) {
            return matched;
        }
    }

    return policyType;
};

const filterClarificationOptionsByDomain = ({
    question,
    options = [],
}) => {
    const rule = detectDomainRule(question);

    if (!rule) {
        return options;
    }

    const filtered = options.filter((option) => {
        const normalizedOption = normalizePolicyTypeLabel(option);
        return rule.preferredPolicyTypes.some((preferred) =>
            normalizedOption.includes(normalizePolicyTypeLabel(preferred))
        );
    });

    return filtered.length ? filtered : options;
};

const resolvePendingClarificationTurn = ({
    question,
    conversationState,
    availablePolicyTypes = [],
    availableDepartments = [],
}) => {
    if (
        !conversationState ||
        !conversationState.pendingClarification ||
        !conversationState.lastPolicyQuestion
    ) {
        return null;
    }

    const pendingClarification = conversationState.pendingClarification;
    const matchedOption = findMatchingOption(
        question,
        pendingClarification.options || []
    );

    if (matchedOption) {
        if (pendingClarification.type === 'policy_type') {
            const matchedPolicyType =
                availablePolicyTypes.find(
                    (policyType) =>
                        normalizePolicyTypeLabel(policyType) ===
                        normalizeForMatch(matchedOption)
                ) || matchedOption.replace(/\s+/g, '_').toLowerCase();

            return buildResolvedTurn({
                question,
                normalizedQuestion: conversationState.lastPolicyQuestion,
                policyType: matchedPolicyType,
                department: conversationState.lastResolvedDepartment || null,
                isFollowUp: true,
                explicitPolicyType: true,
                explicitDepartment: Boolean(
                    conversationState.lastResolvedDepartment
                ),
            });
        }

        const matchedDepartment =
            availableDepartments.find(
                (department) =>
                    normalizeForMatch(department) ===
                    normalizeForMatch(matchedOption)
            ) || matchedOption;

        return buildResolvedTurn({
            question,
            normalizedQuestion: conversationState.lastPolicyQuestion,
            policyType: conversationState.lastResolvedPolicyType || null,
            department: matchedDepartment,
            isFollowUp: true,
            explicitPolicyType: Boolean(
                conversationState.lastResolvedPolicyType
            ),
            explicitDepartment: true,
        });
    }

    if (isClarificationAnyReply(question)) {
        const anyPolicyType = applyDomainPreference({
            question: conversationState.lastPolicyQuestion,
            policyType:
                pendingClarification.type === 'policy_type'
                    ? null
                    : conversationState.lastResolvedPolicyType || null,
            availablePolicyTypes,
            force: true,
        });

        return buildResolvedTurn({
            question,
            normalizedQuestion: conversationState.lastPolicyQuestion,
            policyType: anyPolicyType,
            department:
                pendingClarification.type === 'department'
                    ? null
                    : conversationState.lastResolvedDepartment || null,
            isFollowUp: true,
            explicitPolicyType: pendingClarification.type === 'policy_type'
                ? true
                : Boolean(anyPolicyType),
            explicitDepartment: pendingClarification.type === 'department'
                ? true
                : false,
            suppressClarification: true,
        });
    }

    return buildClarificationTurn({
        question,
        lastPolicyQuestion: conversationState.lastPolicyQuestion,
        clarificationType: pendingClarification.type,
        clarificationOptions: pendingClarification.options || [],
        policyType: conversationState.lastResolvedPolicyType || null,
        department: conversationState.lastResolvedDepartment || null,
    });
};

const understandUserTurnWithLlm = async ({
    question,
    conversationState,
    availablePolicyTypes = [],
    availableDepartments = [],
}) => {
    const policyTypeLabels = availablePolicyTypes.map(formatPolicyTypeLabel);

    const completion = await llm.chat.completions.create({
        model: env.groqModel,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: [
                    'You classify user turns for a company-policy RAG assistant.',
                    'Return valid JSON only.',
                    'If the current turn is an elliptical follow-up like "what about security?" you must preserve the previous subject and only change scope.',
                    'Do not reinterpret a follow-up fragment as a different topic.',
                    'If the question clearly asks about visitors, escorts, access passes, or restricted areas, prefer visitor/security-related policy scope.',
                    'If the question clearly asks about MFA, VPN, devices, remote work, or security controls, prefer remote-work/compliance/security-related policy scope.',
                    'If the user asks a full standalone question like "who approves remote work requests?", treat it as a new topic.',
                    'Infer policyType only from the provided available policy types or null.',
                    'Infer department only from the provided available departments or null.',
                    'Avoid asking for policy-type clarification when the question strongly indicates a policy family already.',
                    'normalizedQuestion must be the fully resolved question to send to retrieval.',
                    'JSON shape:',
                    '{"isPolicyQuestion":true,"isFollowUp":false,"normalizedQuestion":"string","policyType":"string|null","department":"string|null","needsClarification":false,"clarificationType":"policy_type|department|null","clarificationQuestion":"string|null","clarificationOptions":["string"]}',
                ].join(' '),
            },
            {
                role: 'user',
                content: JSON.stringify({
                    question,
                    conversationState,
                    availablePolicyTypes: policyTypeLabels,
                    availableDepartments,
                }),
            },
        ],
    });

    const rawText = completion.choices[0]?.message?.content?.trim();

    if (!rawText) {
        throw new Error('Turn understanding model returned an empty response.');
    }

    const parsed = parseJsonResponse(rawText);

    let resolvedPolicyType =
        availablePolicyTypes.find(
            (policyType) =>
                normalizePolicyTypeLabel(policyType) ===
                normalizeForMatch(parsed.policyType || '')
        ) || null;

    const resolvedDepartment =
        availableDepartments.find(
            (department) =>
                normalizeForMatch(department) ===
                normalizeForMatch(parsed.department || '')
        ) || null;

    resolvedPolicyType = applyDomainPreference({
        question,
        policyType: resolvedPolicyType,
        availablePolicyTypes,
    });

    const clarificationType =
        parsed.clarificationType === 'policy_type' ||
        parsed.clarificationType === 'department'
            ? parsed.clarificationType
            : null;

    let clarificationOptions = Array.isArray(parsed.clarificationOptions)
        ? parsed.clarificationOptions.slice(0, MAX_CLARIFICATION_CHOICES)
        : [];

    clarificationOptions = filterClarificationOptionsByDomain({
        question,
        options: clarificationOptions,
    });

    return {
        originalQuestion: question,
        normalizedQuestion:
            typeof parsed.normalizedQuestion === 'string' &&
            parsed.normalizedQuestion.trim()
                ? parsed.normalizedQuestion.trim()
                : question,
        isPolicyQuestion: Boolean(parsed.isPolicyQuestion),
        isFollowUp: Boolean(parsed.isFollowUp),
        policyType: resolvedPolicyType,
        department: resolvedDepartment,
        explicitPolicyType: Boolean(resolvedPolicyType),
        explicitDepartment: Boolean(resolvedDepartment),
        needsClarification:
            Boolean(parsed.needsClarification) &&
            Boolean(clarificationType) &&
            clarificationOptions.length > 1,
        clarificationType,
        clarificationQuestion:
            typeof parsed.clarificationQuestion === 'string' &&
            parsed.clarificationQuestion.trim()
                ? parsed.clarificationQuestion.trim()
                : null,
        clarificationOptions,
    };
};

const buildFollowUpFromContext = ({
    question,
    conversationState,
    availablePolicyTypes = [],
    availableDepartments = [],
}) => {
    const explicitDepartment = detectDepartmentMention(question, availableDepartments);
    const explicitPolicyType = detectPolicyTypeMention(question, availablePolicyTypes);

    const department =
        explicitDepartment ||
        conversationState?.lastResolvedDepartment ||
        null;

    let policyType =
        explicitPolicyType ||
        conversationState?.lastResolvedPolicyType ||
        null;

    policyType = applyDomainPreference({
        question: `${conversationState?.lastPolicyQuestion || ''}\n${question}`,
        policyType,
        availablePolicyTypes,
    });

    const baseQuestion = conversationState?.lastPolicyQuestion || question;
    const normalizedQuestion = explicitDepartment
        ? `${baseQuestion}\nDepartment: ${explicitDepartment}\nFollow-up: ${question}`
        : department
            ? `${baseQuestion}\nScope: ${department}\nFollow-up: ${question}`
            : `${baseQuestion}\nFollow-up: ${question}`;

    return buildResolvedTurn({
        question,
        normalizedQuestion,
        policyType,
        department,
        isFollowUp: true,
        explicitPolicyType: Boolean(explicitPolicyType),
        explicitDepartment: Boolean(explicitDepartment),
        suppressClarification: false,
    });
};

const buildFallbackTurn = ({
    question,
    conversationState,
    availablePolicyTypes = [],
    availableDepartments = [],
}) => {
    const department = detectDepartmentMention(question, availableDepartments);
    let policyType = detectPolicyTypeMention(question, availablePolicyTypes);
    const intent = classifyQuestionIntentHeuristically(question);

    policyType = applyDomainPreference({
        question,
        policyType,
        availablePolicyTypes,
    });

    if (conversationState?.pendingClarification) {
        return resolvePendingClarificationTurn({
            question,
            conversationState,
            availablePolicyTypes,
            availableDepartments,
        });
    }

    if (
        conversationState?.lastPolicyQuestion &&
        isLikelyEllipticalFollowUp(question)
    ) {
        return buildFollowUpFromContext({
            question,
            conversationState,
            availablePolicyTypes,
            availableDepartments,
        });
    }

    if (intent !== 'policy_specific') {
        return {
            originalQuestion: question,
            normalizedQuestion: question,
            isPolicyQuestion: false,
            isFollowUp: false,
            policyType: null,
            department: null,
            explicitPolicyType: false,
            explicitDepartment: false,
            suppressClarification: false,
            needsClarification: false,
            clarificationType: null,
            clarificationQuestion: null,
            clarificationOptions: [],
        };
    }

    return buildResolvedTurn({
        question,
        normalizedQuestion: question,
        policyType,
        department,
        isFollowUp: false,
        explicitPolicyType: Boolean(policyType),
        explicitDepartment: Boolean(department),
    });
};

const understandUserTurn = async ({
    question,
    conversationState = null,
    availablePolicyTypes = [],
    availableDepartments = [],
}) => {
    if (isObviouslyNonPolicyQuestion(question)) {
        return {
            originalQuestion: question,
            normalizedQuestion: question,
            isPolicyQuestion: false,
            isFollowUp: false,
            policyType: null,
            department: null,
            explicitPolicyType: false,
            explicitDepartment: false,
            suppressClarification: false,
            needsClarification: false,
            clarificationType: null,
            clarificationQuestion: null,
            clarificationOptions: [],
        };
    }

    if (conversationState?.pendingClarification) {
        return resolvePendingClarificationTurn({
            question,
            conversationState,
            availablePolicyTypes,
            availableDepartments,
        });
    }

    if (
        conversationState?.lastPolicyQuestion &&
        isLikelyEllipticalFollowUp(question)
    ) {
        return buildFollowUpFromContext({
            question,
            conversationState,
            availablePolicyTypes,
            availableDepartments,
        });
    }

    try {
        const llmTurn = await understandUserTurnWithLlm({
            question,
            conversationState,
            availablePolicyTypes,
            availableDepartments,
        });

        if (llmTurn.needsClarification) {
            return {
                ...llmTurn,
                clarificationQuestion:
                    llmTurn.clarificationQuestion ||
                    buildClarificationQuestion({
                        clarificationType: llmTurn.clarificationType,
                        clarificationOptions: llmTurn.clarificationOptions,
                    }),
            };
        }

        return llmTurn;
    } catch (error) {
        return buildFallbackTurn({
            question,
            conversationState,
            availablePolicyTypes,
            availableDepartments,
        });
    }
};

module.exports = {
    understandUserTurn,
};
