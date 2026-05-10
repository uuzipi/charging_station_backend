const { createLogger } = require('winston');
const { client } = require('../config/config');
const { ObjectId } = require('mongodb'); // 确保引入 ObjectId 模块
// 读取余额
const getBalance = async (phoneNumber) => {
    try {
        const database = client.db("Test");
        const collection = database.collection("users");

        // 根据手机号查询用户
        const user = await collection.findOne({ phone: phoneNumber });

        // 如果用户存在，返回余额（分转元并保留两位小数）；否则返回0
        if (user) {
            if (user.balanceInCents !== undefined) {
                return (user.balanceInCents / 100).toFixed(2);
            }
        }
        return "0.00";
    } catch (error) {
        console.error('读取余额失败:', error);
        throw error; // 抛出错误，便于上层处理
    }
};

/**
 * 在用户现有余额基础上增加金额
 * @param {String} phoneNumber - 用户手机号
 * @param {Number} additionalAmountInCents - 要增加的金额(分)
 * @returns {String} - 更新后的余额(元)，保留两位小数
 */
const addToBalance = async (phoneNumber, additionalAmountInCents) => {
    if (typeof additionalAmountInCents !== 'number' || isNaN(additionalAmountInCents)) {
        throw new Error('无效的金额数据');
    }

    try {
        const database = client.db("Test");
        const collection = database.collection("users");

        // 获取当前用户数据，直接从数据库获取分为单位的余额
        const user = await collection.findOne({ phone: phoneNumber });
        
        // 初始化当前余额（分）
        let currentBalanceInCents = 0;
        
        // 如果用户存在且有余额字段，获取其值
        if (user && user.balanceInCents !== undefined) {
            currentBalanceInCents = user.balanceInCents;
        }
        
        // 计算新余额（单位：分）
        const newBalanceInCents = currentBalanceInCents + additionalAmountInCents;

        // 更新用户余额
        const result = await collection.findOneAndUpdate(
            { phone: phoneNumber },
            {
                $set: { 
                    balanceInCents: newBalanceInCents, // 存储为分
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    createdAt: new Date(),
                    currency: "CNY",
                    devices: []
                }
            }, 
            { 
                upsert: true,
                returnDocument: 'after'
            }
        );

        if (result) {
            // 返回时将分转换为元并保留两位小数
            return (result.balanceInCents / 100).toFixed(2);
        }
        
        throw new Error('余额增加失败');
    } catch (error) {
        console.error('增加余额失败:', error);
        throw error;
    }
};

// 更新余额的逻辑函数
const updateBalance = async (phoneNumber, amountInYuan) => {
    if (typeof amountInYuan !== 'number' || isNaN(amountInYuan)) {
        throw new Error('无效的金额数据');
    }

    try {
        const database = client.db("Test");
        const collection = database.collection("users");

        // 将元转换为分，并四舍五入确保精度
        const amountInCents = Math.round(amountInYuan * 100);

        // 更新或插入用户余额
        const result = await collection.findOneAndUpdate(
            { phone: phoneNumber },
            {
                $set: { 
                    balanceInCents: amountInCents, // 存储为分
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    createdAt: new Date(),
                    currency: "CNY",
                    devices: []
                }
            }, 
            { 
                upsert: true,
                returnDocument: 'after' // 仅用新版语法
            }
        );
        // 打印结果
        console.log(result);

        if (result) {
            // 返回时将分转换为元并保留两位小数
            return (result.balanceInCents / 100).toFixed(2);
        } 
    } catch (error) {
        console.error('更新余额失败:', error);
        throw error;
    }
};

// 获取所有用户余额
const getUserBalances = async () => {
    try {
        const database = client.db("Test");
        const collection = database.collection("users");

        // 获取所有用户
        const users = await collection.find({}).toArray();

        // 将用户数据转换为键值对对象
        const balanceData = users.reduce((acc, user) => {
            // 处理包含 phone 字段的用户
            if (user.phone) {
                if (user.balanceInCents !== undefined) {
                    // 如果有balanceInCents字段，转换为元并保留两位小数
                    acc[user.phone] = (user.balanceInCents / 100).toFixed(2);
                }
            }
            return acc;
        }, {});

        return balanceData;
    } catch (error) {
        console.error('读取所有用户余额失败:', error);
        throw error; // 抛出错误，便于上层处理
    }
};

module.exports = {
    getBalance,
    updateBalance,
    addToBalance,
    getUserBalances,
};
