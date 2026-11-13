const STORAGE_KEY='washflow_v1';
const STATUS_CONFIG={
  pending:   {label:'Pending Pickup',  bg:'bg-amber-100', text:'text-amber-700', border:'border-amber-300', dot:'bg-amber-400'},
  collected: {label:'At Facility',     bg:'bg-blue-100',  text:'text-blue-700',  border:'border-blue-300',  dot:'bg-blue-400'},
  processing:{label:'In Processing',   bg:'bg-indigo-100',text:'text-indigo-700',border:'border-indigo-300',dot:'bg-indigo-400'},
  delivery:  {label:'Out for Delivery',bg:'bg-purple-100',text:'text-purple-700',border:'border-purple-300',dot:'bg-purple-400'},
  completed: {label:'Delivered',       bg:'bg-green-100', text:'text-green-700', border:'border-green-300', dot:'bg-green-400'}
};
const STATUS_KEYS=['pending','collected','processing','delivery','completed'];
const SERVICE_CONFIG={
  'wash-fold':   {label:'Wash & Fold', bg:'bg-blue-100',  text:'text-blue-700'},
  'dry-cleaning':{label:'Dry Cleaning',bg:'bg-purple-100',text:'text-purple-700'},
  'ironing':     {label:'Ironing Only',bg:'bg-orange-100',text:'text-orange-700'}
};
const PRIORITY_CONFIG={
  normal: {label:'Normal', dot:'bg-slate-400'},
  urgent: {label:'Urgent', dot:'bg-orange-400'},
  express:{label:'Express',dot:'bg-red-500'}
};
const ITEM_PRESETS=['Shirts','Pants','Kurta','Saree','Bedsheet','Pillow Cover','Towel','Jeans','Jacket','Dress','Shorts','Socks (pairs)'];

// Pricing Structure (INR ₹)
const ITEM_PRICES = {
  'Shirts': 50,
  'Pants': 70,
  'Jeans': 80,
  'Kurta': 80,
  'Saree': 160,
  'Bedsheet': 130,
  'Pillow Cover': 35,
  'Towel': 45,
  'Jacket': 220,
  'Dress': 170,
  'Shorts': 45,
  'Socks (pairs)': 25
};
const DEFAULT_ITEM_PRICE = 60;
const SERVICE_RATES = {
  'wash-fold': 1.0,
  'dry-cleaning': 1.8,
  'ironing': 0.6
};
const PRIORITY_FEES = {
  'normal': 0,
  'urgent': 75,
  'express': 150
};

function formatCurrency(val){
  const num = parseFloat(val) || 0;
  return '₹' + Math.round(num).toLocaleString('en-IN');
}

function getItemRate(name){
  if(!name) return DEFAULT_ITEM_PRICE;
  return ITEM_PRICES[name] !== undefined ? ITEM_PRICES[name] : DEFAULT_ITEM_PRICE;
}

function getOrderBreakdown(items, service, priority){
  const safeItems = Array.isArray(items) ? items : [];
  let itemsSubtotal = 0;
  let totalItemsCount = 0;
  const lineItems = safeItems.map(function(item){
    const qty = parseInt(item.qty) || 0;
    const rate = getItemRate(item.name);
    const lineTotal = qty * rate;
    itemsSubtotal += lineTotal;
    totalItemsCount += qty;
    return { name: item.name, qty: qty, rate: rate, lineTotal: lineTotal };
  });

  const sRate = SERVICE_RATES[service] !== undefined ? SERVICE_RATES[service] : 1.0;
  const serviceCharge = Math.round(itemsSubtotal * sRate);
  const priorityFee = PRIORITY_FEES[priority] !== undefined ? PRIORITY_FEES[priority] : 0;
  const totalAmount = safeItems.length > 0 ? (serviceCharge + priorityFee) : 0;

  return {
    lineItems: lineItems,
    itemsSubtotal: itemsSubtotal,
    totalItemsCount: totalItemsCount,
    serviceRate: sRate,
    serviceCharge: serviceCharge,
    priorityFee: priorityFee,
    totalAmount: totalAmount
  };
}

function calculateOrderAmount(items, service, priority){
  return getOrderBreakdown(items, service, priority).totalAmount;
}

const API_BASE = (window.location.port === '5000' && window.location.protocol !== 'file:') ? '' : null;
const AUTH_KEY='washflow_user_session';
const NOTIF_KEY='washflow_notifications_v1';
const FEEDBACK_KEY='washflow_feedbacks_v1';
const REGISTERED_USERS_KEY='washflow_registered_users_v1';

const DEFAULT_AUTH_USERS=[
  {email:'admin@washflow.com',password:'password123',name:'Admin User',role:'Manager',initial:'A'},
  {email:'staff@washflow.com',password:'password123',name:'Rahul Staff',role:'Operator',initial:'S'}
];

function getRegisteredUsers(){
  try{
    const raw = localStorage.getItem(REGISTERED_USERS_KEY);
    if(raw) {
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed) && parsed.length > 0) {
        const validUsers = parsed.filter(u => u && typeof u.email === 'string' && u.email.trim().length > 0 && typeof u.password === 'string' && u.password.length >= 4);
        if(validUsers.length > 0) return validUsers;
      }
    }
  }catch(e){}
  localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(DEFAULT_AUTH_USERS));
  return DEFAULT_AUTH_USERS.slice();
}

function saveRegisteredUsers(usersList){
  localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(usersList));
}
let currentUser=null;
let orders=[],currentFilter='all',currentSearch='',pendingDeleteId=null,orderCounter=1;
let systemStats=null,allOrdersMaster=[];
let notifications=[],feedbacks=[],feedbackFilter='all',selectedFeedbackRating=5;
let cardViewMode='grid',currentView='dashboard',draggedOrderId=null,itemRowCount=0,sidebarCollapsed=false;

// RBAC Permissions & Order Ownership
function isManager(){
  return currentUser && currentUser.role === 'Manager';
}
function isStaff(){
  return currentUser && (currentUser.role === 'Operator' || currentUser.role === 'Staff');
}
function isNormalUser(){
  return currentUser && (currentUser.role === 'User' || (!isManager() && !isStaff()));
}
function canChangeOrderStatus(){
  return isManager() || isStaff();
}
function canLeaveFeedback(){
  // Only regular customers (User role) are permitted to submit reviews or feedback.
  // Staff (Operator) and Managers are strictly prohibited.
  return currentUser && (currentUser.role === 'User' || (!isManager() && !isStaff()));
}
function isOrderOwner(o){
  if(!currentUser || !o) return false;
  const userEmail = (currentUser.email || '').toLowerCase().trim();
  const userName = (currentUser.name || '').toLowerCase().trim();
  const orderEmail = (o.customerEmail || '').toLowerCase().trim();
  const orderName = (o.customerName || '').toLowerCase().trim();
  const orderUserId = o.userId ? String(o.userId) : null;
  const currentUserId = currentUser.id ? String(currentUser.id) : null;

  if(orderEmail && userEmail && orderEmail === userEmail) return true;
  if(orderUserId && currentUserId && orderUserId === currentUserId) return true;
  if(orderName && userName && orderName === userName) return true;
  return false;
}
function canViewOrder(o){
  if(!o) return false;
  if(isManager() || isStaff()) return true;
  return isOrderOwner(o);
}
function canModifyOrder(o){
  if(isManager()) return true;
  if(isNormalUser() && isOrderOwner(o)) return true;
  return false;
}
function canCancelOrder(o){
  if(isManager()) return true;
  if(isNormalUser() && isOrderOwner(o)) return true;
  return false;
}
function checkManagerPermission(actionName){
  if(!isManager()){
    showToast(`⛔ <b>Access Denied:</b> Only <b>Manager/Admin</b> accounts can ${actionName}.`, 'warning', 4500);
    return false;
  }
  return true;
}
function getAuthHeaders(){
  const headers = {'Content-Type':'application/json'};
  if(currentUser){
    if(currentUser.token) headers['Authorization'] = `Bearer ${currentUser.token}`;
    headers['x-user-role'] = currentUser.role || 'Operator';
    headers['x-user-email'] = currentUser.email || '';
    headers['x-user-name'] = currentUser.name || '';
  }
  return headers;
}
// Storage
function loadFromStorage(){
  try{
    const r=localStorage.getItem(STORAGE_KEY);
    if(r){
      const p=JSON.parse(r);
      const rawOrders = Array.isArray(p.orders) ? p.orders : [];
      const seenIds = new Set();
      const uniqueOrders = [];
      for(const o of rawOrders){
        if(o && o.id && !seenIds.has(o.id)){
          seenIds.add(o.id);
          uniqueOrders.push(o);
        }
      }
      orders = uniqueOrders;
      allOrdersMaster = orders;
      orderCounter = p.counter || (orders.length + 1);
      const demoEmailMap = {
        'WF-0001': 'priya@example.com',
        'WF-0002': 'rahul@example.com',
        'WF-0003': 'anjali@example.com',
        'WF-0004': 'kiran@example.com',
        'WF-0005': 'suresh@example.com',
        'WF-0006': 'meena@example.com'
      };
      orders.forEach(function(o){
        if(o.totalAmount === undefined || o.totalAmount === null){
          o.totalAmount = calculateOrderAmount(o.items, o.service, o.priority);
        }
        if(!o.customerEmail && demoEmailMap[o.id]){
          o.customerEmail = demoEmailMap[o.id];
        }
      });
    }
  }catch(e){ orders=[]; allOrdersMaster=[]; }
}
function saveToStorage(){
  const toSave = (allOrdersMaster && allOrdersMaster.length >= orders.length) ? allOrdersMaster : orders;
  localStorage.setItem(STORAGE_KEY,JSON.stringify({orders:toSave,counter:orderCounter}));
}
function generateOrderId(){return 'WF-'+String(orderCounter).padStart(4,'0');}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Sidebar
function toggleSidebar(){sidebarCollapsed=!sidebarCollapsed;document.getElementById('sidebar').classList.toggle('collapsed',sidebarCollapsed);const ic=document.getElementById('sidebar-toggle-icon');ic.setAttribute('data-lucide',sidebarCollapsed?'panel-left-open':'panel-left-close');lucide.createIcons();}
function openMobileSidebar(){document.getElementById('sidebar').classList.add('mobile-open');document.getElementById('mobile-overlay').style.display='block';}
function closeMobileSidebar(){document.getElementById('sidebar').classList.remove('mobile-open');document.getElementById('mobile-overlay').style.display='none';}

// Toast
function showToast(msg,type,dur){
  type=type||'success';dur=dur||3500;
  const c=document.getElementById('toast-container'),el=document.createElement('div');
  el.className='toast toast-'+type;
  const btn=document.createElement('button');
  btn.style.cssText='margin-left:auto;background:none;border:none;color:#fff;cursor:pointer;font-size:16px;opacity:.7';
  btn.textContent='x';
  btn.onclick=function(){el.remove();};
  const inner=document.createElement('div');
  inner.style.cssText='display:flex;align-items:center;gap:8px';
  const sp=document.createElement('span');
  sp.innerHTML=msg;
  inner.appendChild(sp);inner.appendChild(btn);el.appendChild(inner);c.appendChild(el);
  document.getElementById('notif-badge').classList.remove('hidden');
  setTimeout(function(){el.classList.add('hide');setTimeout(function(){el.remove();},400);},dur);
}

// ================================================================
//  AUDIO CHIME & REAL-TIME NOTIFICATIONS SYSTEM
// ================================================================
function playNotificationChime(type){
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return;
    const ctx=new AudioCtx();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now=ctx.currentTime;
    if(type==='completed'){
      // 3-tone cheerful triumph chime for completed orders (C5 -> E5 -> G5)
      osc.type='triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.12);
      osc.frequency.setValueAtTime(783.99, now + 0.24);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.55);
    }else{
      // 2-tone crisp bright alert chime for new orders / feedback (D5 -> A5)
      osc.type='sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880.00, now + 0.12);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    }
  }catch(err){}
}

function loadNotifications(){
  try{
    const raw=localStorage.getItem(NOTIF_KEY);
    if(raw){
      notifications=JSON.parse(raw);
    }else{
      notifications=[
        {id:'n1',title:'🧺 New Order Placed!',body:'Order #WF-0006 placed for Meena Pillai (Wash & Fold)',type:'new',time:new Date(Date.now()-1000*60*15).toISOString(),read:false},
        {id:'n2',title:'✅ Order Completed & Delivered!',body:'Order #WF-0001 for Priya Sharma marked delivered!',type:'completed',time:new Date(Date.now()-1000*60*45).toISOString(),read:false},
        {id:'n3',title:'⭐ New Customer Review!',body:'Priya Sharma rated 5★ for Wash Quality: "Super clean clothes and smelled wonderfully fresh!"',type:'feedback',time:new Date(Date.now()-1000*60*120).toISOString(),read:false}
      ];
      localStorage.setItem(NOTIF_KEY,JSON.stringify(notifications));
    }
  }catch(e){
    notifications=[];
  }
  updateNotificationBadge();
  renderNotificationList();
  checkPushPermissionStatus();
}

function saveNotifications(){
  localStorage.setItem(NOTIF_KEY,JSON.stringify(notifications));
  updateNotificationBadge();
  renderNotificationList();
}

