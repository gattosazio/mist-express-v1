const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Network = sequelize.define(
    'Network',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        slug: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
        },
    },
    {
        tableName: 'networks',
        timestamps: true,
        underscored: true,
    }
);

module.exports = Network;
