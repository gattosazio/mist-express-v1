require('dotenv').config();

const requiredEnvVars = [
    'PORT',
    'DATABASE_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'LIVEKIT_URL',
    'SUPABASE_URL',
    // 'SUPABASE_JWT_ISSUER',
    'SUPABASE_PUBLISHABLE_KEY',
];

// Find any variables that are missing or empty strings
const missingVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingVars.length > 0) {
    console.error(`\n\x1b[31m[FATAL ERROR] MISSU cannot boot. Missing required environment variables:\x1b[0m`);
    missingVars.forEach((envVar) => console.error(`   ${envVar}`));
    console.error(`\x1b[33mPlease check your .env file and restart the server.\x1b[0m\n`);
    process.exit(1);
}

module.exports = {
    port: process.env.PORT || 8000,
    databaseUrl: process.env.DATABASE_URL,
    supabase: {
        url: process.env.SUPABASE_URL,
        jwtIssuer: process.env.SUPABASE_JWT_ISSUER || `${process.env.SUPABASE_URL}/auth/v1`,
    },
    livekit: {
        apiKey: process.env.LIVEKIT_API_KEY,
        apiSecret: process.env.LIVEKIT_API_SECRET,
        url: process.env.LIVEKIT_URL,
    },
    jwtSecret: process.env.JWT_SECRET,
    deepgramApiKey: process.env.DEEPGRAM_API_KEY,
    localHost: process.env.LOCAL_HOST,
    geminiApiKey: process.env.GEMINI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    groqBaseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    ollama: {
        baseUrl: process.env.OLLAMA_BASE_URL,
        embedModel: process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma',
    },
};
