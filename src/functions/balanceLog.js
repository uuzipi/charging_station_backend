const fs = require('fs');
const path = require('path');
const { getBalance, updateBalance, getUserBalances } = require('../db/balanceDB');
const { businessLogger } = require('../utils/logger'); 
const { httpLogger } = require('../utils/logger'); 
const { client } = require('../config/config');

// 获取当前余额 
const getBalanceHandler = async (req, res) => {
    const phoneNumber = req.query.phoneNumber;
    if (!phoneNumber) {
        businessLogger.error('获取余额失败: 缺少 phoneNumber 参数');
        return res.status(400).json({ status: 'error', message: '缺少 phoneNumber 参数' });
    }

    try {
        const balance = await getBalance(phoneNumber);
        res.json({
            status: 'success',
            balance: balance,
        });
        businessLogger.info('获取余额成功', { phoneNumber, balance });
    } catch (error) {
        businessLogger.error('获取余额失败', { phoneNumber, error: error.message });
        res.status(500).json({
            status: 'error',
            message: '获取余额失败',
        });
    }
};

// 更新余额
const updateBalanceHandler = async (req, res) => {
    const { amount, phoneNumber } = req.body;

    if (!phoneNumber) {
        businessLogger.error('更新余额失败: 缺少 phoneNumber 参数', { phoneNumber: null, amount });
        return res.status(400).json({ status: 'error', message: '缺少 phoneNumber 参数' });
    }

    try {
        const newBalance = await updateBalance(phoneNumber, amount);
        businessLogger.info('余额更新成功', { phoneNumber, newBalance });
        res.json({
            status: 'success',
            message: '余额更新成功',
            balance: newBalance,
        });
    } catch (error) {
        businessLogger.error('更新余额失败', { phoneNumber, amount, error: error.message });
        res.status(400).json({
            status: 'error',
            message: error.message,
        });
    }
};

// 获取所有用户余额
const getUserBalancesHandler = async (req, res) => {
    try {
        const balanceData = await getUserBalances();
        res.json(balanceData);
    } catch (error) {
        businessLogger.error('读取用户余额失败', { error: error.message });
        res.status(500).json({ status: 'error', message: '读取用户余额失败' });
    }
};

module.exports = {
    getBalanceHandler,
    updateBalanceHandler,
    getUserBalancesHandler,
};