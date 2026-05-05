const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Network = require('./network');

const NetworkSsoProvider = sequelize.define(
    'NetworkSsoProvider',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        network_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        provider: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        issuer: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        metadata: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: {},
        },
    },
    {
        tableName: 'network_sso_providers',
        timestamps: true,
        underscored: true,
    }
);

Network.hasMany(NetworkSsoProvider, { foreignKey: 'network_id' });
NetworkSsoProvider.belongsTo(Network, { foreignKey: 'network_id' });

module.exports = NetworkSsoProvider;
