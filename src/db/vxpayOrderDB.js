const { client } = require('../config/config');
const { ObjectId } = require('mongodb');
const { paymentLogger } = require('../utils/logger');

/**
 * 创建新用户
 * @param {String} phoneNumber - 用户手机号
 * @param {Number} [balanceInCents=0] - 用户初始余额（单位：分）
 * @returns {Object} - 创建的用户对象
 */
const createUser = async (phoneNumber, balanceInCents = 0) => {
    try {
        const database = client.db("Test");
        const userCollection = database.collection("users");
        
        // 检查用户是否已存在
        const existingUser = await userCollection.findOne({ phone: phoneNumber });
        if (existingUser) {
            return existingUser;
        }
        
        // 创建新用户，直接存储分
        const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // 北京时间
        const newUser = {
            phone: phoneNumber,
            balanceInCents: balanceInCents, // 直接存储分
            createdAt: now,
            currency: "CNY",
            devices: [],
            updatedAt: now
        };
        
        const result = await userCollection.insertOne(newUser);
        
        paymentLogger.info('创建新用户成功', { 
            phoneNumber, 
            balance: (balanceInCents / 100).toFixed(2), // 保留两位小数
            userId: result.insertedId 
        });
        
        return {
            ...newUser,
            _id: result.insertedId
        };
    } catch (error) {
        paymentLogger.error('创建用户失败', { 
            phoneNumber, 
            error: error.message 
        });
        throw error;
    }
};

/**
 * 保存微信支付回调数据到vxpayOrders集合
 * @param {Object} paymentData - 微信支付回调数据
 * @returns {Object} - 操作结果
 */
