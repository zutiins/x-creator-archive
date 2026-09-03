let data={creators:[],lists:[],settings:{}};
let active='all';
let authed=false;

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(n||0);

function isGuest(){return !authed}

function card(c){
  const initial=esc((c.displayName||c.username||'?')[0]);
  const avatar=c.avatarUrl?`<img src="${esc(c.avatarUrl)}" alt="">`:initial;
  const tags=(c.lists||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('');
  return `<article class="creator" data-id="${esc(c.id)}"><div class="banner"${c.bannerUrl?` style="background-image:url('${esc(c.bannerUrl)}')"`:''}></div><div class="creator-body"><div class="creator-card-head"><div class="avatar">${avatar}</div><a class="x-direct" data-x-id="${esc(c.id)}" href="https://x.com/${encodeURIComponent(c.username)}" target="_blank" rel="noopener" aria-label="直接打开 @${esc(c.username)} 的 X 主页">打开 X ↗</a></div><h3>${esc(c.displayName)} ${c.verified?'<span class="badge">✓</span>':''}</h3><div class="handle">@${esc(c.username)} ${c.watchEnabled?'<span class="watch-badge">重点关注</span>':''}</div><p class="bio">${esc(c.bio||'暂无简介')}</p><div class="tags">${tags}</div><div class="creator-meta"><span>${fmt(c.followersCount)} 粉丝</span><span>${c.status==='active'?'正常':'已归档'}</span></div></div></article>`;
}

function filtered(){
  const q=$('#search').value.trim().toLowerCase();
  let rows=data.creators.filter(c=>active==='all'||active==='verified'&&c.verified||active==='archived'&&c.status!=='active'||(c.lists||[]).includes(active)).filter(c=>!q||[c.username,c.displayName,c.bio,...(c.lists||[])].join(' ').toLowerCase().includes(q));
  const sort=$('#sort').value;
  rows.sort((a,b)=>{
    // 重点关注置顶，仅对已登录用户
    if (authed) {
      const aw=Boolean(a.watchEnabled)?1:0;
      const bw=Boolean(b.watchEnabled)?1:0;
      if (aw!==bw) return bw-aw;
    }
    if (sort==='clicks') {
      return (b.clickCount||0)-(a.clickCount||0);
    }
    return sort==='followers'?(b.followersCount||0)-(a.followersCount||0):sort==='name'?String(a.displayName).localeCompare(String(b.displayName)):String(b.firstSeenAt).localeCompare(String(a.firstSeenAt));
  });
  return rows;
}

function bindCards(root=document){
  root.querySelectorAll('.creator').forEach(el=>{
    el.onclick=(event)=>{
      if(event.target.closest('.x-direct'))return;
      show(el.dataset.id);
    };
  });
  root.querySelectorAll('.x-direct').forEach(link=>{
    link.onclick=(event)=>{event.stopPropagation()};
    link.onpointerdown=(event)=>event.stopPropagation();
  });
}

function render(){
  const rows=filtered();
  $('#creators').innerHTML=rows.map(card).join('');
  $('#empty').hidden=rows.length>0;
  bindCards($('#creators'));
}

function filters(){
  // 游客模式不显示分类栏
  if (isGuest()) {
    $('#filters').style.display='none';
    return;
  }
  $('#filters').style.display='';
  const names=[...new Set([...data.lists.map(x=>x.name),...data.creators.flatMap(x=>x.lists||[])])];
  $('#filters').innerHTML=[['all','全部'],['verified','已认证'],...names.map(x=>[x,x]),['archived','赛博坟场']].map(([id,name])=>`<button data-filter="${esc(id)}" class="${id===active?'active':''}">${esc(name)}</button>`).join('');
  $('#filters').onclick=e=>{
    if(!e.target.dataset.filter)return;
    active=e.target.dataset.filter;
    filters();
    render();
  };
}

function spotlight(){
  const activeRows=data.creators.filter(c=>c.status==='active');
  // 游客只从推荐分类抽
  const pool=authed?activeRows:activeRows.filter(c=>(c.lists||[]).includes('推荐'));
  const count=Math.min(data.settings.spotlightCount||3,pool.length);
  const rows=[...pool].sort(()=>Math.random()-.5).slice(0,count);
  $('#spotlight').innerHTML=rows.map(card).join('');
  bindCards($('#spotlight'));
  // 游客无推荐账号时给出提示
  if (!authed && !pool.length) {
    $('#spotlight').innerHTML='<p class="muted">暂无推荐账号，请管理员登录后在账号详情或后台添加“推荐”分类。</p>';
  }
}

function dateText(value){
  if(!value)return '暂无记录';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'暂无记录':date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}

function relatedCreators(c){
  const categories=new Set(c.lists||[]);
  return data.creators.filter(item=>item.id!==c.id&&item.status==='active'&&!item.hidden&&(item.lists||[]).some(name=>categories.has(name))).slice(0,3);
}

function renderTweet(tweet,creator){
  if(!tweet)return '';
  const mediaHtml=(tweet.media||[]).map(m=>{
    if(m.type==='video'||m.type==='gif'){
      return m.url?`<div class="tweet-media-item video-item"><video controls playsinline preload="metadata" poster="${esc(m.thumbnail||'')}"><source src="${esc(m.url)}"></video></div>`:`<div class="tweet-media-item video-item"><a href="${esc(tweet.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(m.thumbnail||'')}" alt="视频封面"><span class="play-icon">▶</span></a></div>`;
    }
    return `<div class="tweet-media-item photo-item"><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(m.url)}" alt="推文图片"></a></div>`;
  }).join('');
  const avatar=creator.avatarUrl?`<img src="${esc(creator.avatarUrl)}" alt="">`:`<span>${esc((creator.displayName||creator.username||'?')[0])}</span>`;
  return `<article class="tweet-card"><header class="tweet-author"><div class="tweet-avatar">${avatar}</div><div class="tweet-author-info"><strong>${esc(creator.displayName||creator.username)} ${creator.verified?'<span class="tweet-verified">✓</span>':''}</strong><span>@${esc(creator.username)}</span></div><span class="tweet-x-logo">𝕏</span></header><div class="tweet-text">${esc(tweet.text||'')}</div>${mediaHtml?`<div class="tweet-media-grid media-count-${Math.min((tweet.media||[]).length,4)}">${mediaHtml}</div>`:''}<footer class="tweet-footer"><time>${dateText(tweet.createdAt)}</time><a href="${esc(tweet.url)}" target="_blank" rel="noopener noreferrer">在 X 查看 ↗</a></footer></article>`;
}

async function refreshCreator(id, button){
  const c=data.creators.find(x=>x.id===id);
  if(!c)return;
  if(button){
    button.disabled=true;
    button.classList.add('loading');
    button.textContent='刷新中…';
  }
  const msg=$('#quick-action-msg');
  if(msg) msg.textContent='正在刷新资料和推文，请稍候…';
  try{
    const res=await fetch('/api/admin/refresh-creators',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:c.username})
    });
    const value=await res.json();
    if(!res.ok) throw new Error(value.error||'刷新失败');
    // 重新拉取数据（已验证会话，返回完整字段）
    const r=await fetch('/api/public');
    data=await r.json();
    const updated=data.creators.find(x=>x.id===id);
    if(updated){
      Object.assign(c,updated);
      const details=(value.results||[]).find(x=>x.username===c.username);
      const tweetText=details&&details.tweetFetched?'推文已更新':(details&&details.tweetError?`推文失败：${details.tweetError}`:(details&&details.tweetNote?details.tweetNote:''));
      if(msg) msg.textContent=`刷新成功${tweetText?` · ${tweetText}`:''}`;
    }
    render();
    spotlight();
    // Keep the detail dialog in place; update its displayed fields without closing it.
    show(id);
    if(button){
      button.disabled=false;
      button.classList.remove('loading');
      button.textContent='刷新资料和推文';
    }
  }catch(error){
    if(msg) msg.textContent=`刷新失败：${error.message}`;
    if(button){
      button.disabled=false;
      button.classList.remove('loading');
      button.textContent='刷新资料和推文';
    }
  }
}

