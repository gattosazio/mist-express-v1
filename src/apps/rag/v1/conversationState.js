const buildConversationState = ({
    lastPolicyQuestion = null,
    pendingClarification = null,
    lastResolvedPolicyType = null,
    lastResolvedDepartment = null,
    lastAnswer = null,
    lastCitations = [],
    lastRetrievedChunks = [],
} = {}) => {
    if (!lastPolicyQuestion) {
        return null;
    }

    return {
        lastPolicyQuestion,
        pendingClarification,
        lastResolvedPolicyType: lastResolvedPolicyType || null,
        lastResolvedDepartment: lastResolvedDepartment || null,
        lastAnswer: lastAnswer || null,
        lastCitations: Array.isArray(lastCitations) ? lastCitations : [],
        lastRetrievedChunks: Array.isArray(lastRetrievedChunks)
            ? lastRetrievedChunks
            : [],
    };
};

const buildPendingClarification = (response = {}) => {
    if (!response?.needsClarification) {
        return null;
    }

    if (!response.clarificationType) {
        return null;
    }

    return {
        type: response.clarificationType,
        options: Array.isArray(response.clarificationOptions)
            ? response.clarificationOptions
            : [],
    };
};

const updateConversationStateFromTurn = ({
    turn,
    response,
    previousState = null,
}) => {
    const pendingClarification = buildPendingClarification(response);

    return buildConversationState({
        lastPolicyQuestion:
            turn?.stateQuestion ||
            turn?.normalizedQuestion ||
            previousState?.lastPolicyQuestion ||
            null,
        pendingClarification,
        lastResolvedPolicyType:
            response?.resolvedPolicyType ??
            turn?.policyType ??
            previousState?.lastResolvedPolicyType ??
            null,
        lastResolvedDepartment:
            response?.resolvedDepartment ??
            turn?.department ??
            previousState?.lastResolvedDepartment ??
            null,
        lastAnswer:
            response?.needsClarification
                ? previousState?.lastAnswer || null
                : response?.answer || previousState?.lastAnswer || null,
        lastCitations:
            response?.needsClarification
                ? previousState?.lastCitations || []
                : Array.isArray(response?.citations)
                    ? response.citations
                    : previousState?.lastCitations || [],
        lastRetrievedChunks:
            response?.needsClarification
                ? previousState?.lastRetrievedChunks || []
                : Array.isArray(response?.retrievedChunks)
                    ? response.retrievedChunks
                    : previousState?.lastRetrievedChunks || [],
    });
};

const attachConversationState = ({
    response,
    turn,
    previousState = null,
}) => {
    return { 
        ...response,
        conversationState: updateConversationStateFromTurn({
            turn,
            response,
            previousState,
        }),
    };
};

module.exports = {
    buildConversationState,
    updateConversationStateFromTurn,
    attachConversationState,
};