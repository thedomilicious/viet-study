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

function showAuthScreen() {
  currentUser = null;
  isAdmin = false;
  const adminTab = document.getElementById('adminNavTab');
  if (adminTab) adminTab.style.display = 'none';
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
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appNav').style.display = 'block';
    document.getElementById('navUserEmail').textContent = session.user.email;
    await loadCardsFromDB();
    await loadProgressFromDB();
    await showAdminTabIfEligible();
    initApp();
  }
});

async function showAdminTabIfEligible() {
  const { data } = await sb.from('admins').select('user_id').eq('user_id', currentUser.id).single();
  const adminTab = document.getElementById('adminNavTab');
  if (adminTab) adminTab.style.display = data ? '' : 'none';
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
  const { data } = await sb.from('progress').select('*').eq('user_id', currentUser.id).single();
  if (!data) return;
  if (data.xp) { xp = data.xp; addXP(0); }
  if (data.streak) { streak = data.streak; document.getElementById('streakBadge').textContent = '🔥 ' + streak + ' streak'; }
  if (data.mastered) {
    data.mastered.split(',').filter(Boolean).forEach(v => masteredSet.add(v));
    updateStats();
  }
}

async function saveProgressToDB() {
  if (!currentUser) return;
  const payload = {
    user_id: currentUser.id,
    xp: xp,
    streak: streak,
    mastered: [...masteredSet].join(',')
  };
  await sb.from('progress').upsert(payload, { onConflict: 'user_id' });
}

/* ── VIEW SWITCHER ── */
function switchView(view) {
  document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.app-nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.app-nav-tab').forEach((t, i) => {
    if (['flashcards','practice','admin'][i] === view) t.classList.add('active');
  });
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
  const key = card.viet;
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
    const isMastered = masteredSet.has(card.viet);
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
let sbIndex = 0, gfIndex = 0;
let selectedScenario = null;
let chatState = null;

const LEVELS = [
  {min:0,   label:'1 · Beginner'},
  {min:50,  label:'2 · Learner'},
  {min:120, label:'3 · Conversational'},
  {min:250, label:'4 · Confident'},
  {min:450, label:'5 · Fluent'},
];

function getLevel(x) {
  for (let i = LEVELS.length-1; i >= 0; i--) if (x >= LEVELS[i].min) return LEVELS[i];
  return LEVELS[0];
}

function addXP(n) {
  xp += n;
  const next = LEVELS.find(l => l.min > xp);
  const prev = getLevel(xp);
  const maxXP = next ? next.min : prev.min + 100;
  const pct = Math.min(100, ((xp - prev.min) / (maxXP - prev.min)) * 100);
  document.getElementById('xpFill').style.width = pct + '%';
  document.getElementById('xpLevel').textContent = prev.label;
}

function updateStreak(correct) {
  if (correct) {
    streak++; consecutiveCorrect++; consecutiveWrong = 0;
    if (consecutiveCorrect >= 3) { setDiff(diff === 'easy' ? 'medium' : 'hard'); consecutiveCorrect = 0; showToast('Getting harder! 🔥'); }
  } else {
    consecutiveWrong++; consecutiveCorrect = 0;
    if (consecutiveWrong >= 2) { setDiff(diff === 'hard' ? 'medium' : 'easy'); consecutiveWrong = 0; showToast('Stepping back a level 📚'); }
    streak = 0;
  }
  document.getElementById('streakBadge').textContent = `🔥 ${streak} streak`;
}

function setMode(m) {
  currentMode = m;
  document.querySelectorAll('.mode-tab').forEach((t,i) => t.classList.toggle('active', ['scenario','sentence','gapfill','teacherprep'][i] === m));
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + m).classList.add('active');
  if (m === 'sentence') loadSentence();
  if (m === 'gapfill') loadGapFill();
}

function setDiff(d) {
  diff = d;
  ['easy','medium','hard'].forEach(x => {
    const btn = document.getElementById('diff-' + x);
    btn.classList.toggle('active-diff', x === d);
  });
}


