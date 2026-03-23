/* ── SUPABASE ── */
const { createClient } = supabase;
const sb = createClient('https://ufodnrwbbxfbbjzsowfc.supabase.co', 'sb_publishable_BS7r1bZfOIkwq_oS_twp8Q_nLYIOXn7', {
  auth: {
    persistSession: false,      // never store session in localStorage
    autoRefreshToken: false,    // don't silently refresh tokens
    detectSessionInUrl: false,  // don't read tokens from URL hash
  }
});

/* ── SECURITY: strip auth tokens from URL immediately ── */
if (window.location.hash && window.location.hash.includes('access_token')) {
  history.replaceState(null, '', window.location.pathname);
}

let currentUser = null;

/* ── AUTH ── */
let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  document.querySelectorAll('.auth-tab').forEach((t,i) => t.classList.toggle('active', ['login','signup'][i]===m));
  document.querySelector('.auth-btn').textContent = m === 'login' ? 'Sign in' : 'Create account';
  document.getElementById('authErr').textContent = '';
}

let authFailCount = 0;
let authLockUntil = 0;

async function handleAuth() {
  const now = Date.now();
  if (now < authLockUntil) {
    const secs = Math.ceil((authLockUntil - now) / 1000);
    document.getElementById('authErr').textContent = `Too many attempts. Wait ${secs}s.`;
    return;
  }
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authErr');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Please fill in both fields'; return; }
  if (!email.includes('@') || email.length > 254) { errEl.textContent = 'Please enter a valid email'; return; }
  if (password.length < 6) { errEl.textContent = 'Password must be at least 6 characters'; return; }
  const btn = document.querySelector('.auth-btn');
  btn.textContent = '...';
  btn.disabled = true;
  try {
    let res;
    if (authMode === 'login') {
      res = await sb.auth.signInWithPassword({ email, password });
    } else {
      res = await sb.auth.signUp({ email, password });
    }
    if (res.error) {
      authFailCount++;
      if (authFailCount >= 5) {
        authLockUntil = Date.now() + 30000; // 30 second lockout
        authFailCount = 0;
        errEl.textContent = 'Too many failed attempts. Please wait 30 seconds.';
      } else {
        errEl.textContent = res.error.message;
      }
    } else {
      authFailCount = 0;
      if (authMode === 'signup' && !res.data.session) {
        errEl.textContent = 'Check your email to confirm your account, then sign in.';
      }
    }
  } catch(e) { errEl.textContent = 'Something went wrong, please try again'; }
  finally { btn.textContent = authMode === 'login' ? 'Sign in' : 'Create account'; btn.disabled = false; }
}

document.getElementById('authPassword').addEventListener('keydown', e => { if(e.key==='Enter') handleAuth(); });

async function handleSignOut() {
  try { await sb.auth.signOut(); } catch(e) {}
  showAuthScreen();
}

function resetUserState() {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  masteredSet.clear();
  xp = 0;
  streak = 0;
  consecutiveCorrect = 0;
  consecutiveWrong = 0;
  currentIdx = 0;
  // Reset UI
  const xpFill = document.getElementById('xpFill');
  const xpLevel = document.getElementById('xpLevel');
  const streakBadge = document.getElementById('streakBadge');
  if (xpFill) xpFill.style.width = '0%';
  if (xpLevel) xpLevel.textContent = '1 · Beginner';
  if (streakBadge) streakBadge.textContent = '🔥 0 streak';
}

function showAuthScreen() {
  currentUser = null;
  isAdmin = false;
  resetUserState();
  const adminTab = document.getElementById('adminNavTab');
  if (adminTab) adminTab.style.display = 'none';
  const adminMobileTab = document.getElementById('adminMobileTab');
  if (adminMobileTab) adminMobileTab.style.display = 'none';
  closeMobileMenu();
  document.getElementById('appNav').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-flashcards').classList.add('active');
  document.getElementById('adminLocked').style.display = 'block';
  document.getElementById('adminUnlocked').style.display = 'none';
}

/* ── SESSION LISTENER ── */
sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_OUT') { showAuthScreen(); return; }
  if (session?.user) {
    currentUser = session.user;
    // Reset all user state before loading new user's progress
    resetUserState();
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appNav').style.display = 'block';
    const email = session.user.email || '';
    document.getElementById('navUserEmail').textContent = email;
    document.getElementById('navUserEmail').title = email;
    const avatarEl = document.getElementById('navUserAvatar');
    if (avatarEl) avatarEl.textContent = email.charAt(0).toUpperCase();
    const mobileUserEl = document.getElementById('mobileUserEmail');
    if (mobileUserEl) mobileUserEl.textContent = email;
    await loadCardsFromDB();
    await loadProgressFromDB();
    await showAdminTabIfEligible();
    initApp();
  }
});

async function showAdminTabIfEligible() {
  const { data } = await sb.from('admins').select('user_id').eq('user_id', currentUser.id).single();
  const adminTab = document.getElementById('adminNavTab');
  const adminMobileTab = document.getElementById('adminMobileTab');
  if (adminTab) adminTab.style.display = data ? '' : 'none';
  if (adminMobileTab) adminMobileTab.style.display = data ? '' : 'none';
  isAdmin = !!data;
}

/* ── LOAD CARDS FROM SUPABASE ── */
async function loadCardsFromDB() {
  const { data, error } = await sb.from('cards').select('*').order('cat').order('viet');
  if (error || !data || data.length === 0) {
    showToast('Using offline cards — database empty or unreachable');
    return;
  }
  // Replace ALL_CARDS with DB data
  ALL_CARDS.length = 0;
  data.forEach(row => {
    ALL_CARDS.push({ viet: row.viet, eng: row.eng, pronun: row.pronun || '', context: row.context || '', cat: row.cat, id: row.id });
  });
  showToast('Cards loaded from database ✓');
}

/* ── PROGRESS SYNC ── */
async function loadProgressFromDB() {
  if (!currentUser) return;
  const { data, error } = await sb.from('progress').select('*').eq('user_id', currentUser.id).single();
  if (error || !data) return; // no row yet = fresh user, keep at 0
  if (data.xp != null)     { xp = data.xp; addXP(0); }
  if (data.streak != null) { streak = data.streak; document.getElementById('streakBadge').textContent = '🔥 ' + streak + ' streak'; }
  if (data.mastered)       { data.mastered.split(',').filter(Boolean).forEach(id => masteredSet.add(id)); updateStats(); }
}

let _saveTimer = null;
function scheduleSave() {
  if (!currentUser) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveProgressToDB, 2000); // debounce: save 2s after last action
}

async function saveProgressToDB() {
  if (!currentUser) return;
  const payload = {
    user_id: currentUser.id,
    xp: xp,
    streak: streak,
    mastered: [...masteredSet].join(',')
  };
  const { error } = await sb.from('progress').upsert(payload, { onConflict: 'user_id' });
  if (error) showToast('⚠️ Progress not saved — check connection', 3000);
}


/* ── MOBILE MENU ── */
function toggleMobileMenu() {
  const menu = document.getElementById('mobileMenu');
  const btn = document.getElementById('hamburger');
  const isOpen = menu.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
}

function closeMobileMenu() {
  document.getElementById('mobileMenu').classList.remove('open');
  document.getElementById('hamburger').classList.remove('open');
}

// Close menu when tapping outside
document.addEventListener('click', e => {
  const nav = document.getElementById('appNav');
  if (nav && !nav.contains(e.target)) closeMobileMenu();
});

/* ── VIEW SWITCHER ── */
function switchView(view) {
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.app-nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.app-nav-tab').forEach((t, i) => {
    if (['flashcards','practice','admin'][i] === view) t.classList.add('active');
  });
  // Sync mobile menu active state
  document.querySelectorAll('.mobile-menu-item').forEach(t => t.classList.remove('active'));
  const mobileViews = ['flashcards','practice','admin'];
  document.querySelectorAll('.mobile-menu-item').forEach((t, i) => {
    if (mobileViews[i] === view) t.classList.add('active');
  });
  closeMobileMenu();
  window.scrollTo({top:0,behavior:'smooth'});
  if (view === 'admin') initAdminView();
  if (view === 'flashcards' && deck && deck.length > 0) showCard();
  if (view === 'practice' && typeof loadSentence === 'function') loadSentence();
}

/* ── SHARED TOAST ── */
function showToast(msg, dur) {
  dur = dur || 2200;
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

/* ── ADMIN PANEL ── */
// Admin now uses the user's own session (no secret key needed)
// Access is controlled by the admins table in Supabase RLS

let adminCards = [];
let isAdmin = false;

async function checkAdminAccess() {
  if (!currentUser) return false;
  const { data, error } = await sb.from('admins').select('user_id').eq('user_id', currentUser.id).single();
  return !error && !!data;
}

async function initAdminView() {
  const adminLocked = document.getElementById('adminLocked');
  const adminUnlocked = document.getElementById('adminUnlocked');
  if (isAdmin) {
    adminLocked.style.display = 'none';
    adminUnlocked.style.display = 'block';
    await loadAdminCards();
  } else {
    adminLocked.style.display = 'block';
    adminUnlocked.style.display = 'none';
  }
}

async function loadAdminCards() {
  const countEl = document.getElementById('adminCardCount');
  countEl.textContent = '(loading...)';
  const { data, error } = await sb.from('cards').select('*').order('cat').order('viet');
  if (error) {
    showToast('Error loading cards: ' + error.message, 4000);
    countEl.textContent = '(error)';
    return;
  }
  adminCards = data || [];
  countEl.textContent = '(' + adminCards.length + ')';
  if (adminCards.length === 0) showToast('Database empty — run migration.sql in Supabase', 4000);
  renderAdminList();
}

function sanitize(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function renderAdminList() {
  const q = (document.getElementById('adminSearch').value || '').toLowerCase();
  const filtered = adminCards.filter(c =>
    !q || c.viet.toLowerCase().includes(q) || c.eng.toLowerCase().includes(q) || c.cat.toLowerCase().includes(q)
  );
  const list = document.getElementById('adminCardsList');
  list.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:32px;color:var(--muted);font-size:14px;';
    empty.textContent = 'No cards found';
    list.appendChild(empty);
    return;
  }

  filtered.forEach(card => {
    const row = document.createElement('div');
    row.className = 'admin-card-row';

    const viet = document.createElement('div');
    viet.className = 'admin-card-viet';
    viet.textContent = card.viet;

    const eng = document.createElement('div');
    eng.className = 'admin-card-eng';
    eng.textContent = card.eng;

    const cat = document.createElement('div');
    cat.className = 'admin-card-cat';
    cat.textContent = card.cat;

    const editBtn = document.createElement('button');
    editBtn.className = 'admin-del-btn';
    editBtn.style.cssText = 'color:var(--gold);border-color:rgba(201,155,69,.3);';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => editCard(card));

    const delBtn = document.createElement('button');
    delBtn.className = 'admin-del-btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteCard(card.id));

    row.append(viet, eng, cat, editBtn, delBtn);
    list.appendChild(row);
  });
}

function editCard(card) {
  document.getElementById('editCardId').value = card.id;
  document.getElementById('aViet').value = card.viet;
  document.getElementById('aEng').value = card.eng;
  document.getElementById('aPronun').value = card.pronun || '';
  document.getElementById('aCat').value = card.cat;
  document.getElementById('aContext').value = card.context || '';
  document.getElementById('adminFormTitle').textContent = 'Edit card';
  document.getElementById('cancelEditBtn').style.display = '';
  window.scrollTo({top:0,behavior:'smooth'});
}

function cancelEdit() {
  document.getElementById('editCardId').value = '';
  document.getElementById('aViet').value = '';
  document.getElementById('aEng').value = '';
  document.getElementById('aPronun').value = '';
  document.getElementById('aCat').value = '';
  document.getElementById('aContext').value = '';
  document.getElementById('adminFormTitle').textContent = 'Add new card';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

async function saveCard() {
  if (!isAdmin) { showToast('No admin access'); return; }
  const id = document.getElementById('editCardId').value;
  const payload = {
    viet: document.getElementById('aViet').value.trim(),
    eng: document.getElementById('aEng').value.trim(),
    pronun: document.getElementById('aPronun').value.trim(),
    cat: document.getElementById('aCat').value.trim(),
    context: document.getElementById('aContext').value.trim(),
  };
  if (!payload.viet || !payload.eng || !payload.cat) { showToast('Vietnamese, English and Category are required'); return; }
  if (payload.viet.length > 200 || payload.eng.length > 200 || payload.cat.length > 100 || payload.context.length > 500) {
    showToast('Input too long — please shorten and try again'); return;
  }
  let error;
  if (id) {
    ({ error } = await sb.from('cards').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('cards').insert(payload));
  }
  if (error) { showToast('Error: ' + error.message); return; }
  showToast(id ? 'Card updated ✓' : 'Card added ✓');
  cancelEdit();
  await loadAdminCards();
  await loadCardsFromDB();
  deck = getFilteredDeck();
  showCard();
}

async function deleteCard(id) {
  if (!isAdmin) return;
  if (!confirm('Delete this card? This cannot be undone.')) return;
  const { error } = await sb.from('cards').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message); return; }
  showToast('Card deleted');
  await loadAdminCards();
  await loadCardsFromDB();
  deck = getFilteredDeck();
  showCard();
}

/* ── INIT ── */
function initApp() {
  buildTopicFilter();
  buildScenarioPicker();
  addXP(0);
  // Re-init flashcard state with DB cards
  deck = getFilteredDeck();
  currentIdx = 0;
  buildCategoryTabs();
  showCard();
  updateStats();
}

function buildCategoryTabs() {
  const tabsEl = document.getElementById('catTabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  const cats = ['All', ...new Set(ALL_CARDS.map(c => c.cat))];
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (cat === 'All' ? ' active' : '');
    const count = cat === 'All' ? ALL_CARDS.length : ALL_CARDS.filter(c => c.cat === cat).length;
    btn.textContent = cat + ' (' + count + ')';
    btn.onclick = () => setCategory(cat);
    tabsEl.appendChild(btn);
  });
}

// Auto-save progress every 30 seconds and on markCard
const _origMarkCard = typeof markCard === 'function' ? markCard : null;


/* ════════════════════════════
   FLASHCARD MODULE
════════════════════════════ */

