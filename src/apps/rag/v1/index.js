const express = require('express');
const multer = require('multer');
const { ingestDocument, ingestDocumentFile, askPolicyQuestion } = require('./controller');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024,
    },
});

function routes() {
    router.post('/ingest', ingestDocument);
    router.post('/ingest/file', upload.single('file'), ingestDocumentFile);
    router.post('/ask', askPolicyQuestion);

    return router;
}

module.exports = routes;