// ════════════════════════════════
// ── SCENARIOS ──
// ════════════════════════════════
const SCENARIOS = [
  {
    id:'restaurant', icon:'🍜', name:'Restaurant', desc:'Order food, ask about ingredients',
    npc:'Nhân viên (Staff)', npcEng:'Restaurant staff',
    easy:[
      {npc:"Xin chào! Bạn muốn gì?", npcEng:"Hello! What would you like?", expect:"Cho tôi xem thực đơn", expectEng:"Can I see the menu?", hint:"Ask to see the menu", suggestions:["Cho tôi xem thực đơn","Xin chào!","Cảm ơn"]},
      {npc:"Đây là thực đơn. Bạn muốn ăn gì?", npcEng:"Here is the menu. What would you like to eat?", expect:"Không có thịt bò", expectEng:"No beef please", hint:"Tell them no beef", suggestions:["Không có thịt bò","Cho tôi cơm","Tôi muốn cá"]},
      {npc:"Được, bạn muốn uống gì?", npcEng:"Sure, what would you like to drink?", expect:"Cho tôi một ly nước", expectEng:"Give me a glass of water", hint:"Order water", suggestions:["Cho tôi một ly nước","Tôi muốn uống sữa","Không cảm ơn"]},
      {npc:"Thức ăn ngon không?", npcEng:"Is the food good?", expect:"Ngon lắm! Cảm ơn", expectEng:"Really delicious! Thank you", hint:"Compliment the food", suggestions:["Ngon lắm! Cảm ơn","Ngon quá!","Không ngon lắm"]},
      {npc:"Bạn cần gì thêm không?", npcEng:"Do you need anything else?", expect:"Tính tiền", expectEng:"Bill please", hint:"Ask for the bill", suggestions:["Tính tiền","Không, cảm ơn","Cho tôi thêm nước"]},
    ],
    medium:[
      {npc:"Chào anh! Hôm nay anh muốn ăn gì?", npcEng:"Hello! What would you like today?", expect:"Cho tôi xem thực đơn. Tôi không ăn thịt bò", expectEng:"Can I see the menu? I don't eat beef", hint:"Ask for menu + mention no beef together", suggestions:["Cho tôi xem thực đơn. Tôi không ăn thịt bò","Có cháo vịt không?","Tôi muốn ăn cá"]},
      {npc:"Dạ, có. Anh muốn cháo vịt hay cơm?", npcEng:"Yes we do. Would you like duck congee or rice?", expect:"Cháo vịt, không bỏ ngò", expectEng:"Duck congee, no coriander", hint:"Order + no coriander", suggestions:["Cháo vịt, không bỏ ngò","Cho tôi cơm","Tôi muốn cháo vịt"]},
      {npc:"Cay không anh?", npcEng:"Spicy?", expect:"Bớt cay được không?", expectEng:"Can you make it less spicy?", hint:"Ask for less spice", suggestions:["Bớt cay được không?","Cay quá","Không cay"]},
      {npc:"Dạ được. Uống gì không anh?", npcEng:"Sure. Anything to drink?", expect:"Cho tôi một ly nước lọc", expectEng:"Give me a glass of still water", hint:"Order still water", suggestions:["Cho tôi một ly nước lọc","Không cảm ơn","Một ly trà"]},
      {npc:"Anh dùng bữa ngon không?", npcEng:"Did you enjoy your meal?", expect:"Ngon lắm! Tính tiền cho tôi", expectEng:"Very delicious! Bill please", hint:"Compliment + ask for bill", suggestions:["Ngon lắm! Tính tiền cho tôi","Ngon quá! Cảm ơn","Bao nhiêu tiền?"]},
    ],
  },
  {
    id:'grab', icon:'🛵', name:'Grab / Taxi', desc:'Directions, stops, small talk',
    npc:'Tài xế (Driver)', npcEng:'Grab / taxi driver',
    easy:[
      {npc:"Chào! Bạn đi đâu?", npcEng:"Hello! Where are you going?", expect:"Tôi muốn đi Quận 1", expectEng:"I want to go to District 1", hint:"Tell the driver your destination", suggestions:["Tôi muốn đi Quận 1","Cho tôi đến chợ Bến Thành","Tôi đi trung tâm"]},
      {npc:"Kẹt xe quá hôm nay!", npcEng:"The traffic is terrible today!", expect:"Kẹt xe quá!", expectEng:"The traffic is terrible!", hint:"Agree about the traffic", suggestions:["Kẹt xe quá!","Vâng, kẹt xe","Thôi được rồi"]},
      {npc:"Bạn ở đâu đến?", npcEng:"Where are you from?", expect:"Tôi đến từ Singapore", expectEng:"I'm from Singapore", hint:"Tell them where you're from", suggestions:["Tôi đến từ Singapore","Tôi là người Singapore","Tôi đến từ nước ngoài"]},
      {npc:"Bạn ở Việt Nam lâu chưa?", npcEng:"Have you been in Vietnam long?", expect:"Tôi mới đến", expectEng:"I just arrived", hint:"Say you just arrived", suggestions:["Tôi mới đến","Tôi ở đây một tuần","Tôi ở đây lâu rồi"]},
      {npc:"Đây rồi! Đến nơi rồi.", npcEng:"Here we are! We've arrived.", expect:"Cảm ơn anh nhiều!", expectEng:"Thank you so much!", hint:"Thank the driver", suggestions:["Cảm ơn anh nhiều!","Cảm ơn","Bao nhiêu tiền?"]},
    ],
    medium:[
      {npc:"Anh đi đâu vậy?", npcEng:"Where are you headed?", expect:"Cho tôi đến đường Lê Lợi, Quận 1", expectEng:"Take me to Le Loi street, District 1", hint:"Give street + district", suggestions:["Cho tôi đến đường Lê Lợi, Quận 1","Tôi muốn đến siêu thị","Cho tôi đến chợ Bến Thành"]},
      {npc:"Anh muốn đi đường nào? Có kẹt xe đó.", npcEng:"Which route do you want? There's traffic.", expect:"Đi đường nào nhanh hơn?", expectEng:"Which road is faster?", hint:"Ask which route is faster", suggestions:["Đi đường nào nhanh hơn?","Thôi được rồi, anh chọn đi","Đi thẳng đi"]},
      {npc:"Tôi sẽ đi đường vòng cho nhanh.", npcEng:"I'll take the bypass to go faster.", expect:"Được, cảm ơn anh", expectEng:"OK, thank you", hint:"Agree politely", suggestions:["Được, cảm ơn anh","Thôi được rồi","Nhanh không?"]},
      {npc:"Gần đến rồi. Dừng ở đâu anh?", npcEng:"Almost there. Where do you want to stop?", expect:"Dừng đây được không?", expectEng:"Can you stop here?", hint:"Ask to stop here", suggestions:["Dừng đây được không?","Đi thẳng thêm một chút","Dừng trước cổng đó"]},
      {npc:"Anh có tiền lẻ không? Tôi không có tiền thối.", npcEng:"Do you have small bills? I don't have change.", expect:"Tiền lẻ không?", expectEng:"Do you have change?", hint:"Ask about change", suggestions:["Thanh toán bằng thẻ được không?","Tôi có tiền lẻ","Không sao, để tôi xem"]},
    ],
  },
  {
    id:'market', icon:'🛒', name:'Wet Market', desc:'Buy produce, negotiate prices',
    npc:'Người bán (Vendor)', npcEng:'Market vendor',
    easy:[
      {npc:"Mua gì không em?", npcEng:"What would you like to buy?", expect:"Cho tôi xem rau", expectEng:"Let me look at the vegetables", hint:"Ask to look at vegetables", suggestions:["Cho tôi xem rau","Bao nhiêu tiền?","Tôi muốn mua cá"]},
      {npc:"Rau tươi lắm! Bao nhiêu muốn mua?", npcEng:"Very fresh vegetables! How much do you want?", expect:"Một ký", expectEng:"One kilogram", hint:"Ask for 1 kilo", suggestions:["Một ký","Nửa ký","Hai ký"]},
      {npc:"Năm mươi ngàn một ký.", npcEng:"50,000 dong per kilogram.", expect:"Đắt quá!", expectEng:"Too expensive!", hint:"Exclaim it's expensive", suggestions:["Đắt quá!","Mắc vậy trời!","Rẻ hơn được không?"]},
      {npc:"Thôi được, bốn mươi ngàn cho em.", npcEng:"OK, 40,000 for you.", expect:"Được, cảm ơn chị", expectEng:"OK, thank you", hint:"Agree and thank them", suggestions:["Được, cảm ơn chị","Cảm ơn","Rẻ hơn nữa không?"]},
      {npc:"Còn muốn mua gì nữa không?", npcEng:"Do you want to buy anything else?", expect:"Còn chuối không?", expectEng:"Do you still have bananas?", hint:"Ask if they have bananas", suggestions:["Còn chuối không?","Không, cảm ơn","Cho tôi thêm cà chua"]},
    ],
    medium:[
      {npc:"Em ơi! Mua gì đây?", npcEng:"Hey! What are you buying?", expect:"Cho tôi nửa ký cá tươi", expectEng:"Give me half a kilo of fresh fish", hint:"Order half kilo of fresh fish", suggestions:["Cho tôi nửa ký cá tươi","Cá hôm nay tươi không?","Bao nhiêu tiền một ký?"]},
      {npc:"Cá tươi lắm! Bắt sáng nay đó. Bao nhiêu?", npcEng:"Very fresh! Caught this morning. How much?", expect:"Bao nhiêu một ký?", expectEng:"How much per kilogram?", hint:"Ask price per kilo", suggestions:["Bao nhiêu một ký?","Đắt không?","Cho tôi xem"]},
      {npc:"Tám mươi ngàn một ký.", npcEng:"80,000 dong per kilo.", expect:"Mắc vậy trời! Rẻ hơn được không?", expectEng:"Wow so expensive! Can it be cheaper?", hint:"React to price + negotiate", suggestions:["Mắc vậy trời! Rẻ hơn được không?","Đắt quá!","Bảy mươi ngàn được không?"]},
      {npc:"Thôi bảy mươi ngàn cho em, lấy đi.", npcEng:"OK 70,000 for you, take it.", expect:"Coi bộ được đó. Cho tôi một ký", expectEng:"Looks good. Give me one kilo", hint:"Accept the deal + order", suggestions:["Coi bộ được đó. Cho tôi một ký","Được rồi, cảm ơn","Cho tôi nửa ký thôi"]},
      {npc:"Còn cần gì nữa không em?", npcEng:"Do you need anything else?", expect:"Còn trứng không?", expectEng:"Do you still have eggs?", hint:"Ask about eggs", suggestions:["Còn trứng không?","Hổng có gì nữa, cảm ơn","Cho tôi thêm rau"]},
    ],
  },
  {
    id:'gym', icon:'💪', name:'Gym / Business', desc:'Talk to staff, potential members',
    npc:'Nhân viên Gym', npcEng:'Gym staff / member',
    easy:[
      {npc:"Chào anh! Anh muốn tập gì?", npcEng:"Hello! What would you like to train?", expect:"Tôi muốn đăng ký tập", expectEng:"I want to sign up to train", hint:"Express interest in signing up", suggestions:["Tôi muốn đăng ký tập","Cho tôi xem phòng tập","Phòng tập ở đâu?"]},
      {npc:"Dạ, anh đã tập bao lâu rồi?", npcEng:"How long have you been training?", expect:"Tôi tập ba năm rồi", expectEng:"I've been training for 3 years", hint:"Say how long you've trained", suggestions:["Tôi tập ba năm rồi","Tôi mới tập","Tôi tập lâu rồi"]},
      {npc:"Anh thích tập gì? Cardio hay tạ?", npcEng:"What do you like to train? Cardio or weights?", expect:"Tôi thích tập tạ", expectEng:"I like weight training", hint:"Say you prefer weights", suggestions:["Tôi thích tập tạ","Tôi thích cardio","Tôi thích cả hai"]},
      {npc:"Anh có thể xem phòng tập không?", npcEng:"Would you like to see the gym?", expect:"Được, cảm ơn", expectEng:"Sure, thank you", hint:"Agree to the tour", suggestions:["Được, cảm ơn","Vâng, tôi muốn xem","Thôi được rồi"]},
      {npc:"Phòng tập thế nào ạ?", npcEng:"What do you think of the gym?", expect:"Coi bộ được đó!", expectEng:"Looks pretty good!", hint:"Give a positive Southern reaction", suggestions:["Coi bộ được đó!","Tốt lắm!","Đẹp quá!"]},
    ],
    medium:[
      {npc:"Chào anh! Anh là khách mới hay đã là thành viên?", npcEng:"Hello! Are you new or already a member?", expect:"Tôi là khách mới. Tôi muốn đăng ký tập", expectEng:"I'm a new customer. I want to sign up", hint:"Identify yourself + intent", suggestions:["Tôi là khách mới. Tôi muốn đăng ký tập","Tôi muốn xem phòng tập trước","Có gói tháng không?"]},
      {npc:"Dạ, chúng tôi có gói tháng và gói năm. Anh muốn biết thêm không?", npcEng:"We have monthly and yearly packages. Would you like more info?", expect:"Bao nhiêu tiền một tháng?", expectEng:"How much per month?", hint:"Ask the monthly price", suggestions:["Bao nhiêu tiền một tháng?","Anh có thể giảm giá không?","Có thể xem thêm không?"]},
      {npc:"Gói tháng là hai triệu đồng.", npcEng:"Monthly package is 2 million dong.", expect:"Anh có thể giảm giá không?", expectEng:"Can you lower the price?", hint:"Negotiate the price", suggestions:["Anh có thể giảm giá không?","Mắc quá!","Để tôi suy nghĩ thêm"]},
      {npc:"Anh là người nước ngoài nên chúng tôi có thể giảm mười phần trăm.", npcEng:"Since you're a foreigner, we can give 10% off.", expect:"Được, cho tôi đăng ký", expectEng:"OK, let me sign up", hint:"Accept the offer", suggestions:["Được, cho tôi đăng ký","Cảm ơn, được rồi","Để tôi suy nghĩ thêm"]},
      {npc:"Lịch tập của anh thế nào? Anh tập mấy ngày?", npcEng:"What's your training schedule? How many days?", expect:"Tôi tập bốn ngày một tuần", expectEng:"I train four days a week", hint:"Say your training frequency", suggestions:["Tôi tập bốn ngày một tuần","Tôi tập mỗi ngày","Tôi tập cuối tuần"]},
    ],
  },
];

