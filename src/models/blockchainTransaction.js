const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('BlockchainTransaction', {
    transaction_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    hoso_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'HoSo',
        key: 'hoso_id'
      }
    },
    hash_value: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    action: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    block_number: {
      type: DataTypes.BIGINT,
      allowNull: true
    },
    from_address: {
      type: DataTypes.STRING(42),
      allowNull: true
    },
    ipfs_hash: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "PENDING"
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'BlockchainTransaction',
    schema: 'public',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "BlockchainTransaction_pkey",
        unique: true,
        fields: [
          { name: "transaction_id" },
        ]
      },
      {
        name: "idx_blockchain_hoso_id",
        fields: [
          { name: "hoso_id" },
        ]
      },
    ]
  });
};
