const express = require('express');
const { login } = require('./controller');

const router = express.Router();

function routes() {
    router.post('/login', login);

    return router;
}

module.exports = routes;