let selectedScenarioObj = null;
let currentScenarioSteps = [];
let chatStepIndex = 0;

function buildScenarioPicker() {
  const el = document.getElementById('scenarioPicker');
  el.innerHTML = '';
  SCENARIOS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'scenario-card' + (i === 0 ? ' selected' : '');
    d.innerHTML = `<div class="sc-icon">${s.icon}</div><div class="sc-name">${s.name}</div><div class="sc-desc">${s.desc}</div>`;
    d.onclick = () => { document.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('selected')); d.classList.add('selected'); selectedScenarioObj = s; };
    el.appendChild(d);
  });
  selectedScenarioObj = SCENARIOS[0];
}

function startScenario() {
  if (!selectedScenarioObj) return;
  const steps = diff === 'hard' ? (selectedScenarioObj.medium || selectedScenarioObj.easy) : selectedScenarioObj[diff] || selectedScenarioObj.easy;
  currentScenarioSteps = steps;
  chatStepIndex = 0;
  document.getElementById('chatScenarioTitle').textContent = selectedScenarioObj.icon + ' ' + selectedScenarioObj.name;
  document.getElementById('chatScenarioDesc').textContent = 'Playing as: ' + selectedScenarioObj.npcEng;
  document.getElementById('scenario-picker-view').style.display = 'none';
  document.getElementById('scenario-chat-view').style.display = 'block';
  document.getElementById('chatBox').innerHTML = '';
  updateChatProgress();
  addBubble('them', steps[0].npc, steps[0].npcEng);
  showSuggestions(steps[0].suggestions);
}

