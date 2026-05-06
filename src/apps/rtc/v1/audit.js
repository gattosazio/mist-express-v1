const logRtcSessionEvent = ({
    event,
    sessionId = null,
    roomName = null,
    authUserId = null,
    localUserId = null,
    networkId = null,
    username = null,
    participantIdentity = null,
    status = null,
    reason = null,
    metadata = {},
}) => {
    const payload = {
        timestamp: new Date().toISOString(),
        source: 'rtc_session',
        event,
        sessionId,
        roomName,
        authUserId,
        localUserId,
        networkId,
        username,
        participantIdentity,
        status,
        reason,
        metadata,
    };

    console.log(`[RTC AUDIT] ${JSON.stringify(payload)}`);
};

module.exports = {
    logRtcSessionEvent,
};
