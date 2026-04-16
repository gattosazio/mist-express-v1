const express = require('express');
const { ingestDocument, askPolicyQuestion } = require('./controller');
const router = express.Router();

function routes() {
    
    router.post('/ingest', ingestDocument);
    router.post('/ask', askPolicyQuestion);

    return router;
}

module.exports = routes;
