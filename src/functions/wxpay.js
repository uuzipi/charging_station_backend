const WxPay = require('wechatpay-node-v3');
const config = require('../config/wxpay.config');
const { businessLogger, paymentLogger } = require('../utils/logger');
const https = require('https');
const vxpayOrderDB = require('../db/vxpayOrderDB');

const wxpay = new WxPay({
    appid: config.appId,
    mchid: config.mchId,
    publicKey: config.publicKey,
    privateKey: config.privateKey,
    secretKey: config.apiV3Key,
});
/*
期望参数
{
    openid: 'o1234567890',
    total_fee: 100,单位元
    body: '充值',
    phoneNumber: '13800138000'
}
*/
const createPayment = async (req, res) => {
    try {
        paymentLogger.info('收到创建支付请求', { body: req.body });
        const { openid, total_fee, body, phoneNumber } = req.body;
//这里去掉了必要openid(小程序需要)
        if (!total_fee || !phoneNumber) {
            return res.json({
                status: 'error',
                message: '缺少必要参数'
            });
        }

        // 先检查用户是否存在，不存在则创建新用户
        try {
            // 使用vxpayOrderDB模块中的方法检查并创建用户
            const user = await vxpayOrderDB.createUserIfNotExists(phoneNumber, openid);
            paymentLogger.info('用户检查/创建结果', { 
                phoneNumber, 
                userId: user._id,
                isNewUser: user.isNewUser || false
            });
        } catch (userError) {
            paymentLogger.error('用户检查/创建失败', { 
                phoneNumber, 
                error: userError.message 
            });
            // 继续处理支付，不因用户创建失败而中断支付流程
        }
        //北京时间(3.26检查到有问题,已修改)
        const beijingNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
        // 生成完全随机的订单号
        const crypto = require('crypto');
        const out_trade_no = crypto.randomBytes(16).toString('hex');
        
        // 在vxpayOrders集合中预创建订单记录
        await vxpayOrderDB.preCreateOrder({
            orderNo: out_trade_no,
            phoneNumber: phoneNumber,
            openid: openid,
            totalFee: parseInt(total_fee * 100), // 转换为分
            description: body || '充值',
            status: 'PENDING',
            createdAt: beijingNow
        });
        
        paymentLogger.info('生成订单号', { out_trade_no, phoneNumber });

        const payParams = {
            appid: config.appId,
            mchid: config.mchId,
            description: body || '充值',
            out_trade_no: out_trade_no,
            notify_url: config.domain,
            amount: {
                total: parseInt(total_fee * 100),
                currency: 'CNY'
            },
            payer: {
                openid: openid
            }
        };

        paymentLogger.info('调用transactions_jsapi前的参数', { payParams });
        //微信官方的统一下单接口
        const result = await wxpay.transactions_jsapi(payParams);
        paymentLogger.info('transactions_jsapi返回完整结果', { result });

        if (!result || result.status !== 200) {
            throw new Error(result?.message || '统一下单请求失败');
        }

        const resultData = result.data;
        paymentLogger.info('提取的 result.data', { resultData });

        // 从 package 中提取 prepay_id
        const packageValue = resultData.package;
        if (!packageValue || !packageValue.startsWith('prepay_id=')) {
            throw new Error(`未获取到有效的 prepay_id，返回数据: ${JSON.stringify(resultData)}`);
        }
        const prepay_id = packageValue.split('=')[1];

        const nonceStr = Math.random().toString(36).slice(2, 15);
        const timeStamp = Math.floor(Date.now() / 1000).toString();
        const message = `${config.appId}\n${timeStamp}\n${nonceStr}\nprepay_id=${prepay_id}\n`;
        const paySign = wxpay.sign(message);

        const paymentData = {
            appId: config.appId,
            timeStamp,
            nonceStr,
            package: `prepay_id=${prepay_id}`,
            signType: 'RSA',
            paySign,
            out_trade_no
        };

        paymentLogger.info('生成支付参数成功', {
            out_trade_no,
            phoneNumber,
            total_fee,
            paymentData
        });

        return res.json({
            status: 'success',
            data: paymentData
        });
    } catch (error) {
        paymentLogger.error('创建支付失败', { error: error.message, stack: error.stack });
        return res.status(500).json({ error: error.message });
    }
};

