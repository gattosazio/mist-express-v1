const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const Network = require('./network');

const NetworkDomain = sequelize.define(
    'NetworkDomain',
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
        domain: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
    },
    {
        tableName: 'network_domains',
        timestamps: true,
        underscored: true,
    }
);

Network.hasMany(NetworkDomain, { foreignKey: 'network_id' });
NetworkDomain.belongsTo(Network, { foreignKey: 'network_id' });

module.exports = NetworkDomain;
