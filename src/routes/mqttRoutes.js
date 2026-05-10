const express = require('express');
const router = express.Router();
const { businessLogger, publishLogger } = require('../utils/logger');

// 引入MQTT客户端实例
const { mqttClient } = require('../../server.js');

// 获取消息
router.get('/messages', (req, res) => {
    res.json(mqttClient.getRecentMessages());
});

// 发布普通消息到指定主题
router.post('/publish', (req, res) => {
    const { topic, message } = req.body;
    
    publishLogger.info('收到MQTT发布请求', { 
        topic, 
        rawMessage: message 
    });
    
    if (!mqttClient || !mqttClient.isConnected) {
        publishLogger.error('MQTT未连接，无法发布消息');
        return res.status(400).json({ error: "MQTT 未连接" });
    }

    try {
        // 解析 message
        const parsedMessage = JSON.parse(message);
        const { combinedId, selectedHour, Tem } = parsedMessage;

        publishLogger.info('解析消息内容', { 
            combinedId, 
            selectedHour, 
            Tem 
        });

        // 从combinedId中提取stationId和portId
        const stationMatch = combinedId.match(/station(\d+)/);
        const portMatch = combinedId.match(/port(\d+)/);
        
        if (!stationMatch || !portMatch) {
            publishLogger.error('无效的combinedId格式', { combinedId });
            return res.status(400).json({ error: "无效的combinedId格式，应为station01_port01" });
        }
        
        const stationId = stationMatch[1];
        const portId = portMatch[1];
        
        // 构建动态的属性名
        const temperatureKey = `Temperature${stationId}_${portId}`;
        const hourKey = `selectedHour${stationId}_${portId}`;

        publishLogger.info('构建属性名', { 
            stationId, 
            portId, 
            temperatureKey, 
            hourKey 
        });

        const sendData = {
            id: Date.now().toString(),
            version: "1.0",
            method: "thing.event.property.post",
            params: {
                [temperatureKey]: parseInt(Tem),
                [hourKey]: parseInt(selectedHour)
            }
        };

        // 发布消息到 MQTT
        mqttClient.publish(topic, JSON.stringify(sendData));
        
        publishLogger.info('MQTT消息发布成功', { 
            topic, 
            sendData 
        });

        res.json({ 
            success: true, 
            message: "消息已发布",
            details: {
                combinedId,
                temperatureKey,
                hourKey,
                stationId,
                portId
            }
        });
    } catch (error) {
        publishLogger.error('MQTT消息发布失败', { 
            topic, 
            message, 
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 发布物模型消息
router.post('/publish-thing-model', (req, res) => {
    const { topic, params } = req.body;
    
    if (!mqttClient || !mqttClient.isConnected) {
        return res.status(400).json({ error: "MQTT 未连接" });
    }
    
    mqttClient.publishThingModel(topic, params);
    res.json({ success: true, message: "物模型消息已发布" });
});

// 订阅主题
router.post('/subscribe', (req, res) => {
    const { topic } = req.body;
    
    if (!mqttClient || !mqttClient.isConnected) {
        return res.status(400).json({ error: "MQTT 未连接" });
    }
    
    mqttClient.subscribe(topic, (message) => {
        console.log(`收到消息: ${message}`);
    });
    
    res.json({ success: true, message: `已订阅主题: ${topic}` });
});

// 检查连接状态
router.get('/is-connected', (req, res) => {
    res.json({ 
        status: 'success',
        isConnected: mqttClient ? mqttClient.getConnectionStatus() : false
    });
});

module.exports = router;