const {
    verifySupabaseJwt,
    syncLocalUserFromAuth,
    buildSessionUser,
} = require('../services/authContext');

const requireAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Access denied: bearer token is required.',
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const claims = await verifySupabaseJwt(token);
        const localUser = await syncLocalUserFromAuth(claims);

        req.auth = {
            supabase_user_id: claims.sub,
            email: claims.email,
            profile: claims.profile,
            claims: claims.raw,
        };
        req.user = buildSessionUser(localUser, claims);

        return next();
    } catch (error) {
        console.error('\x1b[31m[SECURITY] Invalid Supabase token attempt.\x1b[0m', error.message);
        return res.status(403).json({ error: 'Access denied: invalid or expired token.' });
    }
};

module.exports = requireAuth;
