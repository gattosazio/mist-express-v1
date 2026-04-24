const rtcService = require('./service');

const createSession = async (req, res) => {
    try {
        const session = await rtcService.createVoiceSession(req.user);
        return res.status(200).json(session);
    } catch (error) {
        console.error('[RTC SESSION ERROR]', error);

        return res.status(500).json({
            error: error.message || 'Failed to create voice session.',
        });
    }
};

const getToken = async (req, res) => {
    return createSession(req, res);
};

module.exports = {
    createSession,
    getToken,
};