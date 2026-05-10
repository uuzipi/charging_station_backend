const { client } = require('../config/config');
const { addToBalance } = require('./balanceDB'); // 导入addToBalance函数
// 导入aliyunMqttClient.js中导出的功率阈值常量
const { POWER_THRESHOLD } = require('../functions/aliyunMqttClient');

// 获取北京时间 (UTC+8)
const getBeijingNow = () => new Date(Date.now() + 8 * 60 * 60 * 1000);

/**
 * 创建所有充电桩和充电口
 * @returns {Object} - 操作结果，包含 success(成功状态)、message(操作信息)
 */
const createAllStations = async () => {
  try {
    const database = client.db('Test');
    const collection = database.collection('chargingStations');

    const stations = [];
    for (let i = 1; i <= 10; i++) {
      const stationId = String(i).padStart(2, '0'); // 01 到 10
      for (let j = 1; j <= 10; j++) {
        const portId = String(j).padStart(2, '0'); // 01 到 10
        const combinedId = `${stationId}_${portId}`;
        stations.push({
          _id: combinedId,
          stationId,
          portId,
          combinedId,
          power: 0,
          voltage: 0,
          current: 0,
          status: 'idle',
          statusUpdateTime: null,
          runningTime: 0,
          lastIdleTime: null,
          connectedToAliyun: false
        });
      }
    }

    await collection.insertMany(stations);
    console.log('成功创建 100 个充电桩和充电口');
    return {
      success: true,
      message: '充电桩数据初始化完成'
    };
  } catch (error) {
    console.error('创建充电桩失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * 自动处理低功率充电桩的订单完成和退款
 * @param {String} combinedId - 充电站和端口的组合ID
 * @param {Number} power - 当前功率值(W)
 * @returns {Object} - 处理结果
 */
const handleLowPowerAutoComplete = async (combinedId, power) => {
  try {
    // 使用aliyunMqttClient.js中导出的功率阈值常量
    
    if (power >= POWER_THRESHOLD) {
      // 功率正常，不需要处理
      return { processed: false, message: '功率正常，不需自动完成' };
    }
    
    const database = client.db('Test');
    const stationsCollection = database.collection('chargingStations');
    const ordersCollection = database.collection('orders');
    
    // 1. 查询充电桩状态
    const station = await stationsCollection.findOne({ _id: combinedId });
    
    if (!station) {
      throw new Error(`未找到充电桩: ${combinedId}`);
    }
    
    // 如果状态不是running，无需处理
    if (station.status !== 'running') {
      return { processed: false, message: '充电桩不处于运行状态，无需处理' };
    }
    
    console.log(`检测到充电桩${combinedId}功率低于阈值(${power}W < ${POWER_THRESHOLD}W)，自动完成订单`);
    
    // 2. 查询进行中的订单
    const order = await ordersCollection.findOne({
      status: '进行中',
      'chargingInfo.combinedId': combinedId
    });
    
    if (!order) {
      console.log(`未找到充电桩${combinedId}的进行中订单，仅更新充电桩状态`);
      
      // 仅更新充电桩状态为idle
      await stationsCollection.updateOne(
        { _id: combinedId },
        { 
          $set: { 
            status: 'idle',
            statusUpdateTime: getBeijingNow()
          }
        }
      );
      
      return { processed: true, message: '已更新充电桩状态为idle，但未找到相关订单' };
    }
    
    // 3. 计算退款金额（基于已用时间和总时间的比例）
    const currentTime = getBeijingNow();
    let refundFeeCents = 0;
    
    // 如果有预计持续时间，计算退款金额
    if (station.estimatedDuration && station.estimatedDuration > 0) {
      // 计算已使用时间占比
      const usedRatio = station.runningTime / station.estimatedDuration;
      
      // 如果使用未满，计算退款金额
      if (usedRatio < 1) {
        // 计算退款金额 = 总金额 * (1 - 已使用时间占比)
        // totalFee已经是分单位，不需要乘以100
        refundFeeCents = Math.round(order.totalFee * (1 - usedRatio));
      }
    }
    
    // 4. 更新订单状态
    await ordersCollection.updateOne(
      { _id: order._id },
      {
        $set: {
          status: '已完成',
          refundFee: refundFeeCents, // 保持字段名称为refundFee，值为分
          'chargingInfo.endTime': currentTime,
          updatedAt: currentTime
        }
      }
    );
    
    // 5. 更新充电桩状态
    await stationsCollection.updateOne(
      { _id: combinedId },
      { 
        $set: { 
          status: 'idle',
          statusUpdateTime: currentTime
        }
      }
    );
    
    // 6. 如果有退款，增加用户余额 (addToBalance现在接收分为单位)
    if (refundFeeCents > 0) {
      try {
        // addToBalance函数现在接收分为单位的参数
        const newBalance = await addToBalance(order.phoneNumber, refundFeeCents);
        console.log(`已为用户${order.phoneNumber}退款${refundFeeCents / 100}元，新余额为${newBalance}元`);
      } catch (error) {
        console.error(`退款到余额失败: ${error.message}`);
        // 即使退款失败，也不影响订单完成流程
      }
    }
    
    return { 
      processed: true, 
      message: `订单自动完成，退款${refundFeeCents / 100}元`,
      refundFeeCents: refundFeeCents,
      orderId: order._id
    };
  } catch (error) {
    console.error('自动完成订单处理失败:', error);
    return {
      processed: false,
      error: error.message
    };
  }
};

/**
 * 更新充电桩信息
 * @param {String} combinedId - 充电站和端口的组合ID，格式为 "stationId_portId"
 * @param {Object} updates - 需要更新的字段对象，例如 { status: 'running', power: 5000 }
 * @returns {Object} - 操作结果，包含 success(成功状态)、message(操作信息)
 */
const updateStation = async (combinedId = '', updates) => {
  try {
    const database = client.db('Test');
    const collection = database.collection('chargingStations');

    const updateDoc = { $set: {} };
    const currentTime = getBeijingNow();

    const currentDoc = await collection.findOne({ _id: combinedId });
    if (!currentDoc) throw new Error('充电桩不存在');

    /*这里给pay页面传入预计运行时间(3.29) */
    // 设置预计运行时间（秒）- 如果提供了小时数，乘以3600转换为秒
    if (updates.estimatedHours) {
      updateDoc.$set.estimatedDuration = updates.estimatedHours * 3600;
    } 
    /*不传入时间就不管(3.29防止测试的时候把时间给改了) */
    // else {
    //   // 默认充电1小时
    //   updateDoc.$set.estimatedDuration = 3600;
    // }   

    // 检查状态变化 - 用于判断是否需要处理设备监控
    let statusChanged = false;
    let oldStatus = currentDoc.status;
    let newStatus = updates.status || oldStatus;
    
    if (newStatus !== oldStatus) {
      statusChanged = true;
    }

    // 记录新状态和时间
    if (updates.status) {
      updateDoc.$set.status = updates.status;
      updateDoc.$set.statusUpdateTime = currentTime;
      
      // 只有当状态从idle变为running时，才更新lastIdleTime
      if (updates.status === 'running' && currentDoc.status === 'idle') {
        updateDoc.$set.lastIdleTime = currentTime;
      }
    }
      
    // 计算running时间 - 统一处理所有从running状态开始的情况
    if (currentDoc.status === 'running') {
      // 计算从lastIdleTime到当前时间的运行时间
      let runningDuration = 0;
      
      // 如果有lastIdleTime，使用它计算运行时间
      if (currentDoc.lastIdleTime) {
        runningDuration = Math.floor((currentTime - currentDoc.lastIdleTime) / 1000);
      } else {
        // 否则使用statusUpdateTime
        runningDuration = Math.floor((currentTime - currentDoc.statusUpdateTime) / 1000);
      }
      
      // 设置runningTime - 无论是变为idle还是继续running
      updateDoc.$set.runningTime = runningDuration;
    }

    // 更新其他字段
    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'status' && key !== 'estimatedHours') updateDoc.$set[key] = value;
    }

    // 更新充电桩信息
    const result = await collection.updateOne({ _id: combinedId }, updateDoc);
    if (result.matchedCount === 0) throw new Error('未找到匹配的充电桩');

    // 状态变化处理 - 如果状态从running变为idle，处理设备监控
    if (statusChanged && oldStatus === 'running' && newStatus === 'idle') {
      // 尝试导入设备监控模块 - 如果设备变为idle，应该触发订单完成逻辑
      try {
        const deviceMonitor = require('../utils/deviceMonitor');
        const orderDB = require('./orderDB');
        
        // 如果设备监控存在，检查并更新关联订单
        if (deviceMonitor.isDeviceMonitored(combinedId)) {
          // 使用订单模块处理订单状态
          await orderDB.checkAndUpdateOrderStatus(combinedId);
        }
      } catch (error) {
        console.error(`设备 ${combinedId} 状态变更处理失败:`, error);
      }
    }

    // 如果更新了功率值，检查是否需要自动完成订单
    if (updates.power !== undefined && currentDoc.status === 'running') {
      // 检查功率是否低于阈值，如果是则执行自动完成订单逻辑
      const autoCompleteResult = await handleLowPowerAutoComplete(combinedId, updates.power);
      
      if (autoCompleteResult.processed) {
        return {
          success: true,
          message: '更新成功，并自动完成订单',
          autoComplete: autoCompleteResult
        };
      }
    }

    return {
      success: true,
      message: '更新成功'
    };
  } catch (error) {
    console.error('更新充电桩失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * 查询充电口信息
 * @param {String} combinedId - 充电站和端口的组合ID，格式为 "stationId_portId"
 * @returns {Object} - 操作结果，包含 success(成功状态)、data(充电口信息)、message(操作信息)
 */
const getStationInfo = async (combinedId = '') => {
  try {
    const database = client.db('Test');
    const collection = database.collection('chargingStations');

    const stationInfo = await collection.findOne({ _id: combinedId });

    if (!stationInfo) {
      throw new Error('充电口不存在');
    }

    console.log(`成功查询 ${combinedId} 的充电口信息`);
    return {
      success: true,
      data: stationInfo,
      message: '查询成功'
    };
  } catch (error) {
    console.error('查询充电口信息失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * 为所有充电桩和充电口添加预计运行时间字段
 * @returns {Object} - 操作结果，包含 success(成功状态)、message(操作信息)
 */
const addEstimatedDurationField = async () => {
  try {
    const database = client.db('Test');
    const collection = database.collection('chargingStations');

    // 使用updateMany方法为所有文档添加estimatedDuration字段
    const result = await collection.updateMany(
      { estimatedDuration: { $exists: false } }, // 查找不包含estimatedDuration字段的文档
      { $set: { estimatedDuration: 0 } } // 设置默认值为0
    );

    console.log(`成功为 ${result.modifiedCount} 个充电桩和充电口添加estimatedDuration字段`);
    return {
      success: true,
      message: `成功为 ${result.modifiedCount} 个充电桩和充电口添加estimatedDuration字段`
    };
  } catch (error) {
    console.error('添加estimatedDuration字段失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * 查询符合条件的充电桩
 * @param {Object} query - 查询条件对象，例如 { status: 'running' }
 * @returns {Array} - 符合条件的充电桩数组
 */
const findStations = async (query = {}) => {
  try {
    const database = client.db('Test');
    const collection = database.collection('chargingStations');
    
    return await collection.find(query).toArray();
  } catch (error) {
    console.error('查询充电桩失败:', error);
    return [];
  }
};

module.exports = {
  // 3.29 检查
  createAllStations, // 3.26 创建完成，只使用一次
  updateStation,
  getStationInfo, // 更新为使用 combinedId
  addEstimatedDurationField,//3.29 为充电桩加入estimatedDuration(预计充电时间)字段
  handleLowPowerAutoComplete, // 4.7 低功率自动完成订单功能
  findStations // 添加新方法到导出
};