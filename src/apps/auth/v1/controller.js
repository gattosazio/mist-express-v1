const { buildMembershipPayload } = require('../../../services/authContext');

const login = async (req, res) => {
    return res.status(410).json({
        error: 'Local login is deprecated. Authenticate with Supabase and send the Supabase bearer token to this API.',
    });
};

const register = async (req, res) => {
    return res.status(410).json({
        error: 'Local registration is deprecated. Provision identities in Supabase instead.',
    });
};

const getSession = async (req, res) => {
    return res.status(200).json({
        user: req.user,
        network: req.network
            ? {
                  id: req.network.id,
                  name: req.network.name,
                  slug: req.network.slug,
                  role: req.membership?.role || null,
              }
            : null,
        memberships: Array.isArray(req.memberships)
            ? req.memberships.map(buildMembershipPayload)
            : [],
    });
};

module.exports = {
    login,
    register,
    getSession,
};
