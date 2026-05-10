/*
*这里不仅包含解密接口,也包含几个解密函数
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { businessLogger } = require('../utils/logger');
const userDB = require('../db/userDB');
const WxPay = require('wechatpay-node-v3');
const config = require('../config/wxpay.config');


// 微信支付实例，用于调用签名方法
const wxpay = new WxPay({
    appid: config.appId,
    mchid: config.mchId,
    publicKey: config.publicKey,
    privateKey: config.privateKey,
    secretKey: config.apiV3Key,
});

/**
 * 解密微信获取的手机号
 * 接收前端传来的加密数据，并返回解密后的手机号
 */
router.post('/decrypt', async (req, res) => {
    try {
        const { encryptedData, iv, sessionKey } = req.body;
        
        businessLogger.info('收到手机号解密请求');
        
        // 请求参数验证
        if (!encryptedData || !iv || !sessionKey) {
            businessLogger.warn('手机号解密请求缺少必要参数');
            return res.json({
                status: 'error',
                message: '缺少必要参数：encryptedData, iv, sessionKey'
            });
        }

        // 解密手机号
        try {
            const phoneNumber = decryptPhoneNumber(encryptedData, iv, sessionKey);
            
            businessLogger.info('手机号解密成功');
            
            return res.json({
                status: 'success',
                data: { phoneNumber }
            });
        } catch (decryptError) {
            businessLogger.error('手机号解密失败', { error: decryptError.message });
            return res.json({
                status: 'error',
                message: '手机号解密失败: ' + decryptError.message
            });
        }
    } catch (error) {
        businessLogger.error('处理手机号解密请求异常', { error: error.message, stack: error.stack });
        return res.status(500).json({
            status: 'error',
            message: '服务器内部错误'
        });
    }
});

/**
 * 常规登录接口（用于网页端）
 * 接收手机号和密码，验证后返回用户信息
 */
router.post('/login', async (req, res) => {
    try {
        const { phoneNumber, password } = req.body;
        
        businessLogger.info('收到用户登录请求', { phoneNumber });
        
        // 请求参数验证
        if (!phoneNumber || !password) {
            businessLogger.warn('用户登录请求缺少必要参数');
            return res.json({
                status: 'error',
                message: '缺少必要参数：phoneNumber, password'
            });
        }

        // 验证用户
        const user = await userDB.getUserByPhoneNumber(phoneNumber);
        
        if (!user) {
            businessLogger.warn('登录失败：用户不存在', { phoneNumber });
            return res.json({
                status: 'error',
                message: '用户不存在'
            });
        }
        
        // 验证密码
        if (!user.password) {
            businessLogger.warn('登录失败：用户未设置密码', { phoneNumber });
            return res.json({
                status: 'error',
                message: '请先设置密码'
            });
        }
        
        const isValid = verifyPassword(password, user.password);
        
        if (!isValid) {
            businessLogger.warn('登录失败：密码错误', { phoneNumber });
            return res.json({
                status: 'error',
                message: '密码错误'
            });
        }
        
        businessLogger.info('用户登录成功', { phoneNumber });
        
        // 返回用户信息（不包含密码）
        const userInfo = {
            phoneNumber: user.phone,
            displayName: user.displayName || '',
            avatar: user.avatar || ''
        };
        
        return res.json({
            status: 'success',
            data: userInfo
        });
    } catch (error) {
        businessLogger.error('处理用户登录请求异常', { error: error.message, stack: error.stack });
        return res.status(500).json({
            status: 'error',
            message: '服务器内部错误'
        });
    }
});

/**
 * 设置/更新密码
 */
router.post('/setPassword', async (req, res) => {
    try {
        const { phoneNumber, password } = req.body;
        
        businessLogger.info('收到设置密码请求', { phoneNumber });
        
        // 请求参数验证
        if (!phoneNumber || !password) {
            businessLogger.warn('设置密码请求缺少必要参数');
            return res.json({
                status: 'error',
                message: '缺少必要参数：phoneNumber, password'
            });
        }
        
        // 密码强度验证（可根据需求调整）
        if (password.length < 6) {
            return res.json({
                status: 'error',
                message: '密码长度不能少于6位'
            });
        }
        
        // 查找用户
        let user = await userDB.getUserByPhoneNumber(phoneNumber);
        
        if (!user) {
            businessLogger.warn('设置密码失败：用户不存在', { phoneNumber });
            return res.json({
                status: 'error',
                message: '用户不存在'
            });
        }
        
        // 加密密码
        const hashedPassword = hashPassword(password);
        
        // 更新用户密码
        const result = await userDB.updateUserPassword(phoneNumber, hashedPassword);
        
        if (result.success) {
            businessLogger.info('用户密码设置成功', { phoneNumber });
            return res.json({
                status: 'success',
                message: '密码设置成功'
            });
        } else {
            businessLogger.error('用户密码设置失败', { phoneNumber, error: result.error });
            return res.json({
                status: 'error',
                message: '密码设置失败: ' + result.error
            });
        }
    } catch (error) {
        businessLogger.error('处理设置密码请求异常', { error: error.message, stack: error.stack });
        return res.status(500).json({
            status: 'error',
            message: '服务器内部错误'
        });
    }
});

/**
 * 微信小程序手机号解密函数
 */
function decryptPhoneNumber(encryptedData, iv, sessionKey) {
    try {
        // Base64解码
        const encryptedDataBuffer = Buffer.from(encryptedData, 'base64');
        const ivBuffer = Buffer.from(iv, 'base64');
        const sessionKeyBuffer = Buffer.from(sessionKey, 'base64');
        
        // 创建解密器
        const decipher = crypto.createDecipheriv('aes-128-cbc', sessionKeyBuffer, ivBuffer);
        decipher.setAutoPadding(true);
        
        // 解密
        let decoded = decipher.update(encryptedDataBuffer, 'binary', 'utf8');
        decoded += decipher.final('utf8');
        
        const result = JSON.parse(decoded);
        
        // 返回手机号
        return result.phoneNumber;
    } catch (error) {
        businessLogger.error('手机号解密错误', { error: error.message });
        throw new Error(`解密失败: ${error.message}`);
    }
}

/**
 * 密码哈希函数
 */
function hashPassword(password) {
    // 生成随机盐值
    const salt = crypto.randomBytes(16).toString('hex');
    
    // 使用PBKDF2进行密码哈希
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    
    // 返回格式: salt:hash
    return `${salt}:${hash}`;
}

/**
 * 密码验证函数
 */
function verifyPassword(password, storedPassword) {
    // 分离存储的盐值和哈希值
    const [salt, storedHash] = storedPassword.split(':');
    
    // 使用相同的盐值和参数计算哈希
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    
    // 比较哈希值
    return storedHash === hash;
}

module.exports = router;