const saveVxPaymentData = async (paymentData) => {
    try {
        const database = client.db("Test");
        const collection = database.collection("vxpayOrders");
        
        // 查找用户以获取用户ID，如果不存在则创建
        const userCollection = database.collection("users");
        let user = await userCollection.findOne({ phone: paymentData.phoneNumber });
        
        if (!user) {
            // 用户不存在，创建新用户，并将支付金额作为初始余额
            paymentLogger.info(`用户 ${paymentData.phoneNumber} 不存在，正在创建新用户`);
            user = await createUser(paymentData.phoneNumber, paymentData.totalFee);
        } else {

            
            // 用户已存在，更新余额（使用分）
            const oldBalanceInCents = user.balanceInCents;
            const newBalanceInCents = oldBalanceInCents + paymentData.totalFee;
            
            await userCollection.updateOne(
                { _id: user._id },
                { 
                    $set: { 
                        balanceInCents: newBalanceInCents,
                        updatedAt: new Date(Date.now() + 8 * 60 * 60 * 1000) // 北京时间
                    } 
                }
            );
            
            paymentLogger.info(`用户 ${paymentData.phoneNumber} 余额已更新`, {
                oldBalance: (oldBalanceInCents / 100).toFixed(2), // 保留两位小数
                addAmount: (paymentData.totalFee / 100).toFixed(2), // 保留两位小数
                newBalance: (newBalanceInCents / 100).toFixed(2) // 保留两位小数
            });
            
            // 更新本地user对象的余额
            user.balanceInCents = newBalanceInCents;
        }

        // 转换时间为北京时间
        const beijingPayTime = new Date(paymentData.payTime.getTime() + 8 * 60 * 60 * 1000);
        const beijingNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
        
        // 使用 orderNo 进行查询
        const existingOrder = await collection.findOne({ orderNo: paymentData.orderNo });
        
        if (existingOrder) {
            // 如果订单已存在，更新支付信息
            const updateResult = await collection.updateOne(
                { orderNo: paymentData.orderNo },
                { 
                    $set: {
                        paymentStatus: 'SUCCESS',
                        payTime: beijingPayTime,
                        transactionId: paymentData.transactionId,
                        totalFee: paymentData.totalFee,
                        openid: paymentData.openid,
                        updatedAt: beijingNow
                    }
                }
            );
            
            paymentLogger.info('更新微信支付订单信息成功', { 
                orderNo: paymentData.orderNo,
                updated: true 
            });
            
            return {
                success: true,
                orderId: existingOrder._id,
                updated: true
            };
        } else {
            // 如果是新订单，创建新的支付记录
            const orderDoc = {
                userId: user._id,  // 关联用户ID
                phoneNumber: paymentData.phoneNumber,
                orderNo: paymentData.orderNo,
                totalFee: paymentData.totalFee,
                payTime: beijingPayTime,
                paymentStatus: 'SUCCESS',
                openid: paymentData.openid,
                transactionId: paymentData.transactionId,
                description: paymentData.description || '充值',
                time_end: paymentData.time_end,
                updatedAt: beijingNow
            };
            
            const result = await collection.insertOne(orderDoc);
            
            paymentLogger.info('创建新微信支付订单信息成功', { 
                orderNo: paymentData.orderNo,
                orderId: result.insertedId 
            });
            
            return {
                success: true,
                orderId: result.insertedId,
                created: true
            };
        }
    } catch (error) {
        paymentLogger.error('保存微信支付订单信息失败', { 
            error: error.message,
            stack: error.stack 
        });
        
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * 检查用户是否存在，不存在则创建新用户
 * @param {String} phoneNumber - 用户手机号
 * @param {String} openid - 微信openid
 * @returns {Object} - 用户对象
 */
const createUserIfNotExists = async (phoneNumber, openid) => {
    try {
        const database = client.db("Test");
        const userCollection = database.collection("users");
        
        // 检查用户是否已存在
        const existingUser = await userCollection.findOne({ phone: phoneNumber });
        if (existingUser) {
            // 如果用户存在但没有openid，更新openid
            if (!existingUser.openid && openid) {
                await userCollection.updateOne(
                    { _id: existingUser._id },
                    { $set: { openid: openid, updatedAt: new Date() } }
                );
                
                paymentLogger.info('更新用户openid', { 
                    phoneNumber, 
                    userId: existingUser._id,
                    openid
                });
            }
            
            return existingUser;
        }
        
        // 创建新用户，初始余额为0
        const now = new Date(Date.now() + 8 * 60 * 60 * 1000); // 北京时间
        const newUser = {
            phone: phoneNumber,
            openid: openid,
            balanceInCents: 0, // 初始余额为0分
            createdAt: now,
            currency: "CNY",
            devices: [],
            updatedAt: now
        };
        
        const result = await userCollection.insertOne(newUser);
        
        paymentLogger.info('创建新用户成功', { 
            phoneNumber, 
            openid,
            userId: result.insertedId,
            isNewUser: true
        });
        
        return {
            ...newUser,
            _id: result.insertedId,
            isNewUser: true
        };
    } catch (error) {
        paymentLogger.error('创建/检查用户失败', { 
            phoneNumber, 
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
};

/**
 * 在vxpayOrders集合中预创建订单记录
 * @param {Object} orderData - 订单数据
 * @returns {Object} - 创建结果
 */
const preCreateOrder = async (orderData) => {
    try {
        const database = client.db("Test");
        const collection = database.collection("vxpayOrders");
        
        const result = await collection.insertOne(orderData);
        
        paymentLogger.info('预创建订单成功', { 
            orderNo: orderData.orderNo, 
            phoneNumber: orderData.phoneNumber,
            orderId: result.insertedId
        });
        
        return {
            success: true,
            orderId: result.insertedId
        };
    } catch (error) {
        paymentLogger.error('预创建订单失败', { 
            orderNo: orderData.orderNo,
            phoneNumber: orderData.phoneNumber,
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
};

/**
 * 根据订单号获取订单
 * @param {String} orderNo - 订单号
 * @returns {Object} - 订单对象
 */
const getOrderByOrderNo = async (orderNo) => {
    try {
        const database = client.db("Test");
        const collection = database.collection("vxpayOrders");
        
        return await collection.findOne({ orderNo });
    } catch (error) {
        paymentLogger.error('获取订单失败', { 
            orderNo,
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
};

/**
 * 4.6根据手机号查询成功的充值订单
 * @param {String} phoneNumber - 用户手机号
 * @returns {Array<Object>} - 成功的充值订单数组
 */
const getSuccessfulOrdersByPhoneNumber = async (phoneNumber) => {
    try {
        const database = client.db("Test"); // 确保数据库名称正确
        const collection = database.collection("vxpayOrders"); // 确集合名称正确

        // 构建查询条件：匹配手机号且支付状态为 SUCCESS
        const query = {
            phoneNumber: phoneNumber,
            paymentStatus: 'SUCCESS' // 关键条件：只查找成功的订单
        };

        // 执行查询，返回匹配的所有文档组成的数组
        const orders = await collection.find(query).toArray();

        if (orders.length > 0) {
            paymentLogger.info(`成功查询到用户 ${phoneNumber} 的 ${orders.length} 条成功充值订单`);
        } else {
            // 即使没找到也记录一下，方便追踪
            paymentLogger.info(`未找到用户 ${phoneNumber} 的成功充值订单`);
        }

        return orders; // 返回找到的订单数组（可能为空数组）

    } catch (error) {
        paymentLogger.error('根据手机号查询成功充值订单失败', {
            phoneNumber,
            error: error.message,
            stack: error.stack
        });
        throw error; // 将错误向上抛出，以便路由处理器可以捕获并响应
    }
};



module.exports = {
    //25.4.6检查 注:这里文件都是供wxpay.js调用的
    saveVxPaymentData,//在使用,接收支付完成后的回调,进行微信支付订单信息的更新,把标志更新为success,以及用户余额的更新
    createUser,//在使用,传入手机号和初始余额(默认为0)进行用户创建,现在提供给下面检查创建用户函数使用
    createUserIfNotExists,//在使用,先检查用户是否存在,用户不存在时进行用户创建
    preCreateOrder,//在使用,预创建订单,用户创建支付(不管是否接收到回调),主要标志是状态为pending
    getOrderByOrderNo,//暂未使用,传入微信支付官方的订单号进行查询
    getSuccessfulOrdersByPhoneNumber //在使用,传入手机号查询已完成的函数
};