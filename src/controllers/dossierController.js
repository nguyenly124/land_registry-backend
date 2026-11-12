const { initModels } = require('../models/init-models');
const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
const { emit } = require('../utils/NotificationEvent');
const bcrypt = require('bcryptjs');
const { processDocument } = require('../services/documentService');
const { transferOwnership } = require('../blockchain/services/ethService');
const {createPayOS, createPayOSInternal} = require('../controllers/paymentController');
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
//=== Xác nhận xử lý hồ sơ ===
exports.confirmProcessing = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { hosoId: hoso_id } = req.params;
    const actor_id = req.user.id;
    const { role } = req.user;

    if (role !== 'Cán bộ') {
      await t.rollback();
      return res.status(403).json({ message: 'Chỉ cán bộ mới được xác nhận xử lý hồ sơ.' });
    }

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

// ===  Từ chối hồ sơ ===
exports.rejectHoSo = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { hosoId } = req.params;
    const { reason  } = req.body;
    const actor_id = req.user.id;
    const { role } = req.user;

    if (role !== 'Cán bộ') {
      await t.rollback();
      return res.status(403).json({ message: 'Chỉ cán bộ mới được từ chối hồ sơ.' });
    }

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
        if (hoso.account_id !== req.user.id) {
            return res.status(403).json({ message: 'Bạn không có quyền chỉnh sửa hồ sơ này.' });
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
exports.getAllHoSo = async (req, res) => {
  try {
    const { role, id: userId } = req.user;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const status = req.query.status?.toString().trim();
    const search = req.query.search?.toString().trim();
    const offset = (page - 1) * limit;

    const where = {};
    if (role !== 'Cán bộ') {
      where.account_id = userId;
    }

    if (status && ['Chờ xử lý', 'Đang xử lý', 'Đã duyệt', 'Từ chối'].includes(status)) {
      where.status = status;
    }

    if (search) {
      const like = `%${search}%`;
      where[Op.or] = [
        sequelize.where(sequelize.cast(sequelize.col('HoSo.hoso_id'), 'TEXT'), { [Op.like]: like }),
        sequelize.where(sequelize.cast(sequelize.col('HoSo.type'), 'TEXT'), { [Op.like]: like }),
        { '$account.username$': { [Op.like]: like } },
        { '$account->UserProfile.full_name$': { [Op.like]: like } },
        { '$parcel.parcel_code$': { [Op.like]: like } },
        { '$parcel.address$': { [Op.like]: like } }
      ];
    }

    // === ĐẾM – BẮT BUỘC PHẢI CÓ UserProfile ===
    const count = await HoSo.count({
      where,
      distinct: true,
      col: 'hoso_id',
      include: [
        { 
          model: Account, 
          as: 'account', 
          attributes: [],
          include: [
            { model: UserProfile, as: 'UserProfile', attributes: [] }
          ]
        },
        { model: LandParcel, as: 'parcel', attributes: [] }
      ]
    });

    // === LẤY DỮ LIỆU ===
    const rows = await HoSo.findAll({
      where,
      offset,
      limit,
      order: [['created_at', 'DESC']],
      attributes: ['hoso_id', 'type', 'status', 'created_at', 'receiver_info'],
      include: [
        {
          model: Account,
          as: 'account',
          attributes: ['username'],
          include: [{
            model: UserProfile,
            as: 'UserProfile',
            attributes: ['full_name']
          }]
        },
        {
          model: LandParcel,
          as: 'parcel',
          attributes: ['parcel_code', 'address']
        },
        {
          model: BlockchainTransaction,
          as: 'BlockchainTransactions',
          attributes: ['hash_value'],
          separate: true,
          order: [['transaction_id', 'DESC']],
          limit: 1
        }
      ]
    });

    const data = rows.map(h => {
      const json = h.toJSON();
      const latestTx = h.BlockchainTransactions?.[0] || {};

      return {
        hoso_id: json.hoso_id,
        account: { username: json.account?.username || '—' },
        type: json.type,
        parcel: json.parcel ? {
          parcel_code: json.parcel.parcel_code,
          address: json.parcel.address
        } : null,
        status: json.status,
        created_at: json.created_at,
        blockchain_status: h.BlockchainTransactions?.length > 0 ? 'Đã ghi' : 'Chưa ghi',
        blockchain_link: latestTx.hash_value
          ? `https://mumbai.polygonscan.com/tx/${latestTx.hash_value}`
          : null
      };
    });

    const totalPages = Math.ceil(count / limit);

    res.status(200).json({
      success: true,
      message: 'Lấy danh sách hồ sơ thành công',
      data,
      count,
      pagination: {
        total: count,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Lỗi getAllHoSo:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi server khi lấy danh sách hồ sơ'
    });
  }
};
// Lấy danh sách hồ sơ liên quan đến thửa đất
exports.getByParcelCode = async (req, res) => {
  try {
    const { parcel_id } = req.params;
    const { role, id: userId } = req.user;

    // Kiểm tra đầu vào
    if (!parcel_id || isNaN(parcel_id)) {
      return res.status(400).json({
        success: false,
        message: 'ID thửa đất không hợp lệ.',
      });
    }

    // Điều kiện tìm kiếm
    const whereClause = { parcel_id, status: "Đã duyệt", };
    if (role === 'Người dân') {
      whereClause.account_id = userId;
    }

    // Lấy danh sách hồ sơ
    const dossiers = await HoSo.findAll({
      where: whereClause,
      
      attributes: ['hoso_id', 'type', 'status', 'created_at', 'receiver_info'],
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
          attributes: ['doc_name', 'ipfs_hash', 'file_path'],
          required: false, // Bỏ separate để lấy đúng tất cả file
        },
        {
          model: BlockchainTransaction,
          as: 'BlockchainTransactions',
          attributes: ['hash_value', 'action', 'ipfs_hash' ],
          required: false,
        },
      ],
      order: [['created_at', 'DESC']],
    });

    // Chuẩn hóa dữ liệu trả về
    const result = dossiers.map(hoso => {
      const data = hoso.toJSON();
      // Ưu tiên lấy file GCN tổng hợp (chứa ipfs_hash)
      const gcnDoc = data.HoSoDocuments?.find(doc =>
        doc.doc_name?.includes('GCN_') && doc.doc_name?.includes('TongHop')
      );
      const latestTx = data.BlockchainTransactions?.[0];

      return {
        hoso_id: data.hoso_id,
        type: data.type,
        status: data.status,
        createdAt: data.created_at,
        ipfsHash: gcnDoc?.ipfs_hash || latestTx?.ipfs_hash || null,
        
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
        { model: Account, as: 'account',attributes: { exclude: ['password_hash'] }, include: [{ model: UserProfile, as: 'UserProfile' }] },
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