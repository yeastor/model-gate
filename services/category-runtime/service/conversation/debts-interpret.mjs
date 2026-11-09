// Routing hints only choose a topic; they never assert a case fact.
export function debtsStageHint(text){
 const t=text.toLowerCase().replaceAll('ё','е');
 if(/судебн[а-я]* приказ|отмен[а-я]* приказ/iu.test(t))return 'court_order';
 if(/(?:^|\s)иск(?:овое|а|у|ом)?(?:\s|$)|подал[аи]? (?:на меня )?в суд|иск пришел/iu.test(t)&&!/срок.*давност/iu.test(t))return 'court_claim';
 if(/давност/iu.test(t))return /(?:^|\s)иск(?:\s|$)|заседани/iu.test(t)?'court_claim':'limitation_period';
 if(/каникул|реструктур|ипотек/iu.test(t))return 'restructuring_holidays';
 if(/банкрот|непосильн/iu.test(t))return 'bankruptcy_options';
 if(/не брал|договор не заключал|не согласен.*сумм|расчет.*долг|уступк/iu.test(t))return 'debt_amount_dispute';
 if(/процент|штраф|пен[яи]|неустойк/iu.test(t))return 'penalties_interest';
 if(/просроч|кредит|долг|за[йе]м/iu.test(t))return 'overdue_first_days';
 return null;
}
const specs=[
 ['court_claim','limitation_defense_requested',/(?:я )?хочу заявить (?:суду )?(?:о применении )?(?:исковую|исковой)?\s*давност[ьи]/iu,/(?:я )?не хочу заявлять (?:суду )?(?:о применении )?(?:исковую|исковой)?\s*давност[ьи]/iu],
 ['court_claim','hearing_already_held',/заседание (?:уже )?прошло без (?:меня|моего участия)/iu,/заседание еще не (?:проходило|состоялось)/iu],
 ['court_claim','claim_copy_received',/(?:я )?получил[а]? копию иска и (?:расчет|приложени)/iu,/(?:я )?не получил[а]? копию иска/iu],
 ['court_claim','loan_not_taken',/(?:я )?(?:этот )?договор (?:я )?не заключал[а]?/iu,/(?:я )?(?:этот )?договор (?:я )?заключал[а]?/iu],
 ['debt_amount_dispute','loan_not_taken',/(?:я )?(?:этот )?договор (?:я )?не заключал[а]?/iu,/(?:я )?(?:этот )?договор (?:я )?заключал[а]?/iu],
 ['debt_amount_dispute','court_case_started',/(?:кредитор|банк|мфо) (?:уже )?(?:обратил(?:ся|ась) в суд|подал[аи]? (?:иск|заявление о судебном приказе))/iu,/(?:кредитор|банк|мфо) (?:еще )?не (?:обращал(?:ся|ась) в суд|подавал[аи]? (?:иск|заявление))/iu],
 ['debt_amount_dispute','debt_assigned',/право требования (?:по этому долгу )?(?:уже )?передано новому кредитору/iu,/право требования (?:по этому долгу )?не передано/iu],
 ['court_order','order_copy_received',/(?:я )?(?:уже )?получил[а]? копию (?:этого )?судебного приказа/iu,/(?:я )?(?:еще )?не получил[а]? копию (?:этого )?судебного приказа/iu],
 ['court_order','enforcement_started',/по (?:этому )?приказу (?:уже )?возбуждено исполнительное производство/iu,/по (?:этому )?приказу (?:еще )?не возбуждено исполнительное производство/iu],
 ['court_order','learned_after_writeoff',/о (?:судебном )?приказе (?:я )?узнал[а]? только после (?:списания|ареста)/iu,/о (?:судебном )?приказе (?:я )?узнал[а]? до списания/iu],
 ['court_order','documented_obstacle_to_timely_objection',/у меня есть документы об обстоятельствах, которые помешали (?:вовремя|своевременно) подать возражения/iu,/у меня нет документов об обстоятельствах, которые помешали (?:вовремя|своевременно) подать возражения/iu],
 ['restructuring_holidays','loan_is_mortgage',/(?:этот )?договор обеспечен ипотекой/iu,/(?:этот )?договор не обеспечен ипотекой/iu],
 ['restructuring_holidays','mortgaged_home_is_only_home',/в залоге мое единственное пригодное (?:для проживания )?жилье/iu,/в залоге не единственное (?:пригодное )?жилье/iu],
 ['restructuring_holidays','holidays_used_for_same_reason',/по этому договору уже были каникулы по тому же основанию/iu,/по этому договору каникул по тому же основанию не было/iu],
 ['overdue_first_days','court_order_received',/(?:я )?получил[а]? судебный приказ по этому долгу/iu,/судебный приказ по этому долгу (?:я )?не получал[а]?/iu],
 ['overdue_first_days','lawsuit_received',/(?:я )?получил[а]? исковое заявление по этому долгу/iu,/исковое заявление по этому долгу (?:я )?не получал[а]?/iu],
 ['penalties_interest','court_case_started',/спор об этих начислениях (?:уже )?рассматривается судом/iu,/спор об этих начислениях (?:еще )?не рассматривается судом/iu],
 ['penalties_interest','payments_uncredited',/в расчете не учтены (?:мои )?(?:внесенные )?платежи/iu,/все мои платежи учтены в расчете/iu],
 ['limitation_period','court_case_started',/(?:кредитор|банк) (?:уже )?обратился в суд по этому долгу/iu,/(?:кредитор|банк) (?:еще )?не обращался в суд по этому долгу/iu],
 ['limitation_period','default_judgment_made',/по этому долгу (?:уже )?вынесено (?:заочное )?решение суда/iu,/по этому долгу решение суда еще не вынесено/iu],
 ['bankruptcy_options','main_income_is_pension',/мой основной доход (?:это )?(?:страховая|государственная|накопительная) пенсия/iu,/пенсия не является моим основным доходом/iu],
 ['bankruptcy_options','receives_childbirth_upbringing_monthly_benefit',/мне назначено ежемесячное пособие в связи с рождением и воспитанием ребенка по статье 9 закона 81/iu,/мне не назначено ежемесячное пособие в связи с рождением и воспитанием ребенка/iu],
];
export const debtsObservationRules=specs;
export function interpretDebts(text,currentStage=null){
 const normalized=text.toLowerCase().replaceAll('ё','е');
 const scopeChange=/(?:другой|новый) (?:кредит|договор|долг|приказ|случай)/iu.test(normalized);
 const result={stage:null,observations:[],held:false,scopeChange,stop:/^(?:не задавайте вопросы|не хочу отвечать|стоп)[.!]?$/iu.test(text.trim()),resume:/^(?:продолжим|можно задавать вопросы)[.!]?$/iu.test(text.trim())};
 // Hypotheses, quotations, third-party stories and ambiguous mixed obligations are not evidence.
 if(/если|возможно|наверно|допустим|у (?:друга|подруги|соседа)|[«»"]|два договора|несколько кредиторов/iu.test(text)){result.held=true;return result;}
 let hint=debtsStageHint(text);
 // An ongoing topic owns bare field names; explicit process replacement may change it.
 const explicitSwitch=/^(?:исправляю:\s*это\s+(?:судебный приказ|иск)|теперь |хочу обсудить )/iu.test(text.trim());
 result.stage=currentStage&&!explicitSwitch?currentStage:hint;
 const stage=result.stage||currentStage;
 for(const clause of text.split(/[;.!?\n]+/u)){
  const t=clause.trim().replaceAll('ё','е'),operation=/^исправляю:/iu.test(t)?'correct':/^отзываю:/iu.test(t)?'withdraw':'assert';
  const body=t.replace(/^(?:исправляю:|отзываю:)\s*/iu,'');
  if(!body||/^(?:что|как|почему|можно|надо|нужно|проверь|хочу проверить)/iu.test(body))continue;
  for(const [owner,field,yes,no]of specs){if(owner!==stage)continue;
   const matches=[...[[false,no],[true,yes]].filter(([,re])=>new RegExp('^(?:'+re.source+')$','iu').test(body))];
   if(matches.length===1)result.observations.push({key:`debts.${owner}.${field}`,value:operation==='withdraw'?null:matches[0][0],operation});
  }
 }
 return result;
}


