const express = require('express');
const { login, register } = require('./controller');

const router = express.Router();

function routes() {
    router.post('/login', login);
    router.post('/register', register);

    return router;
}

module.exports = routes;