function updateChatProgress() {
  document.getElementById('chatProgress').textContent = `${chatStepIndex + 1} / ${currentScenarioSteps.length}`;
}

function addBubble(type, text, subtext) {
  const box = document.getElementById('chatBox');
  const b = document.createElement('div');
  b.className = 'bubble ' + type;
  b.innerHTML = text + (subtext ? `<div class="viet-hint">${subtext}</div>` : '');
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
  const isCorrect = val.toLowerCase().includes(step.expect.toLowerCase().split(' ')[0]) ||
                    step.suggestions.some(s => val.toLowerCase().includes(s.toLowerCase().split(' ')[0]));

  setTimeout(() => {
    const fb = document.createElement('div');
    fb.className = 'bubble feedback' + (isCorrect ? '' : ' wrong');
    if (isCorrect) {
      fb.innerHTML = `✓ Great! The key phrase here was: <strong>${step.expect}</strong> (${step.expectEng})`;
      addXP(diff === 'easy' ? 8 : diff === 'medium' ? 15 : 25);
      updateStreak(true);
    } else {
      fb.innerHTML = `Try: <strong>${step.expect}</strong> — "${step.expectEng}"<br><span style="font-size:12px;color:var(--muted);">Hint: ${step.hint}</span>`;
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
  el.innerHTML = `
    <div class="summary-box">
      <div class="summary-score">🎉</div>
      <div style="font-family:'Playfair Display',serif;font-size:24px;margin-top:12px;">Scenario complete!</div>
      <div style="font-size:14px;color:var(--muted);margin-top:8px;">You finished the ${selectedScenarioObj.name} conversation</div>
      <div class="summary-stats">
        <div class="sum-stat"><div class="sum-num">${streak}</div><div class="sum-lbl">Streak</div></div>
        <div class="sum-stat"><div class="sum-num">${xp}</div><div class="sum-lbl">Total XP</div></div>
      </div>
      <div class="btn-row" style="justify-content:center;">
        <button class="btn btn-primary" onclick="backToScenarioPicker()">Try another scenario →</button>
      </div>
    </div>`;
}

function backToScenarioPicker() {
  document.getElementById('scenario-picker-view').style.display = 'block';
  document.getElementById('scenario-chat-view').style.display = 'none';
  document.getElementById('scenario-summary-view').style.display = 'none';
}

// ════════════════════════════════
// ── SENTENCE BUILDER ──
// ════════════════════════════════
const SB_EXERCISES = {
  easy: [
    {prompt:"Arrange: I want to eat rice", answer:"Tôi muốn ăn cơm", words:["Tôi","muốn","ăn","cơm","đi","uống"], cat:"Daily Life"},
    {prompt:"Arrange: How much is this?", answer:"Cái này bao nhiêu tiền?", words:["Cái","này","bao","nhiêu","tiền?","ăn","ngon"], cat:"Shopping"},
    {prompt:"Arrange: Give me one portion more", answer:"Cho tôi một phần nữa", words:["Cho","tôi","một","phần","nữa","cơm","rau"], cat:"Food"},
    {prompt:"Arrange: Can you stop here?", answer:"Dừng đây được không?", words:["Dừng","đây","được","không?","đi","nhanh"], cat:"Transport"},
    {prompt:"Arrange: Today's lunch", answer:"Bữa trưa hôm nay", words:["Bữa","trưa","hôm","nay","tối","sáng"], cat:"Grammar"},
    {prompt:"Arrange: I like to train weights", answer:"Tôi thích tập tạ", words:["Tôi","thích","tập","tạ","ăn","cơm"], cat:"Fitness"},
    {prompt:"Arrange: Is it delicious?", answer:"Có ngon không?", words:["Có","ngon","không?","đắt","mắc"], cat:"Food"},
    {prompt:"Arrange: I don't eat beef", answer:"Tôi không ăn thịt bò", words:["Tôi","không","ăn","thịt","bò","gà","rau"], cat:"Food"},
  ],
  medium: [
    {prompt:"Arrange: Too spicy, can you make it less spicy?", answer:"Cay quá, bớt cay được không?", words:["Cay","quá,","bớt","cay","được","không?","ngon","mắc"], cat:"Food"},
    {prompt:"Arrange: Can I pay by card?", answer:"Thanh toán bằng thẻ được không?", words:["Thanh","toán","bằng","thẻ","được","không?","tiền","mặt"], cat:"Payments"},
    {prompt:"Arrange: How long have you been training?", answer:"Bạn tập bao lâu rồi?", words:["Bạn","tập","bao","lâu","rồi?","nhiêu","ngày"], cat:"Fitness"},
    {prompt:"Arrange: I will eat duck congee today", answer:"Hôm nay tôi sẽ ăn cháo vịt", words:["Hôm","nay","tôi","sẽ","ăn","cháo","vịt","cơm","gạo"], cat:"Grammar"},
    {prompt:"Arrange: Give me half a kilo of fresh fish", answer:"Cho tôi nửa ký cá tươi", words:["Cho","tôi","nửa","ký","cá","tươi","rau","gạo"], cat:"Market"},
    {prompt:"Arrange: Let me think about it more", answer:"Để tôi suy nghĩ thêm", words:["Để","tôi","suy","nghĩ","thêm","biết","hiểu"], cat:"Business"},
    {prompt:"Arrange: The traffic is terrible today", answer:"Hôm nay kẹt xe quá", words:["Hôm","nay","kẹt","xe","quá","đi","nhanh"], cat:"Transport"},
    {prompt:"Arrange: Go straight then turn right", answer:"Đi thẳng rồi quẹo phải", words:["Đi","thẳng","rồi","quẹo","phải","trái","nhanh"], cat:"Transport"},
  ],
  hard: [
    {prompt:"Arrange: Can we speak privately?", answer:"Mình có thể nói chuyện riêng không?", words:["Mình","có","thể","nói","chuyện","riêng","không?","cùng","nhau"], cat:"Business"},
    {prompt:"Arrange: Duck congee, no coriander please", answer:"Cháo vịt, không bỏ ngò", words:["Cháo","vịt,","không","bỏ","ngò","thêm","rau"], cat:"Food"},
    {prompt:"Arrange: Can you lower the price?", answer:"Anh có thể giảm giá không?", words:["Anh","có","thể","giảm","giá","không?","tăng","nhiều"], cat:"Business"},
    {prompt:"Arrange: I want to sign up to train", answer:"Tôi muốn đăng ký tập", words:["Tôi","muốn","đăng","ký","tập","học","xem"], cat:"Fitness"},
    {prompt:"Arrange: When do we sign the contract?", answer:"Bao giờ ký hợp đồng?", words:["Bao","giờ","ký","hợp","đồng?","nhiêu","tiền"], cat:"Business"},
    {prompt:"Arrange: Drive faster, I'm already late", answer:"Chạy nhanh lên, tôi trễ rồi", words:["Chạy","nhanh","lên,","tôi","trễ","rồi","đi","chậm"], cat:"Transport"},
  ],
};

let currentSBExercises = [];
let sbCurrentIdx = 0;
let sbPlaced = [];
let sbShuffled = [];

function loadSentence() {
  currentSBExercises = [...(SB_EXERCISES[diff] || SB_EXERCISES.easy)].sort(() => Math.random() - 0.5);
  sbCurrentIdx = 0;
  renderSentence();
}

function renderSentence() {
  const ex = currentSBExercises[sbCurrentIdx % currentSBExercises.length];
  sbPlaced = [];
  sbShuffled = [...ex.words].sort(() => Math.random() - 0.5);
  document.getElementById('sbCatLabel').textContent = ex.cat;
  document.getElementById('sbPrompt').textContent = ex.prompt;
  document.getElementById('sbEng').textContent = 'Target: ' + ex.answer;
  document.getElementById('sbCounter').textContent = `${(sbCurrentIdx % currentSBExercises.length) + 1} / ${currentSBExercises.length}`;
  document.getElementById('sbFeedback').style.display = 'none';
  document.getElementById('sbCheckBtn').style.display = '';
  renderWordBank();
  renderAnswerSlots();
}

function renderWordBank() {
  const wb = document.getElementById('wordBank');
  wb.innerHTML = '';
  sbShuffled.forEach((w, i) => {
    const t = document.createElement('div');
    t.className = 'word-tile' + (sbPlaced.includes(i) ? ' used' : '');
    t.textContent = w;
    t.onclick = () => placeWord(i, w);
    wb.appendChild(t);
  });
}

function renderAnswerSlots() {
  const el = document.getElementById('answerSlots');
  el.className = 'answer-slots';
  el.innerHTML = sbPlaced.length === 0 ? '<span style="color:var(--muted);font-size:13px;">Tap words below to build the sentence</span>' : '';
  sbPlaced.forEach((idx, pos) => {
    const t = document.createElement('div');
    t.className = 'placed-tile';
    t.textContent = sbShuffled[idx];
    t.onclick = () => removeTile(pos);
    el.appendChild(t);
  });
}

function placeWord(i, w) {
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

function removeLastWord() {}

function checkSentence() {
  const ex = currentSBExercises[sbCurrentIdx % currentSBExercises.length];
  const built = sbPlaced.map(i => sbShuffled[i]).join(' ');
  const correct = built.trim().toLowerCase() === ex.answer.toLowerCase();
  const fb = document.getElementById('sbFeedback');
  const slots = document.getElementById('answerSlots');
  fb.style.display = 'block';
  fb.className = 'sb-feedback ' + (correct ? 'correct' : 'incorrect');
  slots.className = 'answer-slots ' + (correct ? 'correct' : 'incorrect');
  if (correct) {
    fb.innerHTML = '✓ Correct! <strong>' + ex.answer + '</strong>';
    addXP(diff === 'easy' ? 10 : diff === 'medium' ? 18 : 28);
    updateStreak(true);
  } else {
    fb.innerHTML = '✗ Not quite. Correct answer: <strong>' + ex.answer + '</strong>';
    updateStreak(false);
  }
  document.getElementById('sbCheckBtn').style.display = 'none';
}

function nextSentence() {
  sbCurrentIdx++;
  renderSentence();
}

// ════════════════════════════════
// ── GAP FILL ──
// ════════════════════════════════
// Each line: text has ___ per blank, answers[] has one answer per blank
const GF_EXERCISES = [
  {
    topic:"Food & Market", scenarioTitle:"At the wet market", scenarioDesc:"Buying fish and vegetables",
    hints:["Còn","còn","Bao nhiêu","Nửa ký","hết rồi","tươi","Cho tôi"],
    lines:[
      {speaker:"You",    text:"Chị ơi! ___ cá không?",          answers:["Còn"],       eng:"Hey! Do you still have fish?"},
      {speaker:"Vendor", text:"Dạ ___! Cá tươi lắm.",            answers:["còn"],       eng:"Yes, still have! Very fresh fish."},
      {speaker:"You",    text:"___ một ký cá chiên.",             answers:["Cho tôi"],   eng:"Give me one kilo of fried fish."},
      {speaker:"Vendor", text:"___ tiền một ký?",                 answers:["Bao nhiêu"], eng:"How much per kilo?"},
      {speaker:"You",    text:"___ thôi, không cần nhiều.",       answers:["Nửa ký"],    eng:"Just half a kilo, don't need much."},
    ]
  },
  {
    topic:"Grammar: Future Tense", scenarioTitle:"Planning tomorrow", scenarioDesc:"Using sẽ for future actions",
    hints:["sẽ","hay","và","có lẽ","đi","hôm nay"],
    lines:[
      {speaker:"Friend", text:"___ bạn làm gì?",                  answers:["Hôm nay"],  eng:"What are you doing today?"},
      {speaker:"You",    text:"Tôi ___ đi chợ mua rau ___ cá.",   answers:["sẽ","và"],  eng:"I will go to the market to buy vegetables and fish."},
      {speaker:"Friend", text:"Bạn muốn ăn cơm ___ bánh mì?",     answers:["hay"],      eng:"Do you want to eat rice or bread?"},
      {speaker:"You",    text:"Tôi muốn cơm ___ rau.",             answers:["và"],       eng:"I want rice and vegetables."},
      {speaker:"Friend", text:"___ tôi sẽ cùng đi.",              answers:["Có lẽ"],    eng:"Maybe I'll come along."},
    ]
  },
  {
    topic:"Yes/No Questions", scenarioTitle:"At the restaurant", scenarioDesc:"Using có...không structure",
    hints:["Có","Có","Còn","không","không","được"],
    lines:[
      {speaker:"You",    text:"___ cháo vịt ___?",                answers:["Có","không"],  eng:"Do you have duck congee?"},
      {speaker:"Staff",  text:"Dạ ___! Anh dùng không?",          answers:["Còn"],          eng:"Yes, still have! Would you like some?"},
      {speaker:"You",    text:"___ cay ___ ?",                    answers:["Có","không"],   eng:"Is it spicy?"},
      {speaker:"Staff",  text:"Không cay lắm, anh yên tâm.",      answers:[],               eng:"Not very spicy, don't worry."},
      {speaker:"You",    text:"Bớt cay ___ không?",               answers:["được"],         eng:"Can it be made less spicy?"},
    ]
  },
  {
    topic:"Transport", scenarioTitle:"In a Grab", scenarioDesc:"Giving directions to the driver",
    hints:["kẹt xe","kẹt xe","đi","thẳng","phải","Dừng","đây"],
    lines:[
      {speaker:"Driver", text:"Hôm nay ___ quá!",                 answers:["kẹt xe"],       eng:"Today the traffic is terrible!"},
      {speaker:"You",    text:"Vâng, ___ quá.",                   answers:["kẹt xe"],       eng:"Yes, so much traffic."},
      {speaker:"Driver", text:"Mình ___ đường này được không?",   answers:["đi"],           eng:"Can we take this road?"},
      {speaker:"You",    text:"Đi ___ rồi quẹo ___.",             answers:["thẳng","phải"], eng:"Go straight then turn right."},
      {speaker:"You",    text:"___ ___ được không?",              answers:["Dừng","đây"],   eng:"Can you stop here?"},
    ]
  },
  {
    topic:"Fitness & Gym", scenarioTitle:"Signing up at a gym", scenarioDesc:"Business conversation with gym staff",
    hints:["đăng ký","tập","tập","bao lâu","thể hình","giảm giá","được"],
    lines:[
      {speaker:"You",    text:"Tôi muốn ___ ___.",                answers:["đăng ký","tập"], eng:"I want to sign up to train."},
      {speaker:"Staff",  text:"Anh ___ ___ rồi?",                 answers:["tập","bao lâu"], eng:"How long have you been training?"},
      {speaker:"You",    text:"Ba năm. Phòng ___ ở đây đẹp lắm.", answers:["thể hình"],      eng:"Three years. The gym here is very nice."},
      {speaker:"You",    text:"Anh có thể ___ không?",            answers:["giảm giá"],      eng:"Can you lower the price?"},
      {speaker:"Staff",  text:"Dạ ___ anh, mười phần trăm.",      answers:["được"],          eng:"Yes we can, ten percent off."},
    ]
  },
];

let gfCurrentIdx = 0;
let gfExercises = [];
let gfSelectedChip = null;
let gfDraggingChip = null;

function loadGapFill() {
  gfExercises = [...GF_EXERCISES].sort(() => Math.random() - 0.5);
  gfCurrentIdx = 0;
  renderGapFill();
}

function renderGapFill() {
  gfSelectedChip = null;
  gfDraggingChip = null;
  const ex = gfExercises[gfCurrentIdx % gfExercises.length];
  document.getElementById('gfTopicLabel').textContent = ex.topic;
  document.getElementById('gfScenarioTitle').textContent = ex.scenarioTitle;
  document.getElementById('gfScenarioDesc').textContent = ex.scenarioDesc;
  document.getElementById('gfCounter').textContent = `${(gfCurrentIdx % gfExercises.length) + 1} / ${gfExercises.length}`;

  // Build chips — one per entry in hints[] (duplicates are explicit in the array)
  const hintsEl = document.getElementById('gfHints');
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
      if (gfSelectedChip === chip) {
        chip.classList.remove('selected');
        gfSelectedChip = null;
      } else {
        if (gfSelectedChip) gfSelectedChip.classList.remove('selected');
        gfSelectedChip = chip;
        chip.classList.add('selected');
      }
    });

    chip.addEventListener('dragstart', e => {
      gfDraggingChip = chip;
      chip.classList.add('dragging');
      e.dataTransfer.setData('text/plain', cid);
      e.dataTransfer.effectAllowed = 'move';
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('dragging');
      gfDraggingChip = null;
    });

    hintsEl.appendChild(chip);
  });

  // Build dialogue with drop zones
  const dlg = document.getElementById('gfDialogue');
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
        const bid = `blank-${blankId++}`;
        const ansIdx = blankCount++;
        const drop = document.createElement('span');
        drop.className = 'gf-drop';
        drop.dataset.bid = bid;
        drop.dataset.li = li;
        drop.dataset.ai = ansIdx;
        drop.dataset.empty = '1';
        drop.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';

        drop.addEventListener('click', () => {
          if (drop.dataset.checked) return;
          if (drop.dataset.empty === '0') {
            const placedCid = drop.dataset.cid;
            const chip = document.querySelector(`.hint-chip[data-cid="${placedCid}"]`);
            if (chip) chip.classList.remove('used', 'selected');
            clearDrop(drop);
            if (gfSelectedChip) gfSelectedChip.classList.remove('selected');
            gfSelectedChip = null;
          } else if (gfSelectedChip) {
            const prevDrop = document.querySelector(`.gf-drop[data-cid="${gfSelectedChip.dataset.cid}"]`);
            if (prevDrop) clearDrop(prevDrop);
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
          const prevDrop = document.querySelector(`.gf-drop[data-cid="${chip.dataset.cid}"]`);
          if (prevDrop && prevDrop !== drop) clearDrop(prevDrop);
          if (drop.dataset.empty === '0') {
            const oldChip = document.querySelector(`.hint-chip[data-cid="${drop.dataset.cid}"]`);
            if (oldChip) oldChip.classList.remove('used', 'selected');
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
  drop.innerHTML = chip.dataset.word + ' <span class="clear-x">\u2715</span>';
  chip.classList.add('used');
  chip.classList.remove('selected');
  if (gfSelectedChip === chip) gfSelectedChip = null;
}

function clearDrop(drop) {
  drop.dataset.empty = '1';
  delete drop.dataset.cid;
  delete drop.dataset.value;
  drop.classList.remove('filled', 'correct-ans', 'wrong-ans', 'selected-blank');
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
        drop.innerHTML = line.answers[di];
        correct++;
      } else {
        drop.classList.remove('filled');
        drop.classList.add('wrong-ans');
        drop.style.minWidth = '110px';
        drop.innerHTML = val
          ? `<span style="text-decoration:line-through;opacity:.5;">${drop.dataset.value}</span>&nbsp;\u2192&nbsp;<strong>${line.answers[di]}</strong>`
          : `<strong>${line.answers[di]}</strong>`;
      }
    });
  });

  document.querySelectorAll('.hint-chip').forEach(c => c.style.pointerEvents = 'none');
  const isGood = total > 0 && correct >= Math.ceil(total * 0.7);
  addXP(isGood ? (diff === 'easy' ? 12 : 20) : 3);
  updateStreak(isGood);
  showToast(isGood ? `\u2713 ${correct}/${total} correct! +XP` : `${correct}/${total} \u2014 check the red blanks`);
}