function renderQuickActions(c){
  if(isGuest()) return '';
  const all=data.lists||[];
  const creatorsLists=data.creators.flatMap(x=>x.lists||[]);
  const names=[...new Set([...all.map(l=>l.name||l.id).filter(Boolean),...creatorsLists])];
  if (!names.includes('推荐')) names.push('推荐'); // 确保“推荐”总是显示，方便老板一键设置
  const chipsHtml=names.map(name=>{
    const on=(c.lists||[]).includes(name);
    return `<button type="button" class="cat-chip ${on?'on':''}" data-cat="${esc(name)}">${on?'✓ ':''}${esc(name)}</button>`;
  }).join('');
  return `<section class="detail-quick-actions">
    <h3>快捷管理</h3>
    <div class="quick-action-row">
      <button id="quick-refresh" class="primary">刷新资料和推文</button>
    </div>
    <div class="quick-action-row">
      <span class="field-label">分类（点击即切换）</span>
      <div class="cat-chips">${chipsHtml}</div>
    </div>
    <p id="quick-action-msg" class="quick-action-msg"></p>
  </section>`;
}

function show(id){
  const c=data.creators.find(x=>x.id===id);
  if(!c)return;
  // 游客点非推荐账号不应发生，前端仅显示推荐账号；后端也会拒绝
  fetch('/api/public/click',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}).then(r=>r.json()).then(res=>{if(res.ok){c.clickCount=res.clickCount;render()}}).catch(()=>{});
  const related=relatedCreators(c);
  const source=c.xUserId?'X 账号资料 / 本地存档':'本地手工录入';
  $('#detail-content').innerHTML=`<div class="detail-banner"${c.bannerUrl?` style="background-image:url('${esc(c.bannerUrl)}')"`:''}></div><div class="detail-body rich-detail"><div class="detail-heading"><div class="avatar detail-avatar">${c.avatarUrl?`<img src="${esc(c.avatarUrl)}" alt="">`:esc((c.displayName||c.username||'?')[0])}</div><div class="detail-title"><h2>${esc(c.displayName)} ${c.verified?'<span class="badge">✓</span>':''}</h2><p class="handle">@${esc(c.username)}</p></div>${isGuest()?'':`<button type="button" id="quick-watch" class="quick-watch ${c.watchEnabled?'on':''}">${c.watchEnabled?'✓ 重点关注':'＋ 重点关注'}</button>`}</div><p class="detail-bio">${esc(c.bio||'暂无简介')}</p><div class="tags">${(c.lists||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div><div class="detail-stats"><div><strong>${fmt(c.followersCount)}</strong><span>粉丝数</span></div><div><strong>${Number(c.clickCount||0).toLocaleString('zh-CN')}</strong><span>本站点击</span></div><div><strong>${c.status==='active'?'正常':'已归档'}</strong><span>账号状态</span></div></div><section class="detail-section"><h3>存档信息</h3><div class="detail-info-grid"><div><strong>${dateText(c.firstSeenAt)}</strong><span>首次录入时间</span></div><div><strong>${dateText(c.lastSeenAt)}</strong><span>资料刷新时间</span></div><div><strong>${esc(source)}</strong><span>资料来源</span></div><div><strong>${c.latestTweetFetchedAt?dateText(c.latestTweetFetchedAt):'未抓取'}</strong><span>推文同步时间</span></div></div></section>${c.watchEnabled&&c.latestTweet?`<section class="detail-section tweet-section"><h3>最新推文</h3>${renderTweet(c.latestTweet,c)}</section>`:''}<section class="detail-section"><div class="detail-section-head"><h3>同分类账号</h3><span>最多显示 3 个</span></div><div class="related-creators">${related.length?related.map(item=>`<button class="related-account" data-related-id="${esc(item.id)}"><span class="related-avatar">${item.avatarUrl?`<img src="${esc(item.avatarUrl)}" alt="">`:esc((item.displayName||item.username||'?')[0])}</span><span><strong>${esc(item.displayName)}</strong><small>@${esc(item.username)}</small></span></button>`).join(''):'<p class="muted">暂无同分类账号</p>'}</div></section><div class="detail-actions"><a class="primary-link" href="https://x.com/${encodeURIComponent(c.username)}" target="_blank" rel="noopener noreferrer">在浏览器打开 X 主页 ↗</a></div>${renderQuickActions(c)}</div>`;
  $('#detail-content').querySelectorAll('.related-account').forEach(button=>button.onclick=()=>show(button.dataset.relatedId));
  // 快捷刷新
  const refreshBtn=$('#quick-refresh');
  if(refreshBtn) refreshBtn.onclick=()=>refreshCreator(c.id,refreshBtn);
  // 单账号重点关注开关
  const watchBtn=$('#quick-watch');
  if(watchBtn) watchBtn.onclick=async()=>{
    watchBtn.disabled=true;
    try{
      const next=!Boolean(c.watchEnabled);
      const res=await fetch('/api/admin/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[c.id],action:'set-watch',value:next})});
      const result=await res.json();
      if(!res.ok) throw new Error(result.error||'操作失败');
      c.watchEnabled=next;
      render();
      spotlight();
      show(c.id);
    }catch(error){
      const msg=$('#quick-action-msg');
      if(msg){msg.textContent=`操作失败：${error.message}`;msg.classList.add('show')}
      watchBtn.disabled=false;
    }
  };
  // 分类即时切换：点击 chip 即添加/移出
  $('#detail-content').querySelectorAll('.cat-chip').forEach(chip=>{
    chip.onclick=async()=>{
      const name=chip.dataset.cat;
      const msg=$('#quick-action-msg');
      const adding=!chip.classList.contains('on');
      try{
        const res=await fetch('/api/admin/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[c.id],action:adding?'add-list':'remove-list',value:name})});
        const result=await res.json();
        if(!res.ok) throw new Error(result.error||'操作失败');
        if(adding){
          c.lists=[...new Set([...(c.lists||[]),name])];
        }else{
          c.lists=(c.lists||[]).filter(x=>x!==name);
        }
        if(msg){
          msg.textContent=adding?`已添加到分类“${name}”`:`已从分类“${name}”移出`;
          msg.classList.add('show');
        }
        // 局部刷新
        render();
        filters();
        show(c.id);
      }catch(error){
        if(msg){
          msg.textContent=`操作失败：${error.message}`;
          msg.classList.add('show');
        }
      }
    };
  });
  if(!$('#detail').open) $('#detail').showModal();
}

function renderAuthBar(){
  const bar=$('#auth-bar');
  if(isGuest()){
    bar.innerHTML=`<div class="auth-inner"><span class="auth-lock" aria-hidden="true">🔒</span><form id="auth-form"><input id="auth-password" type="password" placeholder="输入管理密码以查看全部内容" autocomplete="current-password" required><button>验证访问</button></form><span id="auth-error" class="auth-error">密码错误，请重试</span></div>`;
    $('#auth-form').onsubmit=async(event)=>{
      event.preventDefault();
      const pwd=$('#auth-password').value;
      const error=$('#auth-error');
      error.classList.remove('show');
      try{
        const res=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwd})});
        const value=await res.json();
        if(!res.ok) throw new Error(value.error||'密码错误');
        authed=true;
        renderAuthBar();
        await loadData();
      }catch(err){
        error.textContent=err.message||'密码错误';
        error.classList.add('show');
      }
    };
  }else{
    bar.innerHTML=`<div class="auth-inner"><span class="auth-status">已进入私密模式</span><a class="auth-admin-link" href="/admin.html">管理后台</a><button id="auth-logout" class="logout-btn">退出</button></div>`;
    $('#auth-logout').onclick=async()=>{
      await fetch('/api/admin/logout',{method:'POST'});
      authed=false;
      renderAuthBar();
      await loadData();
    };
  }
}

async function loadData(){
  const r=await fetch('/api/public');
  data=await r.json();
  authed=Boolean(data.authenticated);
  renderAuthBar();
  document.title=data.settings.siteName||'X Creator Vault';
  $('#site-name').textContent=data.settings.siteName||'X Creator Vault';
  $('#site-description').textContent=data.settings.description||'公开创作者资料的本地备份与分类画廊';
  $('#total-count').textContent=data.creators.length;
  $('#verified-count').textContent=data.creators.filter(c=>c.verified).length;
  $('#list-count').textContent=data.lists.length;
  $('#archive-count').textContent=data.creators.filter(c=>c.status!=='active').length;
  active='all';
  filters();
  render();
  spotlight();
}

async function init(){
  await loadData();
}

$('#search').oninput=render;
$('#sort').onchange=render;
$('#shuffle').onclick=spotlight;
$('.dialog-close').onclick=()=>$('#detail').close();
init().catch(()=>{
  $('#empty').hidden=false;
  $('#empty').textContent='读取本地数据失败，请稍后重试。';
});