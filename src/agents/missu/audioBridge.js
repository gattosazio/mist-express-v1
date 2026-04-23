const { AudioStream } = require('@livekit/rtc-node');
const { LiveTranscriptionEvents } = require('@deepgram/sdk');
const {
    AUDIO_SAMPLE_RATE,
    AUDIO_CHANNELS,
    DEEPGRAM_KEEPALIVE_MS,
    DEEPGRAM_ENDPOINTING_MS,
    FINAL_RESPONSE_DELAY_MS,
} = require('./constants');
const { createTranscriptGate } = require('./transcriptFilter');
const { logPolicyInteraction } = require('../../apps/rag/v1/audit');

const CLARIFICATION_TTL_MS = 30000;

const waitForDeepgramOpen = (dgLive) =>
    new Promise((resolve, reject) => {
        dgLive.once(LiveTranscriptionEvents.Open, resolve);
        dgLive.once(LiveTranscriptionEvents.Error, (error) => {
            reject(error instanceof Error ? error : new Error(error?.message || 'Deepgram socket error'));
        });
        dgLive.once(LiveTranscriptionEvents.Close, () => {
            reject(new Error('Deepgram socket closed before opening.'));
        });
    });

const logFilterDecision = (decision) => {
    if (decision.reason === 'missing_wake_word') {
        console.log(`\x1b[90m[FILTERED]\x1b[0m Missing wake word: ${decision.transcript}`);
        return;
    }

    if (decision.reason === 'empty_after_cleanup') {
        console.log('\x1b[90m[FILTERED]\x1b[0m Empty after cleanup.');
        return;
    }

    if (decision.reason === 'too_short') {
        console.log(`\x1b[90m[FILTERED]\x1b[0m Too short: ${decision.cleanedTranscript}`);
        return;
    }

    if (decision.reason === 'too_few_words') {
        console.log(`\x1b[90m[FILTERED]\x1b[0m Too few words: ${decision.cleanedTranscript}`);
        return;
    }

    if (decision.reason === 'duplicate') {
        console.log(`\x1b[90m[FILTERED]\x1b[0m Duplicate transcript: ${decision.cleanedTranscript}`);
        return;
    }

    if (decision.reason === 'cooldown') {
        console.log(
            `\x1b[90m[COOLDOWN]\x1b[0m Skipping LLM call for ${decision.waitSeconds}s: ${decision.cleanedTranscript}`
        );
    }
};

const buildSpokenResponse = (ragResult) => {
    const answer =
        ragResult?.answer ||
        'I could not verify that from the current policy context.';

    if (!ragResult) {
        return answer;
    }

    if (ragResult.needsClarification) {
        return answer;
    }

    return answer;
};