const ALL_CARDS = [
  // ── PRONOUNS & GREETINGS ──
  { viet: "Xin chào", eng: "Hello / Hi", pronun: "sin chow", context: "Formal greeting, use any time", cat: "Greetings" },
  { viet: "Chào", eng: "Hi / Hey", pronun: "chow", context: "Casual greeting, informal", cat: "Greetings" },
  { viet: "Tạm biệt", eng: "Goodbye", pronun: "tahm byeht", context: "Standard farewell", cat: "Greetings" },
  { viet: "Cảm ơn", eng: "Thank you", pronun: "gam uhn", context: "Essential phrase!", cat: "Greetings" },
  { viet: "Xin lỗi", eng: "Sorry / Excuse me", pronun: "sin loy", context: "Apology or getting attention", cat: "Greetings" },
  { viet: "Vâng / Dạ", eng: "Yes (polite)", pronun: "vung / yah", context: "Dạ is more respectful/Southern", cat: "Greetings" },
  { viet: "Không", eng: "No / Zero", pronun: "khome", context: "Also used for the number 0", cat: "Greetings" },
  { viet: "Tôi không hiểu", eng: "I don't understand", pronun: "toy khome hyew", context: "Very useful as a learner!", cat: "Greetings" },
  { viet: "Tôi không biết", eng: "I don't know", pronun: "toy khome byeht", context: "Biết = to know (a fact)", cat: "Greetings" },
  { viet: "Bạn nói chậm hơn được không?", eng: "Can you speak more slowly?", pronun: "ban noy chum huhn duok khome", context: "Chậm = slow, hơn = more", cat: "Greetings" },

  // ── PRONOUNS ──
  { viet: "Ông", eng: "He / You (elderly man)", pronun: "ohm", context: "Address grandpa-aged men. Call yourself 'cháu'", cat: "Pronouns" },
  { viet: "Bà", eng: "She / You (elderly woman)", pronun: "bah", context: "Address grandma-aged women. Call yourself 'cháu'", cat: "Pronouns" },
  { viet: "Chú", eng: "Uncle / Sir (middle-aged man)", pronun: "choo", context: "Dad's younger brother or men ~30–55", cat: "Pronouns" },
  { viet: "Cô", eng: "Aunt / Miss / Ms. / Teacher (female)", pronun: "koh", context: "Used for female teachers, women roughly 25–50, and dad's sister. Very common address term", cat: "Pronouns" },
  { viet: "Anh", eng: "Older brother / Sir (young man)", pronun: "ang", context: "Address males slightly older than you", cat: "Pronouns" },
  { viet: "Chị", eng: "Older sister / Ma'am (young woman)", pronun: "chee", context: "Address females slightly older than you", cat: "Pronouns" },
  { viet: "Em", eng: "I / You (younger person)", pronun: "em", context: "Use when talking to Anh/Chị/Cô/Chú etc.", cat: "Pronouns" },
  { viet: "Bạn", eng: "Friend / You (peer)", pronun: "ban", context: "Use with same-age friends", cat: "Pronouns" },
  { viet: "Tôi", eng: "I / Me (neutral)", pronun: "toy", context: "Safe, formal first-person pronoun", cat: "Pronouns" },
  { viet: "Mình", eng: "I / Me (friendly)", pronun: "ming", context: "Casual; also means 'us' in some contexts", cat: "Pronouns" },
  { viet: "Họ / Bọn họ", eng: "They / Them", pronun: "haw / bon haw", context: "Họ = neutral 'they'; Bọn họ = more colloquial, can sound dismissive ('those people'). Use họ to be safe", cat: "Pronouns" },
  { viet: "Chúng tôi", eng: "We (not including you)", pronun: "choong toy", context: "Exclusive we", cat: "Pronouns" },
  { viet: "Chúng ta", eng: "We (including you)", pronun: "choong tah", context: "Inclusive we", cat: "Pronouns" },

  // ── QUESTIONS ──
  { viet: "Bạn tên gì?", eng: "What is your name?", pronun: "ban ten yee", context: "Literally: 'You name what?'", cat: "Questions" },
  { viet: "Tôi tên là...", eng: "My name is...", pronun: "toy ten lah", context: "E.g. Tôi tên là Dominic", cat: "Questions" },
  { viet: "Bạn đi đâu?", eng: "Where are you going?", pronun: "ban dee doh", context: "Common small-talk question in Vietnam", cat: "Questions" },
  { viet: "Bạn ở đâu?", eng: "Where do you live / are you?", pronun: "ban uh doh", context: "Ở = to be at / to live", cat: "Questions" },
  { viet: "Bạn làm gì?", eng: "What do you do / What are you doing?", pronun: "ban lam yee", context: "Làm = to do/work; context tells you which", cat: "Questions" },
  { viet: "Bao nhiêu?", eng: "How much? / How many?", pronun: "bow nyew", context: "Essential for shopping!", cat: "Questions" },
  { viet: "Ở đâu?", eng: "Where?", pronun: "uh doh", context: "Short form question word", cat: "Questions" },
  { viet: "Khi nào?", eng: "When?", pronun: "khee now", context: "Ask about time/timing", cat: "Questions" },
  { viet: "Tại sao?", eng: "Why?", pronun: "tai sow", context: "Reason/cause question", cat: "Questions" },
  { viet: "Như thế nào?", eng: "How? / Like what?", pronun: "nyuh teh now", context: "Ask about manner/condition", cat: "Questions" },
  { viet: "Ai?", eng: "Who?", pronun: "eye", context: "Person question word", cat: "Questions" },
  { viet: "Cái gì?", eng: "What? (object)", pronun: "kai yee", context: "Cái = classifier for objects", cat: "Questions" },

  // ── NUMBERS ──
  { viet: "Không", eng: "Zero (0)", pronun: "khome", context: "Also means 'no/not'", cat: "Numbers" },
  { viet: "Một", eng: "One (1)", pronun: "moht", context: "Pronunciation: 'moht'", cat: "Numbers" },
  { viet: "Hai", eng: "Two (2)", pronun: "hi", context: "Pronunciation: 'hi'", cat: "Numbers" },
  { viet: "Ba", eng: "Three (3)", pronun: "bah", context: "Also means 'father' in some dialects!", cat: "Numbers" },
  { viet: "Bốn", eng: "Four (4)", pronun: "bohn", context: "Pronunciation: 'bohn'", cat: "Numbers" },
  { viet: "Năm", eng: "Five (5)", pronun: "num", context: "Also means 'year'!", cat: "Numbers" },
  { viet: "Sáu", eng: "Six (6)", pronun: "sow", context: "Pronunciation: 'sow' (rhymes with cow)", cat: "Numbers" },
  { viet: "Bảy", eng: "Seven (7)", pronun: "bay", context: "Pronunciation: 'bay'", cat: "Numbers" },
  { viet: "Tám", eng: "Eight (8)", pronun: "tahm", context: "Lucky number in Vietnamese culture", cat: "Numbers" },
  { viet: "Chín", eng: "Nine (9)", pronun: "chin", context: "Pronunciation: 'chin'", cat: "Numbers" },
  { viet: "Mười", eng: "Ten (10)", pronun: "moo-ee", context: "Pronunciation: 'moo-ee'", cat: "Numbers" },
  { viet: "Mười một", eng: "Eleven (11)", pronun: "moo-ee moht", context: "Mười + một = ten-one", cat: "Numbers" },
  { viet: "Mười hai", eng: "Twelve (12)", pronun: "moo-ee hi", context: "Pattern: mười + number", cat: "Numbers" },
  { viet: "Hai mươi", eng: "Twenty (20)", pronun: "hi moo-ee", context: "Hai + mươi (note: not mười)", cat: "Numbers" },
  { viet: "Hai mươi mốt", eng: "Twenty-one (21)", pronun: "hi moo-ee moht", context: "Note: mốt (not một) for 1 in tens", cat: "Numbers" },
  { viet: "Một trăm", eng: "One hundred (100)", pronun: "moht tram", context: "Trăm = hundred", cat: "Numbers" },
  { viet: "Một nghìn", eng: "One thousand (1,000)", pronun: "moht nyin", context: "Also: một ngàn (Southern dialect)", cat: "Numbers" },
  { viet: "Một triệu", eng: "One million (1,000,000)", pronun: "moht tryew", context: "Triệu = million", cat: "Numbers" },

  // ── FAMILY ──
  { viet: "Gia đình", eng: "Family", pronun: "yah dinh", context: "Gia = home, đình = hall/family", cat: "Family" },
  { viet: "Bố / Ba", eng: "Father / Dad", pronun: "boh / bah", context: "Bố = Northern, Ba = Southern", cat: "Family" },
  { viet: "Mẹ / Má", eng: "Mother / Mum", pronun: "meh / mah", context: "Mẹ = Northern, Má = Southern", cat: "Family" },
  { viet: "Ông nội", eng: "Paternal grandfather", pronun: "ohm noy", context: "Nội = father's side family", cat: "Family" },
  { viet: "Bà nội", eng: "Paternal grandmother", pronun: "bah noy", context: "Nội = father's side family", cat: "Family" },
  { viet: "Ông ngoại", eng: "Maternal grandfather", pronun: "ohm ngwai", context: "Ngoại = mother's side family", cat: "Family" },
  { viet: "Bà ngoại", eng: "Maternal grandmother", pronun: "bah ngwai", context: "Ngoại = mother's side family", cat: "Family" },
  { viet: "Anh trai", eng: "Older brother", pronun: "ang trai", context: "Trai = male", cat: "Family" },
  { viet: "Chị gái", eng: "Older sister", pronun: "chee gai", context: "Gái = female", cat: "Family" },
  { viet: "Em trai", eng: "Younger brother", pronun: "em trai", context: "Em = younger", cat: "Family" },
  { viet: "Em gái", eng: "Younger sister", pronun: "em gai", context: "Em gái = younger female", cat: "Family" },
  { viet: "Con", eng: "Child / Son or daughter", pronun: "kon", context: "Also: first-person when talking to parents", cat: "Family" },
  { viet: "Cháu", eng: "Grandchild / Niece / Nephew", pronun: "chow", context: "Also: use as 'I' when speaking to grandparents", cat: "Family" },
  { viet: "Chú", eng: "Uncle (dad's younger brother)", pronun: "choo", context: "Paternal uncle, younger than dad", cat: "Family" },
  { viet: "Bác", eng: "Uncle/Aunt (older than parents)", pronun: "bahk", context: "Respectful; for relatives older than parents", cat: "Family" },
  { viet: "Vợ", eng: "Wife", pronun: "vuh", context: "Pronunciation: 'vuh'", cat: "Family" },
  { viet: "Chồng", eng: "Husband", pronun: "chome", context: "Pronunciation: 'chome'", cat: "Family" },

  // ── BODY PARTS ──
  { viet: "Khuôn mặt", eng: "Face", pronun: "kwon maht", context: "Khuôn = frame/mold, mặt = face", cat: "Body" },
  { viet: "Đầu", eng: "Head", pronun: "doh", context: "Also: beginning / first", cat: "Body" },
  { viet: "Tóc", eng: "Hair", pronun: "tawk", context: "Refers to hair on head", cat: "Body" },
  { viet: "Trán", eng: "Forehead", pronun: "tran", context: "Pronunciation: 'tran'", cat: "Body" },
  { viet: "Mắt", eng: "Eyes", pronun: "maht", context: "Pronunciation: 'maht'", cat: "Body" },
  { viet: "Mũi", eng: "Nose", pronun: "mwee", context: "Pronunciation: 'mwee'", cat: "Body" },
  { viet: "Miệng", eng: "Mouth", pronun: "myeng", context: "Pronunciation: 'myeng'", cat: "Body" },
  { viet: "Môi", eng: "Lips", pronun: "moy", context: "Pronunciation: 'moy'", cat: "Body" },
  { viet: "Tai", eng: "Ear(s)", pronun: "tie", context: "Pronunciation: 'tie'", cat: "Body" },
  { viet: "Cổ", eng: "Neck", pronun: "koh (falling tone)", context: "Also means 'antique/old'", cat: "Body" },
  { viet: "Vai", eng: "Shoulder", pronun: "vai", context: "Rhymes with 'sky'", cat: "Body" },
  { viet: "Ngực", eng: "Chest", pronun: "nyuk", context: "Pronunciation: 'nyuk'", cat: "Body" },
  { viet: "Bụng", eng: "Stomach / Belly", pronun: "buhng", context: "Pronunciation: 'buhng'", cat: "Body" },
  { viet: "Lưng", eng: "Back", pronun: "loong", context: "Pronunciation: 'loong' (not like English 'lung')", cat: "Body" },
  { viet: "Tay", eng: "Hand / Arm", pronun: "tay", context: "General term for upper limb", cat: "Body" },
  { viet: "Bàn tay", eng: "Hand (palm)", pronun: "ban tay", context: "Bàn = flat surface", cat: "Body" },
  { viet: "Ngón tay", eng: "Finger", pronun: "ngon tay", context: "Ngón = digit/finger", cat: "Body" },
  { viet: "Chân", eng: "Leg / Foot", pronun: "chun", context: "General term for lower limb", cat: "Body" },
  { viet: "Bàn chân", eng: "Foot (sole)", pronun: "ban chun", context: "Bàn = flat surface", cat: "Body" },
  { viet: "Đầu gối", eng: "Knee", pronun: "doh goy", context: "Đầu = head, gối = pillow", cat: "Body" },

  // ── DAYS & TIME ──
  { viet: "Thứ hai", eng: "Monday", pronun: "tuh hi", context: "Literally: 'Second day' (counting from Sunday)", cat: "Days & Time" },
  { viet: "Thứ ba", eng: "Tuesday", pronun: "tuh bah", context: "Literally: 'Third day'", cat: "Days & Time" },
  { viet: "Thứ tư", eng: "Wednesday", pronun: "tuh tuh", context: "Literally: 'Fourth day'", cat: "Days & Time" },
  { viet: "Thứ năm", eng: "Thursday", pronun: "tuh num", context: "Literally: 'Fifth day'", cat: "Days & Time" },
  { viet: "Thứ sáu", eng: "Friday", pronun: "tuh sow", context: "Literally: 'Sixth day'", cat: "Days & Time" },
  { viet: "Thứ bảy", eng: "Saturday", pronun: "tuh bay", context: "Literally: 'Seventh day'", cat: "Days & Time" },
  { viet: "Chủ nhật", eng: "Sunday", pronun: "choo nyuht", context: "Literally: 'Lord's day'", cat: "Days & Time" },
  { viet: "Hôm nay", eng: "Today", pronun: "home nay", context: "Pronunciation: 'home nay'", cat: "Days & Time" },
  { viet: "Hôm qua", eng: "Yesterday", pronun: "home kwah", context: "Qua = past/through", cat: "Days & Time" },
  { viet: "Ngày mai", eng: "Tomorrow", pronun: "ngay my", context: "Ngày = day, mai = morning/next", cat: "Days & Time" },
  { viet: "Tuần này", eng: "This week", pronun: "twun nay", context: "Tuần = week, này = this", cat: "Days & Time" },
  { viet: "Tháng này", eng: "This month", pronun: "tang nay", context: "Tháng = month", cat: "Days & Time" },
  { viet: "Năm nay", eng: "This year", pronun: "num nay", context: "Năm = year (also five!)", cat: "Days & Time" },
  { viet: "Buổi sáng", eng: "Morning", pronun: "boo-oy sahng", context: "Pronunciation: 'boo-oy sahng'", cat: "Days & Time" },
  { viet: "Buổi chiều", eng: "Afternoon", pronun: "boo-oy chyew", context: "Pronunciation: 'boo-oy chyew'", cat: "Days & Time" },
  { viet: "Buổi tối", eng: "Evening / Night", pronun: "boo-oy toy", context: "Tối = dark", cat: "Days & Time" },
  { viet: "Mấy giờ?", eng: "What time is it?", pronun: "may yuh", context: "Mấy = how many, giờ = hour", cat: "Days & Time" },

  // ── COLORS ──
  { viet: "Màu đỏ", eng: "Red", pronun: "mow daw", context: "Lucky color in Vietnamese culture", cat: "Colors" },
  { viet: "Màu xanh lá", eng: "Green", pronun: "mow sang lah", context: "Xanh lá = leaf green", cat: "Colors" },
  { viet: "Màu xanh dương", eng: "Blue", pronun: "mow sang yuhng", context: "Xanh dương = ocean/sky blue", cat: "Colors" },
  { viet: "Màu vàng", eng: "Yellow / Gold", pronun: "mow vahng", context: "Royal color historically", cat: "Colors" },
  { viet: "Màu trắng", eng: "White", pronun: "mow trang", context: "Worn at funerals in Vietnam", cat: "Colors" },
  { viet: "Màu đen", eng: "Black", pronun: "mow den", context: "Pronunciation: 'den'", cat: "Colors" },
  { viet: "Màu cam", eng: "Orange", pronun: "mow kam", context: "Named after the fruit (cam = orange)", cat: "Colors" },
  { viet: "Màu tím", eng: "Purple / Violet", pronun: "mow teem", context: "Pronunciation: 'teem'", cat: "Colors" },
  { viet: "Màu hồng", eng: "Pink", pronun: "mow hohng", context: "Pronunciation: 'hohng'", cat: "Colors" },
  { viet: "Màu nâu", eng: "Brown", pronun: "mow noh", context: "Pronunciation: 'noh'", cat: "Colors" },
  { viet: "Màu xám", eng: "Grey", pronun: "mow sahm", context: "Pronunciation: 'sahm'", cat: "Colors" },

  // ── DAILY ACTIVITIES ──
  { viet: "Thức dậy", eng: "Wake up", pronun: "tuhk day", context: "Thức = awake, dậy = rise", cat: "Daily Life" },
  { viet: "Đánh răng", eng: "Brush teeth", pronun: "dang rang", context: "Đánh = hit/strike, răng = teeth", cat: "Daily Life" },
  { viet: "Rửa mặt", eng: "Wash face", pronun: "ruh-ah maht", context: "Rửa = wash, mặt = face", cat: "Daily Life" },
  { viet: "Ăn sáng", eng: "Eat breakfast", pronun: "an sahng", context: "Ăn = eat, sáng = morning", cat: "Daily Life" },
  { viet: "Ăn trưa", eng: "Eat lunch", pronun: "an truh-ah", context: "Trưa = midday", cat: "Daily Life" },
  { viet: "Ăn tối", eng: "Eat dinner", pronun: "an toy", context: "Tối = evening/night", cat: "Daily Life" },
  { viet: "Đi làm", eng: "Go to work", pronun: "dee lam", context: "Đi = go, làm = work/do", cat: "Daily Life" },
  { viet: "Đi học", eng: "Go to school / study", pronun: "dee hawk", context: "Học = study/learn", cat: "Daily Life" },
  { viet: "Nấu ăn", eng: "Cook food", pronun: "noh an", context: "Nấu = cook, ăn = eat/food", cat: "Daily Life" },
  { viet: "Tắm", eng: "Bathe / Shower", pronun: "tam", context: "Tắm = to bathe", cat: "Daily Life" },
  { viet: "Ngủ", eng: "Sleep", pronun: "ngoo", context: "Đi ngủ = go to sleep", cat: "Daily Life" },
  { viet: "Uống nước", eng: "Drink water", pronun: "oong nuhk", context: "Uống = drink, nước = water", cat: "Daily Life" },
  { viet: "Đọc sách", eng: "Read a book", pronun: "dok sahk", context: "Đọc = read, sách = book", cat: "Daily Life" },
  { viet: "Xem phim", eng: "Watch a movie", pronun: "sem feem", context: "Xem = watch/see, phim = film", cat: "Daily Life" },
  { viet: "Mua sắm", eng: "Go shopping", pronun: "moo-ah sam", context: "Mua = buy, sắm = purchase", cat: "Daily Life" },

  // ── USEFUL PHRASES ──
  { viet: "Bạn có khỏe không?", eng: "How are you?", pronun: "ban kaw kweh khome", context: "Khỏe = healthy/well", cat: "Phrases" },
  { viet: "Tôi khỏe, cảm ơn", eng: "I'm well, thank you", pronun: "toy kweh, gam uhn", context: "Standard reply to 'bạn có khỏe không'", cat: "Phrases" },
  { viet: "Bạn đến từ đâu?", eng: "Where are you from?", pronun: "ban den tuh doh", context: "More natural word order than 'Bạn ở đâu đến?'", cat: "Phrases" },
  { viet: "Tôi đến từ Singapore", eng: "I am from Singapore", pronun: "toy den tuh Singapore", context: "Replace Singapore with your country", cat: "Phrases" },
  { viet: "Bao nhiêu tiền?", eng: "How much money? / How much does this cost?", pronun: "bow nyew tyen", context: "Tiền = money", cat: "Phrases" },
  { viet: "Đắt quá!", eng: "Too expensive!", pronun: "daht kwah", context: "Đắt = expensive, quá = too much", cat: "Phrases" },
  { viet: "Rẻ hơn được không?", eng: "Can it be cheaper?", pronun: "reh huhn duok khome", context: "Rẻ = cheap, hơn = more", cat: "Phrases" },
  { viet: "Tôi muốn...", eng: "I want...", pronun: "toy moo-on", context: "Muốn = to want", cat: "Phrases" },
  { viet: "Tôi thích...", eng: "I like...", pronun: "toy tick", context: "Thích = to like", cat: "Phrases" },
  { viet: "Ngon quá!", eng: "So delicious!", pronun: "ngon kwah", context: "Ngon = delicious, quá = very/so", cat: "Phrases" },
  { viet: "Không sao", eng: "It's okay / No problem", pronun: "khome sow", context: "Versatile phrase for 'never mind'", cat: "Phrases" },
  { viet: "Chúc mừng!", eng: "Congratulations!", pronun: "chook mung", context: "Pronunciation: 'chook mung'", cat: "Phrases" },
  { viet: "Chúc mừng sinh nhật!", eng: "Happy Birthday!", pronun: "chook mung sing nyuht", context: "Sinh nhật = birthday", cat: "Phrases" },

  // ── SHOPPING ──
  { viet: "Shop quần áo", eng: "Clothing shop", pronun: "shop kwun ow", context: "Quần áo = clothes (literally pants + shirt)", cat: "Shopping" },
  { viet: "Này", eng: "This (near)", pronun: "nay", context: "Points to something close to you", cat: "Shopping" },
  { viet: "Kia", eng: "That (far)", pronun: "kee-ah", context: "Points to something away from both of you", cat: "Shopping" },
  { viet: "Em ơi!", eng: "Excuse me! (to get attention)", pronun: "em uh-ee", context: "Used to call a younger staff member; very common in shops & restaurants", cat: "Shopping" },
  { viet: "Dạ", eng: "Yes / I'm here (polite response)", pronun: "yah", context: "The reply when someone calls 'em ơi' or your name", cat: "Shopping" },
  { viet: "Bút", eng: "Pen", pronun: "buht", context: "Pronunciation: 'buht'", cat: "Shopping" },
  { viet: "Bút này bao nhiêu tiền?", eng: "How much is this pen?", pronun: "buht nay bow nyew tyen", context: "Template: [item] + này + bao nhiêu tiền?", cat: "Shopping" },
  { viet: "Đồng hồ", eng: "Watch / Clock", pronun: "dome hoh", context: "Đồng hồ đeo tay = wristwatch", cat: "Shopping" },
  { viet: "Áo", eng: "Shirt / Top / Garment", pronun: "ow", context: "General word for upper-body clothing", cat: "Shopping" },
  { viet: "Quần", eng: "Pants / Trousers", pronun: "kwun", context: "Pronunciation: 'kwun'", cat: "Shopping" },
  { viet: "Quần ngắn", eng: "Shorts", pronun: "kwun ngan", context: "Ngắn = short (length)", cat: "Shopping" },
  { viet: "Đẹp", eng: "Beautiful / Nice-looking", pronun: "dep", context: "Use for people, clothes, places", cat: "Shopping" },
  { viet: "Xấu / Không đẹp", eng: "Ugly / Not attractive", pronun: "soh / khome dep", context: "Xấu = naturally ugly (more direct); Không đẹp = not beautiful (softer). Use xấu with caution!", cat: "Shopping" },
  { viet: "Mắc / Đắt", eng: "Expensive", pronun: "mak / daht", context: "Mắc = Southern dialect; Đắt = Northern dialect", cat: "Shopping" },
  { viet: "Rẻ", eng: "Cheap / Affordable", pronun: "reh", context: "Pronunciation: 'reh' (falling tone)", cat: "Shopping" },
  { viet: "Quá", eng: "Too / Very (intensifier)", pronun: "kwah", context: "Đắt quá! = Too expensive! Đẹp quá! = So beautiful!", cat: "Shopping" },
  { viet: "Thích", eng: "To like", pronun: "tick", context: "Tôi thích cái này = I like this one", cat: "Shopping" },
  { viet: "Không thích", eng: "To not like / Don't like", pronun: "khome tick", context: "Không negates the verb", cat: "Shopping" },
  { viet: "Tôi xem...", eng: "I'm looking at... / Let me look at...", pronun: "toy sem", context: "Use when browsing in a shop", cat: "Shopping" },
  { viet: "Mua không?", eng: "Do you want to buy it?", pronun: "moo-ah khome", context: "Shopkeeper phrase; mua = to buy", cat: "Shopping" },
  { viet: "Có", eng: "Yes / Have / There is", pronun: "kaw", context: "Có = affirmative; also means 'to have'", cat: "Shopping" },

  // ── FOOD ──
  { viet: "Bò", eng: "Beef / Cow", pronun: "baw", context: "Thịt bò = beef (thịt = meat)", cat: "Food" },
  { viet: "Gà", eng: "Chicken", pronun: "gah", context: "Thịt gà = chicken meat; gà rán = fried chicken", cat: "Food" },
  { viet: "Ngò rí / Rau mùi", eng: "Coriander / Cilantro", pronun: "ngo ree / row mwee", context: "Ngò rí = Southern (HCMC); Rau mùi = Northern (Hanoi). Say 'không có ngò rí' to ask for no coriander!", cat: "Food" },

  // ── FOOD & DINING (HCMC) ──
  { viet: "Cho tôi xem thực đơn", eng: "Can I see the menu?", pronun: "cho toy sem tuhk don", context: "First thing to say when seated at any restaurant", cat: "Food & Dining" },
  { viet: "Không có thịt bò", eng: "No beef please", pronun: "khome kaw tit baw", context: "Tell the kitchen upfront when ordering", cat: "Food & Dining" },
  { viet: "Cho tôi một phần nữa", eng: "One more serving please", pronun: "cho toy moht fun nuh-ah", context: "When the food is great and you want more", cat: "Food & Dining" },
  { viet: "Cay quá, bớt cay được không?", eng: "Too spicy, can you make it less spicy?", pronun: "kai kwah, buht kai duok khome", context: "Essential for ordering at street food stalls", cat: "Food & Dining" },
  { viet: "Ăn no chưa?", eng: "Are you full yet? / Have you eaten?", pronun: "an naw chuh-ah", context: "Common Southern greeting — answer 'ăn rồi' (eaten already)", cat: "Food & Dining" },
  { viet: "Ngon lắm!", eng: "Really delicious! / So good!", pronun: "ngon lam", context: "Lắm is the Southern intensifier — stronger than quá", cat: "Food & Dining" },
  { viet: "Tính tiền", eng: "Bill please / Check please", pronun: "ting tyen", context: "Say this or wave to signal you want to pay", cat: "Food & Dining" },
  { viet: "Không bỏ ngò", eng: "No coriander please", pronun: "khome baw ngaw", context: "Southern shorthand — bỏ = put in; không bỏ = don't put in", cat: "Food & Dining" },

  // ── TRANSPORT (HCMC) ──
  { viet: "Chạy nhanh lên, tôi trễ rồi", eng: "Drive faster, I'm already late", pronun: "chai nyang len, toy treh roy", context: "Use politely with Grab or taxi drivers", cat: "Transport" },
  { viet: "Dừng đây được không?", eng: "Can you stop here?", pronun: "yung day duok khome", context: "Ask the driver to pull over at your spot", cat: "Transport" },
  { viet: "Kẹt xe quá", eng: "The traffic jam is terrible", pronun: "ket seh kwah", context: "HCMC small talk — locals say this constantly", cat: "Transport" },
  { viet: "Đi thẳng rồi quẹo phải", eng: "Go straight then turn right", pronun: "dee tang roy kweh-oh fai", context: "Give directions to a driver or motorbike taxi", cat: "Transport" },
  { viet: "Gần đây có chỗ đậu xe không?", eng: "Is there parking nearby?", pronun: "gun day kaw choh doh seh khome", context: "Ask when arriving at a new venue", cat: "Transport" },

  // ── FITNESS & GYM ──
  { viet: "Phòng tập thể hình", eng: "Gym / Weight training gym", pronun: "fome tap teh hing", context: "The standard term for a gym in Southern Vietnam", cat: "Fitness & Gym" },
  { viet: "Tôi muốn đăng ký tập", eng: "I want to sign up / register to train", pronun: "toy moo-on dang kee tap", context: "Use at gym reception to enquire about membership", cat: "Fitness & Gym" },
  { viet: "Lịch tập của bạn thế nào?", eng: "What does your workout schedule look like?", pronun: "lik tap koo-ah ban teh now", context: "Break the ice with gym members or potential clients", cat: "Fitness & Gym" },
  { viet: "Bạn tập bao lâu rồi?", eng: "How long have you been training?", pronun: "ban tap bow loh roy", context: "Great conversation starter with local gym-goers", cat: "Fitness & Gym" },
  { viet: "Cho tôi mượn cái này", eng: "Can I borrow / use this?", pronun: "cho toy muon kai nay", context: "Ask to use equipment or share a bench", cat: "Fitness & Gym" },

  // ── BUSINESS ──
  { viet: "Mình có thể nói chuyện riêng không?", eng: "Can we speak privately?", pronun: "ming kaw teh noy chwyen ryen khome", context: "Request a private conversation with a partner or staff", cat: "Business" },
  { viet: "Để tôi suy nghĩ thêm", eng: "Let me think about it more", pronun: "deh toy swee ngee tem", context: "Polite way to avoid committing on the spot", cat: "Business" },
  { viet: "Bao giờ ký hợp đồng?", eng: "When do we sign the contract?", pronun: "bow yuh kee hup dome", context: "Push gently for timeline in business negotiations", cat: "Business" },
  { viet: "Anh/Chị có thể giảm giá không?", eng: "Can you lower the price?", pronun: "ang/chee kaw teh yam yah khome", context: "Negotiate respectfully with suppliers or vendors", cat: "Business" },

  // ── STREET SLANG ──
  { viet: "Thôi được rồi", eng: "Alright, fine / OK then", pronun: "toy duok roy", context: "Southern casual agreement — heard constantly in HCMC", cat: "Street Slang" },
  { viet: "Coi bộ được đó", eng: "Looks pretty good", pronun: "koy boh duok daw", context: "Approve of something casually — uniquely Southern phrase", cat: "Street Slang" },
  { viet: "Dzậy hả?", eng: "Is that so? / Really?", pronun: "yay hah", context: "Dzậy is the Southern pronunciation of Vậy — sounds very local", cat: "Street Slang" },
  { viet: "Hổng có", eng: "Don't have / There isn't any", pronun: "home kaw", context: "Southern dialect for Không có — you'll hear this everywhere", cat: "Street Slang" },
  { viet: "Mắc vậy trời!", eng: "Oh wow, so expensive!", pronun: "mak yay truh-ee", context: "Exclaim at a high price — very natural Southern expression", cat: "Street Slang" },

  // ── PAYMENTS ──
  { viet: "Thanh toán bằng thẻ được không?", eng: "Can I pay by card?", pronun: "tang twan bang teh duok khome", context: "Ask before assuming card payment is accepted", cat: "Payments" },
  { viet: "Tiền lẻ không?", eng: "Do you have change?", pronun: "tyen leh khome", context: "Small bills are scarce — always good to ask", cat: "Payments" },
  { viet: "Bao nhiêu tất cả?", eng: "How much in total?", pronun: "bow nyew tut kah", context: "Ask for the total bill before paying", cat: "Payments" },
  { viet: "Cho tôi hoá đơn", eng: "Please give me a receipt", pronun: "cho toy hwah don", context: "Important for business expense claims", cat: "Payments" },

  // ── TODAY'S CLASS: FOOD VOCABULARY ──
  { viet: "Thịt heo", eng: "Pork", pronun: "tit heh-oh", context: "Heo = pig (Southern); miền Bắc says thịt lợn", cat: "Food & Dining" },
  { viet: "Cá", eng: "Fish", pronun: "kah", context: "Cá chiên = fried fish; cá hấp = steamed fish", cat: "Food & Dining" },
  { viet: "Trứng", eng: "Egg", pronun: "troong", context: "Trứng chiên = fried egg; trứng luộc = boiled egg", cat: "Food & Dining" },
  { viet: "Rau", eng: "Vegetable(s)", pronun: "row", context: "Rau xanh = green vegetables; ăn nhiều rau = eat more veg", cat: "Food & Dining" },
  { viet: "Cơm", eng: "Rice (cooked)", pronun: "gum", context: "Cơm = cooked rice; also used to mean a meal", cat: "Food & Dining" },
  { viet: "Gạo", eng: "Rice (uncooked / raw)", pronun: "gow", context: "Gạo = raw rice grain; becomes cơm after cooking", cat: "Food & Dining" },
  { viet: "Sữa", eng: "Milk", pronun: "soo-ah", context: "Sữa tươi = fresh milk; sữa đặc = condensed milk", cat: "Food & Dining" },
  { viet: "Bánh mì", eng: "Bread / Baguette sandwich", pronun: "bang mee", context: "Vietnam's iconic street sandwich — a must-try in HCMC", cat: "Food & Dining" },
  { viet: "Quả táo", eng: "Apple", pronun: "kwah tow", context: "Quả/trái = fruit classifier; táo = apple", cat: "Food & Dining" },
  { viet: "Quả cam", eng: "Orange (fruit)", pronun: "kwah kahm", context: "Cam = orange (fruit AND colour); cam vắt = fresh OJ", cat: "Food & Dining" },
  { viet: "Quả chuối", eng: "Banana", pronun: "kwah choo-oy", context: "Very common fruit in Vietnam — cheap and everywhere", cat: "Food & Dining" },
  { viet: "Cháo", eng: "Rice porridge / Congee", pronun: "chow", context: "Popular Vietnamese comfort food, eaten for breakfast or when sick", cat: "Food & Dining" },
  { viet: "Cháo vịt", eng: "Duck porridge / Duck congee", pronun: "chow yit", context: "Vịt = duck; a popular Southern Vietnamese dish", cat: "Food & Dining" },

  // ── TODAY'S CLASS: PLACES ──
  { viet: "Chợ", eng: "Market / Wet market", pronun: "chuh", context: "Traditional market — chợ Bến Thành is HCMC's most famous", cat: "Shopping" },
  { viet: "Siêu thị", eng: "Supermarket", pronun: "syew tee", context: "Modern grocery store; Co.opmart and Lotte are common in HCMC", cat: "Shopping" },

  // ── TODAY'S CLASS: GRAMMAR & CONNECTORS ──
  { viet: "Sẽ", eng: "Will / Future tense marker", pronun: "seh", context: "Put before a verb to make it future: Tôi sẽ ăn = I will eat", cat: "Grammar" },
  { viet: "Và", eng: "And", pronun: "vah", context: "Joins nouns or clauses: cơm và rau = rice and vegetables", cat: "Grammar" },
  { viet: "Hay", eng: "Or", pronun: "hay", context: "Bạn muốn cơm hay bánh mì? = Rice or bread?", cat: "Grammar" },
  { viet: "Có lẽ", eng: "Maybe / Perhaps", pronun: "kaw leh", context: "Soften a statement: Có lẽ tôi sẽ đi = Maybe I'll go", cat: "Grammar" },
  { viet: "Có ... không?", eng: "Yes/No question structure", pronun: "kaw ... khome", context: "Wrap any adjective/verb: Có ngon không? = Is it tasty?", cat: "Grammar" },
  { viet: "Còn ... không?", eng: "Do you still have ...? / Is there still ...?", pronun: "kon ... khome", context: "Ask if something remains: Còn bánh mì không? = Still have bread?", cat: "Grammar" },
  { viet: "Còn / Hết rồi", eng: "Still have / All gone / Sold out", pronun: "kon / heht roy", context: "Market vendor answers: còn = yes still have; hết rồi = all sold out", cat: "Grammar" },
  { viet: "Trưa chưa?", eng: "Have you had lunch yet?", pronun: "truh-ah chuh-ah", context: "Common Southern greeting around midday — very casual and warm", cat: "Grammar" },
  { viet: "Ai nấu?", eng: "Who cooked? / Who cooks?", pronun: "eye noh", context: "Ai = who; nấu = to cook. Use to compliment someone's cooking!", cat: "Grammar" },
  { viet: "Bữa trưa hôm nay", eng: "Today's lunch / Lunch today", pronun: "buh-ah truh-ah home nay", context: "Bữa = meal occasion; trưa = midday; hôm nay = today", cat: "Grammar" },

  // ── TODAY'S CLASS: MEASUREMENTS & USEFUL ──
  { viet: "Ký", eng: "Kilogram", pronun: "kee", context: "Southern shorthand for kilogram — used in all markets", cat: "Shopping" },
  { viet: "Nửa ký", eng: "Half a kilogram (500g)", pronun: "nuh-ah kee", context: "Nửa = half; very useful when buying from market vendors", cat: "Shopping" },
  { viet: "Cho em", eng: "Give me / I'll have ...", pronun: "cho em", context: "Polite way to order or ask for something; em = humble self-reference", cat: "Phrases" },
];

