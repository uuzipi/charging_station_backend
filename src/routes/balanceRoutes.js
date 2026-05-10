const express = require('express');
const router = express.Router();
const balanceController = require('../functions/balanceLog');

// 获取余额
router.get('/balance', balanceController.getBalanceHandler);

// 更新余额
router.post('/update-balance', balanceController.updateBalanceHandler);

// 获取用户余额列表
router.get('/user-balances', balanceController.getUserBalancesHandler);

module.exports = router;
