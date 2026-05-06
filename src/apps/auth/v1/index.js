const express = require('express');
const requireAuth = require('../../../middlewares/requireAuth');
const requireNetworkContext = require('../../../middlewares/requireNetworkContext');
const { login, register, getSession } = require('./controller');

const router = express.Router();

function routes() {
    router.post('/login', login);
    router.post('/register', register);
    router.get('/session', requireAuth, requireNetworkContext, getSession);

    return router;
}

module.exports = routes;
