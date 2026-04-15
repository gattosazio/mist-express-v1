const express = require('express');
const authenticate = require('../apps/auth/v1/index');
const rtc = require('../apps/rtc/v1/index');

const router = express.Router();

router.use('/auth/v1', authenticate);

router.use('/rtc/v1', rtc);

module.exports = router;