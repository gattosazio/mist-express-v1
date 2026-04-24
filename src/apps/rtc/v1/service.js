const crypto = require('crypto');
const { AccessToken } = require('livekit-server-sdk');

const env = require('../../../config/env');
const { ensureAgentSession } = require('../../../agents/missu/worker');

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
    const token = new AccessToken(
        env.livekit.apiKey,
        env.livekit.apiSecret,
        {
            identity: String(participantIdentity),
            name: String(user?.username || participantIdentity),
        }
    );

    token.ttl = '15m';

    token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
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

    await ensureAgentSession(roomName);

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

module.exports = {
    createVoiceSession,
};
