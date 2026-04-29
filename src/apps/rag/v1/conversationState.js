const buildConversationState = ({
    lastPolicyQuestion = null,
    pendingClarification = null,
    lastResolvedPolicyType = null,
    lastResolvedDepartment = null,
} = {}) => {
    if (!lastPolicyQuestion) {
        return null;
    }

    return {
        lastPolicyQuestion,
        pendingClarification,
        lastResolvedPolicyType: lastResolvedPolicyType || null,
        lastResolvedDepartment: lastResolvedDepartment || null,
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
