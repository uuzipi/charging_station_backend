/**
 * 余额管理页面 - balance.html 的页面逻辑
 */

// 显示余额查询面板
function showBalance() {
    document.getElementById('balanceContainer').classList.remove('hidden');
    document.getElementById('userBalanceContainer').classList.add('hidden');
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.tab-button:nth-child(1)').classList.add('active');
}

// 显示用户余额列表面板
function showUserBalances() {
    document.getElementById('balanceContainer').classList.add('hidden');
    document.getElementById('userBalanceContainer').classList.remove('hidden');
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.tab-button:nth-child(2)').classList.add('active');
    fetchUserBalances();
}

// 刷新余额查询
async function refreshBalance() {
    const phoneNumber = document.getElementById('phoneNumber').value;
    if (!phoneNumber) {
        alert('请输入手机号');
        return;
    }

    try {
        const response = await fetch(`/balance?phoneNumber=${phoneNumber}`);
        const data = await response.json();
        if (data.status === 'success') {
            document.getElementById('balanceDisplay').textContent = `¥ ${data.balance}`;
        } else {
            alert('获取余额失败');
        }
    } catch (error) {
        alert('获取余额失败');
    }
}

// 获取所有用户余额列表
async function fetchUserBalances() {
    try {
        const response = await fetch('/user-balances');
        const data = await response.json();
        const userBalanceList = document.getElementById('userBalanceList');
        userBalanceList.innerHTML = '';
        for (const [phoneNumber, balance] of Object.entries(data)) {
            const listItem = document.createElement('li');
            listItem.className = 'p-4 bg-gray-50 rounded-lg flex justify-between items-center';
            listItem.innerHTML = `
                <span class="text-gray-700">手机号: ${phoneNumber}</span>
                <span class="font-bold text-primary-light">余额: ¥${balance}</span>
            `;
            userBalanceList.appendChild(listItem);
        }
    } catch (error) {
        alert('获取用户余额失败');
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
});

