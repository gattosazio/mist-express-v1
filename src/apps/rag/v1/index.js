const express = require('express');
const multer = require('multer');
const requireAuth = require('../../../middlewares/requireAuth');
const requireNetworkContext = require('../../../middlewares/requireNetworkContext');
const { ingestDocument, ingestDocumentFile, askPolicyQuestion } = require('./controller');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024,
    },
});

function routes() {
    router.post('/ingest', requireAuth, requireNetworkContext, ingestDocument);
    router.post('/ingest/file', requireAuth, requireNetworkContext, upload.single('file'), ingestDocumentFile);
    router.post('/ask', requireAuth, requireNetworkContext, askPolicyQuestion);

    return router;
}

module.exports = routes;