const normalizeClarificationText = (text) =>
    String(text || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const resolveClarificationSelection = (transcript, pendingClarification) => {
    if (!pendingClarification) {
        return null;
    }

    const normalizedTranscript = normalizeClarificationText(transcript);

    for (const option of pendingClarification.clarificationOptions || []) {
        const normalizedOption = normalizeClarificationText(option);

        if (!normalizedOption) {
            continue;
        }

        if (
            normalizedTranscript === normalizedOption ||
            normalizedTranscript.includes(normalizedOption)
        ) {
            return option;
        }
    }

    return null;
};

const createAudioBridge = ({
    participant,
    track,
    deepgram,
    askPolicyQuestion,
    speakText,
    publishTranscriptEvent,
}) => {
    const transcriptGate = createTranscriptGate();

    let stopped = false;
    let reader = null;
    let dgLive = null;
    let keepAliveTimer = null;
    let pendingClarification = null;
    let pendingResponseTimer = null;
    let latestAcceptedTranscript = null;

    const stop = async (reason = 'stop requested') => {
        if (stopped) return;
        stopped = true;

        if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
        }

        if (pendingResponseTimer) {
            clearTimeout(pendingResponseTimer);
            pendingResponseTimer = null;
        }

        latestAcceptedTranscript = null;
        pendingClarification = null;

        if (reader) {
            try {
                await reader.cancel(reason);
            } catch (error) {
                console.warn(`\x1b[33m[AUDIO CLEANUP]\x1b[0m Reader cancel failed: ${error.message}`);
            }
        }

        if (dgLive && dgLive.getReadyState() === 1) {
            try {
                dgLive.finalize();
            } catch (error) {
                console.warn(`\x1b[33m[DEEPGRAM CLEANUP]\x1b[0m Finalize failed: ${error.message}`);
            }

            try {
                dgLive.requestClose();
            } catch (error) {
                console.warn(`\x1b[33m[DEEPGRAM CLEANUP]\x1b[0m Close request failed: ${error.message}`);
            }
        }
    };

    const task = (async () => {
        console.log(
            `\x1b[32m[MISSU CORE] Audio feed from "${participant.identity}" secured. Booting Deepgram & RAG...\x1b[0m`
        );

        const rtcAudioStream = new AudioStream(track, {
            sampleRate: AUDIO_SAMPLE_RATE,
            numChannels: AUDIO_CHANNELS,
            frameSizeMs: 20,
        });

        reader = rtcAudioStream.getReader();

        dgLive = deepgram.listen.live({
            model: 'nova-2',
            language: 'en',
            smart_format: true,
            encoding: 'linear16',
            sample_rate: AUDIO_SAMPLE_RATE,
            channels: AUDIO_CHANNELS,
            interim_results: false,
            vad_events: false,
            endpointing: DEEPGRAM_ENDPOINTING_MS,
        });

        dgLive.on(LiveTranscriptionEvents.Error, (error) => {
            console.error('\x1b[31m[DEEPGRAM ERROR]\x1b[0m', error);
        });

        dgLive.on(LiveTranscriptionEvents.Close, () => {
            console.warn(`\x1b[33m[DEEPGRAM]\x1b[0m Connection closed for "${participant.identity}".`);
        });

        dgLive.on(LiveTranscriptionEvents.Metadata, (data) => {
            console.log(
                `\x1b[36m[DEEPGRAM META]\x1b[0m request_id=${data.request_id} model=${data.model_info?.name || 'unknown'}`
            );
        });

        dgLive.on(LiveTranscriptionEvents.SpeechStarted, () => {
            console.log(`\x1b[36m[SPEECH]\x1b[0m "${participant.identity}" started speaking.`);
        });

        dgLive.on(LiveTranscriptionEvents.Transcript, async (data) => {
            const transcript = data?.channel?.alternatives?.[0]?.transcript?.trim();

            if (!transcript || !data.is_final) return;

            console.log(`\x1b[33m[USER FINAL]\x1b[0m ${transcript}`);

            const now = Date.now();

            if (pendingClarification && now - pendingClarification.createdAt > CLARIFICATION_TTL_MS) {
                pendingClarification = null;
            }

            const decision = transcriptGate.evaluate(transcript, now);

            if (!decision.accepted) {
                logFilterDecision(decision);
                return;
            }

            transcriptGate.markAccepted(decision.normalizedCleanedTranscript, now);

            latestAcceptedTranscript = {
                cleanedTranscript: decision.cleanedTranscript,
                timestamp: now,
            };

            if (pendingResponseTimer) {
                clearTimeout(pendingResponseTimer);
            }

            pendingResponseTimer = setTimeout(async () => {
                if (stopped || !latestAcceptedTranscript) {
                    return;
                }

                const acceptedTranscript = latestAcceptedTranscript;
                latestAcceptedTranscript = null;
                pendingResponseTimer = null;

                try {
                    await publishTranscriptEvent({
                        type: 'transcript',
                        speaker: 'user',
                        text: acceptedTranscript.cleanedTranscript,
                        final: true,
                        participantIdentity: participant.identity,
                        createdAt: Date.now(),
                    });
                } catch (error) {
                    console.error('\x1b[31m[TRANSCRIPT PUBLISH ERROR]\x1b[0m', error);
                }

                try {
                    let ragPayload = {
                        question: acceptedTranscript.cleanedTranscript,
                    };

                    const clarificationSelection = resolveClarificationSelection(
                        acceptedTranscript.cleanedTranscript,
                        pendingClarification
                    );

                    const clarificationOriginalQuestion = pendingClarification?.originalQuestion || null;

                    if (pendingClarification && clarificationSelection) {
                        ragPayload = {
                            question: pendingClarification.originalQuestion,
                            [pendingClarification.clarificationType]: clarificationSelection,
                        };

                        console.log(
                            `\x1b[36m[CLARIFICATION RESOLVED]\x1b[0m type=${pendingClarification.clarificationType} value=${clarificationSelection}`
                        );
                    }

                    const ragResult = await askPolicyQuestion(ragPayload);

                    if (ragResult?.needsClarification) {
                        pendingClarification = {
                            originalQuestion: ragPayload.question,
                            clarificationType: ragResult.clarificationType,
                            clarificationOptions: Array.isArray(ragResult.clarificationOptions)
                                ? ragResult.clarificationOptions
                                : [],
                            createdAt: Date.now(),
                        };
                    } else {
                        pendingClarification = null;
                    }

                    const missuResponse =
                        ragResult?.answer ||
                        'I could not verify that from the current policy context.';
                    const spokenResponse = buildSpokenResponse(ragResult);

                    console.log(`\x1b[35m[MISSU BRAIN]\x1b[0m ${missuResponse}`);
                    console.log(`\x1b[35m[MISSU SPOKEN]\x1b[0m ${spokenResponse}`);
                    console.log(
                        `\x1b[36m[RAG]\x1b[0m confidence=${ragResult?.confidence || 'unknown'} escalation=${Boolean(ragResult?.escalationNeeded)} clarification=${Boolean(ragResult?.needsClarification)} citations=${ragResult?.citations?.length || 0}`
                    );

                    try {
                        await publishTranscriptEvent({
                            type: 'transcript',
                            speaker: 'agent',
                            text: spokenResponse,
                            final: true,
                            participantIdentity: 'MISSU_CORE',
                            createdAt: Date.now(),
                        });
                    } catch (error) {
                        console.error('\x1b[31m[TRANSCRIPT PUBLISH ERROR]\x1b[0m', error);
                    }

                    try {
                        await logPolicyInteraction({
                            participantIdentity: participant.identity,
                            query: acceptedTranscript.cleanedTranscript,
                            response: missuResponse,
                            confidence: ragResult?.confidence || 'low',
                            escalationNeeded: Boolean(ragResult?.escalationNeeded),
                            citations: Array.isArray(ragResult?.citations) ? ragResult.citations : [],
                            retrievedChunks: Array.isArray(ragResult?.retrievedChunks) ? ragResult.retrievedChunks : [],
                            policyType: ragResult?.citations?.[0]?.policyType || null,
                            metadata: {
                                roomParticipant: participant.identity,
                                source: 'missu_voice_rag',
                                spokenResponse,
                                needsClarification: Boolean(ragResult?.needsClarification),
                                clarificationType: ragResult?.clarificationType || null,
                                clarificationOptions: Array.isArray(ragResult?.clarificationOptions)
                                    ? ragResult.clarificationOptions
                                    : [],
                                clarificationResolvedWith: clarificationSelection || null,
                                clarificationOriginalQuestion,
                            },
                        });
                    } catch (auditError) {
                        console.error('\x1b[31m[AUDIT ERROR]\x1b[0m', auditError);
                    }

                    await speakText(spokenResponse);
                } catch (error) {
                    console.error('\x1b[31m[BRAIN ERROR]\x1b[0m', error);
                }
            }, FINAL_RESPONSE_DELAY_MS);
        });

        await waitForDeepgramOpen(dgLive);

        console.log(
            `\x1b[32m[DEEPGRAM]\x1b[0m WebSocket open. Streaming ${AUDIO_SAMPLE_RATE}Hz mono PCM for "${participant.identity}".`
        );

        keepAliveTimer = setInterval(() => {
            if (!stopped && dgLive.getReadyState() === 1) {
                dgLive.keepAlive();
            }
        }, DEEPGRAM_KEEPALIVE_MS);

        let frameCount = 0;
        let totalBytesSent = 0;

        while (!stopped) {
            const { done, value: frame } = await reader.read();

            if (done) {
                console.warn(`\x1b[33m[AUDIO]\x1b[0m Stream ended for "${participant.identity}".`);
                break;
            }

            frameCount += 1;

            if (frameCount === 1) {
                console.log(
                    `\x1b[36m[AUDIO DEBUG]\x1b[0m First frame sampleRate=${frame.sampleRate} samplesPerChannel=${frame.samplesPerChannel} channels=${frame.channels}`
                );
            }

            if (dgLive.getReadyState() !== 1) {
                console.warn(
                    `\x1b[33m[AUDIO]\x1b[0m Deepgram socket is no longer open for "${participant.identity}". Stopping stream.`
                );
                break;
            }

            const pcmBuffer = Buffer.from(
                frame.data.buffer,
                frame.data.byteOffset,
                frame.data.byteLength
            );

            if (!pcmBuffer.length) {
                continue;
            }

            dgLive.send(pcmBuffer);
            totalBytesSent += pcmBuffer.length;

            if (frameCount % 100 === 0) {
                console.log(
                    `\x1b[36m[AUDIO DEBUG]\x1b[0m Sent ${frameCount} frames (${totalBytesSent} bytes) for "${participant.identity}".`
                );
            }
        }
    })()
        .catch((error) => {
            console.error(`\x1b[31m[AUDIO BRIDGE ERROR]\x1b[0m ${participant.identity}`, error);
        })
        .finally(async () => {
            await stop('audio bridge finished');
        });

    return { stop, task };
};

module.exports = { createAudioBridge };
