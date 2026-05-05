const requireMembershipRole = (allowedRoles = []) => {
    const normalizedRoles = allowedRoles.map((role) => String(role).toLowerCase());

    return (req, res, next) => {
        const currentRole = String(req.membership?.role || '').toLowerCase();

        if (!currentRole || !normalizedRoles.includes(currentRole)) {
            return res.status(403).json({
                error: 'This action requires a higher network role.',
                code: 'insufficient_network_role',
                requiredRoles: allowedRoles,
            });
        }

        return next();
    };
};

module.exports = requireMembershipRole;
