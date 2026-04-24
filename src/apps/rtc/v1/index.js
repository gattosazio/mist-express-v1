const express = require('express');
const requireAuth = require('../../../middlewares/requireAuth');
const { getToken, createSession, deleteSession } = require('./controller');

const router = express.Router();

function routes() {
    router.get('/token', requireAuth, getToken);
    router.post('/session', requireAuth, createSession);
    router.delete('/session/:sessionId', requireAuth, deleteSession);

    return router;
}

module.exports = routes;