/**
 * 调控中心页面 - Controlcentre.html 的页面逻辑
 */

let currentStationId = '01'; // 默认选择充电站01
let currentPortId = '01'; // 默认选择充电口01

// 添加充电站选择器变化事件监听
document.getElementById('stationSelector')?.addEventListener('change', function(e) {
    currentStationId = e.target.value;
    clearDisplays();
    // 立即更新消息显示
    updateMessageDisplay();
});

// 添加充电口选择器变化事件监听
document.getElementById('portSelector')?.addEventListener('change', function(e) {
    currentPortId = e.target.value;
    clearDisplays();
    // 立即更新消息显示
    updateMessageDisplay();
});

// 清空所有显示的函数
function clearDisplays() {
    document.getElementById('temperatureDisplay').textContent = '-- °C';
    document.getElementById('humidityDisplay').textContent = '-- %';
    document.getElementById('powerDisplay').textContent = '-- W';
    document.getElementById('currentDisplay').textContent = '-- A';
    document.getElementById('voltageDisplay').textContent = '-- V';
}

// 更新环境数据显示
function updateEnvironmentData(data) {
    // 构建数据键，格式为 Temperature{stationId}_{portId}
    const dataKeyPrefix = `${currentStationId}_${currentPortId}`;
    
    if (data[`Temperature${dataKeyPrefix}`] !== undefined) {
        document.getElementById('temperatureDisplay').textContent = 
            `${data[`Temperature${dataKeyPrefix}`]} °C`;
    }
    if (data[`Humidity${dataKeyPrefix}`] !== undefined) {
        document.getElementById('humidityDisplay').textContent = 
            `${data[`Humidity${dataKeyPrefix}`]} %`;
    }
    if (data[`power${dataKeyPrefix}`] !== undefined) {
        document.getElementById('powerDisplay').textContent = 
            `${data[`power${dataKeyPrefix}`]} W`;
    }
    if (data[`current${dataKeyPrefix}`] !== undefined) {
        document.getElementById('currentDisplay').textContent = 
            `${data[`current${dataKeyPrefix}`]} A`;
    }
    if (data[`voltage${dataKeyPrefix}`] !== undefined) {
        document.getElementById('voltageDisplay').textContent = 
            `${data[`voltage${dataKeyPrefix}`]} V`;
    }
}

// 更新消息显示的函数(页面加载时和切换充电站/充电口时,或接收到消息后立即更新)
function updateMessageDisplay() {
    // 从 localStorage 获取最后接收到的消息
    let lastReceivedMessages = [];
    try {
        const savedMessages = localStorage.getItem('lastReceivedMessages');
        if (savedMessages) {
            lastReceivedMessages = JSON.parse(savedMessages);
        }
    } catch (error) {
        console.error('读取保存的消息失败:', error);
    }
    
    const messageContainer = document.getElementById('messageContainer');
    messageContainer.innerHTML = '';
    
    // 当前选择的站点和端口信息
    const combinedId = `station${currentStationId}_port${currentPortId}`;
    const dataKeyPrefix = `${currentStationId}_${currentPortId}`;
    
    // 遍历消息并更新显示(遍历消息并更新显示)
    lastReceivedMessages.forEach((msg, index) => {
        try {
            const data = JSON.parse(msg.content);
            
            // 过滤消息，只显示与当前选择的充电站和充电口相关的数据
            const filteredData = {};
            let hasRelevantData = false;
            
            // 遍历原始数据的所有键
            Object.keys(data).forEach(key => {
                // 检查键是否包含当前选择的充电站和充电口ID
                if (key.includes(dataKeyPrefix)) {
                    filteredData[key] = data[key];
                    hasRelevantData = true;
                }
            });
            
            // 只有当有相关数据时才显示消息
            if (hasRelevantData) {
                const messageElement = document.createElement('div');
                messageElement.className = 'p-4 bg-white rounded-lg shadow-sm';
                
                // 添加当前选择的站点和端口信息
                const selectionInfo = `<div class="text-xs text-gray-400 mb-1">当前选择: ${combinedId}</div>`;
                
                messageElement.innerHTML = `
                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            ${selectionInfo}
                            <div class="text-sm text-gray-500">${msg.timestamp}</div>
                            <pre class="mt-2 text-gray-800 whitespace-pre-wrap">${JSON.stringify(filteredData, null, 2)}</pre>
                        </div>
                    </div>
                `;
                
                messageContainer.appendChild(messageElement);
            }
            
            // 只用最新的消息更新环境数据显示(只用最新的消息更新环境数据显示)
            if (index === 0) {
                updateEnvironmentData(data);
            }
        } catch (error) {
            console.error('解析消息失败:', error);
        }
    });
    
    // 如果没有相关消息，显示提示信息
    if (messageContainer.children.length === 0) {
        const noDataElement = document.createElement('div');
        noDataElement.className = 'p-4 bg-white rounded-lg shadow-sm text-center';
        noDataElement.innerHTML = `
            <div class="text-gray-500">
                <div class="text-xs text-gray-400 mb-1">当前选择: ${combinedId}</div>
                <p>暂无相关数据</p>
            </div>
        `;
        messageContainer.appendChild(noDataElement);
    }
}

// 建立 WebSocket 连接
function initWebSocket() {
    const ws = new WebSocket('wss://' + window.location.host);
    
    // WebSocket 连接建立时的处理
    ws.onopen = () => {
        console.log('WebSocket 连接已建立');
        // 发送客户端标识
        ws.send(JSON.stringify({
            type: 'identify',
            clientId: 'control_centre'
        }));
    };
    
    // 接收消息的处理
    ws.onmessage = (event) => {
        const response = JSON.parse(event.data);
        
        // 根据消息类型处理不同的数据
        if (response.type === 'messages') {
            // 保存接收到的消息到 localStorage，以便在切换页面后仍能保留
            localStorage.setItem('lastReceivedMessages', JSON.stringify(response.data));
            
            // 更新消息显示(接收到消息后立即更新)
            updateMessageDisplay();
        }
    };
    
    // WebSocket 连接关闭时的处理
    ws.onclose = () => {
        console.log('WebSocket 连接已关闭');
    };
    
    // WebSocket 错误处理
    ws.onerror = (error) => {
        console.error('WebSocket 错误:', error);
    };
    
    return ws;
}

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    // 激活当前页面的导航链接
    const currentPage = window.location.pathname.split('/').pop();
    const navLinks = document.querySelectorAll('.sidebar-link');
    navLinks.forEach(link => {
        const linkPage = link.getAttribute('href');
        if (currentPage === linkPage) {
            link.classList.add('active');
        }
    });
    
    // 初始化 WebSocket 连接
    initWebSocket();
    
    // 页面加载时立即显示之前保存的消息(页面加载时立即更新)
    updateMessageDisplay();
});

