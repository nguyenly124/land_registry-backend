const { initModels } = require('../models/init-models');
const { sequelize } = require('../config/db');
const { emit } = require('../utils/NotificationEvent');
const bcrypt = require('bcryptjs');
const { processDocument } = require('../services/documentService');
const { transferOwnership } = require('../blockchain/services/ethService');
// Khởi tạo models
const { HoSo, HoSoDocument,LandParcel, UserProfile, Account, HoSoHistory,BlockchainTransaction,LandTransferHistory,LandOwnership } = initModels(sequelize);

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
// Chức năng Nộp hồ sơ mới
exports.submitHoSo = async (req, res) => {
  let t;
  const io = req.app.get('io');
  try {
    t = await sequelize.transaction();

    const { type, parcelId, receiver_info } = req.body;
    const { id: accountId, role } = req.user;
    const files = req.files; // Từ multer

    // === VALIDATE ===
    if (!type || !['Đăng ký sử dụng', 'Chuyển nhượng'].includes(type)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Loại hồ sơ không hợp lệ.' });
    }

    let finalParcelId = null;
    if (parcelId) {
      const parcel = await LandParcel.findByPk(parcelId, { transaction: t });
      if (!parcel) {
        await t.rollback();
        return res.status(404).json({ success: false, message: 'Không tìm thấy thửa đất.' });
      }
      finalParcelId = parcelId;
    }
    if (type === 'Chuyển nhượng') {
      if (!receiver_info?.full_name?.trim() || !receiver_info?.id_number?.trim()) {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'Thông tin người nhận không đầy đủ.' });
      }
    }

    // === TẠO HỒ SƠ ===
    const newHoSo = await HoSo.create({
      account_id: accountId,
      parcel_id: finalParcelId,
      type: type.trim(),
      status: 'Chờ xử lý',
      receiver_info: type === 'Chuyển nhượng' ? receiver_info : null
    }, { transaction: t });
    // === XỬ LÝ TÀI LIỆU (Cloudinary → IPFS → Blockchain) ===
    if (files && files.length > 0) {
      for (const file of files) {
        const result = await processDocument(file, newHoSo.hoso_id);
        await logBlockchainTx(newHoSo.hoso_id, 'DOCUMENT_SUBMITTED', result.ipfsHash, result.txHash, t);
      }
    }

    // === GHI LỊCH SỬ ===
    await logHistory(
      newHoSo.hoso_id,
      null,
      'Chờ xử lý',
      'Nộp hồ sơ mới',
      accountId,
      `Loại: ${type} | Thửa: ${finalParcelId || 'Không có'}`,
      t
    );

    await t.commit();
    // === GỬI THÔNG BÁO ===
    emit('hoso.submitted', {
      io,
      accountId,
      type: newHoSo.type,
      hosoId: newHoSo.hoso_id,
      parcelId: newHoSo.parcel_id
    });

    res.status(201).json({
      success: true,
      message: 'Nộp hồ sơ thành công.',
      data: { ...newHoSo.toJSON(), documents_uploaded: files?.length || 0 }
    });
  } catch (error) {
    if (t) await t.rollback();
    console.error('Lỗi nộp hồ sơ:', error);
    res.status(500).json({ success: false, message: 'Lỗi server.' });
  }
};
exports.confirmProcessing = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { hoso_id } = req.params;
    const actor_id = req.user.id;

    const hoso = await HoSo.findByPk(hoso_id, { transaction: t });
    if (!hoso) {
      await t.rollback();
      return res.status(404).json({ message: 'Hồ sơ không tồn tại.' });
    }

    if (hoso.status !== 'Chờ xử lý') {
      await t.rollback();
      return res.status(400).json({ message: 'Hồ sơ không ở trạng thái chờ xử lý.' });
    }

    const oldStatus = hoso.status;
    await hoso.update({ status: 'Đang xử lý' }, { transaction: t });

    await logHistory(hoso_id, oldStatus, 'Đang xử lý', 'Xác nhận xử lý', actor_id, null, t);

    await t.commit();
    res.status(200).json({ success: true, message: 'Xác nhận xử lý thành công.' });

  } catch (error) {
    await t.rollback();
    console.error('Lỗi xác nhận xử lý:', error);
    res.status(500).json({ success: false, message: 'Đã có lỗi xảy ra.' });
  }
};

