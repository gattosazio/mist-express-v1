const {
    resolveActiveNetwork,
    buildMembershipPayload,
} = require('../services/authContext');

const requireNetworkContext = async (req, res, next) => {
    try {
        const resolution = await resolveActiveNetwork({
            userId: req.user?.id,
            requestedNetworkId: req.header('X-Network-Id'),
        });

        req.memberships = resolution.memberships;
        req.network = resolution.network;
        req.membership = resolution.activeMembership;

        return next();
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            error: error.message || 'Failed to resolve active network.',
            code: error.code || 'network_resolution_failed',
            memberships: Array.isArray(error.memberships)
                ? error.memberships
                : Array.isArray(req.memberships)
                    ? req.memberships.map(buildMembershipPayload)
                    : [],
        });
    }
};

module.exports = requireNetworkContext;
