const express = require('express');
const { getToken } = require('./controller');
const requireAuth = require('../../../middlewares/requireAuth');

const router = express.Router();
function routes() {
    router.get('/token', requireAuth, getToken);

    return router;
}

module.exports = routes;