// 存储设备监控器的Map
const deviceMonitors = new Map();

// 设备监控配置
const CONFIG = {
  CHECK_INTERVAL: 10000,  // 检查间隔时间(ms) - 10秒
  INITIAL_DELAY: 5000,   // 初始延迟时间(ms) - 5秒
  INACTIVITY_TIMEOUT: 10000 // 不活跃判断时间(ms) - 10秒
};

/**
 * 设备监控器类
 * 用于对单个设备进行功率监控
 */
class DeviceMonitor {
  /**
   * 构造函数
   * @param {String} combinedId - 设备ID
   * @param {Function} checkCallback - 设备检查回调函数
   */
  constructor(combinedId, checkCallback) {
    this.combinedId = combinedId;
    this.checkCallback = checkCallback;
    this.intervalId = null;
    this.active = false;
  }

  /**
   * 启动监控
   */
  start() {
    if (this.active) {
      console.log(`设备 ${this.combinedId} 监控已在运行中，跳过重复启动`);
      return;
    }

    console.log(`启动设备 ${this.combinedId} 监控，延迟 ${CONFIG.INITIAL_DELAY/1000} 秒后开始，每 ${CONFIG.CHECK_INTERVAL/1000} 秒检查一次`);

    // 设置初始延迟后启动定时检查
    setTimeout(() => {
      this.active = true;
      // 立即执行一次检查
      this.checkCallback(this.combinedId);
      
      // 设置定时检查
      this.intervalId = setInterval(() => {
        this.checkCallback(this.combinedId);
      }, CONFIG.CHECK_INTERVAL);
    }, CONFIG.INITIAL_DELAY);
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.active = false;
      console.log(`设备 ${this.combinedId} 监控已停止`);
    }
  }

  /**
   * 检查设备是否正在监控中
   * @returns {Boolean} - 是否正在监控
   */
  isActive() {
    return this.active;
  }
}

/**
 * 启动单个设备的监控
 * @param {String} combinedId - 设备ID
 * @param {Function} checkCallback - 设备检查回调函数
 * @returns {DeviceMonitor} - 创建的设备监控器实例
 */
const startDeviceMonitoring = (combinedId, checkCallback) => {
  // 如果已存在该设备的监控，先停止
  stopDeviceMonitoring(combinedId);
  
  // 创建新的设备监控器
  const monitor = new DeviceMonitor(combinedId, checkCallback);
  deviceMonitors.set(combinedId, monitor);
  
  // 启动监控
  monitor.start();
  return monitor;
};

/**
 * 停止单个设备的监控
 * @param {String} combinedId - 设备ID
 * @returns {Boolean} - 是否成功停止
 */
const stopDeviceMonitoring = (combinedId) => {
  const monitor = deviceMonitors.get(combinedId);
  if (monitor) {
    monitor.stop();
    deviceMonitors.delete(combinedId);
    return true;
  }
  return false;
};

/**
 * 检查设备是否在监控中
 * @param {String} combinedId - 设备ID
 * @returns {Boolean} - 是否在监控中
 */
const isDeviceMonitored = (combinedId) => {
  const monitor = deviceMonitors.get(combinedId);
  return monitor ? monitor.isActive() : false;
};

/**
 * 获取所有正在监控的设备ID
 * @returns {Array} - 设备ID数组
 */
const getMonitoredDevices = () => {
  return Array.from(deviceMonitors.keys());
};

// 导出配置对象以便其他模块使用
module.exports = {
  CONFIG,
  startDeviceMonitoring,
  stopDeviceMonitoring,
  isDeviceMonitored,
  getMonitoredDevices
}; 