const CATEGORIES = ['All', ...new Set(ALL_CARDS.map(c => c.cat))];

let currentCat = 'All';
let deck = [];
let currentIdx = 0;
let masteredSet = new Set();
let isFlipped = false;
let showingGrid = false;
let searchQuery = '';

function getFilteredDeck() {
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    return ALL_CARDS.filter(c =>
      c.viet.toLowerCase().includes(q) ||
      c.eng.toLowerCase().includes(q) ||
      (c.context && c.context.toLowerCase().includes(q)) ||
      c.cat.toLowerCase().includes(q)
    );
  }
  return currentCat === 'All' ? [...ALL_CARDS] : ALL_CARDS.filter(c => c.cat === currentCat);
}

function handleSearch(val) {
  searchQuery = val;
  const hasQuery = val.trim().length > 0;
  document.getElementById('searchClear').classList.toggle('visible', hasQuery);

  deck = getFilteredDeck();
  currentIdx = 0;
  isFlipped = false;
  document.getElementById('flashCard').classList.remove('flipped');

  const bar = document.getElementById('searchResultsBar');
  const noResults = document.getElementById('noResults');
  const flashMode = document.getElementById('flashMode');

  if (hasQuery) {
    bar.classList.add('visible');
    document.getElementById('searchResultsText').textContent =
      `${deck.length} result${deck.length !== 1 ? 's' : ''} for "${val}"`;
    document.getElementById('searchResultsSub').textContent =
      deck.length > 0 ? `across ${[...new Set(deck.map(c => c.cat))].join(', ')}` : '';

    if (deck.length === 0) {
      noResults.classList.add('visible');
      flashMode.style.display = 'none';
      if (showingGrid) document.getElementById('gridMode').style.display = 'none';
    } else {
      noResults.classList.remove('visible');
      if (!showingGrid) flashMode.style.display = 'block';
      else { document.getElementById('gridMode').style.display = 'block'; renderGrid(); }
      showCard();
    }
  } else {
    bar.classList.remove('visible');
    noResults.classList.remove('visible');
    if (!showingGrid) flashMode.style.display = 'block';
    else { document.getElementById('gridMode').style.display = 'block'; renderGrid(); }
    showCard();
  }
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  handleSearch('');
}

