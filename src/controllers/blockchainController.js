const { initModels } = require('../models/init-models');
const { sequelize } = require('../config/db');
const { emit } = require('../utils/NotificationEvent');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const { uploadToIPFS } = require('../blockchain/services/ipfsService');
const { transferOwnership } = require('../blockchain/services/ethService');
// Khởi tạo models
const { HoSo,LandParcel, UserProfile, Account, HoSoHistory,BlockchainTransaction,LandTransferHistory,LandOwnership,HoSoDocument } = initModels(sequelize);

const logHistory = async (hoso_id, old_status, new_status, action, actor_id, note = null, t = null) => {
  await HoSoHistory.create({
    hoso_id,
    old_status,
    new_status,
    action,
    actor_id,
    note,
    created_at: new Date()
  }, { transaction: t });
};
//đẩy hồ sơ lên IPFS
exports.uploadHosoToIPFS = async (fullHoso, certificateNumber, gcnData, t) => {
  const documentLinks = [];
  // === 1. Đẩy tất cả file đính kèm từ Cloudinary lên IPFS ===
  if (fullHoso.HoSoDocuments && fullHoso.HoSoDocuments.length > 0) {
    for (const doc of fullHoso.HoSoDocuments) {
      // Nếu đã có IPFS → dùng lại
      if (doc.ipfs_hash) {
        documentLinks.push({
          name: doc.doc_name,
          url: `https://gateway.pinata.cloud/ipfs/${doc.ipfs_hash}`
        });
        continue;
      }

      let buffer = null;

      // Tải file từ Cloudinary
      if (doc.file_path && doc.file_path.startsWith('http')) {
        try {
          console.log(`Đang tải từ Cloudinary → IPFS: ${doc.doc_name}`);
          const res = await axios.get(doc.file_path, {
            responseType: 'arraybuffer',
            timeout: 30000
          });
          buffer = Buffer.from(res.data);
        } catch (err) {
          console.warn(`Không tải được file: ${doc.doc_name}`, err.message);
        }
      }

      // Đẩy lên IPFS nếu tải thành công
      if (buffer) {
        try {
          const ipfsHash = await uploadToIPFS(buffer, doc.doc_name);
          const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;

          await doc.update({ ipfs_hash: ipfsHash }, { transaction: t });

          documentLinks.push({
            name: doc.doc_name,
            url: ipfsUrl
          });

          console.log(`Đã đẩy thành công: ${doc.doc_name} → ${ipfsHash}`);
        } catch (err) {
          console.error(`Lỗi đẩy IPFS: ${doc.doc_name}`, err.message);
          documentLinks.push({ name: doc.doc_name, url: doc.file_path }); // fallback
        }
      } else {
        documentLinks.push({ name: doc.doc_name, url: doc.file_path });
      }
    }
  }

  // === 2. Tạo + đẩy GCN tổng hợp lên IPFS ===
  gcnData.documents = documentLinks;
  const gcnBuffer = Buffer.from(JSON.stringify(gcnData, null, 2));
  const gcnFilename = `GCN_${certificateNumber}_TongHop.json`;

  const gcnIpfsHash = await uploadToIPFS(gcnBuffer, gcnFilename);
  const gcnIpfsUrl = `https://gateway.pinata.cloud/ipfs/${gcnIpfsHash}`;

  // === 3. Lưu GCN tổng hợp vào bảng HoSoDocument ===
  await HoSoDocument.create({
    hoso_id: fullHoso.hoso_id,
    doc_name: gcnFilename,
    file_path: gcnIpfsUrl,
    ipfs_hash: gcnIpfsHash,
    uploaded_at: new Date()
  }, { transaction: t });

  console.log(`HOÀN TẤT: GCN đã lưu bất biến tại: ${gcnIpfsUrl}`);

  return {
    gcnIpfsHash,
    gcnIpfsUrl,
    documentLinks
  };
};
//2. DUYỆT HỒ SƠ (CÓ CHUYỂN NHƯỢNG → BLOCKCHAIN)
exports.approveHoSo = async (req, res) => {
  let t = null;
  const io = req.app.get('io');

  try {
    t = await sequelize.transaction();
    const { hosoId } = req.params;
    const actor_id = req.user.id;

    // 1. Lấy + khóa hồ sơ
    const hoso = await HoSo.findByPk(hosoId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!hoso || !['Chờ xử lý', 'Đang xử lý'].includes(hoso.status)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Hồ sơ không hợp lệ.' });
    }

    // 2. Lấy full thông tin
    const fullHoso = await HoSo.findByPk(hosoId, {
      include: [
        { model: LandParcel, as: 'parcel', required: true },
        { model: Account, as: 'account', required: true, include: [{ model: UserProfile, as: 'UserProfile' }] },
        { model: HoSoDocument, as: 'HoSoDocuments' }
      ],
      transaction: t
    });

    let newOwnerId = hoso.account_id;
    let actionType = 'INITIAL_REGISTRATION';
    let receiverName = fullHoso.account.UserProfile.full_name;

    // Tạo số GCN
    let certificateNumber = fullHoso.parcel.certificate_number;
    if (!certificateNumber) {
      const year = new Date().getFullYear();
      const count = await HoSo.count({ where: { created_at: { [Op.gte]: `${year}-01-01` } }, transaction: t });
      certificateNumber = `GCN-${year}-${String(count + 1).padStart(6, '0')}`;
    }

    // Xử lý chuyển nhượng
    if (hoso.type === 'Chuyển nhượng' && hoso.receiver_info) {
      const { full_name, id_number } = hoso.receiver_info;
      let receiver = await Account.findOne({ where: { username: id_number }, transaction: t });
      if (!receiver) {
        receiver = await Account.create({
          username: id_number,
          password: await bcrypt.hash(id_number, 10),
          role: 'Người dân'
        }, { transaction: t });
        await UserProfile.create({ account_id: receiver.account_id, full_name, cccd: id_number }, { transaction: t });
      }
      newOwnerId = receiver.account_id;
      actionType = 'OWNERSHIP_TRANSFER';
      receiverName = full_name;
    }

    // GỌI SERVICE ĐẨY TOÀN BỘ LÊN IPFS 
    const gcnData = {
      certificate_number: certificateNumber,
      parcel_code: fullHoso.parcel.parcel_code,
      address: fullHoso.parcel.address || 'Không xác định',
      area: Number(fullHoso.parcel.area) || 0,
      owner_name: receiverName,
      owner_cccd: actionType === 'OWNERSHIP_TRANSFER' ? hoso.receiver_info.id_number : fullHoso.account.username,
      issue_date: new Date().toISOString().split('T')[0],
      type: actionType === 'OWNERSHIP_TRANSFER' ? 'Chuyển nhượng quyền sử dụng đất' : 'Cấp giấy chứng nhận lần đầu',
      hoso_id: fullHoso.hoso_id,
      issued_by: 'Hệ thống Quản lý Đất đai Blockchain - Đồ án Đại học'
    };

    const { gcnIpfsHash, gcnIpfsUrl, documentLinks } =
    await exports.uploadHosoToIPFS(fullHoso, certificateNumber, gcnData, t);

    // Ghi blockchain
    const ownerAddress = `0x${BigInt(newOwnerId).toString(16).padStart(40, '0')}`;
    const txHash = await transferOwnership(fullHoso.parcel.parcel_code, ownerAddress, gcnIpfsHash);

    // Lưu giao dịch
    const bt = await BlockchainTransaction.create({
      hoso_id: hoso.hoso_id,
      action: actionType,
      ipfs_hash: gcnIpfsHash,
      ipfs_url: gcnIpfsUrl,
      hash_value: txHash,
      status: 'CONFIRMED'
    }, { transaction: t });

    // Cập nhật sở hữu + parcel
    await LandOwnership.update(
      { is_current: false, end_date: new Date() },
      { where: { parcel_id: fullHoso.parcel.parcel_id, is_current: true }, transaction: t }
    );
    await LandOwnership.create({
      parcel_id: fullHoso.parcel.parcel_id,
      owner_id: newOwnerId,
      start_date: new Date(),
      is_current: true,
      blockchain_tx_id: bt.transaction_id
    }, { transaction: t });

    await LandParcel.update({
      owner_id: newOwnerId,
      certificate_number: certificateNumber,
      certificate_issue_date: new Date(),
      registration_status: 'Đã cấp GCN',
      current_owner_blockchain: true,
      ownership_blockchain_tx_id: bt.transaction_id
    }, { where: { parcel_id: fullHoso.parcel.parcel_id }, transaction: t });

    if (hoso.type === 'Chuyển nhượng') {
      await LandTransferHistory.create({
        parcel_id: fullHoso.parcel.parcel_id,
        from_owner_id: hoso.account_id,
        to_owner_id: newOwnerId,
        hoso_id: hoso.hoso_id,
        blockchain_tx_id: bt.transaction_id
      }, { transaction: t });
    }

    await logHistory(hosoId, hoso.status, 'Đã duyệt',
      actionType === 'OWNERSHIP_TRANSFER' ? 'Chuyển nhượng thành công' : 'Cấp GCN lần đầu',
      actor_id, `GCN: ${certificateNumber} | IPFS: ${gcnIpfsUrl}`, t);

    await hoso.update({
      status: 'Đã duyệt',
      blockchain_synced: true,
      blockchain_tx_id: bt.transaction_id,
      last_blockchain_action: actionType
    }, { transaction: t });

    await t.commit();

    emit('hoso.approved', { io, accountId: hoso.account_id, hosoId });
    if (hoso.type === 'Chuyển nhượng') {
      const receiverAcc = await Account.findOne({ where: { username: hoso.receiver_info.id_number } });
      if (receiverAcc) emit('hoso.approved', { io, accountId: receiverAcc.account_id, hosoId });
    }

    return res.json({
      success: true,
      message: 'Duyệt hồ sơ thành công! Toàn bộ tài liệu đã lưu bất biến trên IPFS.',
      data: { certificate_number: certificateNumber, ipfs_url: gcnIpfsUrl, blockchain_tx: txHash }
    });

  } catch (error) {
    if (t) await t.rollback();
    console.error('Lỗi duyệt hồ sơ:', error);
    return res.status(500).json({ success: false, message: 'Lỗi server', error: error.message });
  }
};
