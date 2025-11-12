const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('LandOwnership', {
    ownership_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    parcel_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'LandParcel',
        key: 'parcel_id'
      },
      unique: "uq_current_owner"
    },
    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Account',
        key: 'account_id'
      }
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_DATE')
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    is_current: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      unique: "uq_current_owner"
    },
    blockchain_tx_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'BlockchainTransaction',
        key: 'transaction_id'
      }
    }
  }, {
    sequelize,
    tableName: 'LandOwnership',
    schema: 'public',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "LandOwnership_pkey",
        unique: true,
        fields: [
          { name: "ownership_id" },
        ]
      },
      {
        name: "idx_landownership_owner",
        fields: [
          { name: "owner_id" },
        ]
      },
      {
        name: "idx_landownership_parcel",
        fields: [
          { name: "parcel_id" },
        ]
      },
      {
        name: "uq_current_owner",
        unique: true,
        fields: [
          { name: "parcel_id" },
          { name: "is_current" },
        ]
      },
    ]
  });
};
