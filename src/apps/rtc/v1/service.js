const crypto = require('crypto');
const { AccessToken } = require('livekit-server-sdk');

const env = require('../../../config/env');
const { ensureAgentSession, shutdownAgentSession } = require('../../../agents/missu/worker');

const activeVoiceSessions = new Map();

const buildRoomName = (sessionId) => `mist-session-${sessionId}`;

const buildParticipantIdentity = (user, sessionId) => {
    const safeUsername = String(user?.username || 'guest')
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

const createVoiceSession = async (user) => {
    if (!user?.username) {
        throw new Error('Authenticated user is required to create a voice session.');
    }

    const sessionId = crypto.randomUUID();
    const roomName = buildRoomName(sessionId);
    const participantIdentity = buildParticipantIdentity(user, sessionId);

    const sessionRecord = {
        sessionId,
        roomName,
        participantIdentity,
        userId: user.id || null,
        username: user.username,
        startedAt: new Date().toISOString(),
        endedAt: null,
        endReason: null,
        status: 'active',
    };

    activeVoiceSessions.set(sessionId, sessionRecord);

    await ensureAgentSession(roomName, {
        sessionId,
        ownerUsername: user.username,
        onSessionClosed: (reason = 'agent session closed') => {
            const current = activeVoiceSessions.get(sessionId);
            if (!current || current.status === 'closed') {
                return;
            }

            current.status = 'closed';
            current.endedAt = new Date().toISOString();
            current.endReason = reason;
            activeVoiceSessions.set(sessionId, current);
        },
    });

    const token = await buildAccessToken({
        roomName,
        participantIdentity,
        user,
    });

    return {
        sessionId,
        roomName,
        participantIdentity,
        token,
    };
};

const closeVoiceSession = async (sessionId, user) => {
    const session = activeVoiceSessions.get(sessionId);

    if (!session) {
        return {
            sessionId,
            status: 'not_found',
        };
    }

    if (session.username !== user?.username) {
        throw new Error('You are not allowed to close this voice session.');
    }

    if (session.status === 'closed') {
        return {
            sessionId,
            roomName: session.roomName,
            status: 'closed',
            endedAt: session.endedAt,
            endReason: session.endReason,
        };
    }

    await shutdownAgentSession(session.roomName, 'client teardown');

    const updated = activeVoiceSessions.get(sessionId) || session;

    return {
        sessionId,
        roomName: updated.roomName,
        status: updated.status || 'closed',
        endedAt: updated.endedAt,
        endReason: updated.endReason,
    };
};

module.exports = {
    createVoiceSession,
    closeVoiceSession,
};
