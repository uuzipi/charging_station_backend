const { connectDB, client } = require('../config/config.js');
const { ObjectId } = require('mongodb');
const { businessLogger } = require('../utils/logger');

// 用户集合名称
const COLLECTION_NAME = 'users';
const DB_NAME = 'Test';

// 获取数据库连接和集合
const getUsersCollection = async () => {
    try {
        // 确保连接已经建立
        if (!client.topology || !client.topology.isConnected()) {
            await connectDB();
        }
        return client.db(DB_NAME).collection(COLLECTION_NAME);
    } catch (error) {
        businessLogger.error('获取users集合失败', { error: error.message });
        throw error;
    }
};

/**
 * 根据手机号获取用户
 * @param {string} phoneNumber - 用户手机号
 * @returns {Promise<Object|null>} - 用户对象或null
 */
const getUserByPhoneNumber = async (phoneNumber) => {
    try {
        const collection = await getUsersCollection();
        const user = await collection.findOne({ phone: phoneNumber });
        return user;
    } catch (error) {
        businessLogger.error('获取用户信息失败', { phoneNumber, error: error.message });
        throw error;
    }
};

/**
 * 创建新用户（如果不存在）
 * @param {string} phoneNumber - 用户手机号
 * @param {string} openid - 用户的微信openid（可选）
 * @returns {Promise<Object>} - 用户对象和创建状态
 */
const createUserIfNotExists = async (phoneNumber, openid = null) => {
    try {
        const collection = await getUsersCollection();
        
        // 查找用户是否存在
        let user = await collection.findOne({ phone: phoneNumber });
        
        // 用户已存在
        if (user) {
            // 如果传入了openid且用户没有openid，则更新
            if (openid && !user.openid) {
                await collection.updateOne(
                    { _id: user._id },
                    { $set: { openid } }
                );
                user.openid = openid;
            }
            return { ...user, isNewUser: false };
        }
        
        // 创建新用户
        const newUser = {
            phone: phoneNumber,
            openid,
            balanceInCents: 0,  // 注意字段名是 balanceInCents 而不是 balance
            displayName: `用户${phoneNumber.slice(-4)}`,
            avatar: null,
            password: null,
            currency: "CNY",
            createdAt: new Date(),
            updatedAt: new Date(),
            devices: []
        };
        
        const result = await collection.insertOne(newUser);
        newUser._id = result.insertedId;
        
        businessLogger.info('创建新用户成功', { phoneNumber });
        
        return { ...newUser, isNewUser: true };
    } catch (error) {
        businessLogger.error('创建用户失败', { phoneNumber, error: error.message });
        throw error;
    }
};

/**
 * 更新用户密码
 * @param {string} phoneNumber - 用户手机号
 * @param {string} hashedPassword - 哈希后的密码
 * @returns {Promise<Object>} - 更新结果
 */
const updateUserPassword = async (phoneNumber, hashedPassword) => {
    try {
        const collection = await getUsersCollection();
        
        const result = await collection.updateOne(
            { phone: phoneNumber },
            { $set: { password: hashedPassword, updatedAt: new Date() } }
        );
        
        if (result.matchedCount === 0) {
            return {
                success: false,
                error: '用户不存在'
            };
        }
        
        return {
            success: true,
            modifiedCount: result.modifiedCount
        };
    } catch (error) {
        businessLogger.error('更新用户密码失败', { phoneNumber, error: error.message });
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * 更新用户个人资料
 * @param {string} phoneNumber - 用户手机号
 * @param {object} profileData - 要更新的资料对象
 * @returns {Promise<Object>} - 更新结果
 */
const updateUserProfile = async (phoneNumber, profileData) => {
    try {
        const allowedFields = ['displayName', 'avatar'];
        const updateData = {};
        
        // 过滤只允许更新的字段
        Object.keys(profileData).forEach(key => {
            if (allowedFields.includes(key) && profileData[key] !== undefined) {
                updateData[key] = profileData[key];
            }
        });
        
        if (Object.keys(updateData).length === 0) {
            return {
                success: false,
                error: '没有可更新的字段'
            };
        }
        
        // 添加更新时间
        updateData.updatedAt = new Date();
        
        const collection = await getUsersCollection();
        const result = await collection.updateOne(
            { phone: phoneNumber },
            { $set: updateData }
        );
        
        if (result.matchedCount === 0) {
            return {
                success: false,
                error: '用户不存在'
            };
        }
        
        return {
            success: true,
            modifiedCount: result.modifiedCount
        };
    } catch (error) {
        businessLogger.error('更新用户个人资料失败', { phoneNumber, error: error.message });
        return {
            success: false,
            error: error.message
        };
    }
};

module.exports = {
    getUserByPhoneNumber,
    createUserIfNotExists,
    updateUserPassword,
    updateUserProfile
}; 