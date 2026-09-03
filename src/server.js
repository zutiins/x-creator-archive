const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ProxyAgent } = require('proxy-agent');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 39090);
const PASSWORD_FILE = path.join(ROOT, '.admin-password');
let adminPassword = fs.existsSync(PASSWORD_FILE)
  ? fs.readFileSync(PASSWORD_FILE, 'utf8').trim()
  : (process.env.ADMIN_PASSWORD || 'change-me-now');
const sessions = new Map();


function getProxyConfig() {
  const settings = readJson('settings.json', {});
  return {
    enabled: Boolean(settings.proxyEnabled),
    url: String(settings.proxyUrl || '').trim()
  };
}

function validateProxyUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  let parsed;
  try { parsed = new URL(url); }
  catch { throw new Error('代理地址格式不正确'); }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
    throw new Error('支持 HTTP、HTTPS、SOCKS5 和 SOCKS5H 代理');
  }
  return url;
}

function buildDispatcher() {
  const proxy = getProxyConfig();
  if (!proxy.enabled || !proxy.url) return undefined;
  return new ProxyAgent({ getProxyForUrl: () => proxy.url });
}

async function httpJson(url, timeoutMs = 15000) {
  const attempts = buildDispatcher() ? ['proxy', 'direct'] : ['direct'];
  let lastError;
  for (const mode of attempts) {
    const dispatcher = mode === 'proxy' ? buildDispatcher() : undefined;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'X-Creator-Vault/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
        ...(dispatcher ? { dispatcher } : {})
      });
      if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    } finally {
      if (dispatcher && typeof dispatcher.destroy === 'function') dispatcher.destroy();
    }
  }
  throw lastError || new Error('外部接口请求失败');
}

async function fetchXProfile(username) {
  const handle = String(username || '').replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('用户名格式不正确');
  const payload = await httpJson(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`);
  const user = payload.user;
  if (!user || !user.screen_name) throw new Error('找不到该 X 账号');
  return {
    username: user.screen_name,
    xUserId: String(user.id || ''),
    displayName: user.name || user.screen_name,
    bio: user.description || '',
    avatarUrl: user.avatar_url || '',
    bannerUrl: user.banner_url || '',
    followersCount: Number(user.followers || 0),
    verified: Boolean(user.blue_verified || user.verified || user.is_blue_verified),
    fetchedAt: new Date().toISOString()
  };
}

function extractMedia(tweet) {
  if (!tweet) return [];
  const bucket = (tweet.media && tweet.media.all) || tweet.media || [];
  if (!Array.isArray(bucket)) return [];
  return bucket.map(item => {
    if (!item) return null;
    if (item.type === 'photo' || item.type === 'image') {
      return { type: 'photo', url: item.url || item.preview_url || '' };
    }
    if (item.type === 'video' || item.type === 'gif') {
      return {
        type: item.type,
        url: item.url || '',
        thumbnail: item.thumbnail_url || item.preview_url || '',
        variants: Array.isArray(item.variants) ? item.variants : []
      };
    }
    if (typeof item.url === 'string') {
      return { type: 'photo', url: item.url };
    }
    return null;
  }).filter(Boolean);
}

async function fetchLatestTweet(username) {
  const handle = String(username || '').replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('用户名格式不正确');
  const attempts = buildDispatcher() ? ['proxy', 'direct'] : ['direct'];
  let html = '';
  let lastError;
  for (const mode of attempts) {
    const dispatcher = mode === 'proxy' ? buildDispatcher() : undefined;
    try {
      const response = await fetch(`https://x.com/${encodeURIComponent(handle)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(20000),
        ...(dispatcher ? { dispatcher } : {})
      });
      if (!response.ok) throw new Error(`X 页面返回 HTTP ${response.status}`);
      html = await response.text();
      break;
    } catch (error) {
      lastError = error;
    } finally {
      if (dispatcher && typeof dispatcher.destroy === 'function') dispatcher.destroy();
    }
  }
  if (!html) throw lastError || new Error('无法读取 X 账号页面');
  const pattern = new RegExp(`/${handle}/status/(\\d+)`, 'gi');
  const ids = [...html.matchAll(pattern)].map(match => match[1]);
  const id = [...new Set(ids)][0];
  if (!id) return null;
  const payload = await httpJson(`https://api.fxtwitter.com/${encodeURIComponent(handle)}/status/${id}`);
  const tweet = payload.tweet || payload;
  if (!tweet || !(tweet.id_str || tweet.id)) return null;
  return {
    id: String(tweet.id_str || tweet.id || ''),
    text: tweet.text || tweet.full_text || '',
    createdAt: tweet.created_at || tweet.tweet_created_at || null,
    url: tweet.url || `https://x.com/${handle}/status/${tweet.id_str || tweet.id}`,
    media: extractMedia(tweet),
    fetchedAt: new Date().toISOString()
  };
}

