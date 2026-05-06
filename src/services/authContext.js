const User = require('../models/user');
const Network = require('../models/network');
const UserNetworkMembership = require('../models/user_network_membership');
const env = require('../config/env');

let joseModulePromise = null;
let remoteJwksPromise = null;

const loadJose = async () => {
    if (!joseModulePromise) {
        joseModulePromise = import('jose');
    }

    return joseModulePromise;
};

const getRemoteJwks = async () => {
    if (!remoteJwksPromise) {
        remoteJwksPromise = (async () => {
            const { createRemoteJWKSet } = await loadJose();
            return createRemoteJWKSet(new URL(`${env.supabase.url}/auth/v1/.well-known/jwks.json`));
        })();
    }

    return remoteJwksPromise;
};

const normalizeUsername = (value) => {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};

const buildLocalUsername = ({ sub, email, claims }) => {
    const usernameCandidates = [
        `sb-${sub}`,
        claims?.preferred_username,
        claims?.user_metadata?.username,
        claims?.app_metadata?.username,
        email ? email.split('@')[0] : null,
    ];

    for (const candidate of usernameCandidates) {
        const normalized = normalizeUsername(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return `sb-${String(sub).replace(/[^a-zA-Z0-9_-]/g, '')}`;
};

const buildAuthClaims = (payload = {}) => {
    return {
        sub: payload.sub,
        email: payload.email || null,
        profile: payload.user_metadata || payload.app_metadata || {},
        raw: payload,
    };
};

const verifySupabaseJwt = async (token) => {
    const { jwtVerify } = await loadJose();
    const jwks = await getRemoteJwks();
    const { payload } = await jwtVerify(token, jwks, {
        issuer: env.supabase.jwtIssuer,
    });

    if (!payload?.sub) {
        throw new Error('Verified token is missing subject.');
    }

    return buildAuthClaims(payload);
};

const syncLocalUserFromAuth = async (claims) => {
    const defaults = {
        username: buildLocalUsername({
            sub: claims.sub,
            email: claims.email,
            claims: claims.raw,
        }),
        email: claims.email,
    };

    const [user] = await User.findOrCreate({
        where: {
            supabase_user_id: claims.sub,
        },
        defaults,
    });

    const updates = {};

    if (claims.email && user.email !== claims.email) {
        updates.email = claims.email;
    }

    if (!user.username) {
        updates.username = defaults.username;
    }

    if (Object.keys(updates).length) {
        await user.update(updates);
    }

    return user;
};

const getMembershipsForUser = async (userId) => {
    return UserNetworkMembership.findAll({
        where: { user_id: userId },
        include: [
            {
                model: Network,
                attributes: ['id', 'name', 'slug'],
            },
        ],
        order: [
            ['is_default', 'DESC'],
            ['id', 'ASC'],
        ],
    });
};

const buildMembershipPayload = (membership) => ({
    id: membership.id,
    role: membership.role,
    isDefault: membership.is_default,
    network: membership.Network
        ? {
              id: membership.Network.id,
              name: membership.Network.name,
              slug: membership.Network.slug,
          }
        : null,
});

const buildNetworkResolutionError = (message, code, memberships = [], statusCode = 409) => {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    error.memberships = memberships.map(buildMembershipPayload);
    return error;
};

const resolveActiveNetwork = async ({ userId, requestedNetworkId = null }) => {
    const memberships = await getMembershipsForUser(userId);

    if (!memberships.length) {
        throw buildNetworkResolutionError(
            'No network membership found for this user.',
            'network_membership_required',
            memberships,
            403
        );
    }

    let activeMembership = null;

    if (requestedNetworkId) {
        activeMembership = memberships.find(
            (membership) => String(membership.network_id) === String(requestedNetworkId)
        );

        if (!activeMembership) {
            throw buildNetworkResolutionError(
                'Requested network is not accessible for this user.',
                'network_access_denied',
                memberships,
                403
            );
        }
    } else {
        activeMembership =
            memberships.find((membership) => membership.is_default) ||
            (memberships.length === 1 ? memberships[0] : null);

        if (!activeMembership) {
            throw buildNetworkResolutionError(
                'Network selection required.',
                'network_selection_required',
                memberships
            );
        }
    }

    return {
        memberships,
        activeMembership,
        network: activeMembership.Network,
    };
};

const buildSessionUser = (user, claims) => ({
    id: user.id,
    supabase_user_id: user.supabase_user_id,
    email: user.email || claims.email,
    username: user.username,
    clearanceLevel: user.clearanceLevel,
});

module.exports = {
    verifySupabaseJwt,
    syncLocalUserFromAuth,
    resolveActiveNetwork,
    buildMembershipPayload,
    buildSessionUser,
};
