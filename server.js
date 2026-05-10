const https = require('https');
const fs = require('fs');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');

// ============================================================
//  运行模式：true = 线上域名模式，false = 本地开发模式
//  改这一个值就够了
// ============================================================
const IS_PROD = false;

// 引入数据库连接模块
const { connectDB } = require('./src/config/config.js');
// 引入阿里云连接模块
const { AliyunMqttClient } = require('./src/functions/aliyunMqttClient.js');
// 引入日志记录器
const { businessLogger, httpLogger } = require('./src/utils/logger');

// 创建服务器
let server;
if (IS_PROD) {
    const options = {
        key: fs.readFileSync(path.join(__dirname, 'cert', 'www.juzipibackend.xyz.key')),
        cert: fs.readFileSync(path.join(__dirname, 'cert', 'www.juzipibackend.xyz.pem')),
    };
    server = https.createServer(options, app);
} else {
    server = http.createServer(app);
}
const wss = new WebSocket.Server({ server });

// 中间件设置
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 日志设置 
const morganFormat = ':method :url :status :res[content-length] - :response-time ms';
app.use(morgan(morganFormat, {
    stream: {
        write: (message) => httpLogger.info(message.trim())
    }
}));

// 连接数据库
//connectDB();

// WebSocket 连接处理
global.WebSocket = WebSocket;
global.wss = wss;
wss.on('connection', (ws) => {
    console.log('新的 WebSocket 连接已建立');

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'identify') {
            ws.clientId = data.clientId;
            console.log(`客户端 ${data.clientId} 已连接`);

            const messages = aliyunMqttClient.getRecentMessages();
            ws.send(JSON.stringify({
                type: 'messages',
                data: messages
            }));
        }
    });

    ws.on('close', () => {
        console.log(`客户端 ${ws.clientId || '未知'} 连接已关闭`);
    });
});

// 阿里云MQTT客户端
const aliyunMqttClient = new AliyunMqttClient(
    'k214fOqXdly',
    'Wechat',
    '848700d79ceadd957084ce02c47da7b7',
    'cn-shanghai'
);

global.mqttClient = aliyunMqttClient;
module.exports.mqttClient = aliyunMqttClient;

// 连接MQTT
async function connectAndSubscribe() {
    try {
        await aliyunMqttClient.connect();
        console.log("MQTT 连接成功，开始订阅主题...");
        aliyunMqttClient.subscribeAndProcess('/k214fOqXdly/Wechat/user/get', (message) => {
            console.log('在server.js中处理收到的消息:', message);
        });
        console.log("使用单个设备监控，每个下单设备会被单独监控");
    } catch (error) {
        console.error("MQTT 连接或订阅失败:", error);
    }
}
connectAndSubscribe();

// 修改路由引入方式
const orderRoutes = require('./src/routes/orderRoutes');
const balanceRoutes = require('./src/routes/balanceRoutes');
const chargingRoutes = require('./src/routes/chargingRoutes');
const mqttRoutes = require('./src/routes/mqttRoutes');
const pageRoutes = require('./src/routes/pageRoutes');
const phoneNumberRoute = require('./src/routes/phoneNumberRoute');
const qrPaymentRoute = require('./src/routes/qrPaymentRoute');
const wxpay = require('./src/functions/wxpay.js'); // 引入wxpay模块(这个在functions里,没有用routes)

// 使用路由
app.use('/api', orderRoutes);
app.use('/', balanceRoutes);
app.use('/api', chargingRoutes);
app.use('/', mqttRoutes);
app.use('/', pageRoutes);
app.use('/api/phone', phoneNumberRoute);
app.use('/api/qrpayment', qrPaymentRoute);

// 微信支付相关路由 - 单独配置各个端点(微信支付的逻辑是直接写到函数里的)
app.post('/api/wxpay/create', wxpay.createPayment);  // 创建支付
app.post('/api/wxpay/notify', wxpay.paymentNotify);  // 支付回调
app.get('/api/wxpay/openid', wxpay.getOpenid);      // 获取openid
app.get('/api/wxpay/successful-orders-by-phone', wxpay.querySuccessfulOrdersByPhone); // 查询指定手机号的成功微信支付订单

// 错误处理中间件
app.use((err, req, res, next) => {
    businessLogger.error(`错误: ${err.message}`);
    res.status(500).send('服务器错误');
});

// 启动服务器
const PORT = IS_PROD ? 443 : 3000;
server.listen(PORT, '0.0.0.0', () => {
    const protocol = IS_PROD ? 'https' : 'http';
    console.log(`Server is running at ${protocol}://0.0.0.0:${PORT}`);
});