function nextGapFill() {
  gfCurrentIdx++;
  renderGapFill();
}

// ════════════════════════════════
// ── TEACHER PREP ──
// ════════════════════════════════
const LAST_LESSON = `Today we learned: thịt heo (pork), cá (fish), trứng (egg), rau (vegetable), cơm vs gạo (cooked vs raw rice), sữa (milk), bánh mì (bread), quả táo (apple), quả cam (orange), quả chuối (banana), cháo (porridge), cháo vịt (duck congee). Grammar: sẽ (future marker), và (and), hay (or), có lẽ (maybe). Questions: có...không, còn...không. Market: chợ, siêu thị. Measurements: ký, nửa ký. Phrase: cho em (give me).`;

const EXERCISE_TEMPLATES = [
  (w) => ({type:"Translate to Vietnamese", q:`How do you say "${w.eng}" in Vietnamese?`, hint:`Think about the category: ${w.cat}`, answer:w.viet}),
  (w) => ({type:"Fill in the blank", q:`Complete: "Cho tôi ___ ${w.viet.split(' ').slice(-1)[0]}"`, hint:`Use the correct measure word`, answer:'một ' + w.viet}),
  (w) => ({type:"True or False", q:`True or false: "${w.viet}" means "${w.eng}"`, hint:`Check your notes`, answer:'True'}),
  (w) => ({type:"Use in a sentence", q:`Make a sentence using "${w.viet}" (${w.eng})`, hint:`Try: Tôi muốn / Cho tôi / Có ... không?`, answer:`e.g. Cho tôi ${w.viet} / Tôi muốn ${w.viet}`}),
  (w) => ({type:"Pronunciation challenge", q:`Write the phonetic pronunciation of "${w.viet}"`, hint:`Break it syllable by syllable`, answer:w.pronun || 'Check your flashcard deck'}),
];

