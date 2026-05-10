/**
 * 充电桩/继电器管理页面 - charging.html 的页面逻辑
 */

// 检查连接状态
async function checkConnection() {
    try {
        const response = await fetch('/is-connected');
        const data = await response.json();
        const statusIcon = document.getElementById('statusIcon');
        const statusText = document.getElementById('statusText');

        if (data.isConnected) {
            statusIcon.className = 'mdi mdi-wifi text-2xl mr-2 text-green-500';
            statusText.textContent = '已连接';
            statusText.className = 'text-green-600';
        } else {
            statusIcon.className = 'mdi mdi-wifi-off text-2xl mr-2 text-red-500';
            statusText.textContent = '未连接';
            statusText.className = 'text-red-600';
        }
    } catch (error) {
        console.error('检查连接状态失败:', error);
    }
}

// 发布消息到MQTT
async function publishMessage(id) {
    const stationId = document.getElementById('stationIdInput').value;
    const temperature = document.getElementById(`temperature${id}`).value;
    const duration = document.getElementById(`duration${id}`).value;
    
    // 端口ID根据继电器编号自动分配
    const portId = id.toString().padStart(2, '0');

    if (!stationId) {
        alert('请输入站点ID');
        return;
    }

    if (!temperature) {
        alert('请输入温度');
        return;
    }

    // 格式化站点ID，确保是两位数
    const formattedStationId = stationId.padStart(2, '0');
    
    // 组合成combinedId格式
    const combinedId = `station${formattedStationId}_port${portId}`;

    const message = {
        combinedId: combinedId,
        selectedHour: parseInt(duration),
        Tem: parseInt(temperature)
    };

    try {
        const response = await fetch('/publish', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                topic: `/k214fOqXdly/Wechat/user/Wechat`,
                message: JSON.stringify(message)
            })
        });

        const data = await response.json();
        if (data.success) {
            alert('指令发送成功');
        } else {
            alert('指令发送失败: ' + data.message);
        }
    } catch (error) {
        alert('指令发送失败: ' + error.message);
    }
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

    // 定期检查连接状态(5秒检查一次)
    setInterval(checkConnection, 5000);
    checkConnection();
});