function init() {
  // Build tabs
  const tabsEl = document.getElementById('catTabs');
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (cat === 'All' ? ' active' : '');
    const count = cat === 'All' ? ALL_CARDS.length : ALL_CARDS.filter(c => c.cat === cat).length;
    btn.textContent = `${cat} (${count})`;
    btn.onclick = () => setCategory(cat);
    tabsEl.appendChild(btn);
  });

  deck = getFilteredDeck();
  updateStats();
  showCard();
}

function setCategory(cat) {
  currentCat = cat;
  document.querySelectorAll('.cat-btn').forEach((b, i) => {
    b.classList.toggle('active', CATEGORIES[i] === cat);
  });
  document.getElementById('catTitle').textContent = cat === 'All' ? 'All Cards' : cat;
  deck = getFilteredDeck();
  currentIdx = 0;
  isFlipped = false;
  document.getElementById('flashCard').classList.remove('flipped');
  updateStats();

  const noResults = document.getElementById('noResults');
  if (deck.length === 0 && searchQuery.trim()) {
    noResults.classList.add('visible');
    document.getElementById('flashMode').style.display = 'none';
  } else {
    noResults.classList.remove('visible');
    document.getElementById('flashMode').style.display = showingGrid ? 'none' : 'block';
    showCard();
  }
  if (showingGrid) renderGrid();
}

function showCard() {
  if (!deck.length) return;
  const card = deck[currentIdx];
  document.getElementById('frontViet').textContent = card.viet;
  document.getElementById('frontBadge').textContent = card.cat;
  document.getElementById('frontRoman').textContent = card.pronun ? '🔊 ' + card.pronun : '';
  document.getElementById('backEnglish').textContent = card.eng;
  document.getElementById('backContext').textContent = card.context || '';
  document.getElementById('curNum').textContent = currentIdx + 1;
  document.getElementById('totNum').textContent = deck.length;
  // Reset audio button
  const btn = document.getElementById('audioBtn');
  if (btn) {
    btn.classList.remove('playing');
    btn.querySelector('.audio-icon').textContent = '▶';
    btn.querySelector('.audio-label').textContent = 'Listen';
  }
  updateProgress();
}

function flipCard() {
  isFlipped = !isFlipped;
  document.getElementById('flashCard').classList.toggle('flipped', isFlipped);
}

function nextCard() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentIdx < deck.length - 1) currentIdx++;
  else { currentIdx = 0; showToast('Back to the beginning!'); }
  isFlipped = false;
  document.getElementById('flashCard').classList.remove('flipped');
  showCard();
}

function prevCard() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentIdx > 0) currentIdx--;
  else currentIdx = deck.length - 1;
  isFlipped = false;
  document.getElementById('flashCard').classList.remove('flipped');
  showCard();
}

function markCard(mastered) {
  const card = deck[currentIdx];
  const key = card.id || card.viet; // prefer UUID, fall back to viet text
  if (mastered) {
    masteredSet.add(key);
    showToast('✓ Marked as mastered!');
  } else {
    masteredSet.delete(key);
    showToast('Keep practising!');
  }
  updateStats();
  if (showingGrid) renderGrid();
  setTimeout(nextCard, 400);
}

function shuffleDeck() {
  deck = deck.sort(() => Math.random() - 0.5);
  currentIdx = 0;
  isFlipped = false;
  document.getElementById('flashCard').classList.remove('flipped');
  showCard();
  showToast('Deck shuffled!');
}

function updateStats() {
  const total = ALL_CARDS.length;
  const mastered = masteredSet.size;
  document.getElementById('totalCount').textContent = total;
  document.getElementById('masteredCount').textContent = mastered;
  document.getElementById('remainingCount').textContent = total - mastered;
}

function updateProgress() {
  const pct = deck.length ? ((currentIdx + 1) / deck.length) * 100 : 0;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = `${currentIdx + 1} of ${deck.length} cards`;
}

function toggleShowAll() {
  showingGrid = !showingGrid;
  document.getElementById('flashMode').style.display = showingGrid ? 'none' : 'block';
  document.getElementById('gridMode').style.display = showingGrid ? 'block' : 'none';
  document.getElementById('showAllBtn').textContent = showingGrid ? '⊟ Study' : '⊞ Grid';
  document.getElementById('showAllBtn').classList.toggle('active', showingGrid);
  if (showingGrid) renderGrid();
}

function highlight(text, query) {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<span class="highlight">$1</span>');
}

function renderGrid() {
  const grid = document.getElementById('cardGrid');
  const cards = getFilteredDeck();
  document.getElementById('gridBadge').textContent = `${cards.length} cards`;
  grid.innerHTML = '';
  cards.forEach((card) => {
    const isMastered = masteredSet.has(card.id) || masteredSet.has(card.viet);
    const el = document.createElement('div');
    el.className = 'mini-card' + (isMastered ? ' mastered-card' : '');
    const q = searchQuery.trim().toLowerCase();
    el.innerHTML = `
      <div class="mini-tag">${highlight(card.cat, searchQuery)}</div>
      <div class="mini-viet">${highlight(card.viet, searchQuery)}</div>
      <div class="mini-eng">${highlight(card.eng, searchQuery)}</div>
    `;
    el.onclick = () => {
      showingGrid = false;
      document.getElementById('flashMode').style.display = 'block';
      document.getElementById('gridMode').style.display = 'none';
      document.getElementById('noResults').classList.remove('visible');
      document.getElementById('showAllBtn').textContent = '⊞ Grid';
      document.getElementById('showAllBtn').classList.remove('active');
      // Keep search active, jump to this card in current filtered deck
      deck = getFilteredDeck();
      currentIdx = deck.findIndex(c => c.viet === card.viet);
      if (currentIdx === -1) currentIdx = 0;
      isFlipped = false;
      document.getElementById('flashCard').classList.remove('flipped');
      showCard();
    };
    grid.appendChild(el);
  });
}

function speakVietnamese(e) {
  e.stopPropagation(); // don't flip the card
  if (!window.speechSynthesis) {
    showToast('Audio not supported in this browser');
    return;
  }
  const card = deck[currentIdx];
  if (!card) return;

  window.speechSynthesis.cancel();

  const btn = document.getElementById('audioBtn');
  const utterance = new SpeechSynthesisUtterance(card.viet);
  utterance.lang = 'vi-VN';
  utterance.rate = 0.85;
  utterance.pitch = 1;

  // Try to find a Vietnamese voice, fall back to default
  const voices = window.speechSynthesis.getVoices();
  const viVoice = voices.find(v => v.lang.startsWith('vi'));
  if (viVoice) utterance.voice = viVoice;

  utterance.onstart = () => {
    btn.classList.add('playing');
    btn.querySelector('.audio-icon').textContent = '♪';
    btn.querySelector('.audio-label').textContent = 'Playing…';
  };
  utterance.onend = () => {
    btn.classList.remove('playing');
    btn.querySelector('.audio-icon').textContent = '▶';
    btn.querySelector('.audio-label').textContent = 'Listen';
  };
  utterance.onerror = () => {
    btn.classList.remove('playing');
    btn.querySelector('.audio-icon').textContent = '▶';
    btn.querySelector('.audio-label').textContent = 'Listen';
    showToast('Could not play audio');
  };

  window.speechSynthesis.speak(utterance);
}

// Preload voices (some browsers load them async)
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}



// Keyboard nav — skip when typing in search box
document.addEventListener('keydown', e => {
  if (document.activeElement === document.getElementById('searchInput')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextCard();
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prevCard();
  else if (e.key === ' ') { e.preventDefault(); flipCard(); }
  else if (e.key === 'Enter') markCard(true);
  else if (e.key === 'Backspace') markCard(false);
  else if (e.key === 'Escape') { clearSearch(); document.getElementById('searchInput').blur(); }
});

init();

/* ════════════════════════════
   PRACTICE MODULE
════════════════════════════ */

// ── STATE ──
let xp = 0, streak = 0, consecutiveCorrect = 0, consecutiveWrong = 0;
let diff = 'easy';
let currentMode = 'scenario';
let activeTopic = 'All';

// ── TOPICS ──
const TOPICS = ['All','Food & Dining','Transport','Market & Shopping','Gym & Business','Daily Life','Café','Pharmacy','Barbershop'];

// ── XP & DIFFICULTY ──
function getLevel(x) {
  const LEVELS = [{min:0,label:'1 · Beginner'},{min:50,label:'2 · Learner'},{min:120,label:'3 · Conversational'},{min:250,label:'4 · Confident'},{min:450,label:'5 · Fluent'}];
  for (let i = LEVELS.length-1; i >= 0; i--) if (x >= LEVELS[i].min) return LEVELS[i];
  return LEVELS[0];
}

function addXP(n) {
  xp += n;
  const next = [{min:0},{min:50},{min:120},{min:250},{min:450},{min:999}].find(l => l.min > xp);
  const prev = getLevel(xp);
  const maxXP = next ? next.min : prev.min + 100;
  const pct = Math.min(100, ((xp - prev.min) / (maxXP - prev.min)) * 100);
  const fill = document.getElementById('xpFill');
  const level = document.getElementById('xpLevel');
  if (fill) fill.style.width = pct + '%';
  if (level) level.textContent = prev.label;
}

function updateStreak(correct) {
  if (correct) {
    streak++; consecutiveCorrect++; consecutiveWrong = 0;
    if (consecutiveCorrect >= 3) {
      const next = diff === 'easy' ? 'medium' : 'hard';
      if (next !== diff) { setDiff(next); showToast('Level up! 🔥'); }
      consecutiveCorrect = 0;
    }
  } else {
    consecutiveWrong++; consecutiveCorrect = 0;
    if (consecutiveWrong >= 2) {
      const prev = diff === 'hard' ? 'medium' : 'easy';
      if (prev !== diff) { setDiff(prev); showToast('Stepping back 📚'); }
      consecutiveWrong = 0;
    }
    streak = 0;
  }
  const badge = document.getElementById('streakBadge');
  if (badge) badge.textContent = `🔥 ${streak} streak`;
}

// ── TOPIC FILTER ──
function buildTopicFilter() {
  const el = document.getElementById('topicFilter');
  if (!el) return;
  el.innerHTML = '';
  TOPICS.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'topic-btn' + (t === activeTopic ? ' active' : '');
    btn.textContent = t;
    btn.onclick = () => setTopic(t);
    el.appendChild(btn);
  });
}

function setTopic(t) {
  activeTopic = t;
  document.querySelectorAll('.topic-btn').forEach(b => b.classList.toggle('active', b.textContent === t));
  if (currentMode === 'scenario') buildScenarioPicker();
  if (currentMode === 'sentence') loadSentence();
  if (currentMode === 'gapfill') loadGapFill();
  if (currentMode === 'listen') loadListen();
}

// ── MODE SWITCHER ──
function setMode(m) {
  currentMode = m;
  document.querySelectorAll('.mode-tab').forEach((t,i) => {
    t.classList.toggle('active', ['scenario','sentence','gapfill','listen'][i] === m);
  });
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + m).classList.add('active');
  if (m === 'sentence') loadSentence();
  if (m === 'gapfill') loadGapFill();
  if (m === 'listen') loadListen();
  if (m === 'scenario') buildScenarioPicker();
}

function setDiff(d) {
  diff = d;
  ['easy','medium','hard'].forEach(x => {
    const btn = document.getElementById('diff-' + x);
    if (btn) btn.classList.toggle('active-diff', x === d);
  });
}

