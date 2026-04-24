const { Room, RoomEvent } = require('@livekit/rtc-node');
const { TrackKind } = require('@livekit/rtc-ffi-bindings');
const { AccessToken } = require('livekit-server-sdk');
const { createClient } = require('@deepgram/sdk');

const env = require('../../config/env');
const {
    AGENT_IDENTITY,
    AGENT_DISPLAY_NAME,
    AGENT_SESSION_IDLE_TIMEOUT_MS,
    TRANSCRIPT_TOPIC,
} = require('./constants');
const { initTtsPipeline } = require('./tts');
const { createAudioBridge } = require('./audioBridge');
const { askPolicyQuestion } = require('../../apps/rag/v1/service');

const activeAgentSessions = new Map();
let deepgramClient = null;

const buildAgentToken = async (roomName) => {
    const agentToken = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
        identity: AGENT_IDENTITY,
        name: AGENT_DISPLAY_NAME,
        metadata: JSON.stringify({
            role: 'agent',
            roomName,
        }),
    });

    agentToken.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });

    return await agentToken.toJwt();
};

const getDeepgramClient = () => {
    if (!deepgramClient) {
        deepgramClient = createClient(env.deepgramApiKey);
    }

    return deepgramClient;
};

const hasRemoteUsers = (room) => room.remoteParticipants.size > 0;

const shutdownAgentSession = async (roomName, reason = 'shutdown requested') => {
    const session = activeAgentSessions.get(roomName);

    if (!session) {
        return;
    }

    if (session.shutdownTimer) {
        clearTimeout(session.shutdownTimer);
        session.shutdownTimer = null;
    }

    activeAgentSessions.delete(roomName);

    await Promise.allSettled(
        Array.from(session.audioSessions.values()).map((audioSession) =>
            audioSession.stop(`agent session shutdown: ${reason}`)
        )
    );

    session.audioSessions.clear();

    if (session.ttsPipeline) {
        await session.ttsPipeline.close();
    }

    await session.room.disconnect();

    if (typeof session.onSessionClosed === 'function') {
        try {
            session.onSessionClosed(reason);
        } catch (error) {
            console.error('\x1b[31m[SESSION CLOSE CALLBACK ERROR]\x1b[0m', error);
        }
    }

    console.log(`\x1b[33m[AGENT SESSION CLOSED]\x1b[0m room=${roomName} reason=${reason}`);
};

const scheduleIdleShutdown = (roomName) => {
    const session = activeAgentSessions.get(roomName);

    if (!session) {
        return;
    }

    if (session.shutdownTimer) {
        clearTimeout(session.shutdownTimer);
    }

    if (hasRemoteUsers(session.room)) {
        session.shutdownTimer = null;
        return;
    }

    session.shutdownTimer = setTimeout(() => {
        void shutdownAgentSession(roomName, 'idle timeout');
    }, AGENT_SESSION_IDLE_TIMEOUT_MS);
};

