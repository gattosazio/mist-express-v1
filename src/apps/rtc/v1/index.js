const express = require('express');
const { getToken } = require('./controller');
const requireAuth = require('../../../middlewares/requireAuth');

const router = express.Router();

router.get('/token', requireAuth, getToken);

module.exports = router;