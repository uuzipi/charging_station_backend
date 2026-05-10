const { client } = require('../config/config');
const { ObjectId } = require('mongodb');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { businessLogger, paymentLogger } = require('../utils/logger');
const chargingDB = require('./chargingDB'); // 引入chargingDB模块
const deviceMonitor = require('../utils/deviceMonitor'); // 引入设备监控模块
const mqttClient = global.mqttClient; // 引入全局MQTT客户端

/**
 * 生成随机订单号
 * @returns {String} - 随机订单号
 */
const generateRandomOrderNo = () => {
    return crypto.randomBytes(16).toString('hex');
};

/**
 * 创建充电订单并扣减用户余额
 * @param {Object} orderData - 订单数据，包含phoneNumber(手机号)、totalFee(金额，单位分)
 * @param {String} combinedId - 充电站和端口的组合ID，格式为"stationId_portId"
 * @returns {Object} - 操作结果，包含success(成功状态)、orderId(订单ID)、orderNo(订单号)、userBalance(更新后的用户余额)
 */
const createOrUpdatePaymentOrder = async (orderData, combinedId = '') => {
    try {
        const database = client.db("Test");
        const collection = database.collection("orders");
        const userCollection = database.collection("users");
        
        // 从combinedId中解析stationId和portId
        let stationId = '';
        let portId = '';
        
        if (combinedId && combinedId.includes('_')) {
            const parts = combinedId.split('_');
            stationId = parts[0] || '';
            portId = parts[1] || '';
        }
        
        // 查找用户
        let user = await userCollection.findOne({ phone: orderData.phoneNumber });
        
        if (!user) {
            throw new Error(`未找到手机号为 ${orderData.phoneNumber} 的用户`);
        }
        
        // 更新用户余额(扣除金额)，直接使用分作为单位
        const oldBalanceInCents = user.balanceInCents;
        const newBalanceInCents = oldBalanceInCents - orderData.totalFee;
        
        await userCollection.updateOne(
            { _id: user._id },
            { 
                $set: { 
                    balanceInCents: newBalanceInCents,
                    updatedAt: new Date(Date.now() + 8 * 60 * 60 * 1000) // 北京时间
                } 
            }
        );
        
        businessLogger.info(`用户 ${orderData.phoneNumber} 余额已更新`, {
            oldBalance: (oldBalanceInCents / 100).toFixed(2), // 保留两位小数
            subtractAmount: (orderData.totalFee / 100).toFixed(2), // 保留两位小数
            newBalance: (newBalanceInCents / 100).toFixed(2) // 保留两位小数
        });

        // 在后端生成北京时间
        const beijingNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
        
        // 生成随机订单号
        const orderNo = generateRandomOrderNo();
        
        // 创建新订单
        console.log('创建新订单:', orderNo);
        const orderDoc = {
            userId: user._id,                // 用户ID，关联到users集合
            phoneNumber: orderData.phoneNumber, // 用户手机号
            orderNo: orderNo,                // 随机生成的订单号
            totalFee: orderData.totalFee,    // 支付金额，单位为分
            refundFee: 0,                    // 退款金额，初始为0
            payTime: beijingNow,             // 支付时间（北京时间），直接使用当前时间
            status: '进行中',                 // 订单状态：进行中、已完成、已取消等
            chargingInfo: {                  // 充电相关信息
                stationId: stationId,        // 从combinedId解析的充电站ID
                portId: portId,              // 从combinedId解析的充电端口ID
                combinedId: combinedId,      // 直接使用传入的combinedId
                duration: 0,                 // 充电时长（秒）
                startTime: beijingNow,       // 充电开始时间（北京时间），直接使用当前时间
                endTime: null,               // 充电结束时间，初始为null
                totalPower: 0,               // 总充电量（度）
                chargingPower: 0             // 充电功率（瓦）
            },
            updatedAt: beijingNow            // 记录更新时间（北京时间）
        };
        
        const result = await collection.insertOne(orderDoc);
        
        // 更新充电桩状态为running(4.17)
        if (combinedId) {
            // 准备更新对象，包含状态和预计充电时间（如果有的话）
            const updates = {
                status: 'running'
            };
            
            // 如果订单数据中包含预计充电时间（小时），添加到更新对象中
            if (orderData.estimatedHours) {
                updates.estimatedHours = orderData.estimatedHours;
            }
            
            // 调用chargingDB的updateStation方法更新充电桩状态
            const updateResult = await chargingDB.updateStation(combinedId, updates);
            
            if (!updateResult.success) {
                console.warn(`订单创建成功，但更新充电桩状态失败: ${updateResult.error || '未知错误'}`);
                businessLogger.warn(`订单${orderNo}创建成功，但更新充电桩${combinedId}状态失败`, {
                    error: updateResult.error || '未知错误'
                });
            } else {
                console.log(`已将充电桩 ${combinedId} 状态更新为运行中`);
                businessLogger.info(`已将充电桩 ${combinedId} 状态更新为运行中，关联订单: ${orderNo}`);
                
                // 启动单个设备监控 (新增)
                if (global.mqttClient) {
                    // 启动设备监控，使用MQTT客户端的检查方法
                    deviceMonitor.startDeviceMonitoring(combinedId, (deviceId) => {
                        if (global.mqttClient) {
                            global.mqttClient.checkSingleDevicePower(deviceId)
                                .then(result => {
                                    if (result.action === 'reset') {
                                        // 如果设备被重置为空闲状态，检查订单状态并进行更新
                                        checkAndUpdateOrderStatus(deviceId);
                                    }
                                })
                                .catch(err => {
                                    console.error(`设备 ${deviceId} 检查出错:`, err);
                                });
                        }
                    });
                    
                    businessLogger.info(`已为充电桩 ${combinedId} 启动单独监控，关联订单: ${orderNo}`);
                    console.log(`已为充电桩 ${combinedId} 启动单独监控`);
                } else {
                    console.warn('MQTT客户端未初始化，无法启动设备监控');
                    businessLogger.warn(`MQTT客户端未初始化，无法为充电桩 ${combinedId} 启动监控`);
                }
            }
        } else {
            console.warn('订单创建成功，但未提供有效的combinedId，无法更新充电桩状态');
        }
        
        return {
            success: true,
            orderId: result.insertedId,
            orderNo: orderNo,
            userBalance: (newBalanceInCents / 100).toFixed(2) // 保留两位小数
        };
    } catch (error) {
        console.error('创建订单并更新余额失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * 检查并更新订单状态
 * @param {String} combinedId - 充电站和端口的组合ID
 */
const checkAndUpdateOrderStatus = async (combinedId) => {
    try {
        const database = client.db("Test");
        const ordersCollection = database.collection("orders");
        
        // 查询与该设备关联的进行中订单
        const order = await ordersCollection.findOne({
            status: '进行中',
            'chargingInfo.combinedId': combinedId
        });
        
        if (!order) {
            // 没有找到关联的订单，停止设备监控
            deviceMonitor.stopDeviceMonitoring(combinedId);
            businessLogger.info(`设备 ${combinedId} 无关联进行中订单，停止监控`);
            return;
        }
        
        // 检查充电桩当前状态
        const stationInfo = await chargingDB.getStationInfo(combinedId);
        
        if (!stationInfo.success || stationInfo.data.status !== 'idle') {
            // 设备状态未更新为空闲，继续监控
            return;
        }
        
        // 北京时间
        const currentTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
        
        // 计算退款金额（如果有的话）
        let refundFeeCents = 0;
        if (stationInfo.data.estimatedDuration && stationInfo.data.estimatedDuration > 0) {
            // 计算已用时间比例
            const usedRatio = stationInfo.data.runningTime / stationInfo.data.estimatedDuration;
            
            // 如果使用未满，计算退款金额
            if (usedRatio < 1) {
                refundFeeCents = Math.round(order.totalFee * (1 - usedRatio));
            }
        }
        
        // 更新订单状态为已完成
        const updateResult = await ordersCollection.updateOne(
            { _id: order._id },
            {
                $set: {
                    status: '已完成',
                    refundFee: refundFeeCents,
                    'chargingInfo.endTime': currentTime,
                    updatedAt: currentTime
                }
            }
        );
        
        if (updateResult.modifiedCount > 0) {
            businessLogger.info(`订单 ${order.orderNo} 已自动完成`, {
                deviceId: combinedId,
                refundAmount: (refundFeeCents / 100).toFixed(2)
            });
            
            // 如果有退款，增加用户余额
            if (refundFeeCents > 0) {
                try {
                    const { addToBalance } = require('./balanceDB');
                    const newBalance = await addToBalance(order.phoneNumber, refundFeeCents);
                    businessLogger.info(`已为用户 ${order.phoneNumber} 退款 ${refundFeeCents / 100} 元，新余额为 ${newBalance} 元`);
                } catch (error) {
                    businessLogger.error(`退款到余额失败: ${error.message}`);
                }
            }
        }
        
        // 停止设备监控
        deviceMonitor.stopDeviceMonitoring(combinedId);
        businessLogger.info(`设备 ${combinedId} 关联订单已完成，停止监控`);
        
    } catch (error) {
        console.error(`检查并更新订单状态失败:`, error);
        businessLogger.error(`检查并更新设备 ${combinedId} 关联订单状态失败:`, {
            error: error.message,
            stack: error.stack
        });
    }
};

// 查询订单
const queryOrders = async (query = {}, options = {}) => {
    try {
        const database = client.db("Test");
        const collection = database.collection("orders");
        
        // 设置默认分页选项
        const page = options.page || 1;
        const limit = options.limit || 10;
        const skip = (page - 1) * limit;
        
        // 构建查询条件
        const queryCondition = {};
        
        if (query.orderNo) {
            queryCondition.orderNo = query.orderNo;
        }
        
        if (query.phoneNumber) {
            queryCondition.phoneNumber = query.phoneNumber;
        }
        
        if (query.userId) {
            queryCondition.userId = new ObjectId(query.userId);
        }
        
        if (query.status) {
            queryCondition.status = query.status;
        }
        
        if (query.startDate && query.endDate) {
            queryCondition.payTime = {
                $gte: new Date(query.startDate),
                $lte: new Date(query.endDate)
            };
        }
        
        // 获取总数
        const total = await collection.countDocuments(queryCondition);
        
        // 查询订单并排序
        const orders = await collection.find(queryCondition)
            .sort({ payTime: -1 })  // 按支付时间降序排序
            .skip(skip)
            .limit(limit)
            .toArray();
        
        return {
            success: true,
            data: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
                orders
            }
        };
    } catch (error) {
        console.error('查询订单失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// 获取订单详情
const getOrderDetail = async (orderNo) => {
    try {
        const database = client.db("Test");
        const collection = database.collection("orders");
        
        const order = await collection.findOne({ orderNo });
        
        if (!order) {
            return {
                success: false,
                error: '订单不存在'
            };
        }
        
        return {
            success: true,
            data: order
        };
    } catch (error) {
        console.error('获取订单详情失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// 更新订单状态
const updateOrderStatus = async (orderNo, status, additionalData = {}) => {
    try {
        const database = client.db("Test");
        const collection = database.collection("orders");
        
        const updateData = {
            $set: {
                status,
                updatedAt: new Date(),
                ...additionalData
            }
        };
        
        const result = await collection.findOneAndUpdate(
            { orderNo },
            updateData,
            { returnDocument: 'after' }
        );
        
        if (!result) {
            return {
                success: false,
                error: '订单不存在'
            };
        }
        
        return {
            success: true,
            data: result
        };
    } catch (error) {
        console.error('更新订单状态失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/*
    3.15创建
    只传入phoneNumber，返回进行中的订单
 */
// 获取进行中订单
const getActiveOrders = async (phoneNumber, options = {}) => {
    try {
        const database = client.db("Test");
        const collection = database.collection("orders");
        
        // 设置默认分页选项
        const page = options.page || 1;
        const limit = options.limit || 10;
        const skip = (page - 1) * limit;
        
        // 构建查询条件 - 只查询进行中的订单
        const queryCondition = {
            phoneNumber: phoneNumber,
            status: "进行中"
        };
        
        // 获取总数
        const total = await collection.countDocuments(queryCondition);
        
        // 查询订单并排序
        const orders = await collection.find(queryCondition)
            .sort({ payTime: -1 })  // 按支付时间降序排序
            .skip(skip)
            .limit(limit)
            .toArray();
        
        return {
            success: true,
            data: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
                orders
            }
        };
    } catch (error) {
        console.error('查询进行中订单失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
};
/**
 * 获取指定用户的已完成订单，并返回总数
 * @param {String} phoneNumber - 用户手机号
 * @returns {Promise<Object>} - 包含订单总数和订单数组的对象
 */
const getCompletedOrders = async (phoneNumber) => {
    try {
        const database = client.db("Test");
        const collection = database.collection("orders");
        
        // 构建查询条件 - 只查询已完成的订单
        const queryCondition = {
            phoneNumber: phoneNumber,
            status: "已完成"
        };
        
        // 获取订单总数
        const total = await collection.countDocuments(queryCondition);
        
        // 查询所有已完成订单并按支付时间排序
        const orders = await collection.find(queryCondition)
            .sort({ payTime: -1 })  // 按支付时间降序排序
            .toArray();
        
        // 返回包含总数和订单数组的对象
        return {
            success: true,
            data: {
                total,      // 已完成订单总数
                orders      // 已完成订单数组
            }
        };
    } catch (error) {
        console.error('查询已完成订单失败:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// 导出模块
module.exports = { 
    //4.17更新
    createOrUpdatePaymentOrder,//在使用,用户使用余额创建订单
    queryOrders,//未使用,提供给后端管理查询订单(传入任意一种信息)
    getOrderDetail,//未使用,提供给后端管理查询订单(传入订单号)
    updateOrderStatus,//未使用,传入订单号和更新数据更新订单信息
    getActiveOrders,//已使用,提供给前端查询传入电话号码返回状态为正在进行中的订单
    getCompletedOrders, // **4.6新增：导出 getCompletedOrders**
    checkAndUpdateOrderStatus // 4.17导出订单状态检查函数
};
