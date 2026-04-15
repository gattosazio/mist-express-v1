const ROOM_NAME = 'missu-terminal';
const AGENT_IDENTITY = 'MISSU_CORE';

const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_CHANNELS = 1;
const DEEPGRAM_KEEPALIVE_MS = 10000;
const DEEPGRAM_ENDPOINTING_MS = 2000;

const MIN_TRANSCRIPT_CHARS = 4;
const MIN_TRANSCRIPT_WORDS = 1;
const DUPLICATE_WINDOW_MS = 8000;
const LLM_COOLDOWN_MS = 5000;

const REQUIRE_WAKE_WORD = true;
const WAKE_WORDS = ['agent', 'hey agent', 'okay agent'];

const TTS_SAMPLE_RATE = 16000;
const TTS_CHANNELS = 1;
const TTS_FRAME_MS = 20;
const TTS_SAMPLES_PER_FRAME = (TTS_SAMPLE_RATE * TTS_FRAME_MS) / 1000;
const TTS_VOICE_MODEL = 'aura-2-thalia-en';
const TTS_TRACK_NAME = 'missu-voice';

const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL = 'llama-3.1-8b-instant';

const MISSU_SYSTEM_PROMPT =
    'You are MISSU, a highly secure, elite AI terminal assistant. You are concise, professional, and slightly robotic. Keep all responses under 2 sentences so they can be spoken quickly over a voice channel.';

module.exports = {
    ROOM_NAME,
    AGENT_IDENTITY,
    AUDIO_SAMPLE_RATE,
    AUDIO_CHANNELS,
    DEEPGRAM_KEEPALIVE_MS,
    DEEPGRAM_ENDPOINTING_MS,
    MIN_TRANSCRIPT_CHARS,
    MIN_TRANSCRIPT_WORDS,
    DUPLICATE_WINDOW_MS,
    LLM_COOLDOWN_MS,
    REQUIRE_WAKE_WORD,
    WAKE_WORDS,
    TTS_SAMPLE_RATE,
    TTS_CHANNELS,
    TTS_FRAME_MS,
    TTS_SAMPLES_PER_FRAME,
    TTS_VOICE_MODEL,
    TTS_TRACK_NAME,
    DEFAULT_GROQ_BASE_URL,
    DEFAULT_GROQ_MODEL,
    MISSU_SYSTEM_PROMPT,
};
