/**
 * 日志页面 - phoneNumbersLog.html 的页面逻辑
 */

// 获取日志数据
async function fetchLogData() {
    try {
        const response = await fetch('/run-script');
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.text();
        updateLogList(data);
    } catch (error) {
        console.error('Error fetching log data:', error);
    }
}

// 更新日志列表
function updateLogList(data) {
    const logList = document.getElementById('log-list');
    logList.innerHTML = ''; // 清空现有内容
    try {
        const entries = JSON.parse(data);
        entries.forEach(entry => {
            const li = document.createElement('li');
            li.textContent = entry;
            logList.appendChild(li);
        });
    } catch (error) {
        console.error('Error parsing log data:', error);
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

    // 页面加载时获取日志数据
    fetchLogData();
});

