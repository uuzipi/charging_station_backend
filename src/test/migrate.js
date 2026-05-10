// src/test/migrate.js
const { client } = require('../db/config'); // 使用已有的MongoDB客户端

async function migrateBalanceToInCents() {
  try {
    console.log('开始余额迁移...');
    
    const database = client.db("Test"); // 使用您的数据库名称
    const collection = database.collection("users");
    
    console.log('查询有balance字段的用户...');
    // 查找所有有balance字段的用户
    const users = await collection.find({ balance: { $exists: true } }).toArray();
    console.log(`找到${users.length}个用户需要迁移`);
    
    let successCount = 0;
    
    for (const user of users) {
      try {
        // 将元转换为分，并四舍五入确保精度
        const balanceInCents = Math.round(user.balance * 100);
        
        console.log(`更新用户: ${user.phone || user._id}, 旧余额: ${user.balance}元, 新余额: ${balanceInCents}分`);
        
        // 更新文档
        await collection.updateOne(
          { _id: user._id },
          { 
            $set: { balanceInCents: balanceInCents },
            $unset: { balance: "" } // 移除旧字段
          }
        );
        
        successCount++;
      } catch (err) {
        console.error(`更新用户 ${user._id} 失败:`, err);
      }
    }
    
    console.log(`迁移完成！共处理了${users.length}个用户，成功更新${successCount}个。`);
    return { total: users.length, success: successCount };
  } catch (error) {
    console.error('余额迁移失败:', error);
    throw error;
  }
  // 不要关闭连接，因为这是共享的客户端
}

module.exports = {
  migrateBalanceToInCents
};