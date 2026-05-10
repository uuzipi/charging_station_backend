const express = require('express');
const router = express.Router();
const path = require('path');
const orderDB = require('../db/orderDB');
const { businessLogger } = require('../utils/logger');

// 获取活跃订单的路由
router.get('/active-orders', async (req, res) => {
    try {
        const phoneNumber = req.query.phoneNumber;
        
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                error: '缺少手机号参数'
            });
        }
        // 获取分页参数
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        
        // 调用 getActiveOrders 函数
        const result = await orderDB.getActiveOrders(phoneNumber, { page, limit });

        res.json(result);
    } catch (error) {
        console.error('获取进行中订单失败:', error);
        res.status(500).json({
            success: false,
            error: '服务器内部错误'
        });
    }
});

// 获取已完成订单的路由
router.get('/completed-orders', async (req, res) => {
    try {
        const phoneNumber = req.query.phoneNumber;

        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                error: '缺少必要的 phoneNumber 查询参数'
            });
        }

        const result = await orderDB.getCompletedOrders(phoneNumber);

        if (result.success) {
            res.json({
                success: true,
                data: result.data
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || '获取订单失败'
            });
        }

    } catch (error) {
        console.error('处理 /completed-orders 请求失败:', error);
        res.status(500).json({
            success: false,
            error: '服务器内部错误'
        });
    }
});

// 余额支付订单 - 创建订单并扣除余额的接口
router.post('/create-order-update-balance', async (req, res) => {
    try {
        // 从请求体中获取参数
        const { phoneNumber, totalFee, combinedId } = req.body;
        
        // 构建订单数据
        const orderData = {
            phoneNumber,
            totalFee: parseInt(totalFee), // 确保金额是整数
        };
        
        // 直接调用已有的函数
        const result = await orderDB.createOrUpdatePaymentOrder(orderData, combinedId);
        
        // 返回结果
        res.json(result);
    } catch (error) {
        console.error('创建订单失败:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 订单管理页面
router.get('/manage', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'orders.html'));
});

module.exports = router;