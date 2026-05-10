const fs = require('fs');
const path = require('path');

module.exports = {
    // 小程序配置
    appId: 'wx571afdc5c2504a50',
    appSecret: '3bd0f0f51aec5dec4007bfb68401e93c',
    
    // 商户配置
    mchId: '1704106082',
    // V3需要证书路径而非单一API密钥
    publicKey: fs.readFileSync(path.join(__dirname, '../../cert/pay_cert/apiclient_cert.pem')),
    privateKey: fs.readFileSync(path.join(__dirname, '../../cert/pay_cert/apiclient_key.pem')),
    apiV3Key: '8rA9mH2tP7sK1vZ6wJ3Gzj1808243354', // 在商户平台设置的APIv3密钥，用于加密解密
    
    // 回调域名
    domain: 'https://juzipibackend.xyz/api/wxpay/notify'
};