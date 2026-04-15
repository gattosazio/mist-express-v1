const { AudioStream } = require('@livekit/rtc-node');
const { LiveTranscriptionEvents } = require('@deepgram/sdk');
const {
    AUDIO_SAMPLE_RATE,
    AUDIO_CHANNELS,
    DEEPGRAM_KEEPALIVE_MS,
    DEEPGRAM_ENDPOINTING_MS,
} = require('./constants');
const { createTranscriptGate } = require('./transcriptFilter');

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

const createAudioBridge = ({
    participant,
    track,
    deepgram,
    generateAssistantReply,
    extractRetryDelayMs,
    speakText,
}) => {
    const transcriptGate = createTranscriptGate();

    let stopped = false;
    let reader = null;
    let dgLive = null;
    let keepAliveTimer = null;

    const stop = async (reason = 'stop requested') => {
        if (stopped) return;
        stopped = true;

        if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
        }

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
            `\x1b[32m[MISSU CORE] Audio feed from "${participant.identity}" secured. Booting Deepgram & LLM...\x1b[0m`
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
            const decision = transcriptGate.evaluate(transcript, now);

            if (!decision.accepted) {
                logFilterDecision(decision);
                return;
            }

            transcriptGate.markAccepted(decision.normalizedCleanedTranscript, now);

            try {
                const missuResponse = await generateAssistantReply(decision.cleanedTranscript);

                console.log(`\x1b[35m[MISSU BRAIN]\x1b[0m ${missuResponse}`);

                await speakText(missuResponse);

                // TODO: Save to audit log
            } catch (error) {
                const retryDelayMs = extractRetryDelayMs(error);

                if (retryDelayMs) {
                    transcriptGate.defer(retryDelayMs);
                    console.warn(
                        `\x1b[33m[RATE LIMIT]\x1b[0m LLM cooldown extended by ${Math.ceil(retryDelayMs / 1000)}s.`
                    );
                }

                console.error('\x1b[31m[BRAIN ERROR]\x1b[0m', error);
            }
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
