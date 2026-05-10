const mqtt = require('mqtt');
const CryptoJS = require('crypto-js');
const { createLogger } = require('winston');
const { CONFIG } = require('../utils/deviceMonitor'); // 导入统一配置

// 定义功率阈值常量，当功率低于此值时视为设备空闲状态(0.001W)
// 提取为模块级常量，可以被其他模块引用
const POWER_THRESHOLD = 0.001;

// 存储最近消息的数组
const MAX_MESSAGES = 1000; // 最大消息数量限制
let recentMessages = [];

// 存储最近收到功率更新的时间
const lastPowerUpdateTimes = new Map();

// AliyunMqttClient 类
class AliyunMqttClient {
    constructor(productKey, deviceName, deviceSecret, regionId) {
        this.productKey = productKey;
        this.deviceName = deviceName;
        this.deviceSecret = deviceSecret;
        this.regionId = regionId;
        this.thingModelTopic = `/sys/${productKey}/${deviceName}/thing/event/property/post`; // 物模型主题,未使用,还是使用前端传入的topic
        this.client = null;
        this.isConnected = false;
    }

    // 生成 MQTT 密码
    generatePassword() {
        const content = `clientId${this.productKey}.${this.deviceName}deviceName${this.deviceName}productKey${this.productKey}`;
        return CryptoJS.HmacSHA256(content, this.deviceSecret).toString(CryptoJS.enc.Hex);
    }

    // 连接 MQTT（异步）
    connect() {
        return new Promise((resolve, reject) => {
            if (this.isConnected) {
                console.log("已连接，跳过重复连接");
                resolve();
                return;
            }

            const clientId = `${this.productKey}.${this.deviceName}|securemode=2,signmethod=hmacsha256|`;
            const username = `${this.deviceName}&${this.productKey}`;
            const password = this.generatePassword();

            const options = {
                clientId,
                username,
                password,
                keepalive: 60,
            };

            const host = `wss://${this.productKey}.iot-as-mqtt.${this.regionId}.aliyuncs.com:443`;
            this.client = mqtt.connect(host, options);

            this.client.on('connect', () => {
                console.log("MQTT 连接成功");
                this.isConnected = true;
                resolve(); // 连接成功时 resolve
            });

            this.client.on('error', (error) => {
                console.error("连接错误:", error);
                this.isConnected = false;
                reject(error); // 连接失败时 reject
            });

            this.client.on('offline', () => {
                console.log("MQTT 客户端离线");
                this.isConnected = false;
                // 尝试重连
                setTimeout(() => {
                    console.log("尝试重新连接...");
                    this.connect().then(resolve).catch(reject); // 重连时递归调用
                }, 5000);
            });
        });
    }
    
    // 断开 MQTT 连接
    disconnect() {
        if (this.client) {
            this.client.end(() => {
                console.log("MQTT 连接已断开");
                this.isConnected = false;
            });
        }
    }

    // 通用的发布消息方法
    publish(topic, message) {
        if (!this.client || !this.isConnected) {
            console.error("MQTT 未连接，无法发布消息");
            return;
        }
        this.client.publish(topic, message, (err) => {
            if (err) {
                console.error(`发布消息到主题 ${topic} 失败:`, err);
            } else {
                console.log(`消息发布成功: ${message}`);
            }
        });
    }

    // 发布物模型消息
    publishThingModel(topic, params) {
        console.log("params:", params);
        const payload = {
            id: Date.now().toString(),
            version: "1.0",
            method: "thing.event.property.post",
            params: params, // params 是一个对象
        };
        const payloadStr = JSON.stringify(payload);//将payload转换为字符串
        this.publish(topic, payloadStr); // 使用传入的 topic
    }
    
    // 检查单个设备的功率和状态
    async checkSingleDevicePower(combinedId) {
        try {
            const chargingDB = require('../db/chargingDB');
            const now = Date.now();
            
            // 获取最后一次功率更新时间
            const lastUpdateTime = lastPowerUpdateTimes.get(combinedId) || 0;
            const timeElapsed = now - lastUpdateTime;
            
            console.log(`检查设备 ${combinedId} 功率状态，上次更新时间: ${lastUpdateTime ? new Date(lastUpdateTime).toLocaleString() : '无记录'}, 经过时间: ${timeElapsed}ms`);
            
            // 使用统一配置的不活跃判断时间
            if (timeElapsed > CONFIG.INACTIVITY_TIMEOUT) {
                console.log(`⚠️ 充电桩 ${combinedId} 超过${CONFIG.INACTIVITY_TIMEOUT/1000}秒未收到功率更新，设置功率、电压和电流为0`);
                
                // 将功率、电压和电流都设为0
                const updates = {
                    power: 0,
                    voltage: 0,
                    current: 0,
                    status: 'idle'
                };
                
                // 更新数据库
                await chargingDB.updateStation(combinedId, updates);
                console.log(`已将充电桩 ${combinedId} 状态更新为空闲，功率、电压和电流设为0`);
                
                // 广播消息通知前端
                if (global.wss) {
                    const notificationMessage = {
                        timestamp: new Date().toLocaleString(),
                        content: JSON.stringify({ 
                            [`power${combinedId}`]: 0, 
                            [`voltage${combinedId}`]: 0,
                            [`current${combinedId}`]: 0, // 添加这一行，将电流信息也包含在通知中
                            message: `充电桩 ${combinedId} 超时未响应，已自动设置为空闲状态` 
                        })
                    };
                    
                    recentMessages.unshift(notificationMessage);
                    if (recentMessages.length > MAX_MESSAGES) {
                        recentMessages.pop();
                    }
                    
                    global.wss.clients.forEach((client) => {
                        if (client.readyState === global.WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'messages',
                                data: recentMessages
                            }));
                        }
                    });
                }
                