// ===  Yêu cầu bổ sung tài liệu ===
exports.requestSupplement = async (req, res) => {
 
  let t;
  const io = req.app.get('io');
  try {
    t = await sequelize.transaction();
    const { hosoId } = req.params;
    const { reason } = req.body;
    const actor_id = req.user.id;
    const { role } = req.user;

    if (role !== 'Cán bộ') {
      await t.rollback();
      return res.status(403).json({ message: 'Chỉ cán bộ mới được yêu cầu bổ sung.' });
    }

    if (!reason?.trim()) {
      await t.rollback();
      return res.status(400).json({ message: 'Vui lòng nhập nội dung yêu cầu bổ sung.' });
    }

    const hoso = await HoSo.findByPk(hosoId, { transaction: t });
    if (!hoso) {
      await t.rollback();
      return res.status(404).json({ message: 'Không tìm thấy hồ sơ.' });
    }

    if (!['Chờ xử lý', 'Đang xử lý'].includes(hoso.status)) {
      await t.rollback();
      return res.status(400).json({ message: 'Chỉ yêu cầu bổ sung khi hồ sơ đang chờ hoặc đang xử lý.' });
    }

    const oldStatus = hoso.status;
    await hoso.update({
      status: 'Đang xử lý',
      supplement_note: reason.trim(),
      updated_at: new Date()
    }, { transaction: t });

    await logHistory(hosoId, oldStatus, 'Đang xử lý', 'Yêu cầu bổ sung tài liệu', actor_id, reason.trim(), t);

    await t.commit();

    emit('hoso.supplement_requested', {
      io,
      accountId: hoso.account_id,
      hosoId: hoso.hoso_id,
      reason: reason.trim()
    });

    res.status(200).json({
      success: true,
      message: 'Yêu cầu bổ sung đã được gửi thành công.',
      data: { hoso_id: hoso.hoso_id, supplement_note: hoso.supplement_note }
    });

  } catch (error) {
    if (t) await t.rollback();
    console.error('Lỗi yêu cầu bổ sung:', error);
    res.status(500).json({ success: false, message: 'Đã có lỗi xảy ra.' });
  }
};
//2. DUYỆT HỒ SƠ (CÓ CHUYỂN NHƯỢNG → BLOCKCHAIN)
exports.approveHoSo = async (req, res) => {
  let t;
  const io = req.app.get('io');
  try {
    t = await sequelize.transaction();

    const { hosoId } = req.params;
    const { note } = req.body;
    const actor_id = req.user.id;

    // === BƯỚC 1: LẤY HỒ SƠ + KHÓA DÒNG (CHỈ KHÓA HoSo) ===
    const hoso = await HoSo.findByPk(hosoId, {
      transaction: t,
      lock: t.LOCK.UPDATE // CHỈ KHÓA BẢNG CHÍNH
    });

    if (!hoso || !['Chờ xử lý', 'Đang xử lý'].includes(hoso.status)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Hồ sơ không hợp lệ hoặc không thể duyệt.' });
    }

    // === BƯỚC 2: LẤY DỮ LIỆU CHI TIẾT (KHÔNG DÙNG LOCK) ===
    const fullHoso = await HoSo.findByPk(hosoId, {
      include: [
        { model: LandParcel, as: 'parcel', required: true },
        { 
          model: Account, 
          as: 'account', 
          required: true,
          include: [{ model: UserProfile, as: 'UserProfile', required: true }] 
        }
      ],
      transaction: t
    });

    if (!fullHoso.parcel || !fullHoso.account?.UserProfile) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Thiếu thông tin thửa đất hoặc chủ sở hữu.' });
    }

    const oldStatus = hoso.status;
    let newOwnerId = hoso.account_id;
    let actionType = 'INITIAL_REGISTRATION';
    let receiverName = fullHoso.account.UserProfile.full_name;
    let certificateNumber = `GCN-${hosoId}-${Date.now().toString().slice(-6)}`;
    let txHash = null;
    let ipfsHash = `Qm${actionType}${hosoId}${Date.now()}`;

    // === XỬ LÝ CHUYỂN NHƯỢNG ===
    if (hoso.type === 'Chuyển nhượng' && hoso.receiver_info) {
      const { full_name, id_number } = hoso.receiver_info;

      let receiverAccount = await Account.findOne({ where: { username: id_number }, transaction: t });
      if (!receiverAccount) {
        receiverAccount = await Account.create({
          username: id_number,
          password: await bcrypt.hash(id_number, 10),
          role: 'Người dân'
        }, { transaction: t });
        await UserProfile.create({
          account_id: receiverAccount.account_id,
          full_name,
          cccd: id_number
        }, { transaction: t });
      }

      newOwnerId = receiverAccount.account_id;
      actionType = 'OWNERSHIP_TRANSFER';
      receiverName = full_name;
      ipfsHash = `QmTransfer${hosoId}${Date.now()}`;
    }

    // === CHUYỂN owner_id (số) → địa chỉ 0x... (40 ký tự hex) ===
    let ownerAddress;
    try {
      ownerAddress = `0x${BigInt(newOwnerId).toString(16).padStart(40, '0')}`;
      // Kiểm tra địa chỉ hợp lệ
      // if (!ethers.isAddress(ownerAddress)) throw new Error('Invalid address');
    } catch (error) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Owner ID không hợp lệ.' });
    }

    // === GHI LÊN BLOCKCHAIN (CẢ 2 LOẠI) ===
    try {
      txHash = await transferOwnership(
        fullHoso.parcel.parcel_code,
        ownerAddress, 
        ipfsHash
      );
      console.log('txHash từ blockchain:', txHash);
    } catch (blockchainError) {
      console.error('Lỗi ghi blockchain:', blockchainError);
      await t.rollback();
      return res.status(500).json({ 
        success: false, 
        message: 'Ghi blockchain thất bại.', 
        error: blockchainError.message 
      });
    }

    // === GHI GIAO DỊCH BLOCKCHAIN VÀO DB ===
    const bt = await BlockchainTransaction.create({
      hoso_id: hoso.hoso_id,
      action: actionType,
      ipfs_hash: ipfsHash,
      hash_value: txHash,
      status: 'CONFIRMED'
    }, { transaction: t });

    // === CẬP NHẬT LỊCH SỬ SỞ HỮU (LandOwnership) ===
    await LandOwnership.update(
      { is_current: false, end_date: sequelize.literal('CURRENT_DATE') },
      { where: { parcel_id: fullHoso.parcel_id, is_current: true }, 
      transaction: t }
    );

    await LandOwnership.create({
      parcel_id: fullHoso.parcel_id,
      owner_id: newOwnerId,
      start_date: sequelize.literal('CURRENT_DATE'),
      is_current: true,
      blockchain_tx_id: bt.transaction_id
    }, { transaction: t });

    // === CẬP NHẬT LandParcel ===
    await LandParcel.update(
      { owner_id: newOwnerId },
      { where: { parcel_id: fullHoso.parcel_id }, transaction: t }
    );

    // === GHI LỊCH SỬ CHUYỂN NHƯỢNG (nếu có) ===
    if (hoso.type === 'Chuyển nhượng') {
      await LandTransferHistory.create({
        parcel_id: fullHoso.parcel_id,
        from_owner_id: hoso.account_id,
        to_owner_id: newOwnerId,
        hoso_id: hoso.hoso_id,
        blockchain_tx_id: bt.transaction_id
      }, { transaction: t });
    }

    // === GHI LỊCH SỬ HỒ SƠ ===
    const actionText = hoso.type === 'Chuyển nhượng' ? 'Chuyển nhượng thành công' : 'Cấp GCN lần đầu';
    await logHistory(
      hosoId,
      oldStatus,
      'Đã duyệt',
      actionText,
      actor_id,
      `${receiverName} | GCN: ${certificateNumber} | Tx: ${txHash}`,
      t
    );

    // === CẬP NHẬT TRẠNG THÁI ===
    await hoso.update({ status: 'Đã duyệt' }, { transaction: t });

    await t.commit();

    // === GỬI THÔNG BÁO ===
    emit('hoso.approved', { io, accountId: hoso.account_id, hosoId: hoso.hoso_id });
    if (hoso.type === 'Chuyển nhượng') {
      const receiverAcc = await Account.findOne({ where: { username: hoso.receiver_info.id_number } });
      if (receiverAcc) emit('hoso.approved', { io, accountId: receiverAcc.account_id, hosoId: hoso.hoso_id });
    }

    // === TRẢ KẾT QUẢ ===
    res.status(200).json({
      success: true,
      message: 'Duyệt hồ sơ thành công.',
      data: {
        hoso_id: hoso.hoso_id,
        certificate_number: certificateNumber,
        blockchain_tx: txHash,
        owner_id: newOwnerId,
        owner_address: ownerAddress,
        action: actionType
      }
    });

  } catch (error) {
    if (t) await t.rollback();
    console.error('Lỗi duyệt hồ sơ:', error);
    res.status(500).json({ success: false, message: 'Lỗi server.', error: error.message });
  }
};

