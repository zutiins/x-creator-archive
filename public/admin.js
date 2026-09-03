let creators = [];
let allLists = [];
let adminSearch = '';
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[char]);

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '请求失败');
  return value;
}

async function loadSyncHistory() {
  try {
    const history = await request('/api/admin/sync-history');
    const lastTime = $('#sync-last-time');
    const lastStatus = $('#sync-last-status');
    const historyList = $('#sync-history-list');
    
    if (!lastTime || !lastStatus || !historyList) return; // Prevent crashes on duplicate or missing elements
    
    if (!history || !history.length) {
      lastTime.textContent = '最后同步：暂无记录';
      lastStatus.className = 'sync-badge';
      lastStatus.textContent = '未运行';
      historyList.innerHTML = '<p class="muted">暂无历史记录</p>';
      return;
    }
    
    const latest = history[0];
    const finished = new Date(latest.finishedAt);
    lastTime.textContent = `最后同步：${finished.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    
    const isOk = latest.failed === 0 && !latest.consecutiveFailures;
    lastStatus.className = `sync-badge ${isOk ? 'success' : 'failed'}`;
    lastStatus.textContent = isOk ? '正常' : '异常';
    
    historyList.innerHTML = history.slice(0, 5).map(item => {
      const start = new Date(item.startedAt);
      const isSuccess = item.failed === 0 && !item.consecutiveFailures;
      return `
        <div class="sync-history-item ${isSuccess ? 'success' : 'failed'}">
          <strong>${start.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</strong>
          <div class="sync-history-meta muted">
            共 ${item.total} 个 · 成功 ${item.success} · 失败 ${item.failed} · 同步推文 ${item.tweetsFetched} 条
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('加载同步历史失败:', error);
  }
}


async function load() {
  try {
    const data = await request('/api/admin/data');
    creators = data.creators;
    data.lists = data.lists || [];
    allLists = [...new Set([...data.lists.map((item) => item.name || item.id).filter(Boolean), ...creators.flatMap((creator) => creator.lists || [])])].sort();
    $('#proxy-enabled').checked = Boolean(data.settings && data.settings.proxyEnabled);
    $('#proxy-url').value = (data.settings && data.settings.proxyUrl) || '';
    $('#login-panel').hidden = true;
    $('#dashboard').hidden = false;
    render();
    await loadSyncHistory();
  } catch {
    $('#login-panel').hidden = false;
    $('#dashboard').hidden = true;
  }
}

function selectedIds() {
  return [...document.querySelectorAll('.admin-row input[type="checkbox"].row-select:checked')]
    .map((checkbox) => checkbox.value)
    .filter(Boolean);
}

function render() {
  $('#admin-count').textContent = creators.length;

  const listOptions = allLists.map((list) => `<option value="${esc(list)}">${esc(list)}</option>`).join('');
  $('#refresh-list').innerHTML = '<option value="">选择分类</option>' + listOptions;
  $('#bulk-category').innerHTML = '<option value="">选择分类</option>' + listOptions;
  $('#delete-category').innerHTML = '<option value="">选择要删除的分类</option>' + listOptions;

  $('#creator-list-options').innerHTML = allLists.map((list) => `
    <label class="category-check">
      <input type="checkbox" class="category-checkbox" value="${esc(list)}"> ${esc(list)}
    </label>`).join('') || '<span class="muted">暂无分类，可在下方添加</span>';

  const query = adminSearch.trim().toLocaleLowerCase();
  const visibleCreators = query ? creators.filter((creator) => [creator.username, creator.displayName, ...(creator.lists || [])].some((value) => String(value || '').toLocaleLowerCase().includes(query))) : creators;
  $('#admin-search-count').textContent = query ? `匹配 ${visibleCreators.length} / ${creators.length}` : '';
  $('#admin-list').innerHTML = visibleCreators.map((creator) => {
    const lists = (creator.lists || []).map(esc).join(' / ') || '未分类';
    return `
    <div class="admin-row">
      <input type="checkbox" class="row-select" value="${esc(creator.id)}">
      <div class="avatar">
        ${creator.avatarUrl
          ? `<img src="${esc(creator.avatarUrl)}" alt="">`
          : esc((creator.displayName || creator.username || '?')[0])}
      </div>
      <div class="admin-creator-main">
        <strong class="admin-display-name">${esc(creator.displayName)} ${creator.watchEnabled ? '<span class="watch-badge">关注</span>' : ''}</strong>
        <div class="muted admin-handle">@${esc(creator.username)}</div>
        <div class="admin-tags">${(creator.lists || []).length ? (creator.lists || []).map((list) => `<span class="tag">${esc(list)}</span>`).join('') : '<span class="muted">未分类</span>'}</div>
      </div>
      <div class="row-actions">
        <button data-edit="${esc(creator.id)}" class="secondary">编辑</button>
        <button data-refresh="${esc(creator.id)}" class="secondary">刷新资料</button>
        <button data-delete="${esc(creator.id)}" class="delete">删除</button>
      </div>
    </div>
  `;
  }).join('');

  $('#select-all-creators').checked = false;
  $('#bulk-result').textContent = '';
}

function resetForm() {
  $('#creator-form').reset();
  $('#creator-id').value = '';
  $('#followers').value = 0;
  document.querySelectorAll('#creator-list-options .category-checkbox').forEach((checkbox) => { checkbox.checked = false; });
  $('#new-category').value = '';
}

function readFormLists() {
  return [...document.querySelectorAll('#creator-list-options .category-checkbox:checked')]
    .map((checkbox) => checkbox.value.trim())
    .filter(Boolean);
}

function openEdit(creator) {
  if (!creator) return;
  $('#creator-id').value = creator.id;
  $('#username').value = creator.username;
  $('#display-name').value = creator.displayName;
  $('#followers').value = creator.followersCount || 0;
  $('#status').value = creator.status || 'active';
  $('#avatar-url').value = creator.avatarUrl || '';
  $('#banner-url').value = creator.bannerUrl || '';
  $('#bio').value = creator.bio || '';
  $('#verified').checked = Boolean(creator.verified);
  $('#hidden').checked = Boolean(creator.hidden);
  $('#watch-enabled').checked = Boolean(creator.watchEnabled);
  document.querySelectorAll('#creator-list-options .category-checkbox').forEach((checkbox) => {
    checkbox.checked = (creator.lists || []).includes(checkbox.value);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function refreshExisting(body, label) {
  const result = $('#refresh-result');
  result.textContent = `${label}，请稍候…`;
  try {
    const value = await request('/api/admin/refresh-creators', { method: 'POST', body: JSON.stringify(body) });
    const details = (value.results || []).filter(x => x.tweetFetched || x.tweetNote || x.tweetError);
    const tweetStats = details.length ? ` (其中尝试获取推文 ${details.length} 个: 成功 ${details.filter(x => x.tweetFetched).length}, 失败 ${details.filter(x => x.tweetError).length}, 无推文 ${details.filter(x => !x.tweetFetched && !x.tweetError).length})` : '';
    result.textContent = `${label}完成：成功 ${value.success} 个，失败 ${value.failed} 个，共 ${value.total} 个。${tweetStats}`;
    await load();
  } catch (error) {
    result.textContent = `刷新失败：${error.message}`;
  }
}

async function bulkAction(action, value) {
  const ids = selectedIds();
  const result = $('#bulk-result');
  if (!ids.length) { result.textContent = '请先勾选要操作的账号'; return; }
  if (!value) { result.textContent = '请先选择分类'; return; }
  result.textContent = '正在处理…';
  try {
    const response = await request('/api/admin/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, action, value })
    });
    result.textContent = `${action === 'add-list' ? '加入' : action === 'remove-list' ? '移出' : '设置'}分类成功，共处理 ${response.updated} 个账号`;
    await load();
  } catch (error) {
    result.textContent = `操作失败：${error.message}`;
  }
}

$('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  try {
    await request('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: $('#password').value })
    });
    $('#login-error').textContent = '';
    await load();
  } catch (error) {
    $('#login-error').textContent = error.message;
  }
};

$('#creator-form').onsubmit = async (event) => {
  event.preventDefault();
  const body = {
    id: $('#creator-id').value || undefined,
    username: $('#username').value,
    displayName: $('#display-name').value,
    followersCount: Number($('#followers').value),
    status: $('#status').value,
    avatarUrl: $('#avatar-url').value,
    bannerUrl: $('#banner-url').value,
    bio: $('#bio').value,
    lists: readFormLists(),
    verified: $('#verified').checked,
    hidden: $('#hidden').checked,
    watchEnabled: $('#watch-enabled').checked
  };
  await request('/api/admin/creators', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  resetForm();
  await load();
};

$('#reset-form').onclick = resetForm;

$('#add-category').onclick = () => {
  const value = $('#new-category').value.trim();
  if (!value) return;
  if (!allLists.includes(value)) {
    allLists.push(value);
    allLists.sort();
  }
  render();
  $('#new-category').value = '';
  const checkbox = document.querySelector(`#creator-list-options .category-checkbox[value="${CSS.escape(value)}"]`);
  if (checkbox) checkbox.checked = true;
};

$('#fetch-profile').onclick = async () => {
  const username = $('#username').value.trim();
  if (!username) return ($('#login-error').textContent = '请先输入 X 用户名');
  const button = $('#fetch-profile');
  button.disabled = true;
  button.textContent = '抓取中…';
  try {
    const profile = await request('/api/admin/fetch-profile', { method: 'POST', body: JSON.stringify({ username }) });
    $('#username').value = profile.username || username.replace(/^@/, '');
    $('#display-name').value = profile.displayName || '';
    $('#followers').value = profile.followersCount || 0;
    $('#avatar-url').value = profile.avatarUrl || '';
    $('#banner-url').value = profile.bannerUrl || '';
    $('#bio').value = profile.bio || '';
    $('#verified').checked = Boolean(profile.verified);
    $('#login-error').textContent = '';
    alert(`已抓取 @${profile.username} 的公开资料，请确认后点击“保存账号”`);
  } catch (error) {
    alert(`抓取失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '从 X 抓取资料';
  }
};

$('#admin-list').onclick = async (event) => {
  const editId = event.target.dataset.edit;
  const deleteId = event.target.dataset.delete;
  const refreshId = event.target.dataset.refresh;

  if (editId) {
    const creator = creators.find((item) => item.id === editId);
    openEdit(creator);
  }

  if (deleteId && confirm('确定删除这个账号吗？')) {
    await request(`/api/admin/creators/${encodeURIComponent(deleteId)}`, {
      method: 'DELETE'
    });
    await load();
  }

  if (refreshId) {
    const creator = creators.find((item) => item.id === refreshId);
    if (creator) await refreshExisting({ username: creator.username }, `刷新 @${creator.username}`);
  }
};

$('#select-all-creators').onchange = (event) => {
  document.querySelectorAll('.admin-row input[type="checkbox"].row-select').forEach((checkbox) => {
    checkbox.checked = event.target.checked;
  });
};

$('#admin-search').oninput = (event) => {
  adminSearch = event.target.value;
  render();
};

$('#bulk-add-category').onclick = () => bulkAction('add-list', $('#bulk-category').value);
$('#bulk-remove-category').onclick = () => bulkAction('remove-list', $('#bulk-category').value);

$('#delete-category-button').onclick = async () => {
  const name = $('#delete-category').value;
  const result = $('#bulk-result');
  if (!name) return (result.textContent = '请先选择要删除的分类');
  if (!confirm(`确定删除分类“${name}”吗？该分类会从所有账号中移除。`)) return;
  try {
    const response = await request(`/api/admin/lists/${encodeURIComponent(name)}`, { method: 'DELETE' });
    result.textContent = `分类“${name}”已删除，共从 ${response.updated} 个账号中移除`;
    await load();
  } catch (error) {
    result.textContent = `删除失败：${error.message}`;
  }
};

$('#bulk-watch-on').onclick = async () => {
  const ids = selectedIds();
  const result = $('#bulk-result');
  if (!ids.length) { result.textContent = '请先勾选要操作的账号'; return; }
  result.textContent = '正在设置…';
  try {
    const response = await request('/api/admin/bulk', { method: 'POST', body: JSON.stringify({ ids, action: 'set-watch', value: true }) });
    result.textContent = `已设置 ${response.updated} 个账号为重点关注`;
    await load();
  } catch (error) {
    result.textContent = `操作失败：${error.message}`;
  }
};

$('#bulk-watch-off').onclick = async () => {
  const ids = selectedIds();
  const result = $('#bulk-result');
  if (!ids.length) { result.textContent = '请先勾选要操作的账号'; return; }
  result.textContent = '正在取消…';
  try {
    const response = await request('/api/admin/bulk', { method: 'POST', body: JSON.stringify({ ids, action: 'set-watch', value: false }) });
    result.textContent = `已取消 ${response.updated} 个账号的重点关注`;
    await load();
  } catch (error) {
    result.textContent = `操作失败：${error.message}`;
  }
};

$('#refresh-by-list').onclick = async () => {
  const list = $('#refresh-list').value;
  if (!list) return ($('#refresh-result').textContent = '请先选择一个分类');
  await refreshExisting({ list }, `刷新分类“${list}”`);
};

$('#refresh-all').onclick = async () => {
  if (!confirm(`确定刷新全部 ${creators.length} 个现有账号吗？请求会逐个限速执行。`)) return;
  await refreshExisting({}, '刷新全部账号');
};

$('#trigger-sync-now').onclick = async () => {
  const result = $('#sync-result');
  result.textContent = '已触发后台同步，请稍后查看同步状态…';
  try {
    const response = await request('/api/admin/trigger-sync', { method: 'POST' });
    result.textContent = response.message;
    setTimeout(loadSyncHistory, 5000);
  } catch (error) {
    result.textContent = `触发失败：${error.message}`;
  }
};

$('#import-button').onclick = async () => {
  try {
    const body = JSON.parse($('#import-json').value);
    const result = await request('/api/admin/import', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    $('#import-result').textContent = `导入完成，当前共 ${result.count} 个账号`;
    await load();
  } catch (error) {
    $('#import-result').textContent = `导入失败：${error.message}`;
  }
};

$('#logout').onclick = async () => {
  await request('/api/admin/logout', { method: 'POST' });
  location.reload();
};

$('#proxy-form').onsubmit = async (event) => {
  event.preventDefault();
  const result = $('#proxy-result');
  result.textContent = '正在保存…';
  try {
    const value = await request('/api/admin/proxy-settings', {
      method: 'POST',
      body: JSON.stringify({
        proxyEnabled: $('#proxy-enabled').checked,
        proxyUrl: $('#proxy-url').value.trim()
      })
    });
    result.textContent = value.proxyEnabled
      ? '代理已启用，后续资料刷新将通过代理访问。'
      : '代理已关闭，将使用服务器默认出口。';
  } catch (error) {
    result.textContent = `保存失败：${error.message}`;
  }
};

$('#password-form').onsubmit = async (event) => {
  event.preventDefault();
  const result = $('#password-result');
  const newPassword = $('#new-password').value;
  const confirmPassword = $('#confirm-password').value;
  if (newPassword !== confirmPassword) {
    result.textContent = '两次输入的新密码不一致';
    return;
  }
  try {
    await request('/api/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: $('#current-password').value,
        newPassword,
        confirmPassword
      })
    });
    alert('管理密码修改成功，请使用新密码重新登录');
    location.reload();
  } catch (error) {
    result.textContent = `修改失败：${error.message}`;
  }
};

load();
