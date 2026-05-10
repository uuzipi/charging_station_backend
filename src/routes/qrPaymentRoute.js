const express = require('express');
const router = express.Router();
const { businessLogger, paymentLogger } = require('../utils/logger');
const vxpayOrderDB = require('../db/vxpayOrderDB');
const crypto = require('crypto');
const QRCode = require('qrcode');

// WxPay 延迟初始化，首次调用时才创建实例
// 只有在 src/config/wxpay.config.js 中填入真实密钥后才能正常使用微信支付
let wxpayInstance = null;
function getWxPay() {
    if (wxpayInstance) return wxpayInstance;
    const WxPay = require('wechatpay-node-v3');
    const config = require('../config/wxpay.config');
    wxpayInstance = new WxPay({
        appid: config.appId,
        mchid: config.mchId,
        publicKey: config.publicKey,
        privateKey: config.privateKey,
        secretKey: config.apiV3Key,
    });
    return wxpayInstance;
}

/**
 * 生成二维码支付页面
 * 接收 totalFee, combinedId, selectedHour 参数
 */
router.get('/page', (req, res) => {
    const { totalFee, combinedId, selectedHour } = req.query;
    
    // 验证必要参数
    if (!totalFee || !combinedId || !selectedHour) {
        return res.status(400).send('缺少必要参数: totalFee, combinedId, selectedHour');
    }
    
    // 渲染支付页面(返回HTML)
    res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>充值支付</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif;
                background-color: #f5f5f7;
                margin: 0;
                padding: 0;
                color: #1d1d1f;
            }
            .container {
                max-width: 600px;
                margin: 40px auto;
                padding: 30px;
            }
            .payment-card {
                background-color: #ffffff;
                border-radius: 18px;
                overflow: hidden;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
                margin-bottom: 40px;
            }
            .card-header {
                padding: 30px;
                border-bottom: 1px solid #f2f2f2;
            }
            .card-title {
                font-size: 22px;
                font-weight: 600;
                color: #1d1d1f;
                margin: 0;
            }
            .card-content {
                padding: 30px;
            }
            .info-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
            }
            .info-label {
                font-size: 16px;
                color: #86868b;
            }
            .info-value {
                font-size: 16px;
                color: #1d1d1f;
                font-weight: 500;
            }
            .price {
                font-size: 20px;
                font-weight: 600;
            }
            .divider {
                height: 1px;
                background-color: #f2f2f2;
                margin: 30px 0;
            }
            .qrcode-container {
                text-align: center;
                margin: 30px 0;
            }
            .qrcode-title {
                font-size: 16px;
                color: #86868b;
                margin-bottom: 20px;
            }
            #qrcode-display {
                margin: 0 auto;
                max-width: 200px;
            }
            .phone-input-container {
                margin: 30px 0;
            }
            .input-label {
                display: block;
                font-size: 16px;
                color: #1d1d1f;
                margin-bottom: 10px;
            }
            .phone-input {
                width: 100%;
                padding: 15px;
                font-size: 16px;
                border: 1px solid #d2d2d7;
                border-radius: 10px;
                margin-bottom: 20px;
                box-sizing: border-box;
            }
            .submit-button {
                background-color: #000000;
                color: #ffffff;
                font-size: 16px;
                font-weight: 500;
                border-radius: 10px;
                padding: 15px 30px;
                border: none;
                width: 100%;
                cursor: pointer;
            }
            .status-message {
                text-align: center;
                margin: 20px 0;
                padding: 10px;
                border-radius: 10px;
                display: none;
            }
            .success {
                background-color: rgba(52, 199, 89, 0.1);
                color: #34c759;
            }
            .error {
                background-color: rgba(255, 59, 48, 0.1);
                color: #ff3b30;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="payment-card">
                <div class="card-header">
                    <h1 class="card-title">支付详情</h1>
                </div>
                <div class="card-content">
                    <!-- 订单信息 -->
                    <div class="info-row">
                        <span class="info-label">充电时间</span>
                        <span class="info-value">${selectedHour}小时</span>
                    </div>
                    
                    <div class="info-row">
                        <span class="info-label">充电站</span>
                        <span class="info-value">${combinedId.split('_')[0].replace('station', '')}号站</span>
                    </div>
                    
                    <div class="info-row">
                        <span class="info-label">插座编号</span>
                        <span class="info-value">${combinedId.split('_')[1].replace('port', '')}号</span>
                    </div>
                    
                    <div class="info-row">
                        <span class="info-label">支付金额</span>
                        <span class="info-value price">¥${totalFee}</span>
                    </div>
                    
                    <div class="divider"></div>
                    
                    <!-- 手机号输入 -->
                    <div class="phone-input-container">
                        <label for="phoneNumber" class="input-label">请输入手机号</label>
                        <input type="tel" id="phoneNumber" class="phone-input" placeholder="请输入11位手机号" pattern="[0-9]{11}" required>
                    </div>
                    
                    <!-- 支付按钮 -->
                    <button id="generateQrButton" class="submit-button">生成支付二维码</button>
                    
                    <!-- 状态消息 -->
                    <div id="statusMessage" class="status-message"></div>
                    
                    <!-- 二维码显示区域 -->
                    <div class="qrcode-container" style="display: none;" id="qrCodeSection">
                        <div class="qrcode-title">请使用微信扫描二维码进行支付</div>
                        <div id="qrcode-display"></div>
                    </div>
                </div>
            </div>
        </div>
        
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                const generateQrButton = document.getElementById('generateQrButton');
                const statusMessage = document.getElementById('statusMessage');
                const qrCodeSection = document.getElementById('qrCodeSection');
                const qrcodeDisplay = document.getElementById('qrcode-display');
                const phoneInput = document.getElementById('phoneNumber');
                
                let orderNo = '';
                let checkStatusInterval;
                
                // 生成二维码按钮点击事件
                generateQrButton.addEventListener('click', function() {
                    const phoneNumber = phoneInput.value.trim();
                    
                    // 验证手机号
                    if (!/^1[3-9]\\d{9}$/.test(phoneNumber)) {
                        showMessage('请输入有效的11位手机号', 'error');
                        return;
                    }
                    
                    // 禁用按钮，防止重复点击
                    generateQrButton.disabled = true;
                    generateQrButton.textContent = '处理中...';
                    
                    // 创建支付请求
                    fetch('/api/qrpayment/create', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            phoneNumber: phoneNumber,
                            total_fee: ${totalFee},
                            combinedId: '${combinedId}',
                            selectedHour: ${selectedHour},
                            body: '充值${totalFee}元'
                        })
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.status === 'success') {
                            // 显示二维码区域
                            qrCodeSection.style.display = 'block';
                            
                            // 显示二维码
                            qrcodeDisplay.innerHTML = '<img src="' + data.data.qrCodeUrl + '" alt="支付二维码" style="max-width:100%">';
                            
                            // 保存订单号
                            orderNo = data.data.orderNo;
                            
                            // 开始轮询订单状态
                            startCheckingOrderStatus(orderNo, phoneNumber);
                            
                            showMessage('二维码已生成，请扫码支付', 'success');
                        } else {
                            showMessage('生成支付二维码失败: ' + (data.message || '未知错误'), 'error');
                            generateQrButton.disabled = false;
                            generateQrButton.textContent = '重新生成支付二维码';
                        }
                    })
                    .catch(error => {
                        showMessage('请求失败: ' + error.message, 'error');
                        generateQrButton.disabled = false;
                        generateQrButton.textContent = '重新生成支付二维码';
                    });
                });
                
                // 显示状态消息
                function showMessage(message, type) {
                    statusMessage.textContent = message;
                    statusMessage.className = 'status-message ' + type;
                    statusMessage.style.display = 'block';
                }
                
                // 开始轮询订单状态
                function startCheckingOrderStatus(orderNo, phoneNumber) {
                    // 每3秒检查一次订单状态
                    checkStatusInterval = setInterval(() => {
                        fetch('/api/qrpayment/check-status?orderNo=' + orderNo + '&phoneNumber=' + phoneNumber)
                            .then(response => response.json())
                            .then(data => {
                                if (data.status === 'success' && data.orderStatus === 'SUCCESS') {
                                    // 支付成功
                                    clearInterval(checkStatusInterval);
                                    showMessage('支付成功！正在处理订单...', 'success');
                                    
                                    // 调用创建订单和更新充电站状态的接口
                                    createOrderAndUpdateStation(phoneNumber);
                                }
                            })
                            .catch(error => {
                                console.error('检查订单状态失败:', error);
                            });
                    }, 3000);
                }
                
                // 创建订单并更新充电站状态
                function createOrderAndUpdateStation(phoneNumber) {
                    fetch('/api/create-order-update-balance', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            phoneNumber: phoneNumber,
                            totalFee: ${totalFee} * 100, // 转换为分
                            combinedId: '${combinedId}'
                        })
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            // 订单创建成功，发布消息启动充电
                            publishMessage('${combinedId}', ${selectedHour}, 1);
                            
                            showMessage('订单处理成功，充电已启动！', 'success');
                            setTimeout(() => {
                                window.location.href = '/charging/success?orderNo=' + orderNo;
                            }, 2000);
                        } else {
                            showMessage('订单处理失败: ' + (data.error || '未知错误'), 'error');
                        }
                    })
                    .catch(error => {
                        showMessage('订单处理请求失败: ' + error.message, 'error');
                    });
                }
                
                // 发布消息到MQTT
                function publishMessage(combinedId, selectedHour, Tem) {
                    fetch('/publish', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            topic: '/k214fOqXdly/Wechat/user/Wechat',
                            message: JSON.stringify({
                                combinedId: combinedId,
                                selectedHour: selectedHour,
                                Tem: Tem
                            })
                        })
                    })
                    .then(response => response.json())
                    .catch(error => {
                        console.error('发布消息失败:', error);
                    });
                }
            });
        </script>
    </body>
    </html>
    `);
});

/**
 * 生成二维码支付
 * 接收手机号、金额等信息生成支付二维码
 */
router.post('/create', async (req, res) => {
    try {
        const { phoneNumber, total_fee, body, combinedId, selectedHour } = req.body;
        
        businessLogger.info('收到二维码支付创建请求', { 
            phoneNumber, 
            total_fee,
            combinedId,
            selectedHour
        });
        
        // 验证必要参数
        if (!total_fee || !phoneNumber) {
            return res.json({
                status: 'error',
                message: '缺少必要参数: total_fee, phoneNumber'
            });
        }
        
        // 检查用户是否存在，不存在则创建新用户
        try {
            await vxpayOrderDB.createUserIfNotExists(phoneNumber);
        } catch (userError) {
            businessLogger.error('用户检查/创建失败', { 
                phoneNumber, 
                error: userError.message 
            });
            // 继续处理支付，不因用户创建失败而中断支付流程
        }
        
        // 生成随机订单号
        const out_trade_no = crypto.randomBytes(16).toString('hex');
        
        // 生成当前北京时间
        const beijingNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
        
        // 预创建订单记录
        await vxpayOrderDB.preCreateOrder({
            orderNo: out_trade_no,
            phoneNumber: phoneNumber,
            totalFee: parseInt(total_fee * 100), // 转换为分
            description: body || '充值',
            status: 'PENDING',
            createdAt: beijingNow,
            combinedId: combinedId,
            selectedHour: selectedHour
        });
        
        businessLogger.info('生成订单号', { out_trade_no, phoneNumber });
        
        // 构建支付参数
        const payParams = {
            appid: config.appId,
            mchid: config.mchId,
            description: body || '充值',
            out_trade_no: out_trade_no,
            notify_url: config.domain,
            amount: {
                total: parseInt(total_fee * 100), // 转换为分
                currency: 'CNY'
            },
            scene_info: {
                payer_client_ip: req.ip
            }
        };
        
        // 调用微信支付API生成支付二维码
        const result = await getWxPay().transactions_native(payParams);
        
        if (!result || result.status !== 200) {
            throw new Error(result?.message || '创建支付二维码失败');
        }
        
        // 获取支付二维码链接
        const codeUrl = result.data.code_url;
        
        // 生成二维码图片的 data URL
        const qrCodeUrl = await QRCode.toDataURL(codeUrl);
        
        return res.json({
            status: 'success',
            data: {
                orderNo: out_trade_no,
                codeUrl: codeUrl,
                qrCodeUrl: qrCodeUrl
            }
        });
    } catch (error) {
        businessLogger.error('创建二维码支付失败', { error: error.message, stack: error.stack });
        return res.status(500).json({ 
            status: 'error', 
            message: error.message 
        });
    }
});

/**
 * 检查订单支付状态
 */
router.get('/check-status', async (req, res) => {
    try {
        const { orderNo, phoneNumber } = req.query;
        
        if (!orderNo || !phoneNumber) {
            return res.status(400).json({
                status: 'error',
                message: '缺少必要参数: orderNo, phoneNumber'
            });
        }
        
        // 从数据库中查询订单状态
        const order = await vxpayOrderDB.getOrderByOrderNo(orderNo);
        
        if (!order) {
            return res.json({
                status: 'error',
                message: '订单不存在'
            });
        }
        
        return res.json({
            status: 'success',
            orderStatus: order.status,
            orderData: {
                orderNo: order.orderNo,
                totalFee: order.totalFee,
                createdAt: order.createdAt,
                status: order.paymentStatus//paymentStatus才是真实的支付状态
            }
        });
    } catch (error) {
        businessLogger.error('检查订单状态失败', { error: error.message });
        return res.status(500).json({
            status: 'error',
            message: '服务器内部错误'
        });
    }
});

/**
 * 支付成功后的跳转页面
 */
router.get('/success', (req, res) => {
    const { orderNo } = req.query;
    
    res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>支付成功</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif;
                background-color: #f5f5f7;
                margin: 0;
                padding: 0;
                color: #1d1d1f;
                text-align: center;
            }
            .container {
                max-width: 600px;
                margin: 80px auto;
                padding: 40px 30px;
                background-color: #ffffff;
                border-radius: 18px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
            }
            .success-icon {
                font-size: 80px;
                color: #34c759;
                margin-bottom: 30px;
            }
            .title {
                font-size: 24px;
                font-weight: 600;
                margin-bottom: 20px;
            }
            .message {
                font-size: 16px;
                color: #86868b;
                margin-bottom: 40px;
            }
            .order-info {
                background-color: #f5f5f7;
                padding: 20px;
                border-radius: 10px;
                margin-bottom: 30px;
                text-align: left;
            }
            .label {
                font-size: 14px;
                color: #86868b;
            }
            .value {
                font-size: 16px;
                color: #1d1d1f;
                font-weight: 500;
                margin-bottom: 10px;
            }
            .button {
                background-color: #000000;
                color: #ffffff;
                font-size: 16px;
                font-weight: 500;
                border-radius: 10px;
                padding: 15px 30px;
                border: none;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="success-icon">✓</div>
            <h1 class="title">支付成功</h1>
            <p class="message">您的充电已开始，感谢您的使用</p>
            
            <div class="order-info">
                <div class="label">订单号</div>
                <div class="value">${orderNo}</div>
            </div>
            
            <a href="/" class="button">返回首页</a>
        </div>
    </body>
    </html>
    `);
});

module.exports = router; 