                return {
                    success: true,
                    action: 'reset',
                    message: `充电桩 ${combinedId} 超时未响应，已自动设置为空闲状态，功率、电压和电流置为0`
                };
            } else {
                // 如果功率正常更新，不采取行动
                return {
                    success: true,
                    action: 'none',
                    message: `充电桩 ${combinedId} 功率正常更新，不需要采取行动`
                };
            }
        } catch (error) {
            console.error(`检查设备 ${combinedId} 功率出错:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // 订阅并处理消息
    subscribeAndProcess(topic, callback) {
        if (!this.isConnected) {
            console.error('MQTT客户端未连接，无法订阅');
            return;
        }

        this.client.subscribe(topic, (err) => {
            if (err) {
                console.error(`订阅主题 ${topic} 失败:`, err);
                return;
            }
            console.log(`成功订阅主题: ${topic}`);
        });

        this.client.on('message', async (receivedTopic, message) => {
            if (receivedTopic === topic) {
                const messageStr = message.toString();
                console.log(`收到来自主题 ${receivedTopic} 的消息:`, messageStr);
                
                /*3.29 更新充电桩状态数据库begin 
                  4.1 将接收的数据除以1000.传输的是mv,ma,mw      
                */
                // 处理消息并更新数据库
                try {
                    const messageData = JSON.parse(messageStr);
                    const chargingDB = require('../db/chargingDB');
                    
                    // 创建消息副本用于WebSocket
                    const messageForWebSocket = JSON.parse(messageStr);
                    
                    // 解析消息中的所有键值对
                    for (const key in messageData) {
                        // 判断参数类型和提取充电桩ID
                        let paramType = '';
                        let combinedId = '';
                        
                        // 检查是否为功率参数 (例如: "power02_01")
                        if (key.startsWith('power')) {
                            paramType = 'power';
                            combinedId = key.replace('power', '');
                            
                            // 将功率从mW转换为W (除以1000)
                            messageData[key] = parseFloat(messageData[key]) / 1000;
                            messageForWebSocket[key] = parseFloat(messageForWebSocket[key]) / 1000;
                            
                            // 更新最后一次功率更新时间
                            lastPowerUpdateTimes.set(combinedId, Date.now());
                        }
                        // 检查是否为电压参数 (例如: "voltage02_01")
                        else if (key.startsWith('voltage')) {
                            paramType = 'voltage';
                            combinedId = key.replace('voltage', '');
                            
                            // 将电压从mV转换为V (除以1000)
                            messageData[key] = parseFloat(messageData[key]) / 1000;
                            messageForWebSocket[key] = parseFloat(messageForWebSocket[key]) / 1000;
                        }
                        // 检查是否为电流参数 (例如: "current02_01")
                        else if (key.startsWith('current')) {
                            paramType = 'current';
                            combinedId = key.replace('current', '');
                            
                            // 将电流从mA转换为A (除以1000)
                            messageData[key] = parseFloat(messageData[key]) / 1000;
                            messageForWebSocket[key] = parseFloat(messageForWebSocket[key]) / 1000;
                        }
                        // 检查是否为状态参数 (例如: "status02_01")
                        else if (key.startsWith('status')) {
                            paramType = 'status';
                            combinedId = key.replace('status', '');
                            
                            // 状态不需要单位转换
                        }
                        
                        // 如果成功提取了充电桩ID和参数类型
                        if (combinedId && paramType) {
                            // 创建更新对象
                            const updates = {};
                            updates[paramType] = messageData[key];
                            
                            // 如果更新的是功率，根据功率值设置状态（除非明确接收到状态消息）
                            if (paramType === 'power' && !messageData[`status${combinedId}`]) {
                                // 使用模块级常量POWER_THRESHOLD
                                const powerValue = messageData[key]; // 此时已经转换为W
                                
                                // 功率大于等于POWER_THRESHOLD时设为running，否则设为idle
                                updates.status = powerValue >= POWER_THRESHOLD ? 'running' : 'idle';
                            }
                            
                            // 更新数据库
                            await chargingDB.updateStation(combinedId, updates);
                            
                            // 添加适当的单位标识
                            let unitLabel = '';
                            if (paramType === 'power') unitLabel = 'W';
                            else if (paramType === 'voltage') unitLabel = 'V';
                            else if (paramType === 'current') unitLabel = 'A';
                            
                            console.log(`已更新充电桩 ${combinedId} 的 ${paramType} 为 ${messageData[key]}${unitLabel}`);
                        }

                    }
                    
                    // 更新时间戳部分的消息内容
                    const messageWithTimestamp = {
                        timestamp: new Date().toLocaleString(),
                        content: JSON.stringify(messageForWebSocket) // 使用更新后的数据(除以1000转化为国际单位后)(4.1)
                    };
                    
                    // 将新消息添加到数组开头
                    recentMessages.unshift(messageWithTimestamp);
                    
                    // 保持消息数量在限制内
                    if (recentMessages.length > MAX_MESSAGES) {
                        recentMessages.pop();
                    }
                    
                } catch (error) {
                    console.error('处理消息或更新数据库时出错:', error);
                }
                /* 3.29 end */

                // 如果 WebSocket 服务器存在，广播消息给所有连接的客户端
                if (global.wss) {
                    global.wss.clients.forEach((client) => {
                        if (client.readyState === global.WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'messages',
                                data: recentMessages
                            }));
                        }
                    });
                }
                
                /*更新物模型 start*/
                // try {
                //     const messageObj = JSON.parse(messageStr);
                    
                //     // 处理温度更新
                //     if (messageObj.Temperature2 !== undefined) {
                //         // 构建温度物模型消息参数
                //         const tempParams = {
                //             Temperature2: messageObj.Temperature2
                //         };
                        
                //         // 发布温度到指定的 topic
                //         this.publishThingModel(
                //             '/sys/k214fOqXdly/Wechat/thing/event/property/post',
                //             tempParams
                //         );
                //     }

                //     // 处理湿度更新
                //     if (messageObj.Humidity2 !== undefined) {
                //         // 构建湿度物模型消息参数
                //         const humParams = {
                //             Humidity2: messageObj.Humidity2
                //         };
                        
                //         // 发布湿度到指定的 topic
                //         this.publishThingModel(
                //             '/sys/k214fOqXdly/Wechat/thing/event/property/post',
                //             humParams
                //         );
                //     }

                //     // 处理二氧化碳更新
                //     if (messageObj.Carbon2 !== undefined) {
                //         // 构建二氧化碳物模型消息参数
                //         const carbonParams = {
                //             Carbon2: messageObj.Carbon2
                //         };
                        
                //         // 发布二氧化碳到指定的 topic
                //         this.publishThingModel(
                //             '/sys/k214fOqXdly/Wechat/thing/event/property/post',
                //             carbonParams
                //         );
                //     }

                //     // 处理光照强度更新
                //     if (messageObj.Luminance2 !== undefined) {
                //         // 构建光照强度物模型消息参数
                //         const luminanceParams = {
                //             Luminance2: messageObj.Luminance2
                //         };
                        
                //         // 发布光照强度到指定的 topic
                //         this.publishThingModel(
                //             '/sys/k214fOqXdly/Wechat/thing/event/property/post',
                //             luminanceParams
                //         );
                //     }

                //     // 处理土壤温度更新
                //     if (messageObj.Soil_Tem2 !== undefined) {
                //         // 构建土壤温度物模型消息参数
                //         const soilTempParams = {
                //             Soil_Tem2: messageObj.Soil_Tem2
                //         };
                        
                //         // 发布土壤温度到指定的 topic
                //         this.publishThingModel(
                //             '/sys/k214fOqXdly/Wechat/thing/event/property/post',
                //             soilTempParams
                //         );
                //     }

                //     // 处理土壤湿度更新
                //     if (messageObj.Soil_Hum2 !== undefined) {
                //         // 构建土壤湿度物模型消息参数
                //         const soilHumParams = {
                //             Soil_Hum2: messageObj.Soil_Hum2
                //         };
                        
                //         // 发布土壤湿度到指定的 topic
                //         this.publishThingModel(
                //             '/sys/k214fOqXdly/Wechat/thing/event/property/post',
                //             soilHumParams
                //         );
                //     }
                // } catch (error) {
                //     console.error('消息转发失败:', error);
                // }
                // /*更新物模型 end*/
                
            }
        });
    }

    // 获取最近的消息
    getRecentMessages() {
        return recentMessages;
    }
    
    // 获取当前连接状态
    getConnectionStatus() {
        return this.isConnected;
    }
}

// 在导出时，同时导出功率阈值常量
module.exports = { AliyunMqttClient, POWER_THRESHOLD };
