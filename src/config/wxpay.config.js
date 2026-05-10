/**
 * 微信支付配置文件
 *
 * 部署说明：
 *  - 将 YOUR_XXX 替换为真实值即可运行微信支付功能
 *  - 如果暂时不想启用微信支付，只改真实值就行
 *
 * 获取方式：
 *  - appId / appSecret / mchId → 微信支付商户平台
 *  - apiV3Key → 微信支付商户平台 → APIv3密钥（32位）
 *  - publicKey → 微信支付商户平台 → API证书 → 下载证书后提取
 *  - privateKey → 微信支付商户平台 → API证书 → 下载证书后提取
 *  - domain → 你的回调地址，如 https://www.example.com/api/wxpay/notify
 */
module.exports = {
    appId: 'YOUR_APPID',
    mchId: 'YOUR_MCHID',
    appSecret: 'YOUR_APPSECRET',
    apiV3Key: 'YOUR_APISECRET',
    publicKey: '-----BEGIN CERTIFICATE-----\nYOUR_PUBLICKEY\n-----END CERTIFICATE-----',
    privateKey: '-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATEKEY\n-----END PRIVATE KEY-----',
    domain: 'YOUR_DOMAIN',
};
