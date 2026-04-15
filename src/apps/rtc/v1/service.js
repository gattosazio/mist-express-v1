const { AccessToken } = require('livekit-server-sdk');
const env = require('../../../config/env');

const generateLiveKitToken = async (username, roomName) => {
    const at = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
        identity: username,
        name: username,
    });
    at.addGrant({ 
        roomJoin: true, 
        room: roomName, 
        canPublish: true, 
        canSubscribe: true 
    });
    return await at.toJwt();
};

module.exports = { generateLiveKitToken };