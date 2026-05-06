const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./user');
const Network = require('./network');

const UserNetworkMembership = sequelize.define(
    'UserNetworkMembership',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        network_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        role: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'member',
        },
        is_default: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
    },
    {
        tableName: 'user_network_memberships',
        timestamps: true,
        underscored: true,
        indexes: [
            {
                unique: true,
                fields: ['user_id', 'network_id'],
            },
        ],
    }
);

User.hasMany(UserNetworkMembership, { foreignKey: 'user_id' });
UserNetworkMembership.belongsTo(User, { foreignKey: 'user_id' });

Network.hasMany(UserNetworkMembership, { foreignKey: 'network_id' });
UserNetworkMembership.belongsTo(Network, { foreignKey: 'network_id' });

module.exports = UserNetworkMembership;