function mergeFetchedProfile(old, profile) {
  // Only refresh fields sourced from X. Preserve local classification and moderation state.
  return normalizeCreator({
    ...old,
    ...profile,
    lists: old.lists || [],
    hidden: old.hidden,
    status: old.status,
    id: old.id,
    firstSeenAt: old.firstSeenAt,
    lastSeenAt: new Date().toISOString()
  }, old);
}

async function refreshExistingCreators(creators, selected, options = {}) {
  const results = [];
  let consecutiveFailures = 0;
  const forceTweet = Boolean(options.forceTweet);
  for (const old of selected) {
    try {
      const profile = await fetchXProfile(old.username);
      Object.assign(old, mergeFetchedProfile(old, profile));
      const result = { username: old.username, ok: true, watchEnabled: Boolean(old.watchEnabled) };
      consecutiveFailures = 0;
      if (old.watchEnabled || forceTweet) {
        try {
          const tweet = await fetchLatestTweet(old.username);
          if (tweet) {
            old.latestTweet = tweet;
            old.latestTweetFetchedAt = tweet.fetchedAt;
            result.tweetFetched = true;
          } else {
            result.tweetFetched = false;
            result.tweetNote = '该账号暂无推文';
          }
        } catch (error) {
          result.tweetFetched = false;
          result.tweetError = error.message;
        }
      }
      results.push(result);
    } catch (error) {
      results.push({ username: old.username, ok: false, watchEnabled: Boolean(old.watchEnabled), error: error.message });
      consecutiveFailures += 1;
      // If we see 3 failures in a row, assume rate limit and abort the rest of the batch.
      if (consecutiveFailures >= 3 && old !== selected[selected.length - 1]) {
        const remaining = selected.length - selected.indexOf(old) - 1;
        results.push({ username: '*', ok: false, aborted: true, error: `检测到连续失败，停止本次刷新（剩 ${remaining} 个未处理）` });
        break;
      }
    }
    // Be polite to the public profile endpoint and avoid a burst on large archives.
    if (old !== selected[selected.length - 1]) await new Promise(resolve => setTimeout(resolve, 350));
  }
  return results;
}

function mergeLists(current, incoming) {
  const map = new Map((current || []).map(item => [String(item.name || item.id), item]));
  for (const item of incoming || []) {
    if (!item) continue;
    const key = String(item.name || item.id || '').trim();
    if (key && !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); }
  catch { return fallback; }
}

function writeJson(name, value) {
  const target = path.join(DATA_DIR, name);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, target);
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(value));
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1))];
  }));
}

function isAdmin(req) {
  const token = cookies(req).vault_session;
  return Boolean(token && sessions.has(token));
}

function extensionType(file) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function serveFile(res, pathname, req) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const stat = fs.statSync(file);
  const etag = `W/"${stat.size}-${stat.mtimeMs}"`;
  res.writeHead(200, {
    'Content-Type': extensionType(file),
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'ETag': etag,
    'Last-Modified': new Date(stat.mtimeMs).toUTCString()
  });
  // For admin.html, pre-render the login state based on the session cookie to avoid flash.
  if (pathname === '/admin.html') {
    let body = fs.readFileSync(file, 'utf8');
    if (isAdmin(req)) {
      body = body.replace('id="login-panel" class="admin-card narrow" hidden', 'id="login-panel" class="admin-card narrow" hidden')
                 .replace('id="dashboard" hidden', 'id="dashboard"');
    } else {
      body = body.replace('id="login-panel" class="admin-card narrow" hidden', 'id="login-panel" class="admin-card narrow"');
    }
    res.end(body);
    return true;
  }
  fs.createReadStream(file).pipe(res);
  return true;
}

