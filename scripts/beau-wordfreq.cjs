/**
 * Beau 聊天记录高频词/高频句分析
 */
const fs = require('fs');

const raw = fs.readFileSync('/tmp/beau_messages.tsv', 'utf8');
const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('text') && !l.startsWith('mysql:') && !l.startsWith('[Warning]'));

// Parse TSV: text \t role \t primary_name
// text field may contain embedded tabs → find all tab positions
const messages = lines.map(line => {
  const tabs = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] ***REMOVED***= '\t') tabs.push(i);
  }
  const lastTab = tabs[tabs.length - 1];
  const secondLastTab = tabs[tabs.length - 2];
  const text = line.slice(0, secondLastTab);
  const role = line.slice(secondLastTab + 1, lastTab);
  const name = line.slice(lastTab + 1);
  return { text, role, name };
}).filter(m => m.text.trim() && (m.role ***REMOVED***= 'user' || m.role ***REMOVED***= 'me'));

console.log(`总消息数: ${messages.length}`);
const userMsgs = messages.filter(m => m.role ***REMOVED***= 'user');
const opMsgs = messages.filter(m => m.role ***REMOVED***= 'me');
console.log(`达人发送: ${userMsgs.length} | 运营发送: ${opMsgs.length}`);
console.log('');

const STOP = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'yours', 'you', 'your', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'it', 'its', 'they', 'them',
  'their', 'theirs', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or',
  'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to',
  'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'll', 're',
  've', 'y', 'ain', 'aren', 'couldn', 'didn', 'doesn', 'hadn', 'hasn', 'haven',
  'isn', 'wasn', 'weren', 'won', 'wouldn', 'also', 'would', 'could', 'like', 'getting',
  'got', 'gonna', 'gotta', 'kinda', 'sorta', 'maybe', 'actually', 'probably', 'already',
  'though', 'yet', 'ever', 'every', 'something', 'anything', 'nothing', 'someone',
  'anyone', 'much', 'many', 'lot', 'thing', 'things', 'feel', 'always', 'never',
  'thanks', 'thank', 'please', 'hi', 'hello', 'hey', 'dear', 'sorry', 'oh', 'aw',
  'wow', 'haha', 'lol', 'omg', 'ugh', 'umm', 'okay', 'ok', 'yep', 'nah', 'yup',
  'uh', 'hmm', 'ah', 'em', 'en', 'us', 'im', 'thats', 'dont', 'cant', 'wont',
  'didnt', 'doesnt', 'isnt', 'wasnt', 'youre', 'hes', 'shes', 'its', 'theyre',
  'ive', 'youve', 'weve', 'theyve', 'id', 'youd', 'hed', 'shed', 'theyd',
  'ill', 'youll', 'hell', 'shell', 'theyll', 's', 't', 'd', 'm',
  'let', 'sure', 'right', 'yes', 'yeah', 'one', 'two', 'first', 'really', 'well',
  'back', 'even', 'still', 'way', 'take', 'come', 'know', 'think', 'want', 'see',
  'look', 'work', 'works', 'working', 'help', 'try', 'trying', 'tried', 'find', 'found',
  'thing', 'things', 'stuff', 'someone', 'anyone', 'anything', 'everything',
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\d+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

function freq(arr) {
  const f = {};
  arr.forEach(v => { f[v] = (f[v] || 0) + 1; });
  return Object.entries(f).sort((a, b) => b[1] - a[1]);
}

// ---- 1. 全局高频词 ----
const allWords = [];
messages.forEach(m => allWords.push(...tokenize(m.text)));
const allFreq = freq(allWords);
console.log('***REMOVED***= 高频词 TOP 100（全部消息）***REMOVED***=');
allFreq.slice(0, 100).forEach(([w, c], i) => console.log(`${i+1}. ${w}: ${c}`));

// ---- 2. 达人高频词 ----
const creatorWords = [];
userMsgs.forEach(m => creatorWords.push(...tokenize(m.text)));
const creatorFreq = freq(creatorWords);
console.log('\n***REMOVED***= 高频词 TOP 80（仅达人消息）***REMOVED***=');
creatorFreq.slice(0, 80).forEach(([w, c], i) => console.log(`${i+1}. ${w}: ${c}`));

