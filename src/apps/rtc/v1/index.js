const express = require('express');
const requireAuth = require('../../../middlewares/requireAuth');
const { getToken, createSession } = require('./controller');

const router = express.Router();

function routes() {
    router.get('/token', requireAuth, getToken);
    router.post('/session', requireAuth, createSession);

    return router;
}

module.exports = routes;