function normalizeCreator(input, old = {}) {
  const username = String(input.username || old.username || '').replace(/^@/, '').trim();
  if (!username) throw new Error('username is required');
  return {
    id: old.id || input.id || crypto.randomUUID(),
    xUserId: input.xUserId || old.xUserId || '',
    username,
    displayName: input.displayName || old.displayName || username,
    bio: input.bio ?? old.bio ?? '',
    avatarUrl: input.avatarUrl ?? old.avatarUrl ?? '',
    bannerUrl: input.bannerUrl ?? old.bannerUrl ?? '',
    followersCount: Number(input.followersCount ?? old.followersCount ?? 0),
    clickCount: Math.max(0, Number(input.clickCount ?? old.clickCount ?? 0)),
    watchEnabled: Boolean(input.watchEnabled ?? old.watchEnabled ?? false),
    latestTweet: input.latestTweet !== undefined ? input.latestTweet : (old.latestTweet || null),
    latestTweetFetchedAt: input.latestTweetFetchedAt !== undefined ? input.latestTweetFetchedAt : (old.latestTweetFetchedAt || null),
    verified: Boolean(input.verified ?? old.verified ?? false),
    status: input.status || old.status || 'active',
    lists: Array.isArray(input.lists) ? [...new Set(input.lists.map(String))] : (old.lists || []),
    hidden: Boolean(input.hidden ?? old.hidden ?? false),
    firstSeenAt: old.firstSeenAt || input.firstSeenAt || new Date().toISOString(),
    lastSeenAt: input.lastSeenAt || new Date().toISOString()
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/public') {
      const isAuthed = isAdmin(req);
      let creators = readJson('creators.json', []);
      const lists = readJson('lists.json', []);
      const settings = readJson('settings.json', {});
      
      if (!isAuthed) {
        creators = creators.filter(item => !item.hidden && (item.lists || []).includes('推荐'));
      } else {
        creators = creators.filter(item => !item.hidden);
      }

      // Hide non-public fields from guests
      if (!isAuthed) {
        creators = creators.map(c => ({
          id: c.id,
          username: c.username,
          displayName: c.displayName,
          bio: c.bio,
          avatarUrl: c.avatarUrl,
          bannerUrl: c.bannerUrl,
          followersCount: c.followersCount,
          clickCount: c.clickCount,
          verified: c.verified,
          status: c.status,
          lists: c.lists
        }));
      }

      return sendJson(res, 200, {
        authenticated: isAuthed,
        capabilities: {
          viewAll: isAuthed,
          manageCreators: isAuthed,
          viewCategories: isAuthed
        },
        creators,
        lists,
        settings
      });
    }

    if (req.method === 'POST' && pathname === '/api/public/click') {
      // Allow guest click counting for available creators
      const body = await bodyJson(req);
      const id = String(body.id || '');
      if (!id) return sendJson(res, 400, { error: '缺少创作者 ID' });
      const creators = readJson('creators.json', []);
      const isAuthed = isAdmin(req);
      const creator = creators.find(item => item.id === id && !item.hidden && (isAuthed || (item.lists || []).includes('推荐')));
      if (!creator) return sendJson(res, 404, { error: '创作者不存在' });
      creator.clickCount = Math.max(0, Number(creator.clickCount || 0)) + 1;
      writeJson('creators.json', creators);
      return sendJson(res, 200, { ok: true, clickCount: creator.clickCount });
    }

    if (req.method === 'POST' && pathname === '/api/admin/login') {
      const body = await bodyJson(req);
      if (body.password !== adminPassword) return sendJson(res, 401, { error: '密码错误' });
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now());
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `vault_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400` });
    }

    if (req.method === 'POST' && pathname === '/api/admin/logout') {
      const token = cookies(req).vault_session;
      if (token) sessions.delete(token);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'vault_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    if (pathname.startsWith('/api/admin/') && !isAdmin(req)) return sendJson(res, 401, { error: '请先登录' });

    if (req.method === 'GET' && pathname === '/api/admin/sync-history') {
      return sendJson(res, 200, readJson('sync-history.json', []));
    }

    if (req.method === 'POST' && pathname === '/api/admin/trigger-sync') {
      // Run the background sync process without waiting
      const { exec } = require('child_process');
      exec('node scripts/sync-watch-tweets.mjs', { cwd: ROOT }, (error, stdout, stderr) => {
        if (error) {
          console.error(`自动同步后台触发异常: ${error.message}`);
          return;
        }
        console.log(`自动同步后台手动触发完成:\n${stdout}`);
      });
      return sendJson(res, 200, { ok: true, message: '同步任务已在后台启动，可在页面刷新查看最后同步状态。' });
    }

    if (req.method === 'POST' && pathname === '/api/admin/change-password') {
      const body = await bodyJson(req);
      if (body.currentPassword !== adminPassword) return sendJson(res, 400, { error: '当前密码不正确' });
      const nextPassword = String(body.newPassword || '');
      if (nextPassword.length < 8) return sendJson(res, 400, { error: '新密码至少需要 8 位' });
      if (nextPassword !== String(body.confirmPassword || '')) return sendJson(res, 400, { error: '两次输入的新密码不一致' });
      fs.writeFileSync(PASSWORD_FILE, `${nextPassword}\n`, { mode: 0o600 });
      adminPassword = nextPassword;
      sessions.clear();
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'vault_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    if (req.method === 'POST' && pathname === '/api/admin/proxy-settings') {
      const body = await bodyJson(req);
      const settings = readJson('settings.json', {});
      const proxyUrl = validateProxyUrl(body.proxyUrl);
      if (body.proxyEnabled && !proxyUrl) return sendJson(res, 400, { error: '启用代理前请填写代理地址' });
      writeJson('settings.json', {
        ...settings,
        proxyEnabled: Boolean(body.proxyEnabled),
        proxyUrl
      });
      return sendJson(res, 200, { ok: true, proxyEnabled: Boolean(body.proxyEnabled) });
    }

    if (req.method === 'POST' && pathname === '/api/admin/fetch-profile') {
      const body = await bodyJson(req);
      return sendJson(res, 200, await fetchXProfile(body.username));
    }

    if (req.method === 'POST' && pathname === '/api/admin/refresh-creators') {
      const body = await bodyJson(req);
      const creators = readJson('creators.json', []);
      let selected = creators;
      if (body.username) {
        const username = String(body.username).replace(/^@/, '').toLowerCase();
        selected = creators.filter(item => item.username.toLowerCase() === username);
      } else if (body.list) {
        selected = creators.filter(item => (item.lists || []).includes(String(body.list)));
      }
      // Limit manual refresh to at most 5 accounts to protect the public endpoint.
      if (selected.length > 5) selected = selected.slice(0, 5);
      const results = await refreshExistingCreators(creators, selected, { forceTweet: Boolean(body.username) });
      writeJson('creators.json', creators);
      return sendJson(res, 200, {
        ok: true,
        total: results.length,
        success: results.filter(item => item.ok).length,
        failed: results.filter(item => !item.ok).length,
        results
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/refresh-tweet') {
      const body = await bodyJson(req);
      const id = String(body.id || '');
      if (!id) return sendJson(res, 400, { error: '缺少创作者 ID' });
      const creators = readJson('creators.json', []);
      const creator = creators.find(item => item.id === id);
      if (!creator) return sendJson(res, 404, { error: '创作者不存在' });
      try {
        const tweet = await fetchLatestTweet(creator.username);
        if (tweet) {
          creator.latestTweet = tweet;
          creator.latestTweetFetchedAt = tweet.fetchedAt;
          creator.lastSeenAt = tweet.fetchedAt;
          writeJson('creators.json', creators);
          return sendJson(res, 200, { ok: true, tweet });
        }
        return sendJson(res, 200, { ok: true, tweet: null, note: '该账号暂无推文' });
      } catch (error) {
        return sendJson(res, 502, { ok: false, error: error.message });
      }
    }

    if (req.method === 'GET' && pathname === '/api/admin/data') {
      return sendJson(res, 200, {
        creators: readJson('creators.json', []),
        lists: readJson('lists.json', []),
        settings: readJson('settings.json', {})
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/bulk') {
      const body = await bodyJson(req);
      const ids = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
      const action = String(body.action || '');
      if (!ids.size) return sendJson(res, 400, { error: '请至少选择一个账号' });
      if (!['add-list', 'remove-list', 'set-watch'].includes(action)) {
        return sendJson(res, 400, { error: '不支持的批量操作' });
      }

      const creators = readJson('creators.json', []);
      let updated = 0;
      for (const creator of creators) {
        if (!ids.has(String(creator.id))) continue;
        if (action === 'add-list') {
          const listName = String(body.value || '').trim();
          if (!listName) return sendJson(res, 400, { error: '分类名称不能为空' });
          creator.lists = [...new Set([...(creator.lists || []), listName])];
        } else if (action === 'remove-list') {
          const listName = String(body.value || '').trim();
          if (!listName) return sendJson(res, 400, { error: '分类名称不能为空' });
          creator.lists = (creator.lists || []).filter(item => item !== listName);
        } else {
          creator.watchEnabled = Boolean(body.value);
        }
        creator.lastSeenAt = creator.lastSeenAt || new Date().toISOString();
        updated += 1;
      }

      writeJson('creators.json', creators);
      if (action === 'add-list') {
        const listName = String(body.value || '').trim();
        const lists = readJson('lists.json', []);
        if (!lists.some(item => String(item.name || item.id).toLowerCase() === listName.toLowerCase())) {
          lists.push({ id: crypto.randomUUID(), name: listName, description: '', isActive: true });
          writeJson('lists.json', lists);
        }
      }
      return sendJson(res, 200, { ok: true, updated });
    }

    if (req.method === 'POST' && pathname === '/api/admin/creators') {
      const body = await bodyJson(req);
      const creators = readJson('creators.json', []);
      const old = creators.find(item => item.id === body.id || item.username.toLowerCase() === String(body.username || '').replace(/^@/, '').toLowerCase());
      const creator = normalizeCreator(body, old);
      const next = old ? creators.map(item => item.id === old.id ? creator : item) : [creator, ...creators];
      writeJson('creators.json', next);
      // Synchronize back newly created lists dynamically to lists.json if any
      const lists = readJson('lists.json', []);
      let listsUpdated = false;
      for (const name of creator.lists || []) {
        if (!lists.some(item => String(item.name || item.id).toLowerCase() === name.toLowerCase())) {
          lists.push({ id: crypto.randomUUID(), name, description: '', isActive: true });
          listsUpdated = true;
        }
      }
      if (listsUpdated) writeJson('lists.json', lists);
      return sendJson(res, 200, creator);
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/admin/lists/')) {
      const name = decodeURIComponent(pathname.slice('/api/admin/lists/'.length)).trim();
      if (!name) return sendJson(res, 400, { error: '分类名称不能为空' });
      const lists = readJson('lists.json', []);
      const nextLists = lists.filter(item => String(item.name || item.id) !== name);
      if (nextLists.length === lists.length) return sendJson(res, 404, { error: '分类不存在' });
      const creators = readJson('creators.json', []);
      let updated = 0;
      for (const creator of creators) {
        const before = Array.isArray(creator.lists) ? creator.lists.length : 0;
        creator.lists = (creator.lists || []).filter(item => item !== name);
        if (creator.lists.length !== before) updated += 1;
      }
      writeJson('lists.json', nextLists);
      writeJson('creators.json', creators);
      return sendJson(res, 200, { ok: true, updated });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/admin/creators/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      writeJson('creators.json', readJson('creators.json', []).filter(item => item.id !== id));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/admin/import') {
      const body = await bodyJson(req);
      if (!Array.isArray(body.creators)) return sendJson(res, 400, { error: 'creators 必须是数组' });
      const current = readJson('creators.json', []);
      const byUsername = new Map(current.map(item => [item.username.toLowerCase(), item]));
      for (const input of body.creators) {
        const key = String(input.username || '').replace(/^@/, '').toLowerCase();
        if (!key) continue;
        byUsername.set(key, normalizeCreator(input, byUsername.get(key)));
      }
      writeJson('creators.json', [...byUsername.values()]);
      if (Array.isArray(body.lists)) writeJson('lists.json', mergeLists(readJson('lists.json', []), body.lists));
      return sendJson(res, 200, { ok: true, count: byUsername.size });
    }

    if (req.method === 'GET' && pathname === '/health') return sendJson(res, 200, { ok: true, service: 'x-creator-archive' });
    if (serveFile(res, pathname, req)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`X Creator Vault listening on http://127.0.0.1:${PORT}`));
