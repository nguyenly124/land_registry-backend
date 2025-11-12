const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('LandTransferHistory', {
    transfer_id: {
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
      }
    },
    from_owner_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Account',
        key: 'account_id'
      }
    },
    to_owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Account',
        key: 'account_id'
      }
    },
    hoso_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'HoSo',
        key: 'hoso_id'
      }
    },
    transfer_date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    blockchain_tx_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'BlockchainTransaction',
        key: 'transaction_id'
      }
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'LandTransferHistory',
    schema: 'public',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "LandTransferHistory_pkey",
        unique: true,
        fields: [
          { name: "transfer_id" },
        ]
      },
      {
        name: "idx_transfer_parcel",
        fields: [
          { name: "parcel_id" },
        ]
      },
    ]
  });
};
