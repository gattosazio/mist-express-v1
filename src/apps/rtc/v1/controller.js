const rtcService = require('./service');

const getToken = async (req, res) => {
    try {
        const { username } = req.user; 
        const token = await rtcService.generateLiveKitToken(username, 'missu-terminal');
        res.status(200).json({ token });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to generate voice room ticket.' 
        });
    }
};

module.exports = { getToken };