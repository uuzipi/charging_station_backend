const express = require('express');
const router = express.Router();
const path = require('path');
const chargingDB = require('../db/chargingDB');

// 查询充电口信息的接口
router.get('/charging/station', async (req, res) => {
    const { combinedId } = req.query;
  
    if (!combinedId) {
      return res.status(400).json({
        success: false,
        error: '请提供 combinedId'
      });
    }
  
    const result = await chargingDB.getStationInfo(combinedId);
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(404).json(result);
    }
});

// 更新充电站状态的API
router.post('/update-station', async (req, res) => {
    try {
      const { combinedId, updates } = req.body;
      
      if (!combinedId) {
        return res.status(400).json({
          success: false,
          error: '缺少combinedId参数'
        });
      }
      
      if (!updates || typeof updates !== 'object') {
        return res.status(400).json({
          success: false,
          error: '缺少updates参数或格式不正确'
        });
      }
      
      const result = await chargingDB.updateStation(combinedId, updates);
      
      if (result.success) {
        res.json({
          success: true,
          message: '充电站状态更新成功'
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error || '充电站状态更新失败'
        });
      }
    } catch (error) {
      console.error('更新充电站状态API错误:', error);
      res.status(500).json({
        success: false,
        error: '服务器内部错误'
      });
    }
});

// 充电桩管理页面
router.get('/manage', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public', 'charging.html'));
});

module.exports = router;
    