// ════════════════════
// ── SCENARIOS ──
// ════════════════════
const SCENARIOS = [
  {
    id:'restaurant', icon:'🍜', name:'Restaurant', topic:'Food & Dining', desc:'Order food, no beef, ask about spice',
    easy:[
      {npc:"Xin chào! Bạn muốn gì?", npcEng:"Hello! What would you like?", expect:"Cho tôi xem thực đơn", hint:"Ask to see the menu", suggestions:["Cho tôi xem thực đơn","Xin chào!","Có gì ngon không?"]},
      {npc:"Đây là thực đơn. Bạn muốn ăn gì?", npcEng:"Here's the menu. What would you like?", expect:"Không có thịt bò", hint:"Tell them no beef", suggestions:["Không có thịt bò","Cho tôi cá","Tôi muốn cháo vịt"]},
      {npc:"Được. Bạn muốn uống gì?", npcEng:"Sure. What would you like to drink?", expect:"Cho tôi một ly nước lọc", hint:"Order still water", suggestions:["Cho tôi một ly nước lọc","Trà đá","Không cảm ơn"]},
      {npc:"Cay không?", npcEng:"Spicy?", expect:"Bớt cay được không?", hint:"Ask for less spice", suggestions:["Bớt cay được không?","Không cay","Cay được"]},
      {npc:"Thức ăn ngon không?", npcEng:"Is the food good?", expect:"Ngon lắm! Tính tiền", hint:"Compliment then ask for bill", suggestions:["Ngon lắm! Tính tiền","Ngon quá!","Tính tiền cho tôi"]},
    ],
    medium:[
      {npc:"Chào anh! Hôm nay dùng gì ạ?", npcEng:"Hello! What would you like today?", expect:"Cho tôi xem thực đơn. Tôi không ăn thịt bò", hint:"Menu + no beef in one sentence", suggestions:["Cho tôi xem thực đơn. Tôi không ăn thịt bò","Có cháo vịt không?","Cho tôi gọi món"]},
      {npc:"Dạ có. Anh muốn cháo vịt hay cơm gà?", npcEng:"Yes. Duck congee or chicken rice?", expect:"Cháo vịt, không bỏ ngò", hint:"Order + no coriander", suggestions:["Cháo vịt, không bỏ ngò","Cơm gà","Cháo vịt thôi"]},
      {npc:"Cay không anh?", npcEng:"Spicy?", expect:"Cay quá, bớt cay được không?", hint:"Too spicy + ask to reduce", suggestions:["Cay quá, bớt cay được không?","Không cay","Ít cay thôi"]},
      {npc:"Dạ được. Uống gì không anh?", npcEng:"Sure. Anything to drink?", expect:"Cho tôi một ly nước lọc, không đá", hint:"Water without ice", suggestions:["Cho tôi một ly nước lọc, không đá","Trà đá","Nước suối"]},
      {npc:"Anh dùng xong chưa?", npcEng:"Are you finished?", expect:"Xong rồi. Ngon lắm! Tính tiền", hint:"Done + compliment + bill", suggestions:["Xong rồi. Ngon lắm! Tính tiền","Tính tiền","Cho tôi hoá đơn"]},
    ],
  },
  {
    id:'grab', icon:'🛵', name:'Grab / Taxi', topic:'Transport', desc:'Directions, stops, small talk',
    easy:[
      {npc:"Chào! Bạn đi đâu?", npcEng:"Hello! Where are you going?", expect:"Cho tôi đến Quận 1", hint:"Tell driver your destination", suggestions:["Cho tôi đến Quận 1","Tôi đi trung tâm","Cho tôi đến chợ Bến Thành"]},
      {npc:"Kẹt xe quá hôm nay!", npcEng:"Traffic is terrible today!", expect:"Kẹt xe quá!", hint:"Agree about traffic", suggestions:["Kẹt xe quá!","Vâng, kẹt xe","Thôi được rồi"]},
      {npc:"Bạn ở đâu đến?", npcEng:"Where are you from?", expect:"Tôi đến từ Singapore", hint:"Say where you're from", suggestions:["Tôi đến từ Singapore","Tôi là người nước ngoài","Tôi ở Singapore"]},
      {npc:"Gần đến rồi. Dừng ở đâu?", npcEng:"Almost there. Where to stop?", expect:"Dừng đây được không?", hint:"Ask to stop here", suggestions:["Dừng đây được không?","Đi thêm một chút","Dừng trước cổng"]},
      {npc:"Đây rồi! Cảm ơn anh nhé.", npcEng:"Here we are! Thank you.", expect:"Cảm ơn anh nhiều!", hint:"Thank the driver warmly", suggestions:["Cảm ơn anh nhiều!","Cảm ơn","Thanh toán bằng thẻ được không?"]},
    ],
    medium:[
      {npc:"Anh đi đâu vậy?", npcEng:"Where are you headed?", expect:"Cho tôi đến đường Lê Lợi, Quận 1", hint:"Give street + district", suggestions:["Cho tôi đến đường Lê Lợi, Quận 1","Tôi muốn đến siêu thị","Cho tôi đến chợ Bến Thành"]},
      {npc:"Đường nào nhanh hơn?", npcEng:"Which road is faster?", expect:"Đi đường nào nhanh hơn?", hint:"Ask which route is faster", suggestions:["Đi đường nào nhanh hơn?","Anh chọn đi","Đường tránh kẹt xe"]},
      {npc:"Tôi đi đường vòng cho nhanh.", npcEng:"I'll take the bypass to go faster.", expect:"Được, cảm ơn anh", hint:"Agree politely", suggestions:["Được, cảm ơn anh","Thôi được rồi","Nhanh không?"]},
      {npc:"Anh có tiền lẻ không? Tôi không có tiền thối.", npcEng:"Do you have small bills? No change.", expect:"Thanh toán bằng thẻ được không?", hint:"Ask to pay by card", suggestions:["Thanh toán bằng thẻ được không?","Tôi có tiền lẻ","Không sao, để tôi xem"]},
      {npc:"Đến rồi. Cảm ơn anh đã đi.", npcEng:"We're here. Thanks for riding.", expect:"Cảm ơn anh. Lái xe cẩn thận nhé!", hint:"Thank + safe driving", suggestions:["Cảm ơn anh. Lái xe cẩn thận nhé!","Cảm ơn nhiều","Tạm biệt"]},
    ],
  },
  {
    id:'market', icon:'🛒', name:'Wet Market', topic:'Market & Shopping', desc:'Buy produce, negotiate prices',
    easy:[
      {npc:"Mua gì không em?", npcEng:"What would you like to buy?", expect:"Cho tôi xem cá", hint:"Ask to look at fish", suggestions:["Cho tôi xem cá","Bao nhiêu tiền?","Tôi muốn mua rau"]},
      {npc:"Cá tươi lắm! Bao nhiêu muốn mua?", npcEng:"Very fresh! How much?", expect:"Một ký", hint:"One kilogram", suggestions:["Một ký","Nửa ký","Hai ký"]},
      {npc:"Tám mươi ngàn một ký.", npcEng:"80,000 dong per kilo.", expect:"Mắc vậy trời! Rẻ hơn được không?", hint:"Too expensive + negotiate", suggestions:["Mắc vậy trời! Rẻ hơn được không?","Đắt quá!","Bảy mươi ngàn được không?"]},
      {npc:"Thôi bảy mươi ngàn cho em.", npcEng:"OK 70,000 for you.", expect:"Được, cảm ơn chị", hint:"Agree and thank", suggestions:["Được, cảm ơn chị","Cảm ơn","Rẻ hơn nữa không?"]},
      {npc:"Còn muốn mua gì nữa không?", npcEng:"Anything else?", expect:"Còn trứng không?", hint:"Ask about eggs", suggestions:["Còn trứng không?","Hổng có gì nữa","Cho tôi thêm rau"]},
    ],
    medium:[
      {npc:"Em ơi! Mua gì đây?", npcEng:"Hey! What are you buying?", expect:"Cho tôi nửa ký cá tươi", hint:"Half kilo fresh fish", suggestions:["Cho tôi nửa ký cá tươi","Cá hôm nay tươi không?","Bao nhiêu một ký?"]},
      {npc:"Tám mươi ngàn một ký.", npcEng:"80,000 per kilo.", expect:"Mắc vậy trời! Rẻ hơn được không?", hint:"React and negotiate", suggestions:["Mắc vậy trời! Rẻ hơn được không?","Đắt quá!","Bảy mươi ngàn được không?"]},
      {npc:"Thôi bảy mươi ngàn cho em, lấy đi.", npcEng:"OK 70,000 for you, take it.", expect:"Coi bộ được đó. Cho tôi một ký", hint:"Accept + order one kilo", suggestions:["Coi bộ được đó. Cho tôi một ký","Được rồi","Nửa ký thôi"]},
      {npc:"Còn cần gì nữa không em?", npcEng:"Anything else?", expect:"Còn quả chuối không?", hint:"Ask about bananas", suggestions:["Còn quả chuối không?","Hổng có gì","Cho tôi thêm rau"]},
      {npc:"Dạ còn. Bao nhiêu?", npcEng:"Yes, we have. How many?", expect:"Cho tôi một nải", hint:"Ask for a bunch", suggestions:["Cho tôi một nải","Nửa ký","Năm quả"]},
    ],
  },
  {
    id:'gym', icon:'💪', name:'Gym / Business', topic:'Gym & Business', desc:'Staff, members, negotiations',
    easy:[
      {npc:"Chào anh! Anh muốn tập gì?", npcEng:"Hello! What would you like to train?", expect:"Tôi muốn đăng ký tập", hint:"Say you want to sign up", suggestions:["Tôi muốn đăng ký tập","Cho tôi xem phòng tập","Phòng tập ở đâu?"]},
      {npc:"Dạ. Anh đã tập bao lâu rồi?", npcEng:"How long have you been training?", expect:"Tôi tập ba năm rồi", hint:"Say 3 years", suggestions:["Tôi tập ba năm rồi","Tôi mới tập","Tôi tập lâu rồi"]},
      {npc:"Anh thích tập gì? Cardio hay tạ?", npcEng:"Cardio or weights?", expect:"Tôi thích tập tạ", hint:"Say you prefer weights", suggestions:["Tôi thích tập tạ","Tôi thích cardio","Tôi thích cả hai"]},
      {npc:"Phòng tập thế nào ạ?", npcEng:"What do you think of the gym?", expect:"Coi bộ được đó!", hint:"Southern approval phrase", suggestions:["Coi bộ được đó!","Tốt lắm!","Đẹp quá!"]},
      {npc:"Anh muốn đăng ký gói nào?", npcEng:"Which package do you want?", expect:"Bao nhiêu tiền một tháng?", hint:"Ask monthly price", suggestions:["Bao nhiêu tiền một tháng?","Anh có thể giảm giá không?","Cho tôi suy nghĩ"]},
    ],
    medium:[
      {npc:"Anh là khách mới hay thành viên?", npcEng:"New or existing member?", expect:"Tôi là khách mới. Tôi muốn đăng ký tập", hint:"New customer + intent", suggestions:["Tôi là khách mới. Tôi muốn đăng ký tập","Tôi muốn xem phòng tập trước","Có gói tháng không?"]},
      {npc:"Gói tháng là hai triệu đồng.", npcEng:"Monthly is 2 million dong.", expect:"Anh có thể giảm giá không?", hint:"Negotiate politely", suggestions:["Anh có thể giảm giá không?","Mắc quá!","Để tôi suy nghĩ thêm"]},
      {npc:"Vì anh là người nước ngoài, giảm mười phần trăm.", npcEng:"10% off for foreigners.", expect:"Được, cho tôi đăng ký", hint:"Accept the offer", suggestions:["Được, cho tôi đăng ký","Cảm ơn, được rồi","Để tôi suy nghĩ thêm"]},
      {npc:"Lịch tập của anh thế nào?", npcEng:"What's your training schedule?", expect:"Tôi tập bốn ngày một tuần", hint:"Say four days a week", suggestions:["Tôi tập bốn ngày một tuần","Mỗi ngày","Cuối tuần"]},
      {npc:"Mình có thể nói chuyện riêng không?", npcEng:"Can we speak privately?", expect:"Được, tôi có thời gian", hint:"Agree you have time", suggestions:["Được, tôi có thời gian","Tất nhiên","Để tôi suy nghĩ thêm"]},
    ],
  },
  {
    id:'cafe', icon:'☕', name:'Café', topic:'Café', desc:'Order drinks, ask for wifi',
    easy:[
      {npc:"Xin chào! Bạn muốn gì?", npcEng:"Hello! What would you like?", expect:"Cho tôi một ly cà phê sữa đá", hint:"Iced milk coffee", suggestions:["Cho tôi một ly cà phê sữa đá","Trà sữa","Nước cam"]},
      {npc:"Size lớn hay vừa?", npcEng:"Large or medium?", expect:"Vừa thôi", hint:"Medium size", suggestions:["Vừa thôi","Lớn","Nhỏ"]},
      {npc:"Uống ở đây hay mang về?", npcEng:"Dine in or takeaway?", expect:"Uống ở đây", hint:"Dine in", suggestions:["Uống ở đây","Mang về","Ở đây"]},
      {npc:"Dạ, mật khẩu wifi là gì?", npcEng:"What's the wifi password?", expect:"Cho tôi mật khẩu wifi được không?", hint:"Ask for wifi password", suggestions:["Cho tôi mật khẩu wifi được không?","Wifi tên gì?","Có wifi không?"]},
      {npc:"Mật khẩu là cafehanoi123.", npcEng:"Password is cafehanoi123.", expect:"Cảm ơn bạn nhiều!", hint:"Thank warmly", suggestions:["Cảm ơn bạn nhiều!","Cảm ơn","Ok được rồi"]},
    ],
    medium:[
      {npc:"Chào anh! Hôm nay uống gì?", npcEng:"Hello! What are you drinking today?", expect:"Cho tôi cà phê sữa đá, ít đường", hint:"Iced coffee, less sugar", suggestions:["Cho tôi cà phê sữa đá, ít đường","Trà đào","Matcha latte"]},
      {npc:"Anh muốn ngồi ở đâu?", npcEng:"Where would you like to sit?", expect:"Chỗ nào gần cửa sổ được không?", hint:"Ask for a window seat", suggestions:["Chỗ nào gần cửa sổ được không?","Ở trong","Bất kỳ chỗ nào"]},
      {npc:"Dạ được. Anh cần gì thêm không?", npcEng:"Sure. Anything else?", expect:"Cho tôi mật khẩu wifi và ổ cắm điện", hint:"Wifi + power socket", suggestions:["Cho tôi mật khẩu wifi và ổ cắm điện","Chỉ wifi thôi","Không cần gì"]},
      {npc:"Wifi là thecafe2024, ổ cắm ở cạnh bàn.", npcEng:"Wifi is thecafe2024, socket next to table.", expect:"Cảm ơn. Cho tôi thêm một ly nữa sau", hint:"Thanks + order another later", suggestions:["Cảm ơn. Cho tôi thêm một ly nữa sau","Cảm ơn nhiều","Ok"]},
      {npc:"Dạ. Anh làm việc ở đây lâu không?", npcEng:"Are you working here long?", expect:"Có lẽ hai tiếng", hint:"Maybe two hours", suggestions:["Có lẽ hai tiếng","Khoảng một tiếng","Chưa biết"]},
    ],
  },
  {
    id:'pharmacy', icon:'💊', name:'Pharmacy', topic:'Pharmacy', desc:'Describe symptoms, buy medicine',
    easy:[
      {npc:"Xin chào! Bạn cần gì?", npcEng:"Hello! What do you need?", expect:"Tôi bị đau đầu", hint:"Say you have a headache", suggestions:["Tôi bị đau đầu","Tôi bị sốt","Tôi bị đau bụng"]},
      {npc:"Bị lâu chưa?", npcEng:"How long have you had it?", expect:"Từ sáng nay", hint:"Since this morning", suggestions:["Từ sáng nay","Hai ngày rồi","Mới bị"]},
      {npc:"Có bị sốt không?", npcEng:"Do you have a fever?", expect:"Không, chỉ đau đầu thôi", hint:"No, just headache", suggestions:["Không, chỉ đau đầu thôi","Dạ có","Tôi không biết"]},
      {npc:"Cho anh thuốc giảm đau nhé.", npcEng:"I'll give you some painkillers.", expect:"Uống mấy viên?", hint:"Ask how many tablets", suggestions:["Uống mấy viên?","Cảm ơn","Bao nhiêu tiền?"]},
      {npc:"Ngày uống hai lần, mỗi lần hai viên.", npcEng:"Twice a day, two tablets each time.", expect:"Cảm ơn! Bao nhiêu tiền?", hint:"Thank + ask price", suggestions:["Cảm ơn! Bao nhiêu tiền?","Ok, cảm ơn","Có tác dụng phụ không?"]},
    ],
    medium:[
      {npc:"Chào anh! Anh cần gì ạ?", npcEng:"Hello! What do you need?", expect:"Tôi bị đau bụng và tiêu chảy từ hôm qua", hint:"Stomach pain + diarrhea since yesterday", suggestions:["Tôi bị đau bụng và tiêu chảy từ hôm qua","Tôi bị cảm","Tôi cần thuốc ho"]},
      {npc:"Anh có sốt không? Bao nhiêu độ?", npcEng:"Do you have a fever? What temperature?", expect:"Không sốt, nhưng người mệt lắm", hint:"No fever but very tired", suggestions:["Không sốt, nhưng người mệt lắm","Sốt nhẹ","Tôi không đo"]},
      {npc:"Anh ăn gì tối qua?", npcEng:"What did you eat last night?", expect:"Tôi ăn đồ ăn đường phố", hint:"Street food", suggestions:["Tôi ăn đồ ăn đường phố","Tôi ăn hải sản","Tôi không nhớ"]},
      {npc:"Cho anh thuốc tiêu hoá và oresol nhé.", npcEng:"I'll give you digestive medicine and oresol.", expect:"Uống như thế nào?", hint:"How to take it?", suggestions:["Uống như thế nào?","Cảm ơn","Có cần uống hết không?"]},
      {npc:"Mỗi gói oresol hoà với một lít nước ấm.", npcEng:"One oresol packet in one litre of warm water.", expect:"Cảm ơn. Có cần đơn thuốc không?", hint:"Thanks + ask about prescription", suggestions:["Cảm ơn. Có cần đơn thuốc không?","Ok, cảm ơn","Bao nhiêu tiền tất cả?"]},
    ],
  },
  {
    id:'barbershop', icon:'💈', name:'Barbershop', topic:'Barbershop', desc:'Haircut, explain what you want',
    easy:[
      {npc:"Chào anh! Anh muốn cắt kiểu gì?", npcEng:"Hello! What style would you like?", expect:"Cắt ngắn thôi", hint:"Just cut it short", suggestions:["Cắt ngắn thôi","Tỉa gọn","Undercut"]},
      {npc:"Hai bên cắt ngắn không?", npcEng:"Short on the sides?", expect:"Dạ, hai bên ngắn, trên để dài hơn", hint:"Short sides, longer on top", suggestions:["Dạ, hai bên ngắn, trên để dài hơn","Ngắn hết","Hai bên để vừa"]},
      {npc:"Gáy vuông hay tròn?", npcEng:"Square or round at the nape?", expect:"Vuông", hint:"Square nape", suggestions:["Vuông","Tròn","Tự nhiên"]},
      {npc:"Có muốn gội đầu không?", npcEng:"Would you like a shampoo?", expect:"Dạ có, cảm ơn", hint:"Yes please", suggestions:["Dạ có, cảm ơn","Không cần","Có thêm tiền không?"]},
      {npc:"Anh thấy sao?", npcEng:"What do you think?", expect:"Đẹp lắm! Cảm ơn anh", hint:"Looks great, thank you", suggestions:["Đẹp lắm! Cảm ơn anh","Ổn rồi","Cắt thêm một chút nữa được không?"]},
    ],
    medium:[
      {npc:"Hôm nay anh muốn làm gì?", npcEng:"What are we doing today?", expect:"Cắt và tỉa râu", hint:"Cut and trim beard", suggestions:["Cắt và tỉa râu","Chỉ cắt thôi","Cạo râu"]},
      {npc:"Anh muốn cắt kiểu gì trên đầu?", npcEng:"What style on top?", expect:"Để dài trên, fade hai bên", hint:"Long on top, fade on sides", suggestions:["Để dài trên, fade hai bên","Undercut","Cắt đều"]},
      {npc:"Fade cao hay thấp?", npcEng:"High or low fade?", expect:"Fade thấp thôi", hint:"Low fade", suggestions:["Fade thấp thôi","Cao","Vừa vừa"]},
      {npc:"Râu để dài bao nhiêu?", npcEng:"How long for the beard?", expect:"Tỉa gọn thôi, đừng cạo", hint:"Just tidy, don't shave", suggestions:["Tỉa gọn thôi, đừng cạo","Cạo hết","Để vậy"]},
      {npc:"Anh thấy vừa ý chưa?", npcEng:"Are you satisfied?", expect:"Vừa ý rồi. Bao nhiêu tiền?", hint:"Satisfied + ask price", suggestions:["Vừa ý rồi. Bao nhiêu tiền?","Cắt thêm hai bên","Đẹp lắm!"]},
    ],
  },
];