const ensureAgentSession = async (roomName, sessionConfig = {}) => {
    const existingSession = activeAgentSessions.get(roomName);

    if (existingSession) {
        return existingSession.ready;
    }

    const deepgram = getDeepgramClient();
    const room = new Room();
    const audioSessions = new Map();

    const session = {
        roomName,
        room,
        audioSessions,
        ttsPipeline: null,
        shutdownTimer: null,
        onSessionClosed: sessionConfig.onSessionClosed || null,
        sessionId: sessionConfig.sessionId || null,
        ownerUsername: sessionConfig.ownerUsername || null,
        ready: null,
    };

    session.ready = (async () => {
        const token = await buildAgentToken(roomName);

        await room.connect(env.livekit.url, token);
        console.log(`\x1b[35m[AGENT SESSION ONLINE]\x1b[0m room=${roomName}`);

        session.ttsPipeline = await initTtsPipeline(room, deepgram);
        console.log(`\x1b[35m[TTS ONLINE]\x1b[0m room=${roomName}`);

        const publishTranscriptEvent = async (event) => {
            try {
                const payload = new TextEncoder().encode(JSON.stringify(event));

                await room.localParticipant.publishData(payload, {
                    reliable: true,
                    topic: TRANSCRIPT_TOPIC,
                });
            } catch (error) {
                console.error('\x1b[31m[TRANSCRIPT PUBLISH ERROR]\x1b[0m', error);
            }
        };

        room.on(RoomEvent.ParticipantConnected, (participant) => {
            console.log(
                `\x1b[36m[ROOM JOIN]\x1b[0m room=${roomName} participant=${participant.identity}`
            );

            if (session.shutdownTimer) {
                clearTimeout(session.shutdownTimer);
                session.shutdownTimer = null;
            }
        });

        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            console.log(
                `\x1b[33m[ROOM LEAVE]\x1b[0m room=${roomName} participant=${participant.identity}`
            );

            const audioSession = audioSessions.get(participant.identity);
            if (audioSession) {
                void audioSession.stop('participant disconnected');
                audioSessions.delete(participant.identity);
            }

            scheduleIdleShutdown(roomName);
        });

        room.on(RoomEvent.TrackSubscriptionFailed, (trackSid, participant, reason) => {
            console.error(
                `\x1b[31m[TRACK SUBSCRIPTION FAILED]\x1b[0m room=${roomName} participant=${participant.identity} sid=${trackSid} reason=${reason || 'unknown'}`
            );
        });

        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            console.log(
                `\x1b[36m[TRACK SUBSCRIBED]\x1b[0m room=${roomName} participant=${participant.identity} kind=${track.kind} sid=${track.sid}`
            );

            if (track.kind !== TrackKind.KIND_AUDIO) return;
            if (participant.identity === AGENT_IDENTITY) return;

            if (audioSessions.has(participant.identity)) {
                console.warn(
                    `\x1b[33m[AUDIO SESSION EXISTS]\x1b[0m room=${roomName} participant=${participant.identity}`
                );
                return;
            }

            const audioSession = createAudioBridge({
                participant,
                track,
                deepgram,
                askPolicyQuestion,
                speakText: session.ttsPipeline.speakText,
                publishTranscriptEvent,
                sessionContext: {
                    sessionId: session.sessionId,
                    roomName,
                    ownerUsername: session.ownerUsername,
                },
            });

            audioSessions.set(participant.identity, audioSession);

            audioSession.task.finally(() => {
                audioSessions.delete(participant.identity);
            });
        });

        room.on(RoomEvent.TrackUnsubscribed, async (track, publication, participant) => {
            console.log(
                `\x1b[33m[TRACK UNSUBSCRIBED]\x1b[0m room=${roomName} participant=${participant.identity}`
            );

            const audioSession = audioSessions.get(participant.identity);
            if (audioSession) {
                await audioSession.stop('remote audio track unsubscribed');
                audioSessions.delete(participant.identity);
            }
        });

        room.on(RoomEvent.Disconnected, () => {
            console.log(`\x1b[33m[ROOM DISCONNECTED]\x1b[0m room=${roomName}`);
        });

        scheduleIdleShutdown(roomName);

        return session;
    })().catch(async (error) => {
        activeAgentSessions.delete(roomName);
        console.error(`\x1b[31m[AGENT SESSION ERROR]\x1b[0m room=${roomName}`, error);

        try {
            await room.disconnect();
        } catch {}

        if (typeof session.onSessionClosed === 'function') {
            try {
                session.onSessionClosed('agent connect failed');
            } catch {}
        }

        throw error;
    });

    activeAgentSessions.set(roomName, session);

    return session.ready;
};

const startMissuAgent = async () => {
    getDeepgramClient();
    console.log('\x1b[35m[AGENT MANAGER ONLINE]\x1b[0m Waiting for voice sessions...');
};

process.on('SIGINT', async () => {
    console.log('\n\x1b[33m[MIST AGENT] Shutdown signal received.\x1b[0m');

    await Promise.allSettled(
        Array.from(activeAgentSessions.keys()).map((roomName) =>
            shutdownAgentSession(roomName, 'server shutdown')
        )
    );

    process.exit(0);
});

module.exports = {
    startMissuAgent,
    ensureAgentSession,
    shutdownAgentSession,
};
