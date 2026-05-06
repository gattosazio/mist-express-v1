const express = require('express');
const requireAuth = require('../../../middlewares/requireAuth');
const requireNetworkContext = require('../../../middlewares/requireNetworkContext');
const { getToken, createSession, deleteSession } = require('./controller');

const router = express.Router();

function routes() {
    router.get('/token', requireAuth, requireNetworkContext, getToken);
    router.post('/session', requireAuth, requireNetworkContext, createSession);
    router.delete('/session/:sessionId', requireAuth, requireNetworkContext, deleteSession);

    return router;
}

module.exports = routes;
