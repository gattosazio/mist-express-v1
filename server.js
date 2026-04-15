// 1. IMPORT ENV FIRST! If keys are missing, the app dies right here.
const env = require('./src/config/env');
const { testDbConnection, sequelize } = require('./src/config/database');
const { startMissuAgent } = require('./src/agents/missu/worker');
const User = require('./src/models/user'); 
const AuditLog = require('./src/models/audit_log');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const routes = require('./src/routes/index');
const app = express();

app.use(helmet()); // Hides Express metadata from hackers
app.use(cors()); // Allow Next.js to connect  
app.use(express.static('public')); // <-- ADD THIS LINE  
app.use(express.json()); // Allow Express to read JSON body data
app.use('/api', routes); // Mount all our routes under the /api prefix

// 3. Basic Health Route
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'online', 
        system: 'MISSU Express Gateway',
        livekit_url_loaded: env.livekit.url // Just to prove it loaded!
    });
});


const initializeServer = async () => {
    await testDbConnection(); // Make sure the database is up before accepting any requests

    await sequelize.sync({ alter: true }); // Sync models to the database, creating tables if they don't exist

    await startMissuAgent();

    app.listen(env.port, () => {
        console.log(`\n\x1b[32m[SYSTEM ONLINE] MISSU Express Gateway running on port ${env.port}\x1b[0m`);
        console.log(`[LIVEKIT] Securely bound to: ${env.livekit.url}\n`);
    });
};
initializeServer();