const fs = require('fs');
const path = require('path');

// 读取 business.log 文件
const logFilePath = path.join(__dirname, '../../logs/business.log');
const logData = fs.readFileSync(logFilePath, 'utf8');

// 提取包含 phoneNumber 的日志项
const phoneNumberEntries = logData.split('\n').filter(line => line.includes('phoneNumber'));

// 直接返回日志数据
console.log(JSON.stringify(phoneNumberEntries)); 