const crypto = require('crypto');
const { AccessToken } = require('livekit-server-sdk');

const env = require('../../../config/env');
const { ensureAgentSession, shutdownAgentSession } = require('../../../agents/missu/worker');
const { logRtcSessionEvent } = require('./audit');

const activeVoiceSessions = new Map();

const buildHttpError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const buildRoomName = (sessionId) => `mist-session-${sessionId}`;

const buildParticipantIdentity = (sessionUser, sessionId) => {
    const safeUsername = String(sessionUser?.username || sessionUser?.email || sessionUser?.supabase_user_id || 'guest')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    return `${safeUsername || 'guest'}-${sessionId.slice(0, 8)}`;
};

const buildAccessToken = async ({ roomName, participantIdentity, user }) => {
    const token = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
        identity: String(participantIdentity),
        name: String(user?.username || participantIdentity),
        metadata: JSON.stringify({
            roomName,
            username: user?.username || null,
            role: 'user',
        }),
    });

    token.ttl = '15m';

    token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });

    return await token.toJwt();
};

const isSessionOwner = (session, user) => {
    if (!session || !user) {
        return false;
    }

    if (session.ownerUserId && user?.id) {
        return String(session.ownerUserId) === String(user.id);
    }

    if (session.ownerSupabaseUserId && user?.supabase_user_id) {
        return String(session.ownerSupabaseUserId) === String(user.supabase_user_id);
    }

    return String(session.ownerUsername || '').toLowerCase() === String(user?.username || '').toLowerCase();
};

const getOwnedSessionOrThrow = (sessionId, user) => {
    const session = activeVoiceSessions.get(sessionId);

    if (!session || !isSessionOwner(session, user)) {
        throw buildHttpError('Voice session not found.', 404);
    }

    return session;
};

const markSessionClosed = (sessionId, reason) => {
    const session = activeVoiceSessions.get(sessionId);

    if (!session || session.status === 'closed') {
        return session || null;
    }

    session.status = 'closed';
    session.endedAt = new Date().toISOString();
    session.endReason = reason;
    activeVoiceSessions.set(sessionId, session);

    logRtcSessionEvent({
        event: 'session_closed',
        sessionId: session.sessionId,
        roomName: session.roomName,
        username: session.ownerUsername,
        participantIdentity: session.participantIdentity,
        status: session.status,
        reason,
    });

    return session;
};

const createVoiceSession = async ({ user, auth, network }) => {
    if (!user?.id || !network?.id) {
        throw buildHttpError('Authenticated user is required to create a voice session.', 401);
    }

    const sessionId = crypto.randomUUID();
    const roomName = buildRoomName(sessionId);
    const participantIdentity = buildParticipantIdentity(user, sessionId);

    const sessionRecord = {
        sessionId,
        roomName,
        participantIdentity,
        ownerUserId: user.id || null,
        ownerSupabaseUserId: auth?.supabase_user_id || null,
        ownerUsername: user.username,
        networkId: network.id,
        status: 'creating',
        startedAt: new Date().toISOString(),
        endedAt: null,
        endReason: null,
    };

    activeVoiceSessions.set(sessionId, sessionRecord);

    logRtcSessionEvent({
        event: 'session_created',
        sessionId,
        roomName,
        authUserId: auth?.supabase_user_id || null,
        localUserId: user.id || null,
        networkId: network.id,
        username: user.username,
        participantIdentity,
        status: sessionRecord.status,
    });

    try {
        await ensureAgentSession(roomName, {
            sessionId,
            ownerUserId: user.id || null,
            ownerUsername: user.username,
            networkId: network.id,
            onSessionOnline: () => {
                const current = activeVoiceSessions.get(sessionId);
                if (!current || current.status === 'closed') {
                    return;
                }

                current.status = 'active';
                activeVoiceSessions.set(sessionId, current);

                logRtcSessionEvent({
                    event: 'agent_session_ready',
                    sessionId,
                    roomName,
                    authUserId: current.ownerSupabaseUserId || null,
                    localUserId: current.ownerUserId || null,
                    networkId: current.networkId || null,
                    username: current.ownerUsername,
                    participantIdentity: current.participantIdentity,
                    status: current.status,
                });
            },
            onSessionClosed: (reason = 'agent session closed') => {
                markSessionClosed(sessionId, reason);
            },
        });

        const token = await buildAccessToken({
            roomName,
            participantIdentity,
            user,
        });

        logRtcSessionEvent({
            event: 'session_token_issued',
            sessionId,
            roomName,
            authUserId: auth?.supabase_user_id || null,
            localUserId: user.id || null,
            networkId: network.id,
            username: user.username,
            participantIdentity,
            status: 'active',
        });

        return {
            sessionId,
            roomName,
            participantIdentity,
            token,
            networkId: network.id,
        };
    } catch (error) {
        const current = activeVoiceSessions.get(sessionId);
        if (current) {
            current.status = 'failed';
            current.endedAt = new Date().toISOString();
            current.endReason = error.message || 'session creation failed';
            activeVoiceSessions.set(sessionId, current);
        }

        logRtcSessionEvent({
            event: 'session_create_failed',
            sessionId,
            roomName,
            authUserId: auth?.supabase_user_id || null,
            localUserId: user.id || null,
            networkId: network.id,
            username: user.username,
            participantIdentity,
            status: 'failed',
            reason: error.message || 'session creation failed',
        });

        throw error;
    }
};

const closeVoiceSession = async (sessionId, { user, auth, network }, options = {}) => {
    const session = getOwnedSessionOrThrow(sessionId, user);

    logRtcSessionEvent({
        event: 'session_close_requested',
        sessionId: session.sessionId,
        roomName: session.roomName,
        authUserId: auth?.supabase_user_id || null,
        localUserId: user?.id || null,
        networkId: network?.id || session.networkId || null,
        username: session.ownerUsername,
        participantIdentity: session.participantIdentity,
        status: session.status,
        reason: options.reason || 'client teardown',
    });

    if (session.status === 'closed') {
        return {
            sessionId,
            roomName: session.roomName,
            status: 'closed',
            endedAt: session.endedAt,
            endReason: session.endReason,
        };
    }

    await shutdownAgentSession(session.roomName, options.reason || 'client teardown');

    const updatedSession = activeVoiceSessions.get(sessionId) || session;

    return {
        sessionId,
        roomName: updatedSession.roomName,
        status: updatedSession.status || 'closed',
        endedAt: updatedSession.endedAt,
        endReason: updatedSession.endReason,
    };
};

module.exports = {
    createVoiceSession,
    closeVoiceSession,
};
