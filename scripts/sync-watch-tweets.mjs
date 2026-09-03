#!/usr/bin/env node
/**
 * sync-watch-tweets.mjs
 * 每日自动同步重点关注账号的最新推文。
 * 被 cron 隔离任务调用，也可手动执行。
 *
 * 流程：
 * 1. 读取 data/creators.json
 * 2. 筛选 watchEnabled === true 的账号
 * 3. 逐个刷新资料 + 抓取最新推文
 * 4. 账号间加入 3-8 秒随机间隔
 * 5. 连续失败 3 次停止
 * 6. 保存同步历史到 data/sync-history.json
 * 7. 更新 creators.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CREATORS_FILE = path.join(DATA_DIR, 'creators.json');
const HISTORY_FILE = path.join(DATA_DIR, 'sync-history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const MAX_HISTORY = 30; // 保留最近 30 次同步记录
const MIN_DELAY = 3000;
const MAX_DELAY = 8000;
const REQUEST_TIMEOUT = 20000;
const MAX_CONSECUTIVE_FAILURES = 3;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function getProxyConfig() {
  const settings = readJson(SETTINGS_FILE, {});
  return {
    enabled: Boolean(settings.proxyEnabled),
    url: String(settings.proxyUrl || '').trim()
  };
}

function buildDispatcher() {
  const proxy = getProxyConfig();
  if (!proxy.enabled || !proxy.url) return undefined;
  // proxy-agent is a CJS module, use dynamic import
  try {
    const { ProxyAgent } = require('proxy-agent');
    return new ProxyAgent({ getProxyForUrl: () => proxy.url });
  } catch {
    return undefined;
  }
}

async function httpJson(url) {
  const dispatcher = buildDispatcher();
  const attempts = dispatcher ? ['proxy', 'direct'] : ['direct'];
  let lastError;
  for (const mode of attempts) {
    const d = mode === 'proxy' ? buildDispatcher() : undefined;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'X-Creator-Vault/1.0' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        ...(d ? { dispatcher: d } : {})
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    } finally {
      if (d && typeof d.destroy === 'function') d.destroy();
    }
  }
  throw lastError || new Error('请求失败');
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
    if (typeof item.url === 'string') return { type: 'photo', url: item.url };
    return null;
  }).filter(Boolean);
}

async function fetchLatestTweet(username) {
  const handle = String(username || '').replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('用户名格式不正确');
  const dispatcher = buildDispatcher();
  const attempts = dispatcher ? ['proxy', 'direct'] : ['direct'];
  let html = '';
  let lastError;
  for (const mode of attempts) {
    const d = mode === 'proxy' ? buildDispatcher() : undefined;
    try {
      const response = await fetch(`https://x.com/${encodeURIComponent(handle)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        ...(d ? { dispatcher: d } : {})
      });
      if (!response.ok) throw new Error(`X 页面返回 HTTP ${response.status}`);
      html = await response.text();
      break;
    } catch (error) {
      lastError = error;
    } finally {
      if (d && typeof d.destroy === 'function') d.destroy();
    }
  }
  if (!html) throw lastError || new Error('无法读取 X 账号页面');
  const pattern = new RegExp(`/${handle}/status/(\\d+)`, 'gi');
  const ids = [...html.matchAll(pattern)].map(m => m[1]);
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

function randomDelay() {
  const ms = MIN_DELAY + Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY));
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const startedAt = new Date().toISOString();
  const creators = readJson(CREATORS_FILE, []);
  const watchList = creators.filter(c => c.watchEnabled);
  
  console.log(`[同步开始] ${startedAt}`);
  console.log(`重点关注账号共 ${watchList.length} 个`);
  
  if (watchList.length === 0) {
    console.log('没有重点关注账号，跳过同步。');
    const history = readJson(HISTORY_FILE, []);
    history.unshift({
      startedAt,
      finishedAt: new Date().toISOString(),
      total: 0,
      success: 0,
      failed: 0,
      tweetsFetched: 0,
      results: []
    });
    writeJson(HISTORY_FILE, history.slice(0, MAX_HISTORY));
    return;
  }
  
  const results = [];
  let consecutiveFailures = 0;
  let successCount = 0;
  let failedCount = 0;
  let tweetsFetched = 0;
  
  for (let i = 0; i < watchList.length; i++) {
    const creator = watchList[i];
    const username = creator.username;
    console.log(`[${i + 1}/${watchList.length}] @${username} …`);
    
    const result = { username, ok: false, tweetFetched: false };
    
    try {
      // 刷新资料
      const profile = await fetchXProfile(username);
      Object.assign(creator, {
        ...creator,
        ...profile,
        lists: creator.lists || [],
        hidden: creator.hidden,
        status: creator.status,
        id: creator.id,
        firstSeenAt: creator.firstSeenAt,
        lastSeenAt: new Date().toISOString()
      });
      result.ok = true;
      successCount++;
      consecutiveFailures = 0;
      
      // 抓取最新推文
      try {
        const tweet = await fetchLatestTweet(username);
        if (tweet) {
          creator.latestTweet = tweet;
          creator.latestTweetFetchedAt = tweet.fetchedAt;
          result.tweetFetched = true;
          tweetsFetched++;
          console.log(`  ✅ 推文已同步: ${tweet.id}`);
        } else {
          result.tweetNote = '该账号暂无推文';
          console.log(`  ⚠️ 暂无推文`);
        }
      } catch (tweetError) {
        result.tweetError = tweetError.message;
        console.log(`  ⚠️ 推文抓取失败: ${tweetError.message}`);
      }
    } catch (error) {
      result.error = error.message;
      failedCount++;
      consecutiveFailures++;
      console.log(`  ❌ 失败: ${error.message}`);
      
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && i < watchList.length - 1) {
        const remaining = watchList.length - i - 1;
        results.push(result);
        results.push({
          username: '*',
          ok: false,
          aborted: true,
          error: `连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，停止同步（剩 ${remaining} 个未处理）`
        });
        console.log(`\n⚠️ 连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，停止本次同步。`);
        break;
      }
    }
    
    results.push(result);
    
    // 账号间随机间隔
    if (i < watchList.length - 1) {
      const delay = MIN_DELAY + Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY));
      console.log(`  等待 ${(delay / 1000).toFixed(1)}s …`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // 保存更新后的 creators
  writeJson(CREATORS_FILE, creators);
  
  // 保存同步历史
  const finishedAt = new Date().toISOString();
  const history = readJson(HISTORY_FILE, []);
  history.unshift({
    startedAt,
    finishedAt,
    total: watchList.length,
    success: successCount,
    failed: failedCount,
    tweetsFetched,
    consecutiveFailures: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES,
    results
  });
  writeJson(HISTORY_FILE, history.slice(0, MAX_HISTORY));
  
  console.log(`\n[同步完成] ${finishedAt}`);
  console.log(`资料刷新: 成功 ${successCount}, 失败 ${failedCount}`);
  console.log(`推文同步: ${tweetsFetched} 个成功`);
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.log(`⚠️ 因连续失败提前终止`);
  }
  console.log(`同步历史已保存 (${history.length} 条)`);
}

main().catch(error => {
  console.error('同步脚本异常:', error.message);
  process.exit(1);
});
