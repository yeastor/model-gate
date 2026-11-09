// Only exact independently pinned general answers are passed here by the TH profile.
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderThreatsFallback(answer){
 if(!answer||typeof answer.now!=='string'||!['steps','dont','say','laws','where_to'].every(k=>Array.isArray(answer[k])))throw Error('TH_FALLBACK_SHAPE');
 const paragraphs=a=>a.map(x=>'<p>'+esc(x)+'</p>').join('');
 const laws=answer.laws.map(l=>{if(!/^\/laws\/[^\s\\?#]+(?:#[^\s\\#?]+)?$/.test(l.url))throw Error('TH_FALLBACK_LAW_URL');return '<p><a href="'+esc(l.url)+'">'+esc(l.title)+'</a> '+esc(l.short)+'</p>';}).join('');
 return '<section aria-label="Доступная общая помощь"><p>'+esc(answer.now)+'</p>'+paragraphs(answer.steps)+paragraphs(answer.dont)+paragraphs(answer.say)+laws+'<p>Показана общая памятка. Полный пакет для уточнённых обстоятельств сейчас недоступен.</p></section>';
}