let selectedScenarioObj = null;
let currentScenarioSteps = [];
let chatStepIndex = 0;

function getFilteredScenarios() {
  if (activeTopic === 'All') return SCENARIOS;
  return SCENARIOS.filter(s => s.topic === activeTopic || s.id === activeTopic.toLowerCase().replace(/\s.*/,''));
}

function buildScenarioPicker() {
  const el = document.getElementById('scenarioPicker');
  if (!el) return;
  el.innerHTML = '';
  const filtered = getFilteredScenarios();
  filtered.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'scenario-card' + (i === 0 ? ' selected' : '');
    d.innerHTML = `<div class="sc-icon">${s.icon}</div><div class="sc-name">${s.name}</div><div class="sc-desc">${s.desc}</div>`;
    d.onclick = () => {
      document.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('selected'));
      d.classList.add('selected');
      selectedScenarioObj = s;
    };
    el.appendChild(d);
  });
  selectedScenarioObj = filtered[0] || SCENARIOS[0];
}

function startScenario() {
  if (!selectedScenarioObj) return;
  const steps = (diff === 'medium' || diff === 'hard')
    ? (selectedScenarioObj.medium || selectedScenarioObj.easy)
    : selectedScenarioObj.easy;
  currentScenarioSteps = steps;
  chatStepIndex = 0;
  document.getElementById('chatScenarioTitle').textContent = selectedScenarioObj.icon + ' ' + selectedScenarioObj.name;
  document.getElementById('chatScenarioDesc').textContent = 'Playing as: Customer / Guest';
  document.getElementById('scenario-picker-view').style.display = 'none';
  document.getElementById('scenario-chat-view').style.display = 'block';
  document.getElementById('chatBox').innerHTML = '';
  updateChatProgress();
  addBubble('them', steps[0].npc, steps[0].npcEng);
  showSuggestions(steps[0].suggestions);
}

function updateChatProgress() {
  const el = document.getElementById('chatProgress');
  if (el) el.textContent = `${chatStepIndex + 1} / ${currentScenarioSteps.length}`;
}

function addBubble(type, text, subtext) {
  const box = document.getElementById('chatBox');
  const b = document.createElement('div');
  b.className = 'bubble ' + type;
  const textNode = document.createElement('div');
  textNode.textContent = text;
  b.appendChild(textNode);
  if (subtext) {
    const sub = document.createElement('div');
    sub.className = 'viet-hint';
    sub.textContent = subtext;
    b.appendChild(sub);
  }
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
}

function showSuggestions(suggestions) {
  const el = document.getElementById('suggestedReplies');
  el.innerHTML = '';
  if (!suggestions) return;
  suggestions.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'suggestion';
    btn.textContent = s;
    btn.onclick = () => { document.getElementById('chatInput').value = s; sendChat(); };
    el.appendChild(btn);
  });
}

function sendChat() {
  const input = document.getElementById('chatInput');
  const val = input.value.trim();
  if (!val) return;
  input.value = '';
  document.getElementById('suggestedReplies').innerHTML = '';
  addBubble('me', val);
  const step = currentScenarioSteps[chatStepIndex];
  const isCorrect = step.suggestions.some(s => val.toLowerCase().includes(s.toLowerCase().substring(0,6)));
  setTimeout(() => {
    const fb = document.createElement('div');
    fb.className = 'bubble feedback' + (isCorrect ? '' : ' wrong');
    if (isCorrect) {
      const t = document.createElement('div');
      t.textContent = '✓ Great! Key phrase: ';
      const b = document.createElement('strong');
      b.textContent = step.expect;
      t.appendChild(b);
      fb.appendChild(t);
      addXP(diff === 'easy' ? 8 : diff === 'medium' ? 15 : 25);
      updateStreak(true);
    } else {
      const t = document.createElement('div');
      t.textContent = 'Try: ';
      const b = document.createElement('strong');
      b.textContent = step.expect;
      t.appendChild(b);
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:12px;opacity:.6;margin-top:4px;';
      hint.textContent = '💡 ' + step.hint;
      fb.appendChild(t);
      fb.appendChild(hint);
      updateStreak(false);
    }
    document.getElementById('chatBox').appendChild(fb);
    document.getElementById('chatBox').scrollTop = 99999;
    chatStepIndex++;
    if (chatStepIndex < currentScenarioSteps.length) {
      setTimeout(() => {
        const next = currentScenarioSteps[chatStepIndex];
        addBubble('them', next.npc, next.npcEng);
        showSuggestions(next.suggestions);
        updateChatProgress();
      }, 900);
    } else {
      setTimeout(() => showScenarioSummary(), 1000);
    }
  }, 400);
}

function showScenarioSummary() {
  document.getElementById('scenario-chat-view').style.display = 'none';
  const el = document.getElementById('scenario-summary-view');
  el.style.display = 'block';
  el.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'summary-box';
  box.innerHTML = `
    <div class="summary-score">🎉</div>
    <div style="font-family:'Playfair Display',serif;font-size:22px;margin-top:12px;">Conversation complete!</div>
    <div style="font-size:14px;color:var(--muted);margin-top:8px;">${selectedScenarioObj.name} · ${diff} difficulty</div>
    <div class="summary-stats">
      <div class="sum-stat"><div class="sum-num">${streak}</div><div class="sum-lbl">Streak</div></div>
      <div class="sum-stat"><div class="sum-num">${xp}</div><div class="sum-lbl">Total XP</div></div>
    </div>
    <div class="btn-row" style="justify-content:center;gap:12px;">
      <button class="btn btn-primary" onclick="backToScenarioPicker()">Try another →</button>
    </div>`;
  el.appendChild(box);
}

function backToScenarioPicker() {
  document.getElementById('scenario-picker-view').style.display = 'block';
  document.getElementById('scenario-chat-view').style.display = 'none';
  document.getElementById('scenario-summary-view').style.display = 'none';
}

// ════════════════════
// ── SENTENCE BUILDER ──
// ════════════════════
const SB_EXERCISES = {
  'All': {
    easy:[
      {prompt:"Arrange: I want to eat rice", answer:"Tôi muốn ăn cơm", words:["Tôi","muốn","ăn","cơm","đi","uống"], cat:"Daily Life"},
      {prompt:"Arrange: How much is this?", answer:"Cái này bao nhiêu tiền?", words:["Cái","này","bao","nhiêu","tiền?","ăn","ngon"], cat:"Shopping"},
      {prompt:"Arrange: Give me one portion more", answer:"Cho tôi một phần nữa", words:["Cho","tôi","một","phần","nữa","cơm","rau"], cat:"Food"},
      {prompt:"Arrange: I don't eat beef", answer:"Tôi không ăn thịt bò", words:["Tôi","không","ăn","thịt","bò","gà","rau"], cat:"Food"},
      {prompt:"Arrange: Is it spicy?", answer:"Có cay không?", words:["Có","cay","không?","ngon","mắc"], cat:"Food"},
      {prompt:"Arrange: Today's lunch", answer:"Bữa trưa hôm nay", words:["Bữa","trưa","hôm","nay","tối","sáng"], cat:"Grammar"},
      {prompt:"Arrange: I like weight training", answer:"Tôi thích tập tạ", words:["Tôi","thích","tập","tạ","ăn","cơm"], cat:"Fitness"},
      {prompt:"Arrange: Can you stop here?", answer:"Dừng đây được không?", words:["Dừng","đây","được","không?","đi","nhanh"], cat:"Transport"},
      {prompt:"Arrange: Give me a glass of water", answer:"Cho tôi một ly nước", words:["Cho","tôi","một","ly","nước","cơm","rau"], cat:"Daily Life"},
      {prompt:"Arrange: Where are you going?", answer:"Bạn đi đâu?", words:["Bạn","đi","đâu?","làm","gì"], cat:"Grammar"},
    ],
    medium:[
      {prompt:"Arrange: Too spicy, can you make it less spicy?", answer:"Cay quá, bớt cay được không?", words:["Cay","quá,","bớt","cay","được","không?","ngon","mắc"], cat:"Food"},
      {prompt:"Arrange: Can I pay by card?", answer:"Thanh toán bằng thẻ được không?", words:["Thanh","toán","bằng","thẻ","được","không?","tiền","mặt"], cat:"Payments"},
      {prompt:"Arrange: How long have you been training?", answer:"Bạn tập bao lâu rồi?", words:["Bạn","tập","bao","lâu","rồi?","nhiêu","ngày"], cat:"Fitness"},
      {prompt:"Arrange: I will eat duck congee today", answer:"Hôm nay tôi sẽ ăn cháo vịt", words:["Hôm","nay","tôi","sẽ","ăn","cháo","vịt","cơm","gạo"], cat:"Grammar"},
      {prompt:"Arrange: Give me half a kilo of fresh fish", answer:"Cho tôi nửa ký cá tươi", words:["Cho","tôi","nửa","ký","cá","tươi","rau","gạo"], cat:"Market"},
      {prompt:"Arrange: Let me think about it more", answer:"Để tôi suy nghĩ thêm", words:["Để","tôi","suy","nghĩ","thêm","biết","hiểu"], cat:"Business"},
      {prompt:"Arrange: The traffic is terrible today", answer:"Hôm nay kẹt xe quá", words:["Hôm","nay","kẹt","xe","quá","đi","nhanh"], cat:"Transport"},
      {prompt:"Arrange: Go straight then turn right", answer:"Đi thẳng rồi quẹo phải", words:["Đi","thẳng","rồi","quẹo","phải","trái","nhanh"], cat:"Transport"},
      {prompt:"Arrange: Iced milk coffee, less sugar", answer:"Cà phê sữa đá, ít đường", words:["Cà","phê","sữa","đá,","ít","đường","nhiều","nóng"], cat:"Café"},
      {prompt:"Arrange: Can I have the wifi password?", answer:"Cho tôi mật khẩu wifi được không?", words:["Cho","tôi","mật","khẩu","wifi","được","không?","tên"], cat:"Café"},
    ],
    hard:[
      {prompt:"Arrange: Can we speak privately?", answer:"Mình có thể nói chuyện riêng không?", words:["Mình","có","thể","nói","chuyện","riêng","không?","cùng","nhau"], cat:"Business"},
      {prompt:"Arrange: Duck congee, no coriander please", answer:"Cháo vịt, không bỏ ngò", words:["Cháo","vịt,","không","bỏ","ngò","thêm","rau"], cat:"Food"},
      {prompt:"Arrange: Can you lower the price?", answer:"Anh có thể giảm giá không?", words:["Anh","có","thể","giảm","giá","không?","tăng","nhiều"], cat:"Business"},
      {prompt:"Arrange: I want to sign up to train", answer:"Tôi muốn đăng ký tập", words:["Tôi","muốn","đăng","ký","tập","học","xem"], cat:"Fitness"},
      {prompt:"Arrange: Drive faster, I'm already late", answer:"Chạy nhanh lên, tôi trễ rồi", words:["Chạy","nhanh","lên,","tôi","trễ","rồi","đi","chậm"], cat:"Transport"},
      {prompt:"Arrange: Short on the sides, longer on top", answer:"Hai bên ngắn, trên để dài hơn", words:["Hai","bên","ngắn,","trên","để","dài","hơn","cắt","đều"], cat:"Barbershop"},
      {prompt:"Arrange: I have stomach pain since yesterday", answer:"Tôi bị đau bụng từ hôm qua", words:["Tôi","bị","đau","bụng","từ","hôm","qua","sáng","nay"], cat:"Pharmacy"},
      {prompt:"Arrange: Maybe two hours", answer:"Có lẽ hai tiếng", words:["Có","lẽ","hai","tiếng","ba","một","giờ"], cat:"Café"},
    ],
  },
};
// Topic-filtered SB: map topic to exercise subset
const SB_TOPIC_MAP = {
  'Food & Dining': ['easy','medium','hard'].flatMap(d => (SB_EXERCISES['All'][d]||[]).filter(e=>['Food','Food & Dining'].includes(e.cat))),
  'Transport': ['easy','medium','hard'].flatMap(d => (SB_EXERCISES['All'][d]||[]).filter(e=>e.cat==='Transport')),
  'Market & Shopping': ['easy','medium','hard'].flatMap(d => (SB_EXERCISES['All'][d]||[]).filter(e=>['Market','Shopping'].includes(e.cat))),
  'Gym & Business': ['easy','medium','hard'].flatMap(d => (SB_EXERCISES['All'][d]||[]).filter(e=>['Fitness','Business'].includes(e.cat))),
  'Café': ['easy','medium','hard'].flatMap(d => (SB_EXERCISES['All'][d]||[]).filter(e=>e.cat==='Café')),
  'Pharmacy': ['easy','medium','hard'].flatMap(d => (SB_EXERCISES['All'][d]||[]).filter(e=>e.cat==='Pharmacy')),
  'Barbershop': ['easy','medium','hard'].flatMap(d => (SB_EXERCISES['All'][d]||[]).filter(e=>e.cat==='Barbershop')),
};

let currentSBExercises = [];
let sbCurrentIdx = 0;
let sbPlaced = [];
let sbShuffled = [];