// ---- 3. 运营高频词 ----
const opWords = [];
opMsgs.forEach(m => opWords.push(...tokenize(m.text)));
const opFreq = freq(opWords);
console.log('\n***REMOVED***= 高频词 TOP 80（仅运营消息）***REMOVED***=');
opFreq.slice(0, 80).forEach(([w, c], i) => console.log(`${i+1}. ${w}: ${c}`));

// ---- 4. 二元组 ----
const bgFreq = {};
messages.forEach(m => {
  const toks = tokenize(m.text);
  for (let i = 0; i < toks.length - 1; i++) {
    const bg = toks[i] + ' ' + toks[i+1];
    bgFreq[bg] = (bgFreq[bg] || 0) + 1;
  }
});
const sortedBigrams = Object.entries(bgFreq).filter(([,c]) => c >= 8).sort((a,b) => b[1]-a[1]);
console.log('\n***REMOVED***= 高频二元组 TOP 60（≥8次）***REMOVED***=');
sortedBigrams.slice(0, 60).forEach(([bg, c], i) => console.log(`${i+1}. "${bg}": ${c}`));

// ---- 5. 三元组 ----
const tgFreq = {};
messages.forEach(m => {
  const toks = tokenize(m.text);
  for (let i = 0; i < toks.length - 2; i++) {
    const tg = toks[i] + ' ' + toks[i+1] + ' ' + toks[i+2];
    tgFreq[tg] = (tgFreq[tg] || 0) + 1;
  }
});
const sortedTrigrams = Object.entries(tgFreq).filter(([,c]) => c >= 5).sort((a,b) => b[1]-a[1]);
console.log('\n***REMOVED***= 高频三元组 TOP 40（≥5次）***REMOVED***=');
sortedTrigrams.slice(0, 40).forEach(([tg, c], i) => console.log(`${i+1}. "${tg}": ${c}`));

// ---- 6. 主题词分析 ----
const DOMAINS = [
  { name: '试用/介绍', words: ['trial', 'join', 'joinbrands', 'started', 'starting', 'begin', 'new', 'package', 'plan', 'trial_trial', 'program', 'free', 'offer', 'offering', 'trial_trial'] },
  { name: '价格/月费', words: ['price', 'fee', 'monthly', 'month', 'dollar', 'dollars', 'discount', 'pay', 'payment', 'payout', 'paid', 'cost', 'affordable', 'expensive', 'cheapest'] },
  { name: '视频/内容', words: ['video', 'videos', 'posting', 'post', 'posts', 'content', 'tiktok', 'shop', 'shopify', 'creator', 'shoot', 'film', 'record', 'upload', 'uploads'] },
  { name: 'GMV/收入', words: ['gmv', 'sales', 'earning', 'earnings', 'income', 'revenue', 'commission', 'profit', 'money', 'cash', 'order', 'orders', 'sale', 'purchases', 'payout'] },
  { name: '账号/设备', words: ['account', 'accounts', 'device', 'devices', 'link', 'linking', 'linked', 'multiple', 'phone', 'number', 'switch', 'different', 'another', 'other', 'sim'] },
  { name: '违规/申诉', words: ['violation', 'violations', 'strike', 'strikes', 'appeal', 'appealed', 'warning', 'suspended', 'banned', 'flagged', 'violated', 'policy', 'policies', 'rules'] },
  { name: 'GMV目标/里程碑', words: ['threshold', 'milestone', 'milestones', 'target', 'goal', 'goals', 'reach', 'reaching', 'achieve', 'completed', 'complete', 'completing'] },
  { name: '合同/签约期', words: ['contract', 'agreement', 'signed', 'signing', 'term', 'terms', 'renew', 'cancel', 'cancelled', 'terminate', 'ending', 'period', 'duration', 'months'] },
  { name: 'KEEPER平台', words: ['keeper', 'keeperlink', 'dashboard', 'platform', 'app', 'website', 'login'] },
  { name: '品牌/MCN', words: ['moras', 'brand', 'brands', 'collaboration', 'partner', 'partnership', 'mcn', 'agency', 'company'] },
  { name: 'WA沟通', words: ['message', 'messages', 'text', 'reply', 'replied', 'respond', 'response', 'whatsapp', 'chat', 'chatting', 'send', 'sent', 'received'] },
  { name: '确认/核实', words: ['confirm', 'confirmed', 'confirmation', 'check', 'checked', 'verify', 'verified', 'info', 'information', 'details'] },
];