// ===  Từ chối hồ sơ ===
exports.rejectHoSo = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { hosoId } = req.params;
    const { reason  } = req.body;
    const actor_id = req.user.id;

    if (!reason ?.trim()) {
      return res.status(400).json({ message: 'Vui lòng cung cấp lý do từ chối.' });
    }

    const hoso = await HoSo.findByPk(hosoId, { transaction: t });
    if (!hoso) {
      await t.rollback();
      return res.status(404).json({ message: 'Hồ sơ không tồn tại.' });
    }

    if (!['Chờ xử lý', 'Đang xử lý'].includes(hoso.status)) {
      await t.rollback();
      return res.status(400).json({ message: 'Hồ sơ không thể từ chối ở trạng thái hiện tại.' });
    }

    const oldStatus = hoso.status;
    await hoso.update({ status: 'Từ chối' }, { transaction: t });

    // GHI LỊCH SỬ
    await logHistory(
      hosoId,
      oldStatus,
      'Từ chối',
      'Từ chối hồ sơ',
      actor_id,
      reason ,
      t
    );

    await t.commit();
    res.status(200).json({ message: 'Từ chối hồ sơ thành công.' });

  } catch (error) {
    await t.rollback();
    console.error('Lỗi từ chối hồ sơ:', error);
    res.status(500).json({ message: 'Đã có lỗi xảy ra.' });
  }
};