function checkPushPermissionStatus(){
  const permBtnText=document.getElementById('push-perm-text');
  if(!('Notification' in window)||!permBtnText)return;
  if(Notification.permission==='granted'){
    permBtnText.textContent='Push Active ✓';
    permBtnText.parentElement.classList.remove('text-blue-600');
    permBtnText.parentElement.classList.add('text-emerald-600');
  }else if(Notification.permission==='denied'){
    permBtnText.textContent='Push Blocked';
  }else{
    permBtnText.textContent='Enable Push';
  }
}

async function requestDesktopNotificationPermission(){
  if(!('Notification' in window)){
    showToast('Browser notifications are not supported on this device.','warning');
    return;
  }
  try{
    const permission=await Notification.requestPermission();
    checkPushPermissionStatus();
    if(permission==='granted'){
      showToast('🔔 <b>Desktop Push Notifications active!</b> You will get alerts on new & completed orders.','success');
      new Notification('WashFlow Notifications Active',{
        body:'You will receive instant alerts for new and completed laundry orders.',
        icon:'https://cdn-icons-png.flaticon.com/512/3003/3003984.png'
      });
    }else{
      showToast('Notifications permission was not granted.','info');
    }
  }catch(err){}
}

function sendPushNotification(title,body,type='info'){
  // 1. Play audio chime
  playNotificationChime(type==='completed'?'completed':'new');

  // 2. Dispatch native desktop notification if permitted
  if('Notification' in window && Notification.permission==='granted'){
    try{
      new Notification(title,{
        body:body,
        icon:'https://cdn-icons-png.flaticon.com/512/3003/3003984.png'
      });
    }catch(e){}
  }

  // 3. Save to notification state & localStorage
  const notifItem={
    id:Date.now()+Math.random().toString(36).substr(2,4),
    title,
    body,
    type,
    time:new Date().toISOString(),
    read:false
  };
  notifications.unshift(notifItem);
  if(notifications.length>50)notifications=notifications.slice(0,50);
  saveNotifications();

  // 4. Show toast notification on screen
  const toastType=type==='completed'?'success':(type==='new'?'info':'warning');
  showToast(`<b>${title}</b><br><span style="font-size:12px;opacity:0.9">${escHtml(body)}</span>`,toastType,4500);
}

function updateNotificationBadge(){
  const unreadCount=notifications.filter(n=>!n.read).length;
  const badge=document.getElementById('notif-badge');
  const countLabel=document.getElementById('notif-header-count');
  if(badge){
    if(unreadCount>0){
      badge.textContent=unreadCount>9?'9+':unreadCount;
      badge.classList.remove('hidden');
    }else{
      badge.classList.add('hidden');
    }
  }
  if(countLabel){
    countLabel.textContent=`${unreadCount} new`;
  }
}

function toggleNotificationPanel(e){
  if(e){
    if(typeof e.stopPropagation === 'function') e.stopPropagation();
    if(typeof e.preventDefault === 'function') e.preventDefault();
  }
  const panel=document.getElementById('notification-panel');
  if(!panel)return;
  const isHidden=panel.classList.contains('hidden');
  if(isHidden){
    notifications.forEach(n=>n.read=true);
    localStorage.setItem(NOTIF_KEY,JSON.stringify(notifications));
    updateNotificationBadge();
    renderNotificationList();
    panel.classList.remove('hidden');
  }else{
    panel.classList.add('hidden');
  }
}

function clearAllNotifications(){
  notifications=[];
  saveNotifications();
  showToast('Notifications cleared.','info');
}