function loadSentence() {
  let pool;
  if (activeTopic !== 'All' && SB_TOPIC_MAP[activeTopic]?.length) {
    pool = [...SB_TOPIC_MAP[activeTopic]];
  } else {
    pool = [...(SB_EXERCISES['All'][diff] || SB_EXERCISES['All'].easy)];
  }
  currentSBExercises = pool.sort(() => Math.random() - 0.5);
  sbCurrentIdx = 0;
  renderSentence();
}

function renderSentence() {
  const ex = currentSBExercises[sbCurrentIdx % currentSBExercises.length];
  sbPlaced = [];
  sbShuffled = [...ex.words].sort(() => Math.random() - 0.5);
  const catEl = document.getElementById('sbCatLabel');
  const promptEl = document.getElementById('sbPrompt');
  const engEl = document.getElementById('sbEng');
  const counterEl = document.getElementById('sbCounter');
  const fbEl = document.getElementById('sbFeedback');
  const checkBtn = document.getElementById('sbCheckBtn');
  if (catEl) catEl.textContent = ex.cat;
  if (promptEl) promptEl.textContent = ex.prompt;
  if (engEl) engEl.textContent = ''; // NO answer hint shown
  if (counterEl) counterEl.textContent = `${(sbCurrentIdx % currentSBExercises.length) + 1} / ${currentSBExercises.length}`;
  if (fbEl) fbEl.style.display = 'none';
  if (checkBtn) checkBtn.style.display = '';
  renderWordBank();
  renderAnswerSlots();
}

function renderWordBank() {
  const wb = document.getElementById('wordBank');
  if (!wb) return;
  wb.innerHTML = '';
  sbShuffled.forEach((w, i) => {
    const t = document.createElement('div');
    t.className = 'word-tile' + (sbPlaced.includes(i) ? ' used' : '');
    t.textContent = w;
    t.onclick = () => placeWord(i);
    wb.appendChild(t);
  });
}

function renderAnswerSlots() {
  const el = document.getElementById('answerSlots');
  if (!el) return;
  el.className = 'answer-slots';
  el.innerHTML = '';
  if (sbPlaced.length === 0) {
    const hint = document.createElement('span');
    hint.style.cssText = 'color:var(--muted);font-size:13px;';
    hint.textContent = 'Tap words below to build the sentence';
    el.appendChild(hint);
  }
  sbPlaced.forEach((idx, pos) => {
    const t = document.createElement('div');
    t.className = 'placed-tile';
    t.textContent = sbShuffled[idx];
    t.onclick = () => removeTile(pos);
    el.appendChild(t);
  });
}

function placeWord(i) {
  if (sbPlaced.includes(i)) return;
  sbPlaced.push(i);
  renderWordBank();
  renderAnswerSlots();
}

function removeTile(pos) {
  sbPlaced.splice(pos, 1);
  renderWordBank();
  renderAnswerSlots();
}

function checkSentence() {
  const ex = currentSBExercises[sbCurrentIdx % currentSBExercises.length];
  const built = sbPlaced.map(i => sbShuffled[i]).join(' ');
  const correct = built.trim().toLowerCase() === ex.answer.toLowerCase();
  const fb = document.getElementById('sbFeedback');
  const slots = document.getElementById('answerSlots');
  if (!fb || !slots) return;
  fb.style.display = 'block';
  fb.className = 'sb-feedback ' + (correct ? 'correct' : 'incorrect');
  slots.className = 'answer-slots ' + (correct ? 'correct' : 'incorrect');
  fb.innerHTML = '';
  if (correct) {
    fb.textContent = '✓ Correct! ';
    const b = document.createElement('strong');
    b.textContent = ex.answer;
    fb.appendChild(b);
    addXP(diff === 'easy' ? 10 : diff === 'medium' ? 18 : 28);
    updateStreak(true);
  } else {
    fb.textContent = '✗ Correct order: ';
    const b = document.createElement('strong');
    b.textContent = ex.answer;
    fb.appendChild(b);
    updateStreak(false);
  }
  const checkBtn = document.getElementById('sbCheckBtn');
  if (checkBtn) checkBtn.style.display = 'none';
}

function nextSentence() {
  sbCurrentIdx++;
  renderSentence();
}

// ════════════════════
// ── GAP FILL ──
// Every blank has its answer guaranteed in the hints array
// ════════════════════
const GF_EXERCISES = [
  {
    topic:"Food & Market", scenarioTitle:"At the wet market", scenarioDesc:"Buying fish and vegetables",
    hints:["Còn","còn","Bao nhiêu","Nửa ký","tươi","Cho tôi","hết rồi"],
    lines:[
      {speaker:"You",    text:"Chị ơi! ___ cá không?",          answers:["Còn"],       eng:"Hey! Do you still have fish?"},
      {speaker:"Vendor", text:"Dạ ___! Cá tươi lắm.",            answers:["còn"],       eng:"Yes still have! Very fresh."},
      {speaker:"You",    text:"___ một ký cá ___.",               answers:["Cho tôi","tươi"], eng:"Give me one kilo of fresh fish."},
      {speaker:"Vendor", text:"___ tiền một ký?",                 answers:["Bao nhiêu"], eng:"How much per kilo?"},
      {speaker:"You",    text:"___ thôi, không cần nhiều.",       answers:["Nửa ký"],    eng:"Just half a kilo."},
    ]
  },
  {
    topic:"Grammar: Future & Connectors", scenarioTitle:"Planning the day", scenarioDesc:"Using sẽ, và, hay, có lẽ",
    hints:["sẽ","và","hay","Có lẽ","Hôm nay","đi"],
    lines:[
      {speaker:"Friend", text:"___ bạn làm gì?",                  answers:["Hôm nay"],  eng:"What are you doing today?"},
      {speaker:"You",    text:"Tôi ___ đi chợ mua rau ___ cá.",   answers:["sẽ","và"],  eng:"I will go to the market to buy veg and fish."},
      {speaker:"Friend", text:"Bạn muốn ăn cơm ___ bánh mì?",     answers:["hay"],      eng:"Rice or bread?"},
      {speaker:"You",    text:"Tôi muốn cơm ___ rau.",             answers:["và"],       eng:"I want rice and vegetables."},
      {speaker:"Friend", text:"___ tôi sẽ cùng đi.",              answers:["Có lẽ"],    eng:"Maybe I'll come along."},
    ]
  },
  {
    topic:"Yes/No Questions", scenarioTitle:"At the restaurant", scenarioDesc:"Using có...không and còn...không",
    hints:["Có","không","Còn","có","được","ngon"],
    lines:[
      {speaker:"You",    text:"___ cháo vịt ___?",                answers:["Có","không"],  eng:"Do you have duck congee?"},
      {speaker:"Staff",  text:"Dạ ___! Anh dùng không?",          answers:["Còn"],          eng:"Yes still have! Would you like some?"},
      {speaker:"You",    text:"___ cay ___ ?",                    answers:["Có","không"],   eng:"Is it spicy?"},
      {speaker:"You",    text:"Bớt cay ___ không?",               answers:["được"],         eng:"Can it be less spicy?"},
      {speaker:"Staff",  text:"Dạ ___, anh yên tâm.",             answers:["có"],           eng:"Yes of course, don't worry."},
    ]
  },
  {
    topic:"Transport", scenarioTitle:"In a Grab", scenarioDesc:"Giving directions",
    hints:["kẹt xe","kẹt xe","đi","thẳng","phải","Dừng","đây"],
    lines:[
      {speaker:"Driver", text:"Hôm nay ___ quá!",                 answers:["kẹt xe"],       eng:"Traffic is terrible today!"},
      {speaker:"You",    text:"Vâng, ___ quá.",                   answers:["kẹt xe"],       eng:"Yes, so much traffic."},
      {speaker:"Driver", text:"Mình ___ đường này được không?",   answers:["đi"],           eng:"Can we take this road?"},
      {speaker:"You",    text:"Đi ___ rồi quẹo ___.",             answers:["thẳng","phải"], eng:"Go straight then turn right."},
      {speaker:"You",    text:"___ ___ được không?",              answers:["Dừng","đây"],   eng:"Can you stop here?"},
    ]
  },
  {
    topic:"Fitness & Gym", scenarioTitle:"Signing up", scenarioDesc:"Gym membership conversation",
    hints:["đăng ký","tập","tập","bao lâu","thể hình","giảm giá","được"],
    lines:[
      {speaker:"You",    text:"Tôi muốn ___ ___.",                answers:["đăng ký","tập"], eng:"I want to sign up to train."},
      {speaker:"Staff",  text:"Anh ___ ___ rồi?",                 answers:["tập","bao lâu"], eng:"How long have you been training?"},
      {speaker:"You",    text:"Ba năm. Phòng ___ ở đây đẹp lắm.", answers:["thể hình"],      eng:"Three years. The gym here is very nice."},
      {speaker:"You",    text:"Anh có thể ___ không?",            answers:["giảm giá"],      eng:"Can you lower the price?"},
      {speaker:"Staff",  text:"Dạ ___ anh, mười phần trăm.",      answers:["được"],          eng:"Yes, ten percent off."},
    ]
  },
  {
    topic:"Café", scenarioTitle:"At a café", scenarioDesc:"Ordering drinks and asking for wifi",
    hints:["cà phê sữa đá","ít đường","ở đây","mật khẩu wifi","Có lẽ","hai tiếng"],
    lines:[
      {speaker:"You",    text:"Cho tôi ___, ___.",               answers:["cà phê sữa đá","ít đường"], eng:"Give me iced milk coffee, less sugar."},
      {speaker:"Staff",  text:"Uống ___ hay mang về?",            answers:["ở đây"],     eng:"Dine in or takeaway?"},
      {speaker:"You",    text:"Ở đây. Cho tôi ___ được không?",  answers:["mật khẩu wifi"], eng:"Here. Can I have the wifi password?"},
      {speaker:"Staff",  text:"Anh làm việc ở đây lâu không?",  answers:[],            eng:"Are you working here long?"},
      {speaker:"You",    text:"___ ___.",                         answers:["Có lẽ","hai tiếng"], eng:"Maybe two hours."},
    ]
  },
  {
    topic:"Pharmacy", scenarioTitle:"At the pharmacy", scenarioDesc:"Describing symptoms",
    hints:["đau đầu","Từ sáng nay","không","chỉ","Uống mấy viên","Cảm ơn"],
    lines:[
      {speaker:"You",    text:"Tôi bị ___.",                      answers:["đau đầu"],       eng:"I have a headache."},
      {speaker:"Staff",  text:"Bị lâu chưa?",                    answers:[],                eng:"How long have you had it?"},
      {speaker:"You",    text:"___.",                             answers:["Từ sáng nay"],   eng:"Since this morning."},
      {speaker:"Staff",  text:"Có bị sốt không?",                answers:[],                eng:"Do you have a fever?"},
      {speaker:"You",    text:"___, ___ đau đầu thôi.",          answers:["không","chỉ"],   eng:"No, just a headache."},
    ]
  },
];

let gfCurrentIdx = 0;
let gfExercises = [];
let gfSelectedChip = null;
let gfDraggingChip = null;

function loadGapFill() {
  let pool;
  if (activeTopic !== 'All') {
    pool = GF_EXERCISES.filter(e => e.topic.toLowerCase().includes(activeTopic.toLowerCase().split(' ')[0].toLowerCase()));
    if (!pool.length) pool = GF_EXERCISES;
  } else {
    pool = GF_EXERCISES;
  }
  gfExercises = [...pool].sort(() => Math.random() - 0.5);
  gfCurrentIdx = 0;
  renderGapFill();
}

function renderGapFill() {
  gfSelectedChip = null;
  gfDraggingChip = null;
  const ex = gfExercises[gfCurrentIdx % gfExercises.length];
  const topicEl = document.getElementById('gfTopicLabel');
  const titleEl = document.getElementById('gfScenarioTitle');
  const descEl = document.getElementById('gfScenarioDesc');
  const counterEl = document.getElementById('gfCounter');
  if (topicEl) topicEl.textContent = ex.topic;
  if (titleEl) titleEl.textContent = ex.scenarioTitle;
  if (descEl) descEl.textContent = ex.scenarioDesc;
  if (counterEl) counterEl.textContent = `${(gfCurrentIdx % gfExercises.length) + 1} / ${gfExercises.length}`;

  const hintsEl = document.getElementById('gfHints');
  if (!hintsEl) return;
  hintsEl.innerHTML = '';
  ex.hints.forEach((word, wi) => {
    const cid = `chip-${wi}`;
    const chip = document.createElement('div');
    chip.className = 'hint-chip';
    chip.textContent = word;
    chip.dataset.word = word;
    chip.dataset.cid = cid;
    chip.draggable = true;
    chip.addEventListener('click', () => {
      if (chip.classList.contains('used')) return;
      if (gfSelectedChip === chip) { chip.classList.remove('selected'); gfSelectedChip = null; }
      else { if (gfSelectedChip) gfSelectedChip.classList.remove('selected'); gfSelectedChip = chip; chip.classList.add('selected'); }
    });
    chip.addEventListener('dragstart', e => { gfDraggingChip = chip; chip.classList.add('dragging'); e.dataTransfer.setData('text/plain', cid); });
    chip.addEventListener('dragend', () => { chip.classList.remove('dragging'); gfDraggingChip = null; });
    hintsEl.appendChild(chip);
  });

  const dlg = document.getElementById('gfDialogue');
  if (!dlg) return;
  dlg.innerHTML = '';
  let blankId = 0;
  ex.lines.forEach((line, li) => {
    const row = document.createElement('div');
    row.className = 'gf-line';
    const textEl = document.createElement('div');
    textEl.className = 'gf-text';
    const parts = line.text.split('___');
    let blankCount = 0;
    parts.forEach((part, pi) => {
      textEl.appendChild(document.createTextNode(part));
      if (pi < parts.length - 1) {
        const ansIdx = blankCount++;
        const drop = document.createElement('span');
        drop.className = 'gf-drop';
        drop.dataset.bid = `blank-${blankId++}`;
        drop.dataset.li = li;
        drop.dataset.ai = ansIdx;
        drop.dataset.empty = '1';
        drop.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
        drop.addEventListener('click', () => {
          if (drop.dataset.checked) return;
          if (drop.dataset.empty === '0') {
            const chip = document.querySelector(`.hint-chip[data-cid="${drop.dataset.cid}"]`);
            if (chip) chip.classList.remove('used','selected');
            clearDrop(drop);
          } else if (gfSelectedChip) {
            const prev = document.querySelector(`.gf-drop[data-cid="${gfSelectedChip.dataset.cid}"]`);
            if (prev) clearDrop(prev);
            fillDrop(drop, gfSelectedChip);
          }
        });
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
        drop.addEventListener('drop', e => {
          e.preventDefault();
          drop.classList.remove('drag-over');
          if (drop.dataset.checked) return;
          const cid = e.dataTransfer.getData('text/plain');
          const chip = document.querySelector(`.hint-chip[data-cid="${cid}"]`) || gfDraggingChip;
          if (!chip) return;
          const prev = document.querySelector(`.gf-drop[data-cid="${chip.dataset.cid}"]`);
          if (prev && prev !== drop) clearDrop(prev);
          if (drop.dataset.empty === '0') {
            const old = document.querySelector(`.hint-chip[data-cid="${drop.dataset.cid}"]`);
            if (old) old.classList.remove('used','selected');
          }
          fillDrop(drop, chip);
        });
        textEl.appendChild(drop);
      }
    });
    const trans = document.createElement('span');
    trans.className = 'gf-translate';
    trans.textContent = line.eng;
    textEl.appendChild(trans);
    row.innerHTML = `<div class="gf-speaker">${line.speaker}</div>`;
    row.appendChild(textEl);
    dlg.appendChild(row);
  });
}

function fillDrop(drop, chip) {
  drop.dataset.empty = '0';
  drop.dataset.cid = chip.dataset.cid;
  drop.dataset.value = chip.dataset.word;
  drop.classList.add('filled');
  drop.innerHTML = '';
  const wordSpan = document.createElement('span');
  wordSpan.textContent = chip.dataset.word;
  const x = document.createElement('span');
  x.className = 'clear-x';
  x.textContent = ' ✕';
  drop.appendChild(wordSpan);
  drop.appendChild(x);
  chip.classList.add('used');
  chip.classList.remove('selected');
  if (gfSelectedChip === chip) gfSelectedChip = null;
}

function clearDrop(drop) {
  drop.dataset.empty = '1';
  delete drop.dataset.cid;
  delete drop.dataset.value;
  drop.classList.remove('filled','correct-ans','wrong-ans','selected-blank');
  drop.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
}

