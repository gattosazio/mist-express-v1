const { Room, RoomEvent } = require('@livekit/rtc-node');
const { TrackKind } = require('@livekit/rtc-ffi-bindings');
const { AccessToken } = require('livekit-server-sdk');
const { createClient } = require('@deepgram/sdk');

const env = require('../../config/env');
const { ROOM_NAME, AGENT_IDENTITY } = require('./constants');
const { initTtsPipeline } = require('./tts');
const { createAudioBridge } = require('./audioBridge');
const { askPolicyQuestion } = require('../../apps/rag/v1/service');

const TRANSCRIPT_TOPIC = 'missu.transcript';

const buildAgentToken = async () => {
    const agentToken = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
        identity: AGENT_IDENTITY,
        name: 'MISSU AI',
    });

    agentToken.addGrant({
        roomJoin: true,
        room: ROOM_NAME,
        canPublish: true,
        canSubscribe: true,
    });

    return agentToken.toJwt();
};

const startMissuAgent = async () => {
    const token = await buildAgentToken();
    const room = new Room();
    const activeSessions = new Map();

    const deepgram = createClient(env.deepgramApiKey);

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
        console.log(`\n\x1b[36m[MISSU CORE] ${participant.identity} has entered the terminal.\x1b[0m`);
    });

    room.on(RoomEvent.TrackSubscriptionFailed, (trackSid, participant, reason) => {
        console.error(
            `\x1b[31m[TRACK SUBSCRIPTION FAILED]\x1b[0m participant=${participant.identity} sid=${trackSid} reason=${reason || 'unknown'}`
        );
    });

    let ttsPipeline = null;

    try {
        await room.connect(env.livekit.url, token);
        console.log('\x1b[35m[AGENT ONLINE] MISSU Core is connected and standing by.\x1b[0m');

        ttsPipeline = await initTtsPipeline(room, deepgram);
        console.log('\x1b[35m[TTS ONLINE] MISSU voice track published.\x1b[0m');
    } catch (error) {
        console.error('\x1b[31m[AGENT ERROR] MISSU Core failed to connect:\x1b[0m', error);
        process.exit(1);
    }

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        console.log(
            `\x1b[36m[TRACK SUBSCRIBED]\x1b[0m participant=${participant.identity} kind=${track.kind} sid=${track.sid}`
        );

        if (track.kind !== TrackKind.KIND_AUDIO) return;
        if (participant.identity === AGENT_IDENTITY) return;

        if (activeSessions.has(participant.identity)) {
            console.warn(
                `\x1b[33m[MISSU CORE]\x1b[0m Audio session already active for "${participant.identity}". Skipping duplicate subscription.`
            );
            return;
        }

        const session = createAudioBridge({
            participant,
            track,
            deepgram,
            askPolicyQuestion,
            speakText: ttsPipeline.speakText,
            publishTranscriptEvent,
        });

        activeSessions.set(participant.identity, session);

        session.task.finally(() => {
            activeSessions.delete(participant.identity);
        });
    });

    room.on(RoomEvent.TrackUnsubscribed, async (track, publication, participant) => {
        console.log(
            `\x1b[33m[MISSU CORE] Audio feed from "${participant.identity}" disconnected.\x1b[0m`
        );

        const session = activeSessions.get(participant.identity);
        if (session) {
            await session.stop('remote audio track unsubscribed');
            activeSessions.delete(participant.identity);
        }
    });

    process.on('SIGINT', async () => {
        console.log('\n\x1b[33m[MISSU CORE] Shutdown signal received. Disconnecting...\x1b[0m');

        await Promise.allSettled(
            Array.from(activeSessions.values()).map((session) => session.stop('server shutdown'))
        );

        if (ttsPipeline) {
            await ttsPipeline.close();
        }

        await room.disconnect();

        console.log('\x1b[35m[MISSU CORE] Disconnected. Terminal offline.\x1b[0m');
        process.exit(0);
    });
};

module.exports = { startMissuAgent };
