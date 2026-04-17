const AuditLog = require('../../../models/audit_log');

const logPolicyInteraction = async ({
    participantIdentity = null,
    query,
    response,
    confidence = 'low',
    escalationNeeded = false,
    citations = [],
    retrievedChunks = [],
    policyType = null,
    metadata = {},
}) => {
    if (!query || !response) {
        throw new Error('Audit logging requires both query and response.');
    }

    return AuditLog.create({
        participant_identity: participantIdentity,
        channel: 'voice',
        query,
        response,
        confidence,
        escalation_needed: escalationNeeded,
        policy_type: policyType,
        citations,
        retrieved_chunks: retrievedChunks,
        metadata,
    });
};

module.exports = {
    logPolicyInteraction,
};