const LESSON_VOCAB = [
  {viet:"thịt heo",eng:"pork",cat:"Food",pronun:"tit heh-oh"},
  {viet:"cá",eng:"fish",cat:"Food",pronun:"kah"},
  {viet:"trứng",eng:"egg",cat:"Food",pronun:"troong"},
  {viet:"rau",eng:"vegetable",cat:"Food",pronun:"row"},
  {viet:"cơm",eng:"cooked rice",cat:"Food",pronun:"gum"},
  {viet:"gạo",eng:"uncooked rice",cat:"Food",pronun:"gow"},
  {viet:"sữa",eng:"milk",cat:"Food",pronun:"soo-ah"},
  {viet:"bánh mì",eng:"bread / baguette",cat:"Food",pronun:"bang mee"},
  {viet:"quả chuối",eng:"banana",cat:"Food",pronun:"kwah choo-oy"},
  {viet:"cháo vịt",eng:"duck congee",cat:"Food",pronun:"chow yit"},
  {viet:"sẽ",eng:"will (future)",cat:"Grammar",pronun:"seh"},
  {viet:"có lẽ",eng:"maybe",cat:"Grammar",pronun:"kaw leh"},
  {viet:"chợ",eng:"market",cat:"Places",pronun:"chuh"},
  {viet:"siêu thị",eng:"supermarket",cat:"Places",pronun:"syew tee"},
  {viet:"nửa ký",eng:"half a kilogram",cat:"Measurement",pronun:"nuh-ah kee"},
  {viet:"cho em",eng:"give me (polite)",cat:"Phrases",pronun:"cho em"},
];