console.log('\n***REMOVED***= 主题分类词频 ***REMOVED***=');
for (const domain of DOMAINS) {
  const counts = {};
  messages.forEach(m => {
    const toks = tokenize(m.text);
    domain.words.forEach(w => {
      if (toks.includes(w)) counts[w] = (counts[w] || 0) + 1;
    });
  });
  const total = Object.values(counts).reduce((s,v) => s+v, 0);
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  if (total > 0) {
    console.log(`\n【${domain.name}】命中 ${total} 次`);
    top.forEach(([w,c]) => console.log(`  ${w}: ${c}`));
  }
}

// ---- 7. 常见句子开头 ----
const starters = {};
messages.forEach(m => {
  const text = m.text.trim();
  const words = text.split(/\s+/);
  const starter = words.slice(0, 3).join(' ');
  if (starter.length > 5) starters[starter] = (starters[starter] || 0) + 1;
});
const sortedStarters = Object.entries(starters).filter(([,c]) => c >= 3).sort((a,b) => b[1]-a[1]);
console.log('\n***REMOVED***= 常见句子开头（≥3次）***REMOVED***=');
sortedStarters.slice(0, 30).forEach(([s, c], i) => console.log(`${i+1}. "${s}": ${c}`));

// ---- 8. 问句分析 ----
const questionWords = {};
messages.filter(m => m.role ***REMOVED***= 'me' && m.text.includes('?')).forEach(m => {
  tokenize(m.text).forEach(w => { questionWords[w] = (questionWords[w] || 0) + 1; });
});
const sortedQuestions = Object.entries(questionWords).sort((a,b) => b[1]-a[1]);
console.log('\n***REMOVED***= 运营问句高频词 TOP 40 ***REMOVED***=');
sortedQuestions.slice(0, 40).forEach(([w, c], i) => console.log(`${i+1}. ${w}: ${c}`));

// ---- 9. 各达人消息量 ----
const byCreator = {};
messages.forEach(m => {
  if (!byCreator[m.name]) byCreator[m.name] = { user: 0, me: 0, total: 0 };
  byCreator[m.name][m.role]++;
  byCreator[m.name].total++;
});
const sortedByCreator = Object.entries(byCreator).sort((a,b) => b[1].total - a[1].total);
console.log('\n***REMOVED***= 各达人消息量 TOP 25 ***REMOVED***=');
sortedByCreator.slice(0, 25).forEach(([name, counts], i) => {
  console.log(`${i+1}. ${name}: 达人→${counts.user}条 | 运营→${counts.me}条`);
});

// ---- 10. 关键词样本 ----
const KW_SAMPLES = [
  'trial', 'joinbrands', 'violation', 'gmv', 'commission', 'keeper',
  'payment', 'strike', 'contract', 'account', 'device', 'suspended', 'moras',
  'threshold', 'video', '35', 'monthly fee', '20', '300', '200'
];
console.log('\n***REMOVED***= 关键词语境样本 ***REMOVED***=');
KW_SAMPLES.forEach(kw => {
  const matches = messages.filter(m => m.text.toLowerCase().includes(kw.toLowerCase()));
  if (matches.length ***REMOVED***= 0) return;
  console.log(`\n"${kw}" (${matches.length}次):`);
  matches.slice(0, 2).forEach(s => {
    const snippet = s.text.replace(/\n/g, ' ').slice(0, 300);
    console.log(`  [${s.role}] ${snippet}`);
  });
});