function checkGapFill() {
  const ex = gfExercises[gfCurrentIdx % gfExercises.length];
  let correct = 0, total = 0;
  ex.lines.forEach((line, li) => {
    if (!line.answers || line.answers.length === 0) return;
    const drops = document.querySelectorAll(`.gf-drop[data-li="${li}"]`);
    drops.forEach((drop, di) => {
      const correctAns = (line.answers[di] || '').trim().toLowerCase();
      if (!correctAns) return;
      total++;
      drop.dataset.checked = '1';
      const val = (drop.dataset.value || '').trim().toLowerCase();
      if (val === correctAns) {
        drop.classList.remove('filled');
        drop.classList.add('correct-ans');
        const w = document.createElement('span');
        w.textContent = line.answers[di];
        drop.innerHTML = '';
        drop.appendChild(w);
        correct++;
      } else {
        drop.classList.remove('filled');
        drop.classList.add('wrong-ans');
        drop.style.minWidth = '110px';
        drop.innerHTML = '';
        if (val) {
          const s = document.createElement('span');
          s.style.cssText = 'text-decoration:line-through;opacity:.5;';
          s.textContent = drop.dataset.value;
          drop.appendChild(s);
          drop.appendChild(document.createTextNode(' → '));
        }
        const b = document.createElement('strong');
        b.textContent = line.answers[di];
        drop.appendChild(b);
      }
    });
  });
  document.querySelectorAll('.hint-chip').forEach(c => c.style.pointerEvents = 'none');
  const isGood = total > 0 && correct >= Math.ceil(total * 0.7);
  addXP(isGood ? (diff === 'easy' ? 12 : 20) : 3);
  updateStreak(isGood);
  showToast(isGood ? `✓ ${correct}/${total} correct! +XP` : `${correct}/${total} — check the red blanks`);
}

function nextGapFill() {
  gfCurrentIdx++;
  renderGapFill();
}

// ════════════════════
// ── LISTENING ──
// ════════════════════
const LISTEN_POOL = [
  // Easy: pick the meaning
  {viet:"Xin chào", eng:"Hello", options:["Hello","Goodbye","Thank you","Sorry"], answer:"Hello", diff:'easy', type:'meaning'},
  {viet:"Cảm ơn", eng:"Thank you", options:["You're welcome","Sorry","Thank you","Excuse me"], answer:"Thank you", diff:'easy', type:'meaning'},
  {viet:"Bao nhiêu tiền?", eng:"How much?", options:["Where is it?","How much?","When?","Who is it?"], answer:"How much?", diff:'easy', type:'meaning'},
  {viet:"Kẹt xe quá", eng:"The traffic is terrible", options:["I'm lost","The food is good","The traffic is terrible","It's too expensive"], answer:"The traffic is terrible", diff:'easy', type:'meaning'},
  {viet:"Ngon lắm", eng:"Really delicious", options:["Very expensive","Really delicious","Very beautiful","Too spicy"], answer:"Really delicious", diff:'easy', type:'meaning'},
  {viet:"Dừng đây", eng:"Stop here", options:["Go faster","Turn right","Stop here","Go straight"], answer:"Stop here", diff:'easy', type:'meaning'},
  {viet:"Không có thịt bò", eng:"No beef", options:["No chicken","No beef","No pork","No fish"], answer:"No beef", diff:'easy', type:'meaning'},
  {viet:"Mắc vậy trời", eng:"Wow so expensive!", options:["So delicious!","Wow so expensive!","That's great!","Too spicy!"], answer:"Wow so expensive!", diff:'easy', type:'meaning'},

  // Medium: type what you hear
  {viet:"Cho tôi xem thực đơn", eng:"Can I see the menu?", diff:'medium', type:'type'},
  {viet:"Bớt cay được không?", eng:"Can you make it less spicy?", diff:'medium', type:'type'},
  {viet:"Thanh toán bằng thẻ được không?", eng:"Can I pay by card?", diff:'medium', type:'type'},
  {viet:"Đi thẳng rồi quẹo phải", eng:"Go straight then turn right", diff:'medium', type:'type'},
  {viet:"Coi bộ được đó", eng:"Looks pretty good", diff:'medium', type:'type'},
  {viet:"Hổng có", eng:"Don't have any", diff:'medium', type:'type'},
  {viet:"Thôi được rồi", eng:"Alright, fine", diff:'medium', type:'type'},
  {viet:"Cho tôi mật khẩu wifi", eng:"Give me the wifi password", diff:'medium', type:'type'},

  // Hard: respond appropriately
  {viet:"Bạn muốn ăn gì?", eng:"What would you like to eat?", expected:"Cho tôi xem thực đơn / Không có thịt bò", diff:'hard', type:'respond'},
  {viet:"Bạn đi đâu?", eng:"Where are you going?", expected:"Cho tôi đến Quận 1 / tên địa điểm", diff:'hard', type:'respond'},
  {viet:"Bao nhiêu?", eng:"How much?", expected:"Negotiate: Mắc quá! / Rẻ hơn được không?", diff:'hard', type:'respond'},
  {viet:"Anh tập bao lâu rồi?", eng:"How long have you been training?", expected:"Tôi tập [số] năm rồi", diff:'hard', type:'respond'},
  {viet:"Phòng tập thế nào?", eng:"What do you think of the gym?", expected:"Coi bộ được đó! / Đẹp lắm!", diff:'hard', type:'respond'},
  {viet:"Uống ở đây hay mang về?", eng:"Dine in or takeaway?", expected:"Uống ở đây / Mang về", diff:'hard', type:'respond'},
];

let listenPool = [];
let listenIdx = 0;
let listenPlaying = false;

function loadListen() {
  const filtered = LISTEN_POOL.filter(q => {
    if (diff === 'easy') return q.diff === 'easy';
    if (diff === 'medium') return q.diff !== 'hard';
    return true;
  });
  listenPool = [...filtered].sort(() => Math.random() - 0.5);
  listenIdx = 0;
  renderListen();
}

function renderListen() {
  const el = document.getElementById('listenView');
  if (!el) return;
  el.innerHTML = '';
  const q = listenPool[listenIdx % listenPool.length];

  const counter = document.createElement('div');
  counter.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--terracotta);margin-bottom:16px;';
  counter.textContent = `${(listenIdx % listenPool.length) + 1} / ${listenPool.length} · ${q.type === 'meaning' ? 'What does it mean?' : q.type === 'type' ? 'Type what you hear' : 'How would you respond?'}`;
  el.appendChild(counter);

  // Play button
  const playBtn = document.createElement('button');
  playBtn.className = 'listen-play-btn';
  playBtn.innerHTML = '▶ Play';
  playBtn.onclick = () => speakVietnamese_listen(q.viet, playBtn);
  el.appendChild(playBtn);

  // Hint (English meaning shown after playing)
  const hintEl = document.createElement('div');
  hintEl.className = 'listen-hint';
  hintEl.style.display = 'none';
  hintEl.textContent = `"${q.eng}"`;
  el.appendChild(hintEl);

  // Show hint after 3 seconds of playing
  playBtn.addEventListener('click', () => {
    setTimeout(() => { hintEl.style.display = 'block'; }, 3000);
  }, {once: true});

  if (q.type === 'meaning') {
    // Multiple choice
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px;';
    q.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'listen-choice-btn';
      btn.textContent = opt;
      btn.onclick = () => checkListenChoice(opt, q.answer, grid, el);
      grid.appendChild(btn);
    });
    el.appendChild(grid);

  } else if (q.type === 'type') {
    // Type input
    const label = document.createElement('div');
    label.style.cssText = 'font-size:13px;color:var(--muted);margin-top:20px;margin-bottom:8px;';
    label.textContent = 'Type the Vietnamese you heard:';
    el.appendChild(label);
    const inp = document.createElement('input');
    inp.className = 'chat-input';
    inp.style.cssText = 'width:100%;margin-bottom:12px;';
    inp.placeholder = 'Type in Vietnamese…';
    inp.setAttribute('lang', 'vi');
    el.appendChild(inp);
    const checkBtn = document.createElement('button');
    checkBtn.className = 'btn btn-primary';
    checkBtn.textContent = 'Check';
    checkBtn.onclick = () => checkListenType(inp.value, q.viet, el);
    inp.onkeydown = e => { if (e.key === 'Enter') checkBtn.click(); };
    el.appendChild(checkBtn);

  } else {
    // Respond appropriately
    const label = document.createElement('div');
    label.style.cssText = 'font-size:13px;color:var(--muted);margin-top:20px;margin-bottom:8px;';
    label.textContent = 'How would you respond in Vietnamese?';
    el.appendChild(label);
    const inp = document.createElement('input');
    inp.className = 'chat-input';
    inp.style.cssText = 'width:100%;margin-bottom:12px;';
    inp.placeholder = 'Type your response…';
    el.appendChild(inp);
    const checkBtn = document.createElement('button');
    checkBtn.className = 'btn btn-primary';
    checkBtn.textContent = 'Check';
    checkBtn.onclick = () => checkListenRespond(inp.value, q.expected, el);
    inp.onkeydown = e => { if (e.key === 'Enter') checkBtn.click(); };
    el.appendChild(checkBtn);
  }
}

function speakVietnamese_listen(text, btn) {
  if (!window.speechSynthesis) { showToast('Audio not supported'); return; }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'vi-VN';
  utt.rate = 0.8;
  const voices = window.speechSynthesis.getVoices();
  const viVoice = voices.find(v => v.lang.startsWith('vi'));
  if (viVoice) utt.voice = viVoice;
  utt.onstart = () => { btn.innerHTML = '♪ Playing…'; btn.disabled = true; };
  utt.onend = () => { btn.innerHTML = '▶ Play again'; btn.disabled = false; };
  utt.onerror = () => { btn.innerHTML = '▶ Play'; btn.disabled = false; };
  window.speechSynthesis.speak(utt);
}

function checkListenChoice(chosen, answer, grid, container) {
  const correct = chosen === answer;
  grid.querySelectorAll('.listen-choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.textContent === answer) btn.classList.add('choice-correct');
    else if (btn.textContent === chosen && !correct) btn.classList.add('choice-wrong');
  });
  addXP(correct ? 10 : 0);
  updateStreak(correct);
  appendListenNext(container, correct);
}

function checkListenType(val, correct, container) {
  const norm = s => s.trim().toLowerCase().replace(/[?!.,]/g,'');
  const isCorrect = norm(val) === norm(correct);
  const fb = document.createElement('div');
  fb.className = 'sb-feedback ' + (isCorrect ? 'correct' : 'incorrect');
  fb.style.marginTop = '12px';
  fb.textContent = isCorrect ? `✓ Correct! "${correct}"` : `✗ It was: "${correct}"`;
  container.appendChild(fb);
  addXP(isCorrect ? 15 : 0);
  updateStreak(isCorrect);
  appendListenNext(container, isCorrect);
}

function checkListenRespond(val, expected, container) {
  const fb = document.createElement('div');
  fb.className = 'sb-feedback correct';
  fb.style.marginTop = '12px';
  fb.textContent = `✓ Good try! Suggested: "${expected}"`;
  container.appendChild(fb);
  addXP(10);
  updateStreak(true);
  appendListenNext(container, true);
}

function appendListenNext(container, correct) {
  showToast(correct ? '✓ Correct! +XP' : '✗ Keep practising');
  const row = document.createElement('div');
  row.className = 'btn-row';
  row.style.marginTop = '16px';
  const next = document.createElement('button');
  next.className = 'btn btn-primary';
  next.textContent = 'Next →';
  next.onclick = () => { listenIdx++; renderListen(); };
  row.appendChild(next);
  container.appendChild(row);
}

// ════════════════════
// ── TEACHER PREP ──
// ════════════════════
const LAST_LESSON = `Today we learned: thịt heo (pork), cá (fish), trứng (egg), rau (vegetable), cơm vs gạo (cooked vs raw rice), sữa (milk), bánh mì (bread), quả táo (apple), quả cam (orange), quả chuối (banana), cháo (porridge), cháo vịt (duck congee). Grammar: sẽ (future marker), và (and), hay (or), có lẽ (maybe). Questions: có...không, còn...không. Market: chợ, siêu thị. Measurements: ký, nửa ký. Phrase: cho em (give me).`;

function loadLastLesson() {
  const el = document.getElementById('tpInput');
  if (el) el.value = LAST_LESSON;
}

function generateExercises() {
  const input = document.getElementById('tpInput');
  if (!input || !input.value.trim()) { showToast('Please paste your lesson notes first'); return; }
  const exercises = [
    {type:"Grammar drill", q:`Use "sẽ" to say: "I will eat duck congee tomorrow"`, hint:`Formula: Subject + sẽ + verb + object`, answer:`Ngày mai tôi sẽ ăn cháo vịt`},
    {type:"Yes/No question", q:`Ask "Do you still have duck congee?" using còn...không`, hint:`còn + [item] + không?`, answer:`Còn cháo vịt không?`},
    {type:"Market roleplay", q:`At the wet market: ask for half a kilo of fresh fish, react to price, negotiate`, hint:`Cho tôi nửa ký cá tươi → Mắc quá! → Rẻ hơn được không?`, answer:`Cho tôi nửa ký cá tươi → Mắc vậy trời! → Rẻ hơn được không?`},
    {type:"Difference check", q:`What is the difference between "cơm" and "gạo"? Use both in a sentence`, hint:`One is cooked, one is raw`, answer:`Cơm = cooked (on plate). Gạo = raw (at market). Tôi mua gạo để nấu cơm.`},
    {type:"Connector drill", q:`Combine using "và" or "hay": cơm / bánh mì / rau`, hint:`Try: Bạn muốn cơm hay bánh mì? Or: Tôi muốn cơm và rau`, answer:`Bạn muốn cơm hay bánh mì? / Tôi muốn cơm và rau`},
    {type:"Translate to Vietnamese", q:`How do you say "Give me half a kilogram" in Vietnamese?`, hint:`Use cho tôi + measurement`, answer:`Cho tôi nửa ký`},
    {type:"Pronunciation", q:`Write the phonetic pronunciation of "cháo vịt"`, hint:`Break syllable by syllable`, answer:`chow yit`},
    {type:"Sentence build", q:`Build a full sentence ordering food without beef at a restaurant`, hint:`Start with Cho tôi xem thực đơn, then Không có thịt bò`, answer:`Cho tôi xem thực đơn. Tôi không ăn thịt bò.`},
    {type:"Fill in the blank", q:`"Tôi muốn ăn ___ ___ hôm nay." (duck congee today)`, hint:`Food + time marker`, answer:`cháo vịt / hôm nay`},
    {type:"Role-play prompt", q:`You are at the market. The vendor says "Mua gì không?" — how do you respond and ask the price?`, hint:`Cho tôi xem + item, then Bao nhiêu tiền?`, answer:`Cho tôi xem cá. Bao nhiêu tiền một ký?`},
  ];

  const list = document.getElementById('exerciseList');
  if (!list) return;
  list.innerHTML = '';
  exercises.forEach((ex, i) => {
    const el = document.createElement('div');
    el.className = 'exercise-item';
    const typeEl = document.createElement('div');
    typeEl.className = 'ex-type';
    typeEl.textContent = String(i+1).padStart(2,'0') + ' · ' + ex.type;
    const qEl = document.createElement('div');
    qEl.className = 'ex-q';
    qEl.textContent = ex.q;
    el.appendChild(typeEl);
    el.appendChild(qEl);
    if (ex.hint) {
      const hEl = document.createElement('div');
      hEl.className = 'ex-hint';
      hEl.textContent = '💡 ' + ex.hint;
      el.appendChild(hEl);
    }
    const ansEl = document.createElement('div');
    ansEl.className = 'ex-answer';
    ansEl.id = `ans-${i}`;
    ansEl.textContent = '✓ ' + ex.answer;
    ansEl.style.display = 'none';
    const showBtn = document.createElement('button');
    showBtn.className = 'show-answer-btn';
    showBtn.textContent = 'Show answer';
    showBtn.onclick = () => {
      const show = ansEl.style.display === 'none';
      ansEl.style.display = show ? 'block' : 'none';
      showBtn.textContent = show ? 'Hide answer' : 'Show answer';
    };
    el.appendChild(ansEl);
    el.appendChild(showBtn);
    list.appendChild(el);
  });
  showToast('10 exercises generated ✓');
}

// ── OVERRIDES (save progress on XP/streak change) ──
const _addXPOrig = addXP;
addXP = function(n) {
  _addXPOrig(n);
  if (n > 0) scheduleSave();
};

const _updateStreakOrig = updateStreak;
updateStreak = function(correct) {
  _updateStreakOrig(correct);
  scheduleSave();
};

setInterval(() => { if (currentUser) saveProgressToDB(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentUser) saveProgressToDB();
});