function loadLastLesson() {
  document.getElementById('tpInput').value = LAST_LESSON;
}

function generateExercises() {
  const input = document.getElementById('tpInput').value.trim();
  if (!input) { showToast('Please paste your lesson notes first'); return; }

  const shuffled = [...LESSON_VOCAB].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 8);

  const exercises = [];

  // Fixed structural exercises always included
  exercises.push({
    type:"Grammar drill",
    q:`Use "sẽ" to say: "I will eat duck congee tomorrow"`,
    hint:`Formula: Subject + sẽ + verb + object`,
    answer:`Ngày mai tôi sẽ ăn cháo vịt`
  });
  exercises.push({
    type:"Yes/No question",
    q:`Ask "Do you still have duck congee?" using the còn...không structure`,
    hint:`còn + [item] + không?`,
    answer:`Còn cháo vịt không?`
  });
  exercises.push({
    type:"Market roleplay prompt",
    q:`You're at the wet market. Ask for half a kilo of fresh fish, say it's too expensive, then negotiate`,
    hint:`Cho tôi nửa ký cá tươi / Mắc quá! / Rẻ hơn được không?`,
    answer:`Cho tôi nửa ký cá tươi → Mắc vậy trời! → Rẻ hơn được không?`
  });
  exercises.push({
    type:"Difference check",
    q:`What is the difference between "cơm" and "gạo"? Use both in a sentence`,
    hint:`One is cooked, one is raw`,
    answer:`Cơm = cooked rice (on your plate). Gạo = uncooked rice (at the market). e.g. Tôi mua gạo để nấu cơm.`
  });
  exercises.push({
    type:"Connector drill",
    q:`Combine these into one sentence using "và" or "hay": cơm / bánh mì / rau`,
    hint:`Try asking: Bạn muốn cơm hay bánh mì? Or listing: cơm và rau`,
    answer:`Bạn muốn cơm hay bánh mì? / Tôi muốn cơm và rau`
  });

  // Dynamic vocab exercises
  selected.slice(0, 5).forEach((w, i) => {
    const tmpl = EXERCISE_TEMPLATES[i % EXERCISE_TEMPLATES.length];
    exercises.push(tmpl(w));
  });

  const list = document.getElementById('exerciseList');
  list.innerHTML = '';
  exercises.forEach((ex, i) => {
    const el = document.createElement('div');
    el.className = 'exercise-item';
    el.innerHTML = `
      <div class="ex-type">${String(i+1).padStart(2,'0')} · ${ex.type}</div>
      <div class="ex-q">${ex.q}</div>
      ${ex.hint ? `<div class="ex-hint">💡 ${ex.hint}</div>` : ''}
      <div class="ex-answer" id="ans-${i}">✓ ${ex.answer}</div>
      <button class="show-answer-btn" onclick="toggleAnswer(${i})">Show answer</button>
    `;
    list.appendChild(el);
  });

  showToast('10 exercises generated! ✓');
}

function toggleAnswer(i) {
  const el = document.getElementById('ans-' + i);
  const btn = el.nextElementSibling;
  const show = el.style.display === 'none' || !el.style.display;
  el.style.display = show ? 'block' : 'none';
  btn.textContent = show ? 'Hide answer' : 'Show answer';
}

// ── INIT ──
buildScenarioPicker();
addXP(0);


/* ── INIT ── */
buildScenarioPicker();
addXP(0);


// Override markCard to save progress after each verdict
const _markCardOrig = markCard;
markCard = function(mastered) {
  _markCardOrig(mastered);
  saveProgressToDB();
};