const express = require('express');
const router = express.Router();
const path = require('path');

// 获取并显示主页
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'admin.html'));
});

// 获取并显示管理系统页面
router.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'admin.html'));
});

// 获取并显示充电桩管理页面
router.get('/charging', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'charging.html'));
});

// 运行提取电话号码日志的脚本
router.get('/run-script', (req, res) => {
    const { exec } = require('child_process');
    exec('node ./src/routes/extractPhoneNumbers.js', (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).send('Error running script');
        }
        console.info(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
        res.send(stdout); // 返回日志数据
    });
});

module.exports = router;