function renderNotificationList(){
  const listEl=document.getElementById('notif-list');
  const emptyEl=document.getElementById('notif-empty');
  if(!listEl)return;
  if(!notifications.length){
    listEl.innerHTML='';
    if(emptyEl)emptyEl.classList.remove('hidden');
    return;
  }
  if(emptyEl)emptyEl.classList.add('hidden');

  listEl.innerHTML=notifications.map(n=>{
    let icon='bell';
    let iconBg='bg-blue-100 text-blue-600';
    if(n.type==='completed'){
      icon='check-circle';
      iconBg='bg-emerald-100 text-emerald-600';
    }else if(n.type==='new'){
      icon='package-plus';
      iconBg='bg-indigo-100 text-indigo-600';
    }else if(n.type==='feedback'){
      icon='star';
      iconBg='bg-amber-100 text-amber-600';
    }

    const timeAgo=formatTimeAgo(n.time);

    return `
      <div class="p-3.5 hover:bg-slate-50 transition-colors flex items-start gap-3">
        <div class="w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0 mt-0.5">
          <i data-lucide="${icon}" class="w-4 h-4"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between">
            <h4 class="text-xs font-bold text-slate-800 truncate">${escHtml(n.title)}</h4>
            <span class="text-[10px] text-slate-400 flex-shrink-0 ml-2">${timeAgo}</span>
          </div>
          <p class="text-xs text-slate-600 mt-0.5 leading-snug">${escHtml(n.body)}</p>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

function formatTimeAgo(isoString){
  const diffSec=Math.floor((Date.now()-new Date(isoString).getTime())/1000);
  if(diffSec<60)return 'Just now';
  if(diffSec<3600)return `${Math.floor(diffSec/60)}m ago`;
  if(diffSec<86400)return `${Math.floor(diffSec/3600)}h ago`;
  return `${Math.floor(diffSec/86400)}d ago`;
}

// Close notification panel when clicking outside
document.addEventListener('click',function(e){
  const panel=document.getElementById('notification-panel');
  if(!panel||panel.classList.contains('hidden'))return;
  const bellBtn=document.getElementById('notif-bell-btn');
  if(bellBtn&&(bellBtn===e.target||bellBtn.contains(e.target)||e.target.closest('#notif-bell-btn')))return;
  if(panel===e.target||panel.contains(e.target)||e.target.closest('#notification-panel'))return;
  panel.classList.add('hidden');
});

// View Management
const pageMeta={
  dashboard:{title:'Dashboard',subtitle:'Overview of all laundry operations'},
  kanban:{title:'Workflow Board',subtitle:'Manage orders through each stage of the workflow'},
  orders:{title:'All Orders',subtitle:'Browse all laundry orders at a glance'},
  feedback:{title:'Customer Feedback',subtitle:'Ratings and reviews from verified clients'}
};
function showView(v){
  currentView=v;
  ['dashboard','kanban','orders','feedback'].forEach(function(x){
    const el = document.getElementById('view-'+x);
    if(el) el.classList.toggle('hidden',x!==v);
  });
  if(pageMeta[v]){
    let title = pageMeta[v].title;
    let subtitle = pageMeta[v].subtitle;
    if(isNormalUser()){
      if(v==='dashboard'){ title='My Laundry Portal'; subtitle='Overview of your personal orders & active pickups'; }
      if(v==='kanban'){ title='My Order Tracking'; subtitle='Track your orders through each service stage'; }
      if(v==='orders'){ title='My Orders'; subtitle='Browse and manage your personal laundry orders'; }
    }
    document.getElementById('page-title').textContent=title;
    document.getElementById('page-subtitle').textContent=subtitle;
  }
  document.querySelectorAll('.nav-item[data-view]').forEach(function(b){b.classList.toggle('active',b.dataset.view===v);});
  if(v==='dashboard')renderDashboard();
  if(v==='kanban')renderKanban();
  if(v==='orders')renderOrderCards();
  if(v==='feedback')renderFeedbackView();
  closeMobileSidebar();
}

// Filter & Search
function setFilter(f){
  currentFilter=f;
  document.querySelectorAll('.filter-btn').forEach(function(b){
    const a=b.dataset.filter===f;
    b.classList.toggle('bg-blue-600',a);b.classList.toggle('text-white',a);
    b.classList.toggle('bg-white',!a);b.classList.toggle('text-slate-600',!a);
  });
  renderDashboardTable();
}
function handleSearch(val){
  currentSearch=val.toLowerCase();
  if(currentView==='dashboard')renderDashboardTable();
  if(currentView==='kanban')renderKanban();
  if(currentView==='orders')renderOrderCards();
}
function getFilteredOrders(){
  return orders.filter(function(o){
    if(isNormalUser() && !isOrderOwner(o)) return false;
    const mf=currentFilter==='all'||o.status===currentFilter;
    const ms=!currentSearch||o.customerName.toLowerCase().includes(currentSearch)||o.id.toLowerCase().includes(currentSearch)||o.phone.includes(currentSearch);
    return mf&&ms;
  });
}
function getSortedOrders(list){
  const s=(document.getElementById('sort-select')||{}).value||'newest';
  return list.slice().sort(function(a,b){
    return s==='newest'?new Date(b.createdAt)-new Date(a.createdAt):s==='oldest'?new Date(a.createdAt)-new Date(b.createdAt):a.customerName.localeCompare(b.customerName);
  });
}
function updateStats(){
  let tot = 0, pend = 0, inprog = 0, deliv = 0, comp = 0;
  if(systemStats){
    tot = Number(systemStats.total) || 0;
    pend = Number(systemStats.pending) || 0;
    inprog = Number(systemStats.inprogress) || 0;
    deliv = Number(systemStats.delivery) || 0;
    comp = Number(systemStats.completed) || 0;
  } else {
    const all = (allOrdersMaster && allOrdersMaster.length >= orders.length) ? allOrdersMaster : orders;
    tot = all.length;
    pend = all.filter(o => o.status === 'pending').length;
    inprog = all.filter(o => o.status === 'processing' || o.status === 'collected').length;
    deliv = all.filter(o => o.status === 'delivery').length;
    comp = all.filter(o => o.status === 'completed').length;
  }

  document.getElementById('stat-total').textContent = tot;
  document.getElementById('stat-pending').textContent = pend;
  document.getElementById('stat-inprogress').textContent = inprog;
  document.getElementById('stat-delivery').textContent = deliv;
  document.getElementById('stat-completed').textContent = comp;

  renderCustomerStatusBar();
}

function renderCustomerStatusBar(){
  const container = document.getElementById('user-status-card-container');
  if(!container) return;
  if(!isNormalUser()){
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const myOrders = orders.filter(isOrderOwner);
  container.classList.remove('hidden');

  if(myOrders.length === 0){
    container.innerHTML = `
      <div class="order-tracking-window text-white rounded-2xl p-5 shadow-lg border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3.5">
          <div class="w-11 h-11 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300 flex-shrink-0">
            <i data-lucide="sparkles" class="w-6 h-6"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-2">
              Welcome to WashFlow, ${escHtml(currentUser ? currentUser.name : 'Customer')}!
              <span class="text-[10px] font-bold bg-blue-500/30 text-blue-200 px-2 py-0.5 rounded-full border border-blue-400/30">Client Portal</span>
            </h3>
            <p class="text-xs text-slate-300 mt-0.5">Overall laundry system orders & live stage counts are shown below. You currently have 0 orders on file.</p>
          </div>
        </div>
        <button onclick="openCreateModal()" class="text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-1.5 flex-shrink-0">
          <i data-lucide="plus" class="w-4 h-4"></i> Schedule First Pickup
        </button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Find latest order
  const latest = myOrders[0];
  const sc = STATUS_CONFIG[latest.status] || STATUS_CONFIG.pending;
  const svc = SERVICE_CONFIG[latest.service] || SERVICE_CONFIG['wash-fold'];
  const amt = latest.totalAmount !== undefined ? latest.totalAmount : calculateOrderAmount(latest.items, latest.service, latest.priority);

  // Workflow steps
  const steps = [
    { key: 'pending', label: 'Pickup Requested', icon: 'clock' },
    { key: 'collected', label: 'At Facility', icon: 'package-check' },
    { key: 'processing', label: 'In Processing', icon: 'refresh-cw' },
    { key: 'delivery', label: 'Out for Delivery', icon: 'truck' },
    { key: 'completed', label: 'Delivered', icon: 'check-circle-2' }
  ];

  const currentIdx = steps.findIndex(s => s.key === latest.status);

  const stepHtml = steps.map((s, idx) => {
    const isDone = idx < currentIdx;
    const isCurrent = idx === currentIdx;
    
    let circleClass = 'bg-white/10 text-slate-400 border-white/10';
    let labelClass = 'text-slate-400 font-medium';
    let iconName = s.icon;

    if (isDone) {
      circleClass = 'bg-emerald-500 text-white border-emerald-400';
      labelClass = 'text-emerald-300 font-semibold';
      iconName = 'check';
    } else if (isCurrent) {
      circleClass = 'bg-blue-500 text-white border-blue-300 ring-4 ring-blue-500/30';
      labelClass = 'text-white font-bold';
    }

    return `
      <div class="flex flex-col items-center flex-1 relative min-w-0">
        <div class="w-8 h-8 rounded-full border flex items-center justify-center text-xs mb-1.5 transition-all ${circleClass}">
          <i data-lucide="${iconName}" class="w-4 h-4"></i>
        </div>
        <span class="text-[11px] truncate max-w-full px-1 text-center ${labelClass}">${s.label}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="order-tracking-window text-white rounded-2xl p-5 shadow-lg border border-slate-800">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-5 pb-4 border-b border-white/10">
        <div class="flex items-center gap-3.5">
          <div class="w-11 h-11 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-300 flex-shrink-0">
            <i data-lucide="package-search" class="w-6 h-6"></i>
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-semibold text-blue-200 uppercase tracking-wider">Your Live Laundry Tracking</span>
              <span class="text-xs font-mono font-bold bg-blue-500/30 text-blue-200 px-2 py-0.5 rounded-lg border border-blue-400/30">#${latest.id}</span>
              <span class="text-[11px] font-semibold ${svc.bg} ${svc.text} px-2 py-0.5 rounded-full">${svc.label}</span>
              <span class="text-xs font-bold text-emerald-400 font-mono">${formatCurrency(amt)}</span>
            </div>
            <div class="text-sm font-bold text-white mt-1 flex items-center gap-2">
              <span>Order Status: <span class="text-amber-300 font-extrabold uppercase">${sc.label}</span></span>
              <span class="text-xs font-normal text-slate-300">(${myOrders.length} order${myOrders.length !== 1 ? 's' : ''} placed)</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button onclick="viewOrderDetail('${latest.id}')" class="text-xs font-semibold bg-white/10 hover:bg-white/20 text-white px-3.5 py-2 rounded-xl border border-white/20 transition-all flex items-center gap-1.5 shadow-sm">
            <i data-lucide="eye" class="w-3.5 h-3.5"></i> View Details
          </button>
          <button onclick="openCreateModal()" class="text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-xl shadow transition-all flex items-center gap-1.5">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i> New Order
          </button>
        </div>
      </div>

      <!-- Step Tracker -->
      <div class="pt-1">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-blue-200/70 mb-3 text-center sm:text-left">Live Order Workflow Stage:</div>
        <div class="flex items-center justify-between gap-1 overflow-x-auto pb-1">
          ${stepHtml}
        </div>
      </div>
    </div>
  `;

  lucide.createIcons();
}

function renderDashboard(){updateStats();renderDashboardTable();}

// Fetch orders from Local Storage / JavaScript Backend with fallback
async function fetchOrders(){
  if(API_BASE){
    try{
      const res = await fetch(`${API_BASE}/api/orders`, {
        headers: getAuthHeaders()
      });
      if(res.ok){
        const data = await res.json();
        if(data.success && Array.isArray(data.orders)){
          orders = data.orders;
          if(data.systemStats){
            systemStats = data.systemStats;
          }
          saveToStorage();
          refreshCurrentView();
          return;
        }
      }else if(res.status === 403){
        showToast('⚠ 403 Forbidden: You do not have permission to view orders.', 'danger');
      }
    }catch(err){
      // Backend offline; use local storage
    }
  }
  loadFromStorage();
  if(!orders.length) seedDemoData();
  refreshCurrentView();
}
// Dashboard Table
function renderDashboardTable(){
  const tbody=document.getElementById('orders-table-body');
  const empty=document.getElementById('empty-state-dashboard');
  const cl=document.getElementById('orders-count-label');
  const filtered=getSortedOrders(getFilteredOrders());
  cl.textContent=filtered.length+' order'+(filtered.length!==1?'s':'');
  if(!filtered.length){tbody.innerHTML='';empty.classList.remove('hidden');lucide.createIcons();return;}
  empty.classList.add('hidden');
  const rows=filtered.map(function(o){
    const sc=STATUS_CONFIG[o.status];
    const svc=SERVICE_CONFIG[o.service];
    const prio=PRIORITY_CONFIG[o.priority]||PRIORITY_CONFIG.normal;
    const tot=o.items.reduce(function(s,i){return s+(parseInt(i.qty)||0);},0);
    const amt=o.totalAmount!==undefined?o.totalAmount:calculateOrderAmount(o.items,o.service,o.priority);
    const d=new Date(o.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
    const dotStyle='width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block;';
    const opts=STATUS_KEYS.map(function(s){return '<option value="'+s+'"'+(s===o.status?' selected':'')+'>'+STATUS_CONFIG[s].label+'</option>';}).join('');

    const isMine = isOrderOwner(o);
    const ownerBadge = isMine ? '<span class="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-md ml-1.5">You</span>' : '';

    // Status column: Staff & Managers get the dropdown; Customers get a read-only badge
    const statusHtml = canChangeOrderStatus()
      ? '<select onchange="updateStatus(\''+o.id+'\',this.value)" class="text-xs font-semibold px-2 py-1 rounded-full border cursor-pointer focus:outline-none '+sc.bg+' '+sc.text+' '+sc.border+'">'+opts+'</select>'
      : '<span class="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border '+sc.bg+' '+sc.text+' '+sc.border+'" title="Status updated by laundry staff"><span class="w-1.5 h-1.5 rounded-full '+sc.dot+'"></span>'+sc.label+'</span>';

    // Actions: Managers can edit/delete all; Customers can edit/cancel their own
    let actionBtns = '<button onclick="viewOrderDetail(\''+o.id+'\')" class="p-1.5 rounded-lg hover:bg-blue-100 text-blue-500" title="View Details"><i data-lucide="eye" class="w-4 h-4"></i></button>';
    if(canModifyOrder(o)){
      actionBtns += '<button onclick="openEditModal(\''+o.id+'\')" class="p-1.5 rounded-lg hover:bg-amber-100 text-amber-500" title="Modify Order"><i data-lucide="pencil" class="w-4 h-4"></i></button>';
    }
    if(canCancelOrder(o)){
      actionBtns += '<button onclick="openDeleteModal(\''+o.id+'\')" class="p-1.5 rounded-lg hover:bg-red-100 text-red-500" title="'+(isNormalUser()?'Cancel Order':'Delete Order')+'"><i data-lucide="trash-2" class="w-4 h-4"></i></button>';
    }

    return '<tr class="hover:bg-slate-50 group">'+
      '<td class="px-6 py-4"><div class="flex items-center gap-2"><span style="'+dotStyle+'" class="'+prio.dot+'" title="'+prio.label+' priority"></span><span class="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">#'+o.id+'</span></div></td>'+
      '<td class="px-6 py-4"><div class="flex items-center"><span class="font-semibold text-slate-800 text-sm">'+escHtml(o.customerName)+'</span>'+ownerBadge+'</div><div class="text-xs text-slate-400">'+escHtml(o.phone)+'</div></td>'+
      '<td class="px-6 py-4"><span class="inline-flex text-xs font-semibold px-2.5 py-1 rounded-full '+svc.bg+' '+svc.text+'">'+svc.label+'</span></td>'+
      '<td class="px-6 py-4 text-xs text-slate-600">'+tot+' item'+(tot!==1?'s':'')+'</td>'+
      '<td class="px-6 py-4"><span class="font-bold text-slate-800 font-mono text-sm">'+formatCurrency(amt)+'</span></td>'+
      '<td class="px-6 py-4">'+statusHtml+'</td>'+
      '<td class="px-6 py-4 text-xs text-slate-500">'+d+'</td>'+
      '<td class="px-6 py-4"><div class="flex items-center gap-2 opacity-60 group-hover:opacity-100">'+actionBtns+'</div></td></tr>';
  });
  tbody.innerHTML=rows.join('');
  lucide.createIcons();
}
// Kanban Board
function renderKanban(){
  const board=document.getElementById('kanban-board');
  const filtered=getFilteredOrders();
  const cols=STATUS_KEYS.map(function(status){
    const sc=STATUS_CONFIG[status];
    const col=filtered.filter(function(o){return o.status===status;});
    const cards=col.map(function(o){return renderKanbanCard(o);}).join('');
    const placeholder=col.length===0?'<div class="text-center py-8 text-xs text-slate-300 select-none">Drop cards here</div>':'';
    return '<div class="kanban-col flex-shrink-0 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden" '+
      'data-status="'+status+'" '+
      'ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDrop(event,\''+status+'\')">'+
      '<div class="px-4 py-3 border-b border-slate-100 flex items-center gap-2">'+
        '<span class="w-2.5 h-2.5 rounded-full '+sc.dot+' flex-shrink-0"></span>'+
        '<span class="text-sm font-bold text-slate-700 flex-1">'+sc.label+'</span>'+
        '<span class="text-xs font-bold text-white '+sc.dot+' px-2 py-0.5 rounded-full">'+col.length+'</span>'+
      '</div>'+
      '<div class="flex-1 p-3 space-y-3 overflow-y-auto min-h-20">'+placeholder+cards+'</div>'+
    '</div>';
  });
  board.innerHTML=cols.join('');
  lucide.createIcons();
}
function renderKanbanCard(o){
  const sc=STATUS_CONFIG[o.status];
  const svc=SERVICE_CONFIG[o.service];
  const prio=PRIORITY_CONFIG[o.priority]||PRIORITY_CONFIG.normal;
  const tot=o.items.reduce(function(s,i){return s+(parseInt(i.qty)||0);},0);
  const amt=o.totalAmount!==undefined?o.totalAmount:calculateOrderAmount(o.items,o.service,o.priority);
  const d=new Date(o.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
  const dotStyle='width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block;';
  const tags=o.items.slice(0,3).map(function(i){return '<span class="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">'+i.qty+'x '+escHtml(i.name)+'</span>';}).join('');
  const more=o.items.length>3?'<span class="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">+'+(o.items.length-3)+' more</span>':'';
  const isMine = isOrderOwner(o);
  const ownerBadge = isMine ? '<span class="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-md ml-1">You</span>' : '';
  const canDrag = canChangeOrderStatus();

  let actionBtns = '<button onclick="viewOrderDetail(\''+o.id+'\')" class="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-500" title="View Details"><i data-lucide="eye" class="w-3.5 h-3.5"></i></button>';
  if(canModifyOrder(o)){
    actionBtns += '<button onclick="openEditModal(\''+o.id+'\')" class="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-500" title="Modify Order"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>';
  }
  if(canCancelOrder(o)){
    actionBtns += '<button onclick="openDeleteModal(\''+o.id+'\')" class="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500" title="'+(isNormalUser()?'Cancel Order':'Delete Order')+'"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>';
  }

  return '<div class="order-card bg-white rounded-xl border border-slate-200 p-3.5 shadow-sm" draggable="'+canDrag+'" data-id="'+o.id+'" '+
    (canDrag ? 'ondragstart="onDragStart(event,\''+o.id+'\')" ondragend="onDragEnd(event)"' : 'onclick="if(isNormalUser())showToast(\'Order status is updated exclusively by laundry staff.\',\'info\',2500)"') + '>'+
    '<div class="flex items-start justify-between mb-2">'+
      '<span class="font-mono text-xs font-bold text-blue-600">#'+o.id+'</span>'+
      '<div class="flex items-center gap-1.5">'+
        '<span style="'+dotStyle+'" class="'+prio.dot+'" title="'+prio.label+'"></span>'+
        '<span class="text-xs '+svc.bg+' '+svc.text+' px-2 py-0.5 rounded-full font-semibold">'+svc.label+'</span>'+
      '</div>'+
    '</div>'+
    '<div class="font-semibold text-slate-800 text-sm mb-0.5 flex items-center">'+escHtml(o.customerName)+ownerBadge+'</div>'+
    '<div class="text-xs text-slate-400 mb-2">'+escHtml(o.phone)+'</div>'+
    '<div class="flex flex-wrap gap-1 mb-3">'+tags+more+'</div>'+
    '<div class="flex items-center justify-between pt-2 border-t border-slate-100">'+
      '<div class="flex items-center gap-1.5">'+
        '<span class="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-lg font-mono">'+formatCurrency(amt)+'</span>'+
        '<span class="text-xs text-slate-400">'+tot+' pcs</span>'+
      '</div>'+
      '<div class="flex gap-1">'+actionBtns+'</div>'+
    '</div>'+
  '</div>';
}

// Drag & Drop
function onDragStart(e,id){
  if(!canChangeOrderStatus()){
    e.preventDefault();
    showToast('⛔ <b>Access Denied:</b> Customers cannot move orders across workflow columns. Status is updated exclusively by laundry Staff and Managers.', 'warning', 3500);
    return;
  }
  draggedOrderId=id;e.dataTransfer.effectAllowed='move';e.currentTarget.classList.add('dragging');
}
function onDragEnd(e){e.currentTarget.classList.remove('dragging');document.querySelectorAll('.kanban-col').forEach(function(c){c.classList.remove('drag-over');});}
function onDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='move';e.currentTarget.classList.add('drag-over');}
function onDragLeave(e){e.currentTarget.classList.remove('drag-over');}
async function onDrop(e,ns){
  e.preventDefault();e.currentTarget.classList.remove('drag-over');
  if(!draggedOrderId)return;
  const oid = draggedOrderId;
  draggedOrderId=null;

  if(!canChangeOrderStatus()){
    showToast('⛔ <b>Access Denied:</b> Customers cannot change order workflow status. Status is updated exclusively by laundry Staff and Managers.', 'warning', 4500);
    return;
  }

  const o=orders.find(function(x){return x.id===oid;});
  if(!o||o.status===ns)return;

  const prevStatus = o.status;
  o.status=ns;o.updatedAt=new Date().toISOString();
  saveToStorage();renderKanban();updateStats();

  if(API_BASE){
    try{
      const res = await fetch(`${API_BASE}/api/orders/${oid}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: ns })
      });
      if(res.status === 403){
        o.status = prevStatus;
        saveToStorage();renderKanban();updateStats();
        showToast('⛔ <b>403 Forbidden:</b> Only Staff and Managers can update order workflow status.', 'danger');
        return;
      }
    }catch(err){
      // Backend offline; local update already applied
    }
  }

  if(ns === 'completed'){
    sendPushNotification('✅ Order Completed & Delivered!', `Order #${oid} for ${o.customerName} has been delivered and marked completed!`, 'completed');
  } else {
    showToast('Order #'+oid+' moved to <b>'+STATUS_CONFIG[ns].label+'</b>','info');
  }
}
// All Orders Card View
function setCardView(mode){
  cardViewMode=mode;
  document.querySelectorAll('.view-btn').forEach(function(b){b.classList.toggle('active',b.dataset.viewMode===mode);});
  renderOrderCards();
}
function renderOrderCards(){
  const container=document.getElementById('orders-card-container');
  const empty=document.getElementById('empty-state-orders');
  const filtered=getSortedOrders(getFilteredOrders());
  if(!filtered.length){container.innerHTML='';empty.classList.remove('hidden');lucide.createIcons();return;}
  empty.classList.add('hidden');
  const isList=cardViewMode==='list';
  container.className=isList?'flex flex-col gap-3':'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4';
  const dotStyle='width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block;';
  const cards=filtered.map(function(o){
    const sc=STATUS_CONFIG[o.status],svc=SERVICE_CONFIG[o.service],prio=PRIORITY_CONFIG[o.priority]||PRIORITY_CONFIG.normal;
    const tot=o.items.reduce(function(s,i){return s+(parseInt(i.qty)||0);},0);
    const amt=o.totalAmount!==undefined?o.totalAmount:calculateOrderAmount(o.items,o.service,o.priority);
    const d=new Date(o.createdAt).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
    const ico=o.service==='dry-cleaning'?'sparkles':o.service==='ironing'?'zap':'shirt';
    const tags=o.items.slice(0,3).map(function(i){return '<span class="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">'+i.qty+'x '+escHtml(i.name)+'</span>';}).join('');
    const more=o.items.length>3?'<span class="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">+'+(o.items.length-3)+'</span>':'';
    const opts=STATUS_KEYS.map(function(s){return '<option value="'+s+'"'+(s===o.status?' selected':'')+'>'+STATUS_CONFIG[s].label+'</option>';}).join('');
    const isMine=isOrderOwner(o);
    const ownerBadge=isMine?'<span class="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-md ml-1">You</span>':'';

    let actionBtns='<button onclick="viewOrderDetail(\''+o.id+'\')" class="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-500" title="View Details"><i data-lucide="eye" class="w-4 h-4"></i></button>';
    if(canModifyOrder(o)){
      actionBtns+='<button onclick="openEditModal(\''+o.id+'\')" class="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-500" title="Modify Order"><i data-lucide="pencil" class="w-4 h-4"></i></button>';
    }
    if(canCancelOrder(o)){
      actionBtns+='<button onclick="openDeleteModal(\''+o.id+'\')" class="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500" title="'+(isNormalUser()?'Cancel Order':'Delete Order')+'"><i data-lucide="trash-2" class="w-4 h-4"></i></button>';
    }

    if(isList)return '<div class="order-card bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">'+
      '<div class="w-10 h-10 rounded-xl '+svc.bg+' flex items-center justify-center flex-shrink-0"><i data-lucide="'+ico+'" class="w-5 h-5 '+svc.text+'"></i></div>'+
      '<div class="flex-1 min-w-0"><div class="flex items-center gap-2 flex-wrap"><span class="font-mono text-xs font-bold text-blue-600">#'+o.id+'</span>'+
        '<span class="font-semibold text-slate-800 text-sm flex items-center">'+escHtml(o.customerName)+ownerBadge+'</span>'+
        '<span style="'+dotStyle+'" class="'+prio.dot+'"></span></div>'+
      '<div class="text-xs text-slate-400 truncate">'+escHtml(o.phone)+' · '+tot+' items · '+d+'</div></div>'+
      '<div class="flex items-center gap-3 flex-shrink-0">'+
        '<span class="text-sm font-bold text-slate-800 font-mono bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl">'+formatCurrency(amt)+'</span>'+
        '<span class="text-xs font-semibold '+sc.bg+' '+sc.text+' px-3 py-1 rounded-full hidden sm:inline-flex">'+sc.label+'</span>'+
        actionBtns+
      '</div></div>';

    const statusControl = canChangeOrderStatus()
      ? '<select onchange="updateStatus(\''+o.id+'\',this.value)" class="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none text-slate-600 bg-white cursor-pointer">'+opts+'</select>'
      : '<span class="text-xs font-semibold '+sc.bg+' '+sc.text+' px-2.5 py-1 rounded-full">'+sc.label+'</span>';

    return '<div class="order-card bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">'+
      '<div class="h-1.5 '+sc.dot+'"></div>'+
      '<div class="p-4">'+
        '<div class="flex items-start justify-between mb-3">'+
          '<span class="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">#'+o.id+'</span>'+
          '<span class="text-xs font-semibold '+sc.bg+' '+sc.text+' px-2.5 py-1 rounded-full">'+sc.label+'</span>'+
        '</div>'+
        '<div class="flex items-center gap-2 mb-1"><span style="'+dotStyle+'" class="'+prio.dot+'" title="'+prio.label+'"></span><h3 class="font-bold text-slate-800 flex items-center">'+escHtml(o.customerName)+ownerBadge+'</h3></div>'+
        '<p class="text-xs text-slate-400 mb-2.5">'+escHtml(o.phone)+'</p>'+
        '<div class="flex items-center justify-between mb-3">'+
          '<span class="text-xs font-semibold '+svc.bg+' '+svc.text+' px-2.5 py-1 rounded-full">'+svc.label+'</span>'+
          '<span class="font-bold text-slate-900 font-mono text-sm bg-slate-50 border border-slate-200/80 px-2 py-0.5 rounded-lg">'+formatCurrency(amt)+'</span>'+
        '</div>'+
        '<div class="flex flex-wrap gap-1 mb-3">'+tags+more+'</div>'+
        '<div class="text-xs text-slate-400 mb-3">'+d+'</div>'+
        '<div class="flex items-center justify-between pt-3 border-t border-slate-100">'+
          '<div class="flex gap-1">'+actionBtns+'</div>'+
          statusControl+
        '</div>'+
      '</div></div>';
  });
  container.innerHTML=cards.join('');
  lucide.createIcons();
}
// Create / Edit Modal
// Live Order Cost Calculation
function updateLiveOrderCost(){
  const items=getItemsFromForm();
  const svcEl=document.querySelector('input[name="service"]:checked');
  const service=svcEl?svcEl.value:'wash-fold';
  const prioEl=document.querySelector('input[name="priority"]:checked');
  const priority=prioEl?prioEl.value:'normal';

  const breakdown=getOrderBreakdown(items,service,priority);

  const subtotalEl=document.getElementById('calc-items-subtotal');
  const countEl=document.getElementById('calc-items-count');
  const svcLabelEl=document.getElementById('calc-service-label');
  const svcMultEl=document.getElementById('calc-service-multiplier');
  const prioLabelEl=document.getElementById('calc-priority-label');
  const prioFeeEl=document.getElementById('calc-priority-fee');
  const grandTotalEl=document.getElementById('calc-grand-total');

  if(subtotalEl)subtotalEl.textContent=formatCurrency(breakdown.itemsSubtotal);
  if(countEl)countEl.textContent=breakdown.totalItemsCount+' item'+(breakdown.totalItemsCount!==1?'s':'')+' selected';
  if(svcLabelEl)svcLabelEl.textContent=SERVICE_CONFIG[service]?.label||service;
  if(svcMultEl)svcMultEl.textContent=breakdown.serviceRate+'x ('+formatCurrency(breakdown.serviceCharge)+')';
  if(prioLabelEl)prioLabelEl.textContent=PRIORITY_CONFIG[priority]?.label||priority;
  if(prioFeeEl)prioFeeEl.textContent=breakdown.priorityFee>0?'+'+formatCurrency(breakdown.priorityFee):'₹0 (Free)';
  if(grandTotalEl)grandTotalEl.textContent=formatCurrency(breakdown.totalAmount);
}

// Create / Edit Modal
// Create / Edit Modal
function openCreateModal(){
  if(!currentUser){
    showToast('Please sign in to place an order.','warning');
    showLoginScreen();
    return;
  }
  const newId=generateOrderId();
  document.getElementById('display-order-id').textContent='#'+newId;
  document.getElementById('display-timestamp').textContent=new Date().toLocaleString('en-IN');
  document.getElementById('modal-title').textContent='Create New Order';
  document.getElementById('modal-subtitle').textContent='Fill in the details below to create a laundry order';
  document.getElementById('submit-btn-text').textContent=isNormalUser() ? 'Place Order' : 'Create Order';
  document.getElementById('f-edit-id').value='';
  ['f-name','f-phone','f-address','f-instructions'].forEach(function(id){document.getElementById(id).value='';});
  if(currentUser && isNormalUser() && currentUser.name){
    document.getElementById('f-name').value = currentUser.name;
  }
  document.querySelectorAll('input[name="service"]')[0].checked=true;
  document.querySelectorAll('input[name="priority"]')[0].checked=true;
  itemRowCount=0;document.getElementById('items-container').innerHTML='';addItemRow();
  updateLiveOrderCost();
  document.getElementById('order-modal').classList.remove('hidden');
  setTimeout(function(){
    if(document.getElementById('f-name').value){
      document.getElementById('f-phone').focus();
    } else {
      document.getElementById('f-name').focus();
    }
  },100);
}
function openEditModal(id){
  const o=orders.find(function(x){return x.id===id;});if(!o)return;
  if(!canModifyOrder(o)){
    showToast('⛔ <b>Access Denied:</b> You can only modify your own orders. Managers have permission to edit all orders.', 'warning', 4500);
    return;
  }
  document.getElementById('display-order-id').textContent='#'+o.id;
  document.getElementById('display-timestamp').textContent=new Date(o.createdAt).toLocaleString('en-IN');
  document.getElementById('modal-title').textContent='Modify Order';
  document.getElementById('modal-subtitle').textContent='Editing order #'+o.id;
  document.getElementById('submit-btn-text').textContent='Save Changes';
  document.getElementById('f-edit-id').value=o.id;
  document.getElementById('f-name').value=o.customerName;
  document.getElementById('f-phone').value=o.phone;
  document.getElementById('f-address').value=o.address;
  document.getElementById('f-instructions').value=o.instructions||'';
  document.querySelectorAll('input[name="service"]').forEach(function(r){r.checked=r.value===o.service;});
  document.querySelectorAll('input[name="priority"]').forEach(function(r){r.checked=r.value===(o.priority||'normal');});
  itemRowCount=0;document.getElementById('items-container').innerHTML='';
  const itemList=o.items.length?o.items:[{}];
  itemList.forEach(function(item){addItemRow(item.name,item.qty);});
  updateLiveOrderCost();
  document.getElementById('order-modal').classList.remove('hidden');
  setTimeout(function(){document.getElementById('f-name').focus();},100);
}
function closeModal(){document.getElementById('order-modal').classList.add('hidden');}
function addItemRow(name,qty){
  name=name||'';qty=qty||1;
  const container=document.getElementById('items-container');
  const idx=itemRowCount++;
  const div=document.createElement('div');
  div.className='flex gap-2 items-center';
  div.id='item-row-'+idx;
  const custom=name&&!ITEM_PRESETS.includes(name);
  const opts='<option value="">- Select Item -</option>'+
    ITEM_PRESETS.map(function(p){
      const rate=ITEM_PRICES[p]||DEFAULT_ITEM_PRICE;
      return '<option value="'+p+'"'+(p===name?' selected':'')+'>'+p+' (₹'+rate+')</option>';
    }).join('')+
    '<option value="__custom__"'+(custom?' selected':'')+'>Custom... (₹'+DEFAULT_ITEM_PRICE+')</option>';
  div.innerHTML='<select class="item-name-select flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400">'+opts+'</select>'+
    '<input type="text" class="item-custom-input border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:outline-none w-28'+(custom?'':" hidden")+'" placeholder="Item name" value="'+(custom?escHtml(name):'')+'" />'+
    '<input type="number" class="item-qty w-20 border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 focus:outline-none text-center" min="1" max="99" value="'+qty+'" />'+
    '<button type="button" onclick="removeItemRow('+idx+')" class="p-2 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-500 flex-shrink-0"><i data-lucide="x" class="w-4 h-4"></i></button>';
  container.appendChild(div);

  const sel=div.querySelector('.item-name-select');
  const ci=div.querySelector('.item-custom-input');
  const qtyInput=div.querySelector('.item-qty');

  sel.addEventListener('change',function(){
    ci.classList.toggle('hidden',this.value!=='__custom__');
    if(this.value!=='__custom__')ci.value='';
    updateLiveOrderCost();
  });
  ci.addEventListener('input',updateLiveOrderCost);
  qtyInput.addEventListener('input',updateLiveOrderCost);
  qtyInput.addEventListener('change',updateLiveOrderCost);

  updateLiveOrderCost();
  lucide.createIcons();
}
function removeItemRow(idx){
  const row=document.getElementById('item-row-'+idx);
  if(row){
    if(document.getElementById('items-container').children.length<=1){showToast('At least one item is required.','warning');return;}
    row.remove();
    updateLiveOrderCost();
  }
}
function getItemsFromForm(){
  const items=[];
  document.querySelectorAll('#items-container > div').forEach(function(row){
    const sel=row.querySelector('.item-name-select');
    const ci=row.querySelector('.item-custom-input');
    const name=sel.value==='__custom__'?ci.value.trim():sel.value;
    const qty=parseInt(row.querySelector('.item-qty').value)||1;
    if(name)items.push({name:name,qty:qty});
  });
  return items;
}
let isOrderSubmitting = false;

async function handleFormSubmit(event){
  event.preventDefault();
  if(isOrderSubmitting) return;
  isOrderSubmitting = true;

  const submitBtn = document.getElementById('submit-btn-text')?.parentElement;
  if(submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '0.7'; }

  try{
    const editId=document.getElementById('f-edit-id').value;
    if(editId){
      const existing=orders.find(function(x){return x.id===editId;});
      if(existing && !canModifyOrder(existing)){
        showToast('⛔ <b>Access Denied:</b> You can only modify your own orders.', 'warning', 4500);
        closeModal();
        return;
      }
    }

    const items=getItemsFromForm();
    if(!items.length){showToast('Please add at least one item.','warning');return;}
    const service=document.querySelector('input[name="service"]:checked').value||'wash-fold';
    const priority=document.querySelector('input[name="priority"]:checked').value||'normal';
    const customerName=document.getElementById('f-name').value.trim();
    const phone=document.getElementById('f-phone').value.trim();
    const address=document.getElementById('f-address').value.trim();
    const instructions=document.getElementById('f-instructions').value.trim();
    const totalAmount=calculateOrderAmount(items, service, priority);
    const customerEmail = currentUser ? currentUser.email : '';
    const userId = currentUser ? currentUser.id : null;

    if(editId){
      if(API_BASE){
        try{
          const res = await fetch(`${API_BASE}/api/orders/${editId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ customerName, phone, address, service, priority, items, instructions, totalAmount })
          });
          if(res.status === 403){
            showToast('⛔ <b>403 Forbidden:</b> You can only modify your own orders.', 'danger');
            return;
          }
          if(res.ok){
            const data = await res.json();
            const idx = orders.findIndex(o => o.id === editId);
            if(idx !== -1) orders[idx] = data.order || { ...orders[idx], customerName, phone, address, service, priority, items, instructions, totalAmount, customerEmail, userId, updatedAt: new Date().toISOString() };
            allOrdersMaster = orders;
            saveToStorage(); closeModal(); refreshCurrentView();
            showToast('Order #'+editId+' modified successfully!','success');
            return;
          }
        }catch(err){}
      }

      const idx=orders.findIndex(function(o){return o.id===editId;});
      if(idx!==-1){
        orders[idx]=Object.assign({},orders[idx],{customerName, phone, address, service, priority, items, instructions, totalAmount, customerEmail, userId, updatedAt:new Date().toISOString()});
      }
      allOrdersMaster = orders;
      saveToStorage(); closeModal(); refreshCurrentView();
      showToast('Order #'+editId+' modified successfully!','success');
      return;
    } else {
      const newId = generateOrderId();
      const no = { id: newId, customerName, phone, address, service, priority, items, instructions, status: 'pending', totalAmount, customerEmail, userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if(API_BASE){
        try{
          const res = await fetch(`${API_BASE}/api/orders`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(no)
          });
          if(res.status === 403){
            showToast('⛔ <b>403 Forbidden:</b> Failed to place order.', 'danger');
            return;
          }
          if(res.ok){
            const data = await res.json();
            const createdOrder = data.order || no;
            if(!orders.some(x => x.id === createdOrder.id)){
              orders.unshift(createdOrder);
            }
            allOrdersMaster = orders;
            if(systemStats){ systemStats.total++; systemStats.pending++; }
            orderCounter++;
            saveToStorage(); closeModal(); refreshCurrentView();
            sendPushNotification('🧺 New Order Placed!', `Order #${newId} placed for ${customerName} (${formatCurrency(totalAmount)})`, 'new');
            return;
          }
        }catch(err){}
      }

      // Local storage order creation (added strictly once)
      if(!orders.some(x => x.id === no.id)){
        orders.unshift(no);
      }
      allOrdersMaster = orders;
      if(systemStats){ systemStats.total++; systemStats.pending++; }
      orderCounter++;
      saveToStorage(); closeModal(); refreshCurrentView();
      sendPushNotification('🧺 New Order Placed!', `Order #${no.id} placed for ${no.customerName} (${formatCurrency(totalAmount)})`, 'new');
      return;
    }
  } finally {
    isOrderSubmitting = false;
    if(submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = '1'; }
  }
}
// Status Update
async function updateStatus(id,ns){
  if(!canChangeOrderStatus()){
    showToast('⛔ <b>Access Denied:</b> Customers cannot change order workflow status. Status is updated exclusively by laundry Staff and Managers.', 'warning', 4500);
    refreshCurrentView();
    return;
  }
  const o=orders.find(function(x){return x.id===id;});if(!o||o.status===ns)return;
  const prevStatus = o.status;
  o.status=ns;o.updatedAt=new Date().toISOString();
  saveToStorage();refreshCurrentView();

  if(API_BASE){
    try{
      const res = await fetch(`${API_BASE}/api/orders/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: ns })
      });
      if(res.status === 403){
        o.status = prevStatus;
        saveToStorage();refreshCurrentView();
        showToast('⛔ <b>403 Forbidden:</b> You do not have permission to change order status.', 'danger');
        return;
      }
      if(res.ok){
        if(ns === 'completed'){
          sendPushNotification('✅ Order Completed & Delivered!', `Order #${id} for ${o.customerName} marked delivered!`, 'completed');
        } else {
          showToast('Order #'+id+' moved to <b>'+STATUS_CONFIG[ns].label+'</b>!','info');
        }
        return;
      }
    }catch(err){}
  }

  if(ns === 'completed'){
    sendPushNotification('✅ Order Completed & Delivered!', `Order #${id} for ${o.customerName} marked delivered!`, 'completed');
  } else {
    showToast('Order #'+id+' moved to <b>'+STATUS_CONFIG[ns].label+'</b>','info');
  }
}

// Delete / Cancel
function openDeleteModal(id){
  const o=orders.find(function(x){return x.id===id;});if(!o)return;
  if(!canCancelOrder(o)){
    showToast('⛔ <b>Access Denied:</b> You can only cancel your own orders. Managers have permission to cancel all orders.', 'warning', 4500);
    return;
  }
  pendingDeleteId=id;
  const titleEl = document.querySelector('#delete-modal h2');
  const pEl = document.querySelector('#delete-modal p');
  if(titleEl) titleEl.textContent = isNormalUser() ? 'Cancel Order?' : 'Delete Order?';
  if(pEl) pEl.textContent = isNormalUser() ? 'Are you sure you want to cancel this order? It will be removed from the system.' : 'This action cannot be undone. The order will be permanently removed.';
  document.getElementById('delete-modal').classList.remove('hidden');
}
function closeDeleteModal(){pendingDeleteId=null;document.getElementById('delete-modal').classList.add('hidden');}
async function confirmDelete(){
  if(!pendingDeleteId)return;
  const id=pendingDeleteId;
  const o=orders.find(function(x){return x.id===id;});
  if(o && !canCancelOrder(o)){
    showToast('⛔ <b>Access Denied:</b> You can only cancel your own orders.', 'warning');
    closeDeleteModal();
    return;
  }
  if(API_BASE){
    try{
      const res = await fetch(`${API_BASE}/api/orders/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if(res.status === 403){
        showToast('⛔ <b>403 Forbidden:</b> You can only cancel your own orders.', 'danger');
        closeDeleteModal();
        return;
      }
      if(res.ok){
        orders=orders.filter(function(x){return x.id!==id;});
        allOrdersMaster=allOrdersMaster.filter(function(x){return x.id!==id;});
        if(systemStats && systemStats.total > 0) systemStats.total--;
        saveToStorage();showToast('Order #'+id+' cancelled successfully.','info');
        closeDeleteModal();refreshCurrentView();
        return;
      }
    }catch(err){}
  }
  orders=orders.filter(function(x){return x.id!==id;});
  allOrdersMaster=allOrdersMaster.filter(function(x){return x.id!==id;});
  if(systemStats && systemStats.total > 0) systemStats.total--;
  saveToStorage();showToast('Order #'+id+' cancelled.','info');closeDeleteModal();refreshCurrentView();
}

// Detail Modal
function viewOrderDetail(id){
  const o=orders.find(function(x){return x.id===id;});
  if(!o){
    showToast('Order not found.', 'warning');
    return;
  }
  if(!canViewOrder(o)){
    showToast('⛔ <b>Access Denied:</b> You do not have permission to view other customers\' order details.', 'warning', 4500);
    return;
  }
  const sc=STATUS_CONFIG[o.status],svc=SERVICE_CONFIG[o.service],prio=PRIORITY_CONFIG[o.priority]||PRIORITY_CONFIG.normal;
  const dotStyle='width:8px;height:8px;border-radius:50%;display:inline-block;';
  document.getElementById('detail-order-id').textContent='#'+o.id;
  
  const b=getOrderBreakdown(o.items, o.service, o.priority);
  const finalAmount = o.totalAmount !== undefined ? o.totalAmount : b.totalAmount;

  const itemRows=b.lineItems.map(function(item){
    return '<div class="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0 text-xs">'+
      '<div class="flex items-center gap-2"><span class="font-medium text-slate-700">'+escHtml(item.name)+'</span><span class="text-slate-400">@ '+formatCurrency(item.rate)+'</span></div>'+
      '<div class="flex items-center gap-3"><span class="font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">x '+item.qty+'</span><span class="font-bold text-slate-800 font-mono w-16 text-right">'+formatCurrency(item.lineTotal)+'</span></div>'+
    '</div>';
  }).join('');

  const canEdit = canModifyOrder(o);
  const canCancel = canCancelOrder(o);
  const cancelLabel = isNormalUser() ? 'Cancel' : 'Delete';

  document.getElementById('detail-body').innerHTML=
    '<div class="flex flex-wrap gap-2 mb-4">'+
      '<span class="text-xs font-bold '+sc.bg+' '+sc.text+' px-3 py-1.5 rounded-full">'+sc.label+'</span>'+
      '<span class="text-xs font-bold '+svc.bg+' '+svc.text+' px-3 py-1.5 rounded-full">'+svc.label+'</span>'+
      '<span class="text-xs font-semibold bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full flex items-center gap-1.5"><span style="'+dotStyle+'" class="'+prio.dot+'"></span>'+prio.label+' Priority</span>'+
    '</div>'+
    '<div class="grid grid-cols-2 gap-4 mb-4">'+
      '<div><div class="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1">Customer</div><div class="text-sm font-bold text-slate-800">'+escHtml(o.customerName)+'</div></div>'+
      '<div><div class="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1">Phone</div><div class="text-sm font-semibold text-slate-700">'+escHtml(o.phone)+'</div></div>'+
    '</div>'+
    '<div class="mb-4"><div class="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1">Pickup Address</div><div class="text-sm text-slate-700 bg-slate-50 rounded-xl p-3">'+escHtml(o.address)+'</div></div>'+
    
    '<!-- Itemized Bill Breakdown -->'+
    '<div class="mb-4 bg-slate-50 border border-slate-200/80 rounded-2xl p-4">'+
      '<div class="flex items-center justify-between mb-2 text-xs font-bold text-slate-700 uppercase tracking-wider">'+
        '<span>Itemized Service Receipt</span>'+
        '<span class="text-slate-400 font-normal lowercase">'+b.totalItemsCount+' items</span>'+
      '</div>'+
      '<div class="mb-3">'+itemRows+'</div>'+
      '<div class="space-y-1.5 pt-2.5 border-t border-slate-200 text-xs text-slate-600">'+
        '<div class="flex justify-between items-center"><span>Items Base Subtotal:</span><span class="font-semibold text-slate-800 font-mono">'+formatCurrency(b.itemsSubtotal)+'</span></div>'+
        '<div class="flex justify-between items-center"><span>Service Charge ('+svc.label+' @ '+b.serviceRate+'x):</span><span class="font-semibold text-slate-800 font-mono">'+formatCurrency(b.serviceCharge)+'</span></div>'+
        '<div class="flex justify-between items-center"><span>Priority Surcharge ('+prio.label+'):</span><span class="font-semibold text-slate-800 font-mono">'+(b.priorityFee>0?'+'+formatCurrency(b.priorityFee):'₹0')+'</span></div>'+
      '</div>'+
      '<div class="flex justify-between items-center pt-3 mt-3 border-t-2 border-slate-200">'+
        '<span class="text-sm font-bold text-slate-800 uppercase tracking-wider">Total Amount</span>'+
        '<span class="text-xl font-black text-emerald-600 font-mono tracking-tight">'+formatCurrency(finalAmount)+'</span>'+
      '</div>'+
    '</div>'+

    (o.instructions?'<div class="mb-4"><div class="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1">Special Instructions</div><div class="text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-xl p-3">'+escHtml(o.instructions)+'</div></div>':'')+
    '<div class="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100 text-xs text-slate-400">'+
      '<div><span class="font-semibold">Created:</span> '+new Date(o.createdAt).toLocaleString('en-IN')+'</div>'+
      '<div><span class="font-semibold">Updated:</span> '+new Date(o.updatedAt).toLocaleString('en-IN')+'</div>'+
    '</div>'+
    '<div class="mt-4 flex gap-2.5">' +
      (canEdit ? '<button onclick="closeDetailModal();openEditModal(\''+o.id+'\')" class="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-xl py-2.5 transition-colors"><i data-lucide="pencil" class="w-3.5 h-3.5"></i> Edit</button>' : '') +
      (canLeaveFeedback() ? '<button onclick="closeDetailModal();openFeedbackModal(\''+o.id+'\')" class="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-pink-600 bg-pink-50 hover:bg-pink-100 rounded-xl py-2.5 transition-colors"><i data-lucide="star" class="w-3.5 h-3.5"></i> Feedback</button>' : '') +
      (canCancel ? '<button onclick="closeDetailModal();openDeleteModal(\''+o.id+'\')" class="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl py-2.5 transition-colors"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i> '+cancelLabel+'</button>' : '') +
    '</div>';
  document.getElementById('detail-modal').classList.remove('hidden');
  lucide.createIcons();
}
function closeDetailModal(){document.getElementById('detail-modal').classList.add('hidden');}

// Helpers
function refreshCurrentView(){
  updateStats();
  if(currentView==='dashboard')renderDashboardTable();
  if(currentView==='kanban')renderKanban();
  if(currentView==='orders')renderOrderCards();
}
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){closeModal();closeDetailModal();closeDeleteModal();}
  if((e.ctrlKey||e.metaKey)&&e.key==='n'){e.preventDefault();openCreateModal();}
});

// Demo seed data
function seedDemoData(){
  orders=[
    {id:'WF-0001',customerName:'Priya Sharma',customerEmail:'priya@example.com',phone:'+91 98765 43210',address:'12, Green Park, Delhi - 110016',service:'wash-fold',priority:'normal',items:[{name:'Shirts',qty:5},{name:'Pants',qty:3},{name:'Socks (pairs)',qty:4}],instructions:'Use gentle detergent only.',status:'completed',totalAmount:560,createdAt:'2026-10-25T09:00:00Z',updatedAt:'2026-10-27T14:00:00Z'},
    {id:'WF-0002',customerName:'Rahul Mehta',customerEmail:'rahul@example.com',phone:'+91 87654 32109',address:'45, Juhu Beach Road, Mumbai - 400049',service:'dry-cleaning',priority:'urgent',items:[{name:'Jacket',qty:2},{name:'Dress',qty:1}],instructions:'No heat on jacket lining.',status:'delivery',totalAmount:1173,createdAt:'2026-10-28T11:30:00Z',updatedAt:'2026-10-30T08:00:00Z'},
    {id:'WF-0003',customerName:'Anjali Verma',customerEmail:'anjali@example.com',phone:'+91 76543 21098',address:'7, MG Road, Bangalore - 560001',service:'ironing',priority:'normal',items:[{name:'Kurta',qty:6},{name:'Shirts',qty:4}],instructions:'',status:'processing',totalAmount:408,createdAt:'2026-10-30T13:00:00Z',updatedAt:'2026-10-31T10:00:00Z'},
    {id:'WF-0004',customerName:'Kiran Nair',customerEmail:'kiran@example.com',phone:'+91 65432 10987',address:'88, Poes Garden, Chennai - 600086',service:'wash-fold',priority:'express',items:[{name:'Bedsheet',qty:3},{name:'Pillow Cover',qty:6},{name:'Towel',qty:4}],instructions:'Express delivery needed.',status:'collected',totalAmount:930,createdAt:'2026-10-31T08:00:00Z',updatedAt:'2026-10-31T12:00:00Z'},
    {id:'WF-0005',customerName:'Suresh Gupta',customerEmail:'suresh@example.com',phone:'+91 54321 09876',address:'22, Banjara Hills, Hyderabad - 500034',service:'dry-cleaning',priority:'normal',items:[{name:'Saree',qty:2},{name:'Dress',qty:3}],instructions:'Handle silk sarees with care.',status:'pending',totalAmount:1494,createdAt:'2026-11-01T07:30:00Z',updatedAt:'2026-11-01T07:30:00Z'},
    {id:'WF-0006',customerName:'Meena Pillai',customerEmail:'meena@example.com',phone:'+91 43210 98765',address:'5, Boat Club Road, Pune - 411001',service:'wash-fold',priority:'urgent',items:[{name:'Jeans',qty:4},{name:'Shirts',qty:3},{name:'Shorts',qty:2}],instructions:'',status:'pending',totalAmount:635,createdAt:'2026-11-01T09:15:00Z',updatedAt:'2026-11-01T09:15:00Z'}
  ];
  orderCounter=7;
  allOrdersMaster=orders.slice();
  saveToStorage();
}

// ================================================================
//  AUTHENTICATION (JavaScript Local Storage + Backend API)
// ================================================================
function checkAuth(){
  try{
    const raw=localStorage.getItem(AUTH_KEY)||sessionStorage.getItem(AUTH_KEY);
    if(raw){
      currentUser=JSON.parse(raw);
      showAppShell();
      fetchOrders();
      return true;
    }
  }catch(e){currentUser=null;}
  showLoginScreen();
  return false;
}

function showLoginScreen(){
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-error').classList.add('hidden');
  const em = document.getElementById('login-email');
  const pw = document.getElementById('login-password');
  const rem = document.getElementById('reg-email');
  const rpw = document.getElementById('reg-password');
  const rnm = document.getElementById('reg-name');
  const rsec = document.getElementById('reg-security-key');

  if(em){ em.value = ''; em.removeAttribute('readonly'); }
  if(pw){ pw.value = ''; pw.removeAttribute('readonly'); }
  if(rem){ rem.value = ''; rem.removeAttribute('readonly'); }
  if(rpw){ rpw.value = ''; rpw.removeAttribute('readonly'); }
  if(rnm){ rnm.value = ''; rnm.removeAttribute('readonly'); }
  if(rsec){ rsec.value = ''; }

  initFloatingEmojis();
  lucide.createIcons();
}

function showAppShell(){
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  updateUserInfo();
  initFloatingEmojis();
  lucide.createIcons();
}

function updateUserInfo(){
  if(!currentUser)return;
  const avatar=document.getElementById('user-avatar');
  const nameEl=document.getElementById('user-name');
  const roleEl=document.getElementById('user-role');
  const headerName=document.getElementById('header-user-name');
  const headerBadge=document.getElementById('header-user-badge');

  const initChar=currentUser.initial||(currentUser.name?currentUser.name.charAt(0).toUpperCase():'U');
  if(avatar)avatar.textContent=initChar;
  if(nameEl)nameEl.textContent=currentUser.name||'User';
  
  let roleLabel = 'Customer (User)';
  if(currentUser.role === 'Manager') roleLabel = 'Manager (Admin)';
  else if(currentUser.role === 'Operator' || currentUser.role === 'Staff') roleLabel = 'Staff (Operator)';
  else roleLabel = 'Customer (User)';

  if(roleEl)roleEl.textContent=roleLabel;
  if(headerName)headerName.textContent=currentUser.name||'User';

  if(headerBadge){
    if(currentUser.role === 'Manager'){
      headerBadge.textContent = 'Manager (Admin Access)';
      headerBadge.className = 'text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200';
    } else if(currentUser.role === 'Operator' || currentUser.role === 'Staff'){
      headerBadge.textContent = 'Staff (Operations)';
      headerBadge.className = 'text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200';
    } else {
      headerBadge.textContent = 'Customer (Client Access)';
      headerBadge.className = 'text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200';
    }
  }

  // Restrict Leave Review action: Only Customers can leave reviews, Staff and Managers cannot
  const sidebarReviewBtn = document.getElementById('sidebar-leave-review-btn');
  const pageFeedbackBtn = document.getElementById('btn-leave-feedback-page');
  const staffFeedbackBadge = document.getElementById('staff-feedback-badge');
  const emptyStateReviewBtn = document.getElementById('btn-empty-state-feedback');

  const customerCanReview = canLeaveFeedback();
  if(sidebarReviewBtn) sidebarReviewBtn.style.display = customerCanReview ? 'flex' : 'none';
  if(pageFeedbackBtn) pageFeedbackBtn.style.display = customerCanReview ? 'flex' : 'none';
  if(staffFeedbackBadge) staffFeedbackBadge.style.display = customerCanReview ? 'none' : 'flex';
  if(emptyStateReviewBtn) emptyStateReviewBtn.style.display = customerCanReview ? 'inline-block' : 'none';
}

async function handleLoginSubmit(event){
  event.preventDefault();
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  const password=document.getElementById('login-password').value;
  const errorEl=document.getElementById('login-error');
  const errorMsg=document.getElementById('login-error-msg');
  const submitBtn=document.getElementById('login-submit-btn');

  if(!email || !email.includes('@')){
    errorEl.classList.remove('hidden');
    errorMsg.innerHTML = '⚠️ Please enter a valid email address.';
    const emEl = document.getElementById('login-email');
    if(emEl){ emEl.focus(); emEl.classList.add('border-red-500'); setTimeout(()=>emEl.classList.remove('border-red-500'), 2500); }
    return;
  }
  if(!password || password.length < 4){
    errorEl.classList.remove('hidden');
    errorMsg.innerHTML = '⚠️ Please enter your password (minimum 4 characters).';
    const pwEl = document.getElementById('login-password');
    if(pwEl){ pwEl.focus(); pwEl.classList.add('border-red-500'); setTimeout(()=>pwEl.classList.remove('border-red-500'), 2500); }
    return;
  }

  if(submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('opacity-75'); }

  // 1. Try Backend API if configured
  if(API_BASE){
    try{
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if(res.ok && data.success){
        currentUser = {
          ...data.user,
          token: data.token,
          initial: (data.user.name || 'U').charAt(0).toUpperCase()
        };
        errorEl.classList.add('hidden');
        const remember = document.getElementById('login-remember')?.checked;
        if (remember) {
          localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
        } else {
          sessionStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
          localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
        }
        showAppShell();
        showToast(`Welcome back, <b>${escHtml(currentUser.name)}</b> [${escHtml(currentUser.role)}]!`, 'success');
        showView('dashboard');
        fetchOrders();
        fetchFeedbacks();
        if(submitBtn){ submitBtn.disabled = false; submitBtn.classList.remove('opacity-75'); }
        return;
      } else {
        errorEl.classList.remove('hidden');
        errorMsg.textContent = data.error || 'Invalid email or password.';
        if(submitBtn){ submitBtn.disabled = false; submitBtn.classList.remove('opacity-75'); }
        return;
      }
    }catch(err){
      // Backend offline; use local storage
    }
  }

  if(submitBtn){ submitBtn.disabled = false; submitBtn.classList.remove('opacity-75'); }

  // 2. Offline Fallback Validation (Stored in LocalStorage)
  const registeredUsers = getRegisteredUsers();
  const match = registeredUsers.find(function(u){
    return u.email.toLowerCase() === email && u.password === password;
  });

  if(match){
    currentUser = {
      id: match.id || Date.now(),
      email: match.email,
      name: match.name,
      role: match.role || 'User',
      initial: (match.name || 'U').charAt(0).toUpperCase()
    };
  } else if(email && email.includes('@') && password && password.length >= 4){
    const localPart = email.split('@')[0];
    const formattedName = localPart.charAt(0).toUpperCase() + localPart.slice(1);
    currentUser = {
      id: Date.now(),
      email: email,
      name: formattedName,
      role: 'User',
      initial: formattedName.charAt(0).toUpperCase()
    };
    registeredUsers.push({ ...currentUser, password: password });
    saveRegisteredUsers(registeredUsers);
  } else {
    errorEl.classList.remove('hidden');
    errorMsg.textContent = 'Invalid credentials. Use demo account or password (min 4 chars).';
    return;
  }

  errorEl.classList.add('hidden');
  const remember = document.getElementById('login-remember')?.checked;
  if(remember){
    localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
  } else {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
    localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
  }
  showAppShell();
  showToast('Welcome back, <b>'+escHtml(currentUser.name)+'</b> ('+escHtml(currentUser.role)+')!','success');
  showView('dashboard');
  fetchOrders();
  fetchFeedbacks();
}

function fillQuickLogin(email,password,name,role){
  const em = document.getElementById('login-email');
  const pw = document.getElementById('login-password');
  if(em){ em.removeAttribute('readonly'); em.value=email; }
  if(pw){ pw.removeAttribute('readonly'); pw.value=password; }
  document.getElementById('login-error').classList.add('hidden');
  const form = document.getElementById('login-form');
  if(typeof form.requestSubmit === 'function'){
    form.requestSubmit();
  } else {
    handleLoginSubmit(new Event('submit'));
  }
}

function togglePasswordVisibility(){
  const pwd=document.getElementById('login-password');
  const icon=document.getElementById('pwd-toggle-icon');
  if(pwd.type==='password'){
    pwd.type='text';
    icon.setAttribute('data-lucide','eye-off');
  }else{
    pwd.type='password';
    icon.setAttribute('data-lucide','eye');
  }
  lucide.createIcons();
}

function handleLogout(){
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(AUTH_KEY);
  currentUser=null;
  systemStats=null;
  const container = document.getElementById('user-status-card-container');
  if(container){ container.innerHTML = ''; container.classList.add('hidden'); }
  showToast('You have been logged out.','info');
  showLoginScreen();
}

// ------------------------------------------------------------
//  AUTH TABS & USER REGISTRATION (NEW ID & PASSWORD)
// ------------------------------------------------------------
function switchAuthTab(tab){
  const loginForm=document.getElementById('login-form');
  const regForm=document.getElementById('register-form');
  const loginBtn=document.getElementById('tab-login-btn');
  const regBtn=document.getElementById('tab-register-btn');
  const subtitle=document.getElementById('auth-subtitle');
  const errEl=document.getElementById('login-error');

  if(errEl)errEl.classList.add('hidden');

  if(tab==='register'){
    if(loginForm)loginForm.classList.add('hidden');
    if(regForm)regForm.classList.remove('hidden');
    if(loginBtn)loginBtn.className='flex-1 py-2 text-xs font-bold rounded-xl text-slate-500 hover:text-slate-800 transition-all flex items-center justify-center gap-1.5';
    if(regBtn)regBtn.className='flex-1 py-2 text-xs font-bold rounded-xl bg-white text-slate-800 shadow-sm transition-all flex items-center justify-center gap-1.5';
    if(subtitle)subtitle.textContent='Create your new credentials for WashFlow';
    const rem = document.getElementById('reg-email');
    const rpw = document.getElementById('reg-password');
    const rnm = document.getElementById('reg-name');
    const rsec = document.getElementById('reg-security-key');
    if(rem) { rem.value = ''; rem.removeAttribute('readonly'); }
    if(rpw) { rpw.value = ''; rpw.removeAttribute('readonly'); }
    if(rnm) { rnm.value = ''; rnm.removeAttribute('readonly'); }
    if(rsec) { rsec.value = ''; }
    // Default to User role and ensure security key is hidden
    const userRadio=document.querySelector('input[name="reg-role"][value="User"]');
    if(userRadio)userRadio.checked=true;
    handleRoleSelectionChange('User');
  }else{
    if(loginForm)loginForm.classList.remove('hidden');
    if(regForm)regForm.classList.add('hidden');
    if(loginBtn)loginBtn.className='flex-1 py-2 text-xs font-bold rounded-xl bg-white text-slate-800 shadow-sm transition-all flex items-center justify-center gap-1.5';
    if(regBtn)regBtn.className='flex-1 py-2 text-xs font-bold rounded-xl text-slate-500 hover:text-slate-800 transition-all flex items-center justify-center gap-1.5';
    if(subtitle)subtitle.textContent='Sign in or create a new account to continue';
    const em = document.getElementById('login-email');
    const pw = document.getElementById('login-password');
    if(em) { em.value = ''; em.removeAttribute('readonly'); }
    if(pw) { pw.value = ''; pw.removeAttribute('readonly'); }
  }
  lucide.createIcons();
}

function handleRoleSelectionChange(selectedRole){
  const secContainer=document.getElementById('security-key-container');
  const secInput=document.getElementById('reg-security-key');
  if(!secContainer)return;

  if(selectedRole==='Staff'||selectedRole==='Manager'){
    secContainer.classList.remove('hidden');
    if(secInput){
      secInput.required=true;
      secInput.focus();
    }
  }else{
    secContainer.classList.add('hidden');
    if(secInput){
      secInput.required=false;
      secInput.value='';
    }
  }
  lucide.createIcons();
}

function toggleSecurityKeyVisibility(){
  const secInput=document.getElementById('reg-security-key');
  const icon=document.getElementById('reg-sec-toggle-icon');
  if(!secInput||!icon)return;
  if(secInput.type==='password'){
    secInput.type='text';
    icon.setAttribute('data-lucide','eye-off');
  }else{
    secInput.type='password';
    icon.setAttribute('data-lucide','eye');
  }
  lucide.createIcons();
}

function toggleRegPasswordVisibility(){
  const pwd=document.getElementById('reg-password');
  const icon=document.getElementById('reg-pwd-toggle-icon');
  if(!pwd||!icon)return;
  if(pwd.type==='password'){
    pwd.type='text';
    icon.setAttribute('data-lucide','eye-off');
  }else{
    pwd.type='password';
    icon.setAttribute('data-lucide','eye');
  }
  lucide.createIcons();
}

async function handleRegisterSubmit(event){
  event.preventDefault();
  const name=document.getElementById('reg-name').value.trim();
  const email=document.getElementById('reg-email').value.trim().toLowerCase();
  const password=document.getElementById('reg-password').value;
  const roleEl=document.querySelector('input[name="reg-role"]:checked');
  const role=roleEl?roleEl.value:'User';
  const secInput=document.getElementById('reg-security-key');
  const securityKey=secInput?secInput.value.trim():'';
  const submitBtn=document.getElementById('reg-submit-btn');
  const errorEl=document.getElementById('login-error');
  const errorMsg=document.getElementById('login-error-msg');

  // 1. Mandatory Name Validation
  if(!name || name.length < 2){
    if(errorEl && errorMsg){
      errorEl.classList.remove('hidden');
      errorMsg.innerHTML = '⚠️ <b>Full Name Required:</b> Please enter your name (minimum 2 characters).';
    }
    const nEl = document.getElementById('reg-name');
    if(nEl){ nEl.focus(); nEl.classList.add('border-red-500'); setTimeout(()=>nEl.classList.remove('border-red-500'), 2500); }
    return;
  }

  // 2. Mandatory Email Validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if(!email || !emailRegex.test(email)){
    if(errorEl && errorMsg){
      errorEl.classList.remove('hidden');
      errorMsg.innerHTML = '⚠️ <b>Valid Email Required:</b> Please enter a valid email address (e.g. name@washflow.com).';
    }
    const eEl = document.getElementById('reg-email');
    if(eEl){ eEl.focus(); eEl.classList.add('border-red-500'); setTimeout(()=>eEl.classList.remove('border-red-500'), 2500); }
    return;
  }

  // 3. Mandatory Password Validation (min 4 characters)
  if(!password || password.length < 4){
    if(errorEl && errorMsg){
      errorEl.classList.remove('hidden');
      errorMsg.innerHTML = '⚠️ <b>Password Required:</b> Please create a secure password of at least 4 characters.';
    }
    const pEl = document.getElementById('reg-password');
    if(pEl){ pEl.focus(); pEl.classList.add('border-red-500'); setTimeout(()=>pEl.classList.remove('border-red-500'), 2500); }
    return;
  }

  // 4. Verify Security Key for Staff or Manager (key must be 1627)
  if(role==='Staff'||role==='Manager'){
    if(!securityKey||securityKey!=='1627'){
      if(errorEl&&errorMsg){
        errorEl.classList.remove('hidden');
        errorMsg.innerHTML='⛔ <b>Access Denied:</b> Invalid Security Key. Authorization key (1627) is required for Staff and Manager accounts.';
      }
      if(secInput){
        secInput.focus();
        secInput.classList.add('border-red-500');
        setTimeout(()=>secInput.classList.remove('border-red-500'),2500);
      }
      return;
    }
  }

  if(submitBtn){ submitBtn.disabled=true; submitBtn.classList.add('opacity-75'); }

  let mappedRole='User';
  if(role==='Manager')mappedRole='Manager';
  else if(role==='Staff')mappedRole='Operator';
  else mappedRole='User';

  // 5. Try Backend API
  if(API_BASE){
    try{
      const res=await fetch(`${API_BASE}/api/register`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,email,password,role:mappedRole,securityKey})
      });
      const data=await res.json();
      if(res.ok&&data.success){
        currentUser={
          ...data.user,
          token:data.token,
          initial:(data.user.name||'U').charAt(0).toUpperCase()
        };
        localStorage.setItem(AUTH_KEY,JSON.stringify(currentUser));
        if(errorEl)errorEl.classList.add('hidden');
        showAppShell();
        showToast(`🎉 <b>Account Created!</b> Welcome to WashFlow, <b>${escHtml(currentUser.name)}</b> [${escHtml(currentUser.role)}]!`,'success',5000);
        showView('dashboard');
        fetchOrders();
        fetchFeedbacks();
        if(submitBtn){ submitBtn.disabled=false; submitBtn.classList.remove('opacity-75'); }
        return;
      }else{
        if(errorEl&&errorMsg){
          errorEl.classList.remove('hidden');
          errorMsg.textContent=data.error||'Registration failed.';
        }
        if(submitBtn){ submitBtn.disabled=false; submitBtn.classList.remove('opacity-75'); }
        return;
      }
    }catch(err){
      // Backend offline fallback
    }
  }

  if(submitBtn){ submitBtn.disabled=false; submitBtn.classList.remove('opacity-75'); }

  // 6. Offline Fallback Registration (Stored in LocalStorage)
  const registeredUsers = getRegisteredUsers();
  if(registeredUsers.some(function(u){ return u.email && u.email.toLowerCase() === email; })){
    if(errorEl && errorMsg){
      errorEl.classList.remove('hidden');
      errorMsg.innerHTML = '⚠️ <b>Account Exists:</b> An account with email <b>' + escHtml(email) + '</b> already exists. Please sign in instead.';
    }
    const eEl = document.getElementById('reg-email');
    if(eEl){ eEl.focus(); eEl.classList.add('border-red-500'); setTimeout(()=>eEl.classList.remove('border-red-500'), 2500); }
    return;
  }

  const newUser={
    id:Date.now(),
    email:email,
    name:name,
    password:password,
    role:mappedRole,
    initial:name.charAt(0).toUpperCase()
  };
  registeredUsers.push(newUser);
  saveRegisteredUsers(registeredUsers);

  currentUser={
    id: newUser.id,
    email: newUser.email,
    name: newUser.name,
    role: newUser.role,
    initial: newUser.initial
  };
  localStorage.setItem(AUTH_KEY,JSON.stringify(currentUser));
  if(errorEl)errorEl.classList.add('hidden');
  showAppShell();
  showToast(`🎉 <b>Account Created!</b> Welcome, <b>${escHtml(currentUser.name)}</b> [${escHtml(currentUser.role)}]!`,'success',5000);
  showView('dashboard');
  fetchOrders();
  fetchFeedbacks();
}

// ================================================================
//  CUSTOMER FEEDBACK & REVIEWS
// ================================================================
async function fetchFeedbacks(){
  if(API_BASE){
    try{
      const res=await fetch(`${API_BASE}/api/feedbacks`);
      if(res.ok){
        const data=await res.json();
        if(data.success&&Array.isArray(data.feedbacks)){
          feedbacks=data.feedbacks;
          localStorage.setItem(FEEDBACK_KEY,JSON.stringify(feedbacks));
          if(currentView==='feedback')renderFeedbackView();
          return;
        }
      }
    }catch(e){}
  }

  // Local fallback
  try{
    const raw=localStorage.getItem(FEEDBACK_KEY);
    if(raw){
      feedbacks=JSON.parse(raw);
    }else{
      feedbacks=[
        {id:1,order_id:'WF-0001',customer_name:'Priya Sharma',rating:5,category:'Wash Quality',comments:'Super clean clothes and smelled wonderfully fresh! The silk was handled with great care.',created_at:'2026-10-27T15:00:00Z'},
        {id:2,order_id:'WF-0002',customer_name:'Rahul Mehta',rating:5,category:'Delivery Speed',comments:'Express delivery arrived right on time before my flight. Jacket lining was intact.',created_at:'2026-10-30T09:30:00Z'},
        {id:3,order_id:'WF-0003',customer_name:'Anjali Verma',rating:4,category:'Ironing & Finish',comments:'Crisp ironing on the kurtas. Neatly folded and packaged.',created_at:'2026-10-31T11:00:00Z'},
        {id:4,order_id:'WF-0004',customer_name:'Kiran Nair',rating:5,category:'Packaging',comments:'Eco-friendly packaging and spotless towels. WashFlow is definitely our go-to laundry service!',created_at:'2026-11-01T12:00:00Z'}
      ];
      localStorage.setItem(FEEDBACK_KEY,JSON.stringify(feedbacks));
    }
  }catch(e){
    feedbacks=[];
  }
  if(currentView==='feedback')renderFeedbackView();
}

function renderFeedbackView(){
  const container=document.getElementById('feedbacks-container');
  const emptyState=document.getElementById('empty-state-feedback');
  const avgScoreEl=document.getElementById('fb-avg-score');
  const avgStarsEl=document.getElementById('fb-avg-stars');
  const totalCountEl=document.getElementById('fb-total-count');
  const filterCountEl=document.getElementById('fb-filter-count');
  const barsContainer=document.getElementById('fb-breakdown-bars');

  if(!container)return;

  const total=feedbacks.length;
  const avg=total>0?(feedbacks.reduce((sum,f)=>sum+(parseInt(f.rating)||5),0)/total).toFixed(1):'5.0';

  if(avgScoreEl)avgScoreEl.textContent=avg;
  if(totalCountEl)totalCountEl.textContent=`Based on ${total} verified review${total===1?'':'s'}`;

  // Render avg stars
  if(avgStarsEl){
    const numAvg=Math.round(parseFloat(avg));
    avgStarsEl.innerHTML=[1,2,3,4,5].map(i=>{
      const fillClass=i<=numAvg?'fill-amber-300 text-amber-300':'text-white/40';
      return `<i data-lucide="star" class="w-5 h-5 ${fillClass}"></i>`;
    }).join('');
  }

  // Render rating breakdown bars
  if(barsContainer){
    const counts={5:0,4:0,3:0,2:0,1:0};
    feedbacks.forEach(f=>{
      const r=Math.min(5,Math.max(1,parseInt(f.rating)||5));
      counts[r]++;
    });

    barsContainer.innerHTML=[5,4,3,2,1].map(star=>{
      const count=counts[star];
      const pct=total>0?Math.round((count/total)*100):0;
      return `
        <div class="flex items-center gap-3 text-xs">
          <span class="w-12 font-bold text-slate-700 flex items-center gap-1">${star} <i data-lucide="star" class="w-3.5 h-3.5 fill-amber-400 text-amber-400"></i></span>
          <div class="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div class="h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
          </div>
          <span class="w-14 text-right text-slate-400 font-semibold">${count} (${pct}%)</span>
        </div>
      `;
    }).join('');
  }

  // Apply star filter
  let filtered=feedbacks;
  if(feedbackFilter==='5')filtered=feedbacks.filter(f=>parseInt(f.rating)===5);
  else if(feedbackFilter==='4')filtered=feedbacks.filter(f=>parseInt(f.rating)===4);
  else if(feedbackFilter==='3')filtered=feedbacks.filter(f=>parseInt(f.rating)<=3);

  if(filterCountEl){
    filterCountEl.textContent=`Showing ${filtered.length} of ${total} review${total===1?'':'s'}`;
  }

  if(!filtered.length){
    container.innerHTML='';
    if(emptyState)emptyState.classList.remove('hidden');
    const emptyStateReviewBtn = document.getElementById('btn-empty-state-feedback');
    if(emptyStateReviewBtn) emptyStateReviewBtn.style.display = canLeaveFeedback() ? 'inline-block' : 'none';
    lucide.createIcons();
    return;
  }
  if(emptyState)emptyState.classList.add('hidden');

  // Sync Customer / Staff controls
  const customerCanReview = canLeaveFeedback();
  const pageFeedbackBtn = document.getElementById('btn-leave-feedback-page');
  const staffFeedbackBadge = document.getElementById('staff-feedback-badge');
  const emptyStateReviewBtn = document.getElementById('btn-empty-state-feedback');
  if(pageFeedbackBtn) pageFeedbackBtn.style.display = customerCanReview ? 'flex' : 'none';
  if(staffFeedbackBadge) staffFeedbackBadge.style.display = customerCanReview ? 'none' : 'flex';
  if(emptyStateReviewBtn) emptyStateReviewBtn.style.display = customerCanReview ? 'inline-block' : 'none';

  container.innerHTML=filtered.map(f=>{
    const rating=Math.min(5,Math.max(1,parseInt(f.rating)||5));
    const starsHtml=[1,2,3,4,5].map(i=>{
      const fillClass=i<=rating?'fill-amber-400 text-amber-400':'text-slate-200';
      return `<i data-lucide="star" class="w-4 h-4 ${fillClass}"></i>`;
    }).join('');

    const initial=(f.customer_name||'C').charAt(0).toUpperCase();
    const dateStr=f.created_at?new Date(f.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'Recently';

    return `
      <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between gap-3 mb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 text-white font-bold text-sm flex items-center justify-center shadow-md shadow-blue-500/20">
                ${initial}
              </div>
              <div>
                <h4 class="font-bold text-slate-800 text-sm">${escHtml(f.customer_name)}</h4>
                <div class="text-[11px] text-slate-400">${dateStr}</div>
              </div>
            </div>
            <span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              ${escHtml(f.category||'General')}
            </span>
          </div>

          <div class="flex items-center gap-1 mb-2">
            ${starsHtml}
          </div>

          <p class="text-xs text-slate-600 leading-relaxed italic mb-3">
            "${escHtml(f.comments)}"
          </p>
        </div>

        <div class="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>${f.order_id?`<span class="font-mono text-blue-600 font-bold">#${escHtml(f.order_id)}</span>`:'Direct Review'}</span>
          <span class="flex items-center gap-1 text-emerald-600 font-semibold"><i data-lucide="badge-check" class="w-3.5 h-3.5"></i> Verified Service</span>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

function setFeedbackFilter(star){
  feedbackFilter=star;
  document.querySelectorAll('.fb-filter-btn').forEach(b=>{
    const active=b.dataset.star===star;
    b.classList.toggle('bg-blue-600',active);
    b.classList.toggle('text-white',active);
    b.classList.toggle('bg-slate-100',!active);
    b.classList.toggle('text-slate-600',!active);
  });
  renderFeedbackView();
}

function setFeedbackRating(val){
  selectedFeedbackRating=val;
  const ratingInput=document.getElementById('fb-rating-value');
  const starLabel=document.getElementById('star-label');
  if(ratingInput)ratingInput.value=val;

  const labels={
    1:'1 Star - Needs Improvement 😞',
    2:'2 Stars - Fair 😐',
    3:'3 Stars - Good 🙂',
    4:'4 Stars - Very Good! 😊',
    5:'5 Stars - Outstanding! ⭐⭐⭐⭐⭐'
  };
  if(starLabel)starLabel.textContent=labels[val]||`${val} Stars`;

  renderStarPicker();
}

function renderStarPicker(){
  const picker=document.getElementById('star-picker');
  if(!picker)return;
  picker.innerHTML=[1,2,3,4,5].map(i=>{
    const fillClass=i<=selectedFeedbackRating?'fill-amber-400 text-amber-400':'text-slate-200 hover:text-amber-300';
    return `
      <button type="button" onclick="setFeedbackRating(${i})" class="p-1 focus:outline-none transition-transform hover:scale-110">
        <i data-lucide="star" class="w-7 h-7 ${fillClass}"></i>
      </button>
    `;
  }).join('');
  lucide.createIcons();
}

function openFeedbackModal(prefillOrderId){
  if(!canLeaveFeedback()){
    showToast('⛔ <b>Access Restricted:</b> Reviews and feedback can only be submitted by Customers. Staff and Managers cannot leave reviews.', 'warning', 4500);
    return;
  }
  const modal=document.getElementById('feedback-modal');
  const orderSelect=document.getElementById('fb-order-id');
  const nameInput=document.getElementById('fb-customer-name');
  if(!modal)return;

  // Pre-fill customer name if logged in as customer
  if(nameInput && currentUser && currentUser.name){
    nameInput.value = currentUser.name;
  }

  // Populate Order ID options from current orders belonging to the customer
  if(orderSelect){
    const availOrders = orders.filter(isOrderOwner);
    orderSelect.innerHTML='<option value="">General Experience</option>'+
      availOrders.map(o=>`<option value="${escHtml(o.id)}">#${escHtml(o.id)} - ${escHtml(o.service || 'Laundry')}</option>`).join('');
    if(prefillOrderId)orderSelect.value=prefillOrderId;
  }

  setFeedbackRating(5);
  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeFeedbackModal(){
  const modal=document.getElementById('feedback-modal');
  if(modal)modal.classList.add('hidden');
}

async function handleFeedbackSubmit(event){
  event.preventDefault();
  if(!canLeaveFeedback()){
    showToast('⛔ <b>Access Denied:</b> Reviews and feedback can only be submitted by Customers. Staff and Managers cannot submit reviews.', 'danger', 4500);
    closeFeedbackModal();
    return;
  }
  const customerName=document.getElementById('fb-customer-name').value.trim();
  const orderId=document.getElementById('fb-order-id').value;
  const rating=parseInt(document.getElementById('fb-rating-value').value)||5;
  const category=document.getElementById('fb-category').value;
  const comments=document.getElementById('fb-comments').value.trim();
  const submitBtn=document.getElementById('fb-submit-btn');

  if(!customerName||!comments){
    showToast('Please provide your name and review comments.','warning');
    return;
  }

  if(submitBtn){ submitBtn.disabled=true; submitBtn.classList.add('opacity-75'); }

  const payload={customerName,orderId,rating,category,comments};

  if(API_BASE){
    try{
      const res=await fetch(`${API_BASE}/api/feedbacks`,{
        method:'POST',
        headers: getAuthHeaders(),
        body:JSON.stringify(payload)
      });
      if(res.status === 403){
        showToast('⛔ <b>403 Forbidden:</b> Only customers can submit feedback. Staff and Managers cannot leave reviews.', 'danger', 4500);
        closeFeedbackModal();
        if(submitBtn){ submitBtn.disabled=false; submitBtn.classList.remove('opacity-75'); }
        return;
      }
      if(res.ok){
        const data=await res.json();
        const newFb=data.feedback||{id:Date.now(),...payload,customer_name:customerName,order_id:orderId,created_at:new Date().toISOString()};
        feedbacks.unshift(newFb);
        localStorage.setItem(FEEDBACK_KEY,JSON.stringify(feedbacks));
        closeFeedbackModal();
        document.getElementById('feedback-form').reset();
        sendPushNotification('⭐ New Customer Review!',`${customerName} rated ${rating}★ for ${category}: "${comments.slice(0,45)}..."`,'feedback');
        if(currentView==='feedback')renderFeedbackView();
        if(submitBtn){ submitBtn.disabled=false; submitBtn.classList.remove('opacity-75'); }
        return;
      }
    }catch(err){}
  }

  // Fallback offline submission
  const fallbackFb={
    id:Date.now(),
    customer_name:customerName,
    order_id:orderId||null,
    rating,
    category,
    comments,
    created_at:new Date().toISOString()
  };
  feedbacks.unshift(fallbackFb);
  localStorage.setItem(FEEDBACK_KEY,JSON.stringify(feedbacks));
  closeFeedbackModal();
  document.getElementById('feedback-form').reset();
  sendPushNotification('⭐ New Customer Review!',`${customerName} rated ${rating}★: "${comments.slice(0,45)}..."`,'feedback');
  if(currentView==='feedback')renderFeedbackView();
  if(submitBtn){ submitBtn.disabled=false; submitBtn.classList.remove('opacity-75'); }
}

// ================================================================
//  AUTOMATIC AMBIENT FLOATING BACKGROUND EMOJIS
//  Theme: Wash, Laundry, Cleaning & Happiness (Always Floating Everywhere)
// ================================================================

const WASH_EMOJIS = [
  // Wash & Laundry
  '🧺', '🧼', '🫧', '👕', '👗', '👖', '🧦', '👔', '🧴',
  // Cleaning & Sparkle
  '✨', '🧽', '💧', '🌟', '🚿',
  // Happiness & Good Vibes
  '😊', '🌈', '💖', '🎉', '🌸', '💫', '☀️', '🍃', '🤍'
];

// Spawns a floating emoji inside container with full-width distribution and pre-staggered start
function createFloatingEmoji(container, index, total){
  if(!container) return null;
  const el = document.createElement('span');
  el.className = 'floating-emoji';
  el.textContent = WASH_EMOJIS[Math.floor(Math.random() * WASH_EMOJIS.length)];

  // Even horizontal distribution across the screen from 2% to 98%
  const step = 94 / Math.max(1, total);
  const left = (2 + index * step + (Math.random() * step * 0.8)).toFixed(1);

  const size = Math.floor(Math.random() * 16) + 20; // 20px to 36px
  const duration = (Math.random() * 8 + 16).toFixed(1); // 16s to 24s smooth pace
  const swayDuration = (Math.random() * 2 + 3.2).toFixed(1);

  // Negative animation delay ensures emojis are ALREADY distributed vertically across the entire screen from frame 1
  const delay = -(Math.random() * duration).toFixed(1);
  const isDark = container.id === 'login-emoji-container';
  const opacity = isDark ? (Math.random() * 0.35 + 0.45).toFixed(2) : (Math.random() * 0.25 + 0.25).toFixed(2);
  const spin = (Math.floor(Math.random() * 360) - 180) + 'deg';

  el.style.left = left + '%';
  el.style.bottom = '-60px';
  el.style.fontSize = size + 'px';
  el.style.setProperty('--emoji-opacity', opacity);
  el.style.setProperty('--emoji-spin', spin);
  el.style.animationDuration = `${duration}s, ${swayDuration}s`;
  el.style.animationDelay = `${delay}s, -${(Math.random() * 3).toFixed(1)}s`;

  // Continuous automatic respawn at new random position when each upward float cycle finishes
  el.addEventListener('animationiteration', function(e){
    if(e.animationName === 'floatUpward'){
      el.textContent = WASH_EMOJIS[Math.floor(Math.random() * WASH_EMOJIS.length)];
      el.style.left = (Math.random() * 94 + 3).toFixed(1) + '%';
      el.style.setProperty('--emoji-spin', (Math.floor(Math.random() * 360) - 180) + 'deg');
    }
  });

  container.appendChild(el);
  return el;
}

// Initialize floating background emojis across both login and app backgrounds
function initFloatingEmojis(){
  // 1. Fullscreen background for login screen
  const loginContainer = document.getElementById('login-emoji-container');
  if(loginContainer && loginContainer.children.length === 0){
    const totalLogin = 36;
    for(let i = 0; i < totalLogin; i++){
      createFloatingEmoji(loginContainer, i, totalLogin);
    }
  }

  // 2. Fullscreen background for authenticated app shell (Dashboard, Kanban, Orders, Feedback)
  const appContainer = document.getElementById('app-emoji-container');
  if(appContainer && appContainer.children.length === 0){
    const totalApp = 40;
    for(let i = 0; i < totalApp; i++){
      createFloatingEmoji(appContainer, i, totalApp);
    }
  }
}

// Init
(function init(){
  loadFromStorage();
  if(!orders.length)seedDemoData();
  loadNotifications();
  fetchFeedbacks();
  initFloatingEmojis();
  lucide.createIcons();
  checkAuth();
})();