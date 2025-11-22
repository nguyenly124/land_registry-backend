const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('Payment', {
    payment_id: {
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
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    payment_method: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: "PayOS"
    },
    payment_status: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: "Đang xử lý"
    },
    vnp_txn_ref: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    vnp_transaction_no: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    vnp_response_code: {
      type: DataTypes.STRING(10),
      allowNull: true
    },
    vnp_bank_code: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    vnp_pay_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    gateway_data: {
      type: DataTypes.JSONB,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'Payment',
    schema: 'public',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "Payment_pkey",
        unique: true,
        fields: [
          { name: "payment_id" },
        ]
      },
      {
        name: "idx_payment_hoso_status",
        fields: [
          { name: "hoso_id" },
          { name: "payment_status" },
        ]
      },
    ]
  });
};
