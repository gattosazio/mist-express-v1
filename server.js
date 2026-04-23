const env = require('./src/config/env');
const { testDbConnection, sequelize } = require('./src/config/database');
const { startMissuAgent } = require('./src/agents/missu/worker');
const User = require('./src/models/user');
const AuditLog = require('./src/models/audit_log');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const passport = require('./src/config/passport');
const routes = require('./src/routes/index');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.use(passport.initialize());

app.use('/api', routes);

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'online',
        system: 'MISSU Express Gateway',
        livekit_url_loaded: env.livekit.url,
    });
});

const initializeServer = async () => {
    await testDbConnection();
    await sequelize.sync({ alter: true });

    await startMissuAgent();

    app.listen(env.port, () => {
        console.log(`\n\x1b[32m[SYSTEM ONLINE] MISSU Express Gateway running on port ${env.port}\x1b[0m`);
        console.log(`[LIVEKIT] Securely bound to: ${env.livekit.url}\n`);
    });
};

initializeServer();