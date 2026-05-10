/**
 * 订单管理页面 - orders.html 的页面逻辑
 */

let currentPageNum = 1;
let currentSearchMode = 'phone';

// 切换搜索模式
function switchSearchMode(mode) {
    currentSearchMode = mode;
    const phoneForm = document.getElementById('phoneSearchForm');
    const orderForm = document.getElementById('orderSearchForm');
    const phoneBtn = document.getElementById('phoneSearchBtn');
    const orderBtn = document.getElementById('orderSearchBtn');

    phoneForm.classList.toggle('hidden', mode !== 'phone');
    orderForm.classList.toggle('hidden', mode === 'phone');
    phoneBtn.classList.toggle('search-btn-active', mode === 'phone');
    phoneBtn.classList.toggle('search-btn-inactive', mode !== 'phone');
    orderBtn.classList.toggle('search-btn-active', mode !== 'phone');
    orderBtn.classList.toggle('search-btn-inactive', mode === 'phone');
}

/**
 * 搜索订单
 * 绑定：查询按钮点击事件和分页按钮点击事件
 * 按钮类：btn-primary（查询按钮）
 * @param {number} page - 页码，默认为1
 */
function searchOrders(page = 1) {
    const phoneNumber = document.getElementById('phoneNumber').value;  // 获取手机号输入值
    const orderNo = document.getElementById('orderNo').value;         // 获取订单号输入值
    let queryParams = '';  // 查询参数字符串

    // 根据搜索模式构建查询参数
    if (currentSearchMode === 'phone' && phoneNumber) {
        queryParams = `phoneNumber=${phoneNumber}`;
    } else if (currentSearchMode === 'order' && orderNo) {
        queryParams = `orderNo=${orderNo}`;
    } else {
        showToast('请输入搜索条件');  // 如果没有输入搜索条件，显示提示
        return;
    }
    
    // 发送API请求获取订单数据，使用负号表示降序排序
    fetch(`/api/wxpay/query?${queryParams}&page=${page}&limit=10&sort=-payTime`)
        .then(response => response.json())
        .then(response => {
            if (response.status === 'success') {
                renderOrders(response.data.orders);     // 渲染订单列表
                renderPagination(response.data);        // 渲染分页控件
                currentPageNum = page;                  // 更新当前页码
            } else {
                showToast(response.message || '查询失败');  // 显示错误信息
            }
        })
        .catch(error => {
            console.error('查询失败:', error);
            showToast('查询失败');  // 显示错误信息
        });
}

/**
 * 渲染订单列表
 * 内部函数，由searchOrders调用
 * 目标元素ID：orderList
 * @param {Array} orders - 订单数据数组
 */
function renderOrders(orders) {
    const tbody = document.getElementById('orderList');  // 获取订单列表容器
    tbody.innerHTML = '';  // 清空现有内容
    
    // 如果没有订单数据，显示提示信息
    if (!orders || orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="table-cell text-center text-gray-500">
                    暂无订单数据
                </td>
            </tr>
        `;
        return;
    }
    
    // 遍历订单数据，创建表格行
    orders.forEach(order => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';
        // 构建订单行HTML，包含订单号、手机号、金额等信息
        tr.innerHTML = `
            <td class="table-cell">${order.orderNo}</td>
            <td class="table-cell">${order.phoneNumber}</td>
            <td class="table-cell">${order.amount.toFixed(2)}</td>
            <td class="table-cell">
                <span class="status-badge ${order.status === '支付成功' ? 'status-success' : 'status-pending'}">
                    ${order.status}
                </span>
            </td>
            <td class="table-cell">${order.description || '-'}</td>
            <td class="table-cell">${new Date(order.payTime).toLocaleString()}</td>
        `;
        tbody.appendChild(tr);  // 添加到表格中
    });
}

// 渲染分页
function renderPagination(data) {
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';

    if (data.pages <= 1) return;

    const ul = document.createElement('ul');
    ul.className = 'pagination-list';

    // 上一页
    ul.innerHTML += `
        <li>
            <button onclick="searchOrders(${data.page - 1})" 
                class="pagination-btn ${data.page === 1 ? 'pagination-btn-disabled' : ''}"
                ${data.page === 1 ? 'disabled' : ''}>
                上一页
            </button>
        </li>
    `;

    // 页码（优化为显示当前页附近5页）
    const startPage = Math.max(1, data.page - 2);
    const endPage = Math.min(data.pages, data.page + 2);
    for (let i = startPage; i <= endPage; i++) {
        ul.innerHTML += `
            <li>
                <button onclick="searchOrders(${i})" 
                    class="pagination-btn ${data.page === i ? 'pagination-btn-active' : ''}">
                    ${i}
                </button>
            </li>
        `;
    }

    // 下一页
    ul.innerHTML += `
        <li>
            <button onclick="searchOrders(${data.page + 1})" 
                class="pagination-btn ${data.page === data.pages ? 'pagination-btn-disabled' : ''}"
                ${data.page === data.pages ? 'disabled' : ''}>
                下一页
            </button>
        </li>
    `;

    pagination.appendChild(ul);
}

// 重置搜索
function resetSearch() {
    document.getElementById('phoneNumber').value = '';
    document.getElementById('orderNo').value = '';
    switchSearchMode('phone');
    searchOrders(1);
}

// 显示提示
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded shadow-lg';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    switchSearchMode('phone');
    const currentPage = window.location.pathname.split('/').pop();
    document.querySelectorAll('nav a').forEach(link => {
        if (link.getAttribute('href') === currentPage) {
            link.classList.add('bg-blue-600', 'text-white');
            link.classList.remove('text-gray-700', 'hover:bg-gray-100');
        }
    });
    searchOrders(1); // 默认加载第一页
});