// 支付回调处理
const paymentNotify = async (req, res) => {
    paymentLogger.info('收到支付回调请求');

    try {
        const rawData = req.body;
        paymentLogger.info('原始回调数据', { rawData });

        const headers = {
            'Wechatpay-Signature': req.headers['wechatpay-signature'],
            'Wechatpay-Timestamp': req.headers['wechatpay-timestamp'],
            'Wechatpay-Nonce': req.headers['wechatpay-nonce'],
            'Wechatpay-Serial': req.headers['wechatpay-serial'],
        };

        const result = await wxpay.decipher_gcm(
            rawData.resource.ciphertext,
            rawData.resource.associated_data,
            rawData.resource.nonce,
            config.apiV3Key
        );

        paymentLogger.info('解密后的回调数据', { result });

        if (result.trade_state === 'SUCCESS') {
            // 处理订单创建时间
            const orderTimestamp = parseInt(result.out_trade_no.split('_')[0]);
            const createDateTime = new Date(orderTimestamp + 8 * 60 * 60 * 1000);

            const now = new Date();
            const timeDiff = now - createDateTime;
            const hoursDiff = timeDiff / (1000 * 60 * 60);

            if (hoursDiff > 24) {
                paymentLogger.warn('收到过期回调（超过24小时）', {
                    out_trade_no: result.out_trade_no,
                    createTime: createDateTime,
                    timeDiff: `${hoursDiff.toFixed(2)}小时`
                });
            }

            // V3的success_time格式为RFC3339 (如 "2023-10-01T12:00:00+08:00")
            const successTime = new Date(result.success_time);
            
            // 从vxpayOrders集合中查找预创建的订单记录
            const preOrder = await vxpayOrderDB.getOrderByOrderNo(result.out_trade_no);
            
            if (!preOrder) {
                paymentLogger.error('未找到预创建的订单记录', { out_trade_no: result.out_trade_no });
                return res.json({ code: 'FAIL', message: '未找到订单记录' });
            }
            
            // 获取手机号
            const phoneNumber = preOrder.phoneNumber;
            const amount = parseInt(result.amount.total) / 100; // 转换为元

            // 构建支付回调提供的订单数据(这里用来修改用于余额和订单数据)
            const orderData = {
                orderNo: result.out_trade_no,
                phoneNumber: phoneNumber,
                totalFee: parseInt(result.amount.total)*100, // 保持分为单位(4.14测试阶段改为1:100)
                transactionId: result.transaction_id,
                payTime: successTime,
                status: 'SUCCESS',
                openid: result.payer.openid,
                description: preOrder.description || '充值'
            };

            // 使用 vxpayOrderDB 模块保存订单到vxpayOrders集合并更新用户余额
            const saveResult = await vxpayOrderDB.saveVxPaymentData(orderData);

            if (saveResult.success) {
                paymentLogger.info('微信支付订单信息已保存', { 
                    orderNo: orderData.orderNo, 
                    orderId: saveResult.orderId 
                });
                
            } else {
                paymentLogger.error('保存微信支付订单信息失败', { 
                    orderNo: orderData.orderNo, 
                    error: saveResult.error 
                });
            }

            return res.json({ code: 'SUCCESS', message: 'OK' });
        } else {
            paymentLogger.error('支付结果不成功', { trade_state: result.trade_state });
            return res.json({ code: 'FAIL', message: '支付失败' });
        }
    } catch (error) {
        paymentLogger.error('回调处理错误', { error: error.message });
        return res.status(500).json({ code: 'FAIL', message: '处理失败' });
    }
};

// 获取openid
const getOpenid = async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.json({
                status: 'error',
                message: '缺少code参数'
            });
        }

        const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.appId}&secret=${config.appSecret}&js_code=${code}&grant_type=authorization_code`;

        const data = await new Promise((resolve, reject) => {
            https.get(url, (resp) => {
                let data = '';
                resp.on('data', (chunk) => { data += chunk; });
                resp.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        if (data.errcode) {
            throw new Error(data.errmsg);
        }

        return res.json({
            status: 'success',
            data: { 
                openid: data.openid,
                session_key: data.session_key  // 增加返回 session_key
            }
        });
    } catch (error) {
        businessLogger.error('获取openid失败', { error: error.message });
        return res.json({
            status: 'error',
            message: error.message
        });
    }
};

// --- 新增的vxpay订单查询控制器函数 ---
/**
 * 控制器函数：查询指定手机号的成功微信支付订单
 * @param {Object} req - Express Request 对象
 * @param {Object} res - Express Response 对象
 */
const querySuccessfulOrdersByPhone = async (req, res) => {
    const phoneNumber = req.query.phone; // 从查询参数获取手机号

    // 输入验证
    if (!phoneNumber) {
        paymentLogger.warn('查询成功订单请求缺少手机号参数');
        return res.status(400).json({
            success: false,
            message: '请求参数错误，请提供手机号 (phone)。'
        });
    }

    paymentLogger.info(`收到查询成功订单请求，手机号: ${phoneNumber}`);

    try {
        // 调用数据库层函数执行查询
        const orders = await vxpayOrderDB.getSuccessfulOrdersByPhoneNumber(phoneNumber);

        paymentLogger.info(`成功为手机号 ${phoneNumber} 查询到 ${orders.length} 条成功订单记录`);
        // 构造成功响应
        res.status(200).json({
            success: true,
            message: orders.length > 0 ? `查询成功，找到 ${orders.length} 条记录。` : '未找到该手机号的成功充值记录。',
            data: orders // 返回订单数组
        });

    } catch (error) {
        // 捕获数据库或其他流程中的错误
        paymentLogger.error(`处理查询手机号 ${phoneNumber} 成功订单的请求时出错`, {
            error: error.message,
            stack: error.stack // 记录堆栈信息以便调试
        });
        // 发送服务器内部错误响应
        res.status(500).json({
            success: false,
            message: '服务器内部错误，查询订单失败。',
            // 注意：生产环境中不建议直接暴露 error.message 给客户端
            // error: error.message
        });
    }
};

module.exports = {
    //4.6检查
    createPayment,//前端在使用,收到用户创建支付请求,进行订单预创建,调用预创建函数进行订单创建
    paymentNotify,//前端在使用,处理接收到支付回调后的信息处理
    getOpenid,//前端在使用,提供给用户向微信官方进行openid的获取,是进行微信支付的必要条件
    querySuccessfulOrdersByPhone//前端在使用,传入手机号查询已完成的函数(4.6新增)
};