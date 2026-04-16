const express = require('express');
const authenticate = require('../apps/auth/v1/index');
const rtc = require('../apps/rtc/v1/index');
const rag = require('../apps/rag/v1/index');

const routes = express.Router();

routes.use('/auth/v1', authenticate());
routes.use('/rtc/v1', rtc());
routes.use('/rag/v1', rag());

module.exports = routes;