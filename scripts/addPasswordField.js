const { connectDB, client } = require('../src/config/config.js');
const { businessLogger } = require('../src/utils/logger');

/**
 * 脚本：为已有用户添加密码字段
 * 运行方式：node scripts/addPasswordField.js
 */
async function addPasswordFieldToUsers() {
    try {
        // 连接数据库
        await connectDB();
        console.log('数据库连接成功');

        // 获取Test数据库中的users集合
        const database = client.db("Test");
        const usersCollection = database.collection("users");
        
        // 查询所有没有password字段的用户
        const usersWithoutPassword = await usersCollection.find({
            password: { $exists: false }
        }).toArray();
        
        console.log(`找到 ${usersWithoutPassword.length} 个没有密码字段的用户`);
        
        if (usersWithoutPassword.length === 0) {
            console.log('所有用户已经有密码字段，无需更新');
            return;
        }
        
        // 为每个用户添加password字段（默认为null）
        const updatePromises = usersWithoutPassword.map(user => {
            return usersCollection.updateOne(
                { _id: user._id },
                { $set: { password: null } }
            );
        });
        
        // 等待所有更新完成
        const results = await Promise.all(updatePromises);
        
        let successCount = 0;
        results.forEach(result => {
            if (result.modifiedCount > 0) {
                successCount++;
            }
        });
        
        console.log(`已成功更新 ${successCount} 个用户的密码字段`);
        
        // 验证是否所有用户都有密码字段
        const remainingUsersWithoutPassword = await usersCollection.countDocuments({
            password: { $exists: false }
        });
        
        if (remainingUsersWithoutPassword === 0) {
            console.log('所有用户都已添加密码字段');
        } else {
            console.log(`仍有 ${remainingUsersWithoutPassword} 个用户没有密码字段`);
        }
    } catch (error) {
        console.error('添加密码字段时出错:', error);
    } finally {
        // 确保脚本执行完后退出
        process.exit(0);
    }
}

// 运行脚本
addPasswordFieldToUsers(); 