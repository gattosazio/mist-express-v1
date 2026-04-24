const AGENT_IDENTITY = 'MISSU_CORE';
const AGENT_DISPLAY_NAME = 'Mist';
const AGENT_SESSION_IDLE_TIMEOUT_MS = 30000; 
const AUDIO_SAMPLE_RATE = 32000;
const AUDIO_CHANNELS = 1;
const DEEPGRAM_KEEPALIVE_MS = 10000;
const DEEPGRAM_ENDPOINTING_MS = 4000;

const MIN_TRANSCRIPT_CHARS = 4;
const MIN_TRANSCRIPT_WORDS = 1;
const DUPLICATE_WINDOW_MS = 8000;
const LLM_COOLDOWN_MS = 5000;

const REQUIRE_WAKE_WORD = true;
const WAKE_WORDS = ['agent', 'hey agent', 'okay agent'];

const TTS_SAMPLE_RATE = 32000;
const TTS_CHANNELS = 1;
const TTS_FRAME_MS = 20;
const TTS_SAMPLES_PER_FRAME = (TTS_SAMPLE_RATE * TTS_FRAME_MS) / 1000;
const TTS_VOICE_MODEL = 'aura-2-thalia-en';
const TTS_TRACK_NAME = 'mist-voice';
const TRANSCRIPT_TOPIC = 'missu.transcript';

const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL = 'llama-3.1-8b-instant';

const CLARIFICATION_TTL_MS = 30000;

const FINAL_RESPONSE_DELAY_MS = 1200;


const MISSU_SYSTEM_PROMPT =
    'You are Mist, a highly secure, elite AI terminal assistant. You are concise, professional, and slightly robotic. Keep all responses under 2 sentences so they can be spoken quickly over a voice channel.';

module.exports = {
    AGENT_IDENTITY,
    AGENT_DISPLAY_NAME,
    AGENT_SESSION_IDLE_TIMEOUT_MS,
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
    TRANSCRIPT_TOPIC,
    DEFAULT_GROQ_BASE_URL,
    DEFAULT_GROQ_MODEL,
    MISSU_SYSTEM_PROMPT,
    CLARIFICATION_TTL_MS,
    FINAL_RESPONSE_DELAY_MS,
};
