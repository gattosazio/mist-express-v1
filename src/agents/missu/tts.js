const {
    AudioSource,
    AudioFrame,
    LocalAudioTrack,
    TrackPublishOptions,
    TrackSource,
} = require('@livekit/rtc-node');
const {
    TTS_SAMPLE_RATE,
    TTS_CHANNELS,
    TTS_SAMPLES_PER_FRAME,
    TTS_VOICE_MODEL,
    TTS_TRACK_NAME,
} = require('./constants');

const collectStream = async (stream) => {
    const reader = stream.getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(totalLength);

    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }

    return Buffer.from(merged.buffer);
};

const readWavPcm = (wavBuffer) => {
    if (wavBuffer.toString('ascii', 0, 4) !== 'RIFF' || wavBuffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Deepgram TTS did not return a valid WAV file.');
    }

    let offset = 12;
    let audioFormat = null;
    let numChannels = null;
    let sampleRate = null;
    let bitsPerSample = null;
    let dataOffset = null;
    let dataLength = null;

    while (offset + 8 <= wavBuffer.length) {
        const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
        const chunkSize = wavBuffer.readUInt32LE(offset + 4);
        const chunkDataStart = offset + 8;

        if (chunkId === 'fmt ') {
            audioFormat = wavBuffer.readUInt16LE(chunkDataStart);
            numChannels = wavBuffer.readUInt16LE(chunkDataStart + 2);
            sampleRate = wavBuffer.readUInt32LE(chunkDataStart + 4);
            bitsPerSample = wavBuffer.readUInt16LE(chunkDataStart + 14);
        } else if (chunkId === 'data') {
            dataOffset = chunkDataStart;
            dataLength = chunkSize;
            break;
        }

        offset = chunkDataStart + chunkSize + (chunkSize % 2);
    }

    if (audioFormat !== 1) {
        throw new Error(`Unsupported WAV format: expected PCM, got ${audioFormat}`);
    }

    if (numChannels !== TTS_CHANNELS) {
        throw new Error(`Unsupported WAV channels: expected ${TTS_CHANNELS}, got ${numChannels}`);
    }

    if (bitsPerSample !== 16) {
        throw new Error(`Unsupported WAV bit depth: expected 16-bit, got ${bitsPerSample}`);
    }

    if (dataOffset === null || dataLength === null) {
        throw new Error('WAV file is missing a data chunk.');
    }

    return {
        pcmBuffer: wavBuffer.subarray(dataOffset, dataOffset + dataLength),
        sampleRate,
        numChannels,
    };
};

const synthesizeSpeech = async (deepgram, text) => {
    const response = await deepgram.speak.request(
        { text },
        {
            model: TTS_VOICE_MODEL,
            encoding: 'linear16',
            sample_rate: TTS_SAMPLE_RATE,
            container: 'wav',
        }
    );

    const headers = await response.getHeaders();
    console.log(`\x1b[36m[TTS META]\x1b[0m content-type=${headers.get('content-type')}`);

    const stream = await response.getStream();
    if (!stream) {
        throw new Error('Deepgram TTS returned no audio stream.');
    }

    const wavBuffer = await collectStream(stream);
    return readWavPcm(wavBuffer);
};

const playPcmToRoom = async (ttsAudio, ttsSource) => {
    const { pcmBuffer, sampleRate, numChannels } = ttsAudio;

    if (sampleRate !== TTS_SAMPLE_RATE) {
        throw new Error(`TTS sample rate mismatch: expected ${TTS_SAMPLE_RATE}, got ${sampleRate}`);
    }

    if (numChannels !== TTS_CHANNELS) {
        throw new Error(`TTS channel mismatch: expected ${TTS_CHANNELS}, got ${numChannels}`);
    }

    const sampleCount = Math.floor(pcmBuffer.byteLength / 2);
    const pcm = new Int16Array(
        pcmBuffer.buffer,
        pcmBuffer.byteOffset,
        sampleCount
    );

    for (let i = 0; i < pcm.length; i += TTS_SAMPLES_PER_FRAME) {
        const slice = pcm.subarray(i, i + TTS_SAMPLES_PER_FRAME);
        if (!slice.length) continue;

        const frame = new AudioFrame(
            slice,
            TTS_SAMPLE_RATE,
            TTS_CHANNELS,
            slice.length
        );

        await ttsSource.captureFrame(frame);
    }

    await ttsSource.waitForPlayout();
};

const createSpeechPlayer = (deepgram, ttsSource) => {
    let speechQueue = Promise.resolve();

    return (text) => {
        speechQueue = speechQueue
            .then(async () => {
                console.log(`\x1b[35m[TTS]\x1b[0m Synthesizing: ${text}`);
                const ttsAudio = await synthesizeSpeech(deepgram, text);
                await playPcmToRoom(ttsAudio, ttsSource);
            })
            .catch((error) => {
                console.error('\x1b[31m[TTS ERROR]\x1b[0m', error);
            });

        return speechQueue;
    };
};

const initTtsPipeline = async (room, deepgram) => {
    const ttsSource = new AudioSource(TTS_SAMPLE_RATE, TTS_CHANNELS);
    const ttsTrack = LocalAudioTrack.createAudioTrack(TTS_TRACK_NAME, ttsSource);

    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;

    await room.localParticipant.publishTrack(ttsTrack, publishOptions);

    const speakText = createSpeechPlayer(deepgram, ttsSource);

    const close = async () => {
        if (ttsTrack) {
            await ttsTrack.close();
        } else {
            await ttsSource.close();
        }
    };

    return {
        speakText,
        close,
    };
};

module.exports = {
    initTtsPipeline,
};
