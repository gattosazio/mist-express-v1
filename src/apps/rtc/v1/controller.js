const rtcService = require('./service');

const createSession = async (req, res) => {
    try {
        const session = await rtcService.createVoiceSession({
            user: req.user,
            auth: req.auth,
            network: req.network,
        });
        return res.status(200).json(session);
    } catch (error) {
        console.error('[RTC SESSION ERROR]', error);

        return res.status(error.statusCode || 500).json({
            error: error.message || 'Failed to create voice session.',
        });
    }
};

const deleteSession = async (req, res) => {
    try {
        const result = await rtcService.closeVoiceSession(
            req.params.sessionId,
            {
                user: req.user,
                auth: req.auth,
                network: req.network,
            },
            {
                reason: 'client teardown',
            }
        );

        return res.status(200).json(result);
    } catch (error) {
        console.error('[RTC TEARDOWN ERROR]', error);

        return res.status(error.statusCode || 500).json({
            error: error.message || 'Failed to close voice session.',
        });
    }
};

const getToken = async (req, res) => {
    return createSession(req, res);
};

module.exports = {
    createSession,
    deleteSession,
    getToken,
};
