const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, json, colorize, simple } = format;
const path = require('path');
const fs = require('fs');

// 自定义日志格式
const myFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
});

// 自定义业务日志格式
const busmyFormat = printf(({ level, message, timestamp, ...metadata }) => {
    let logMessage = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
        logMessage += ` ${JSON.stringify(metadata)}`;
    }
    return logMessage;
});

// 创建logs目录（如果不存在）
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// 通用日志格式
const logFormat = combine(
    timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    json()
);

// 创建 HTTP 请求日志 Logger 实例
const httpLogger = createLogger({
    level: 'info',
    format: combine(
        timestamp({
            format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        myFormat
    ),
    transports: [
        new transports.File({ 
            filename: path.join(logsDir, 'http.log'),
            level: 'info'
        })
    ]
});

// 创建业务日志 Logger 实例
const businessLogger = createLogger({
    level: 'info',
    format: combine(
        timestamp({
            format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        busmyFormat
    ),
    transports: [
        new transports.File({ 
            filename: path.join(logsDir, 'business.log'),
            level: 'info'
        })
    ]
});

// 支付日志记录器
const paymentLogger = createLogger({
    level: 'info',
    format: combine(
        timestamp({
            format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        busmyFormat
    ),
    transports: [
        new transports.File({ 
            filename: path.join(logsDir, 'payment.log'),
            level: 'info'
        })
    ]
});

// MQTT发布日志记录器
const publishLogger = createLogger({
    level: 'info',
    format: combine(
        timestamp({
            format: 'YYYY-MM-DD HH:mm:ss.SSS'
        }),
        busmyFormat
    ),
    transports: [
        new transports.File({ 
            filename: path.join(logsDir, 'publish.log'),
            level: 'info'
        })
    ]
});

// 开发环境下同时输出到控制台
if (process.env.NODE_ENV !== 'production') {
    const consoleFormat = combine(
        colorize(),
        simple()
    );
    
    const consoleTransport = new transports.Console({
        format: consoleFormat
    });

    businessLogger.add(consoleTransport);
    httpLogger.add(consoleTransport);
    paymentLogger.add(consoleTransport);
    publishLogger.add(consoleTransport);
}

// 监听错误事件
businessLogger.on('error', (error) => {
    console.error('winston 日志记录失败:', error);
});

module.exports = {
    businessLogger,
    httpLogger,
    paymentLogger,
    publishLogger
};