// Chức năng Chỉnh sửa hồ sơ
exports.editHoSo = async (req, res) => {
    try {
        const { hosoId, ...updatedData } = req.body;
        const hoso = await HoSo.findByPk(hosoId);

        if (!hoso) {
            return res.status(404).json({ message: 'Không tìm thấy hồ sơ.' });
        }
        if (hoso.status !== 'Chờ xử lý' && hoso.status !== 'Đang xử lý') {
            return res.status(403).json({ message: 'Không thể chỉnh sửa hồ sơ ở trạng thái này.' });
        }

        await hoso.update(updatedData);
        res.status(200).json({ message: 'Chỉnh sửa hồ sơ thành công.', hoso });
    } catch (error) {
        console.error('Lỗi khi chỉnh sửa hồ sơ:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra. Vui lòng thử lại.' });
    }
};
// Chức năng Yêu cầu hủy hồ sơ
exports.cancelHoSo = async (req, res) => {
  
  const t = await sequelize.transaction();
  try {
    const { hoso_id } = req.params;
    const { id: actor_id, role } = req.user;
    const hoso = await HoSo.findByPk(hoso_id, {
      include: [{ model: Account,as: 'account', attributes: ['role'] }],
      transaction: t
    });

    if (!hoso) {
      await t.rollback();
      return res.status(404).json({ message: 'Hồ sơ không tồn tại.' });
    }

    // Kiểm tra quyền hủy
    if (role === 'Người dân' && hoso.account_id !== actor_id) {
      await t.rollback();
      return res.status(403).json({ message: 'Bạn không có quyền hủy hồ sơ này.' });
    }

    if (!['Chờ xử lý', 'Đang xử lý'].includes(hoso.status)) {
      await t.rollback();
      return res.status(400).json({ message: 'Chỉ có thể hủy hồ sơ ở trạng thái chờ hoặc đang xử lý.' });
    }

    const oldStatus = hoso.status;
    await hoso.update({ status: 'Từ chối' }, { transaction: t });

    // GHI LỊCH SỬ
    await logHistory(
      hoso_id,
      oldStatus,
      'Đã hủy',
      'Hủy hồ sơ',
      actor_id,
       'Người dùng yêu cầu hủy hồ sơ.',
      t
    );

    await t.commit();
    res.status(200).json({ message: 'Hủy hồ sơ thành công.' ,data: hoso});

  } catch (error) {
    await t.rollback();
    console.error('Lỗi hủy hồ sơ:', error);
    res.status(500).json({ message: 'Đã có lỗi xảy ra.' });
  }
};
// Hàm lấy tất cả hồ sơ
exports.getAllHoSo = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const where = role === 'Cán bộ' ? {} : { account_id: userId };

    const { count, rows } = await HoSo.findAndCountAll({
      where,
      offset,
      limit,
      order: [['created_at', 'DESC']],
      include: [
        { model: Account, as: 'account', include: [{ model: UserProfile, as: 'UserProfile' }] },
        { model: LandParcel, as: 'parcel' },
        { model: BlockchainTransaction, as: 'BlockchainTransactions', attributes: ['hash_value', 'action'] }
      ]
    });

    res.status(200).json({
      success: true,
      data: rows.map(h => ({
        ...h.toJSON(),
        blockchain_status: h.BlockchainTransactions?.length > 0 ? 'Đã ghi' : 'Chưa ghi',
        blockchain_link: h.BlockchainTransactions?.[0]?.hash_value
          ? `https://mumbai.polygonscan.com/tx/${h.BlockchainTransactions[0].hash_value}`
          : null
      })),
      pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Lỗi server.' });
  }
};
// Lấy danh sách hồ sơ liên quan đến thửa đất
exports.getByParcelCode = async (req, res) => {
  try {
    
    const { parcel_id } = req.params;
    const { role, id: userId } = req.user;
    // === KIỂM TRA ĐẦU VÀO ===
    if (!parcel_id || isNaN(parcel_id)) {
      return res.status(400).json({
        success: false,
        message: 'ID thửa đất không hợp lệ.',
      });
    }
    // === TÌM HỒ SƠ ===
    const whereClause = {
      parcel_id: parcel_id,
    };
    // Người dân chỉ xem được hồ sơ của mình
    if (role === 'Người dân') {
      whereClause.account_id = userId;
    }

    const dossiers = await HoSo.findAll({
      where: whereClause,
      attributes: [
        'hoso_id',
        'type',
        'status',
        'created_at',
        'receiver_info',
      ],
      include: [
        {
          model: LandParcel,
          as: 'parcel',
          attributes: ['parcel_code'],
          required: true,
        },
        {
          model: HoSoDocument,
          as: 'HoSoDocuments',
          attributes: ['ipfs_hash'],
          separate: true,
        },
        {
          model: BlockchainTransaction,
          as: 'BlockchainTransactions',
          attributes: ['hash_value', 'action'],
          separate: true,
        },
      ],
      order: [['created_at', 'DESC']],
    });

    // === CHUẨN HÓA DỮ LIỆU TRẢ VỀ ===
    const result = dossiers.map(hoso => {
      const data = hoso.toJSON();
      const latestDoc = data.HoSoDocuments?.[0];
      const latestTx = data.BlockchainTransactions?.[0];

      return {
        hoso_id: data.hoso_id,
        type: data.type,
        status: data.status,
        createdAt: data.created_at,
        ipfsHash: latestDoc?.ipfs_hash || null,
        txHash: latestTx?.hash_value || null,
        receiver_info: data.receiver_info,
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Lấy lịch sử hồ sơ thành công.',
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error('Lỗi getByParcelCode:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi server khi lấy hồ sơ.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};
//laays chi tiết hồ sơ 
exports.getHoSoDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, id: userId } = req.user;

    const hoso = await HoSo.findByPk(id, {
      include: [
        {
          model: HoSoDocument,
          as: 'HoSoDocuments',
          attributes: ['doc_id', 'doc_name', 'file_path', 'ipfs_hash', 'uploaded_at']
        },
        { model: Account, as: 'account', include: [{ model: UserProfile, as: 'UserProfile' }] },
        { model: LandParcel, as: 'parcel' },
        { model: BlockchainTransaction, as: 'BlockchainTransactions' }
      ]
    });

    if (!hoso || (role === 'Người dân' && hoso.account_id !== userId)) {
      return res.status(403).json({ message: 'Không có quyền.' });
    }

    res.status(200).json({
      success: true,
      data: {
        ...hoso.toJSON(),
        blockchain_explorer: hoso.BlockchainTransactions?.[0]?.hash_value
          ? `https://mumbai.polygonscan.com/tx/${hoso.BlockchainTransactions[0].hash_value}`
          : null
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Lỗi server.' });
  }
};

// Tìm kiếm hồ sơ 
exports.searchHoSo = async (req, res) => {
    try {
        const {
            query, page, limit, status, account_id, parcel_id
        } = req.query;
        
        const { role, id: userId } = req.user;

        const whereClause = {};
        if (role === 'Người dân') {
            whereClause.account_id = userId;
        }

        if (status) {
            whereClause.status = status;
        }
        if (account_id) {
            // Cán bộ có quyền tìm kiếm theo account_id của người khác
            if (role === 'Cán bộ') {
                whereClause.account_id = account_id;
            } else {
                // Người dân chỉ có thể tìm hồ sơ của chính họ
                return res.status(403).json({ message: 'Bạn không có quyền tìm kiếm hồ sơ của người khác.' });
            }
        }
        if (parcel_id) {
            whereClause.parcel_id = parcel_id;
        }
        
        // Thêm điều kiện tìm kiếm chung (query)
        if (query) {
            whereClause[Op.or] = [
                { type: { [Op.iLike]: `%${query}%` } },
                { '$account.user_profile.full_name$': { [Op.iLike]: `%${query}%` } },
                { '$account.user_profile.email$': { [Op.iLike]: `%${query}%` } }
            ];
        }

        const offset = (page - 1) * limit;

        const { count, rows } = await HoSo.findAndCountAll({
            where: whereClause,
            limit: limit,
            offset: offset,
            order: [['created_at', 'DESC']],
            include: [
                {
                    model: Account,
                    as: 'account',
                    attributes: ['username', 'role'],
                    include: [{
                        model: UserProfile,
                        as: 'UserProfile',
                        attributes: ['full_name', 'phone', 'email']
                    }]
                },
                {
                    model: LandParcel,
                    as: 'parcel',
                    attributes: ['parcel_code', 'address']
                }
            ]
        });

        res.status(200).json({
            message: 'Tìm kiếm hồ sơ thành công.',
            totalItems: count,
            totalPages: Math.ceil(count / limit),
            currentPage: page,
            items: rows
        });

    } catch (error) {
        console.error('Lỗi khi tìm kiếm hồ sơ:', error);
        res.status(500).json({ message: 'Đã có lỗi xảy ra. Vui lòng thử lại.' });
    }
};