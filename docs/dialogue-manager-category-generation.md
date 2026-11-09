# Генерация пакета Dialogue Manager для категории: MVP

Рабочая инструкция агенту: [../dialogue-generator/AGENTS.md](../dialogue-generator/AGENTS.md). Папка генерации по умолчанию: dialogue-generator/output/<categoryId>/<version>/.

Статус: инструкция и проверяемый пример; не новый подключённый формат runtime.
Основание: согласованные ограничения MVP от 22 октября 2026 года.
Общий движок остаётся в model-gate. Для категории генерируется пакет данных и проверок, а не отдельный менеджер диалога.

## Границы

1. Использовать существующие context_fields и variant.context. Не создавать дополнительные обстоятельства для удобства распознавания.
2. Не менять исходные variant_id, payload.next, answer, document, ссылки и юридический смысл категории.
3. Дополнительные вопросы хранить отдельно от категории. Предлагать только полезные ответы из true / false / null; все три не обязательны, пустой набор скрывает вопрос. Подпись неизвестности выбирать по смыслу согласно ARTIFACT-RULES.md v2-draft.
4. Разрешены вопросы о существующем context и вопросы маршрутизации: участник, категория, подтема. Маршрутизация обновляет служебное состояние, а не выдуманное поле variant.context.
5. Поиск через embeddings предлагает кандидатов. Он не устанавливает обстоятельства и не подтверждает допустимость ответа.
6. Генератор не создаёт новые юридические ответы внутри правил. Если покрытия не хватает, описать пробел.

## Что подавать генератору

Обязательные входы:
- точный запечатанный JSON категории, SHA-256, версия контракта;
- context_fields каждой подтемы, все маски variant.context;
- полный существующий граф NEXT: вопросы, field_key, ветви, цели;
- проверенные ответы вариантов, чтобы понять, какое различие действительно меняет помощь;
- семантические пояснения автора категории, если название поля не определяет его однозначно;
- доступные реальные обезличенные реплики и принятые проверочные диалоги;
- контракт runtime: область эпизода/участника/документа, обновление фактов, лимит уточнений, совместимость, неизвестность, запрет повторов.

Отсутствующие реальные диалоги не придумывать как реальные. Синтетические примеры помечать.
Ссылки на законы и исходные NEXT служат обоснованием, но не заменяют определение смысла поля.
Если смысл поля неоднозначен, пометить NEEDS_REVIEW; не генерировать уверенное правило по одному имени.

## Как получить правила и дополнительные вопросы

1. Инвентаризация. Выписать разрешённые поля по полному ключу category.stage.field и их определения. Для каждого описать true, false, unknown, зависимости, участника/предмет и границы эпизода.
2. Различия ответов. Сравнить варианты и определить, какое существующее обстоятельство меняет применимость или полезное действие. Каждому предлагаемому вопросу указать конкретные варианты и причину различия.
3. Повторное использование. Найти вопрос в исходном NEXT. Если он подходит, ссылаться на него и использовать существующие цели. Не генерировать дубликат только ради другого текста.
4. Дополнение. Новый внешний вопрос создавать лишь для обнаруженного пробела: нельзя распознать направление либо существующее уточнение недоступно в нужной точке разговора. Самодостаточность и отсутствие повторов проверять по всей категории.
5. Условия показа. Записать: категория/подтема, требуемые подтверждённые факты, неизвестное поле, подходящий участник/предмет, отсутствие конфликта и предыдущего ответа на тот же вопрос, доступный лимит.
6. Ветки. Для каждого предлагаемого ответа из true / false / null указать обновление существующего факта либо служебного маршрута, целевой variant_id/подтему или безопасную остановку. Все цели должны существовать в закреплённой версии категории. Для отсутствующей кнопки объяснить причину и безопасную обработку такого ответа свободным текстом, без выдуманной ветви.
7. Допустимость. Ни одна ненулевая маска целевого варианта не может требовать неподтверждённого факта. Переход проверяется после обновления только того обстоятельства, о котором действительно спросили.
8. Распознавание. Для каждого поля подготовить подтверждающие фразы, отрицания, гипотезы, угрозы, чужую ситуацию, неоднозначного участника, время, исправление, конфликт. Сохранить источник: сообщение, цитату и связь с вопросом. Набор примеров сам по себе не становится исполняемым распознавателем.
9. Неизвестность. Отсутствующее значение означает «не выясняли», null — «не знаю», false — прямое отрицание. В variant.context null означает отсутствие ограничения, а не факт пользователя. Неизвестность не стирает подтверждённое: для отзыва/исправления нужен явный смысл реплики.
10. Проверка и выпуск. Проверить ссылки, все предлагаемые ветви, обработку остальных текстовых ответов, совместимость, повтор вопроса/ответа, смену темы и неизменность исходного файла. Не подключать неподдержанный формат пакета как будто он уже работает.

Один вопрос проверяет одно обстоятельство. Формулировка простая, нейтральная, без скрытого утверждения факта или оценки законности.
Порядок: неоднозначный участник/направление → обстоятельство, меняющее применимость ответа → остальные полезные уточнения.
Новый очевидный факт может сменить подтему; выбранная тема страницы не должна запирать разговор.
Общий бюджет относится ко всему текущему случаю: две пары по умолчанию, третья — только по явно принятому основанию для конкретного вопроса; четвёртая запрещена. В активном PPS список оснований третьего вопроса пуст. Исходный NEXT, supplemental, выбор участника/темы, конфликт и текстовое уточнение используют один счётчик. Новый раунд, факт, предмет, участник, перефразирование, перезагрузка или смена версии его не обнуляют. Новый бюджет появляется только при явно сообщённом отдельном происшествии. Считается фактически выданный вопрос при атомарном сохранении ответа; отклонённая заготовка и повтор доставки не расходуют ещё одну пару. Исчерпание вопросов не прекращает помощь по известным обстоятельствам.
Готовый пакет PPS переиспользуется:47 определений,45 reviewed и2 blocked,15 вопросов,48 решений,681 синтетический пример. Поле maxQuestionsPerRound в историческом compiled-пакете не является разрешением пополнять текущий счётчик случая.

На «не знаю» не задавать тот же вопрос другими словами. Если новый факт/маршрут не появился, дать короткое продолжение вместо прежней полной памятки.

## Формат результата генератора

Пакет должен содержать:
- manifest.json: версия правил, categoryId, categorySha256, версия контракта, статус review и результаты проверки;
- field-semantics.json: существующие поля, определения значений, область действия, зависимости, случаи неизвестности и конфликта;
- extraction-cases.json: входные реплики и ожидаемые факты/источники, примеры и контрпримеры;
- supplemental-next.json: только необходимые дополнительные вопросы, условия, ветви, источник/обоснование целей, порядок и защита от повторов;
- dialogue-cases.json: многошаговые диалоги с ожидаемыми фактами, вопросами, допустимыми вариантами и недопустимыми результатами;
- gaps.json: недостающее покрытие и неоднозначности, требующие решения;
- validation-report.json: проверенная версия категории, результаты и ограничения.

Это целевой состав пакета. Загрузчик этих файлов пока не реализован. Существующий pps.json имеет другой формат и сам по себе их не прочитает.
Код интерпретатора/его обновления либо адаптер будущей модели нужны отдельно: из списка примеров нельзя автоматически обещать понимание любых фраз.
Дополнительные правила не переписывают категории в Qdrant; версия категории и версия правил выпускаются согласованной парой.
Если категория изменилась, повторить проверку и закрепить новый SHA; сессии с прежней версией не переключать незаметно.

## Пример на действующей категории PPS

Исходный SHA-256: 1f3d30732d4c00d77bbb5c63b715bdddfe97e5ecaed92bb764706541c2bd26af.
Подтема: use_of_force.
Поля: force_actually_used — «физическую силу фактически применили»; injuries_present — «после применения силы есть травмы».

Исходный NEXT уже содержит вопрос о травмах:
- true → pps_use_of_force_v51;
- false → pps_use_of_force_v34;
- null → pps_use_of_force_v34.

v51 требует force_actually_used=true и injuries_present=true.
v34 требует force_actually_used=true; injuries_present в его маске равен null, то есть не является условием.
Поэтому «Нет» и «Не знаю» здесь дают один общий вариант, но сохраняются разными значениями факта.
Дополнительный вопрос для этого конкретного случая не нужен: пример демонстрирует формат, а настоящий генератор должен отметить REUSE_EXISTING_NEXT.

Исполняемый пример: examples/pps-dialogue-next.example.mjs.
Он проверяет SHA, источник вопроса, цели, все три значения, невозможность затереть известный факт, неподтверждённую применимость и неизменность загруженной категории.
Он использует настоящий createExplicitEngine и показывает пропуск вопроса о силе, когда факт уже известен.
Его упрощённая функция applyQuestion не заменяет журнал, привязку к эпизоду/участнику, проверки ревизии, транспорт и сохранение.

Команда из корня model-gate:

```powershell
node docs/examples/pps-dialogue-next.example.mjs "C:/Users/mujlo/Documents/Codex/model-category-document-generator/work/pps-natural-speech-content-seal-20261022-v2/pps.final.json"
```

Ожидается status=PASS; «Да» → v51/full, «Нет» и «Не знаю» → v34/continuation при уже показанном v34.

## Где это подключать

Отдельный Git-репозиторий и новый сетевой сервис для MVP не нужны.
Исполняемая часть остаётся в model-gate/services/category-runtime:
- service/conversation/policy/pps.json — текущая политика PPS, загружаемая interpret.mjs;
- service/conversation/interpret.mjs — текущий ограниченный extractor;
- service/conversation/state.mjs — факты и состояние;
- service/conversation/service.mjs — вопросы, маршрутизация, показ ответа;
- service/explicit/engine.mjs — исходный NEXT и проверка совместимости.

Генератор категории может оставаться в своём существующем проекте: там создаётся пакет.
Принятая конфигурация и проверки поставляются с model-gate. Рекомендуемое будущее место: service/conversation/policy/<categoryId>/; runtime не начнёт читать эту папку без загрузчика.
Документационный пример не является рабочим конфигом и не подключается к пользовательскому чату.

План подключения внешних вопросов:
1. Зафиксировать машинную схему и валидатор пакета: разрешённые поля, полные ключи, SHA, условия, вопросы/цели.
2. Загрузить пакет по categoryId + categorySha256 с сохранением версии для сессии.
3. В service.mjs добавить отдельный вид pending для дополнительного вопроса, его проверку и обновление через recordFact. Не менять payload.next.
4. Использовать существующие UI-кнопки и проверки revision/questionId/nonce; учесть вопрос в общем бюджете, синхронизировать факт с движком исходного NEXT.
5. Перед выдачей пропускать целевой вариант через engine.compatible. При несоответствии выбирать подтверждённый общий ответ/уточнение; не выдавать желаемый target принудительно.
6. Сохранить existing NEXT как основной путь, дополнительные вопросы применять по проверенным условиям. Known/unknown и история вопросов не должны образовать повторный цикл между двумя источниками.
7. Выпустить после диалоговых проверок; исходный JSON и Qdrant не менять ради подключения этих правил.

Основное Next.js/Payload-приложение остаётся оболочкой и источником стартового контекста.
Фронтенд чата показывает ответ и кнопки, но не принимает решения о фактах.
Новый генератор не должен выполнять Git-коммиты, переписывать Qdrant или включать правила до проверки только потому, что подготовил пакет.

## Поток обработки

Новое сообщение + сохранённое состояние + текущий вопрос
→ извлечение явных фактов
→ проверка источника, области, конфликтов и обновление состояния
→ определение применимой категории/подтемы
→ исходный NEXT либо допустимый дополнительный вопрос
→ проверенный совместимый variant_id
→ готовый ответ из категории; если уже показан — продолжение.

Embeddings помогают предложить категорию/подтему/кандидатов при неясном свободном тексте.
После точного перехода по кнопке повторно искать целевой вариант через embeddings не нужно.
В текущем V2 поиск имеет вспомогательную роль; первая найденная строка не выбирает юридический ответ автоматически.
Текст ассистента не подтверждает факты пользователя. Контекст следующего хода состоит из фактов пользователя, области ситуации, текущего вопроса и истории показов; для поиска — до четырёх последних пользовательских реплик текущего эпизода.


## Контракт артефактов и задания

Обязательные правила заполнения шести файлов, источники, матрица примеров и проверки: [ARTIFACT-RULES.md](../dialogue-generator/ARTIFACT-RULES.md), authoring format v2-draft. Готовое задание: [GENERATION-TASK.txt](../dialogue-generator/GENERATION-TASK.txt). Исторический неполный пример [manifest.json](../dialogue-generator/examples/pps-force-v1/manifest.json) сохраняет свою версию. Универсальный загрузчик нового формата runtime ещё не реализован.

## Ограниченный локальный профиль ДПС — N59, 25 октября 2026

В `services/category-runtime/service/conversation/dps-profile.mjs` реализован отдельный private reader текущего комплекта ДПС. Локальное подключение задаётся явно: `createConversationService({dataDir, getActive, getBundle, dpsProfile: createDpsProfile()})`. Без этой опции существующие маршруты не переключаются. Это не включение категории в production или UI.

Профиль принимает только исходные bytes SHA-256 `1be540a5d06d3798462c83564d81ce3289cd4e50c383fcd19d572584b7682af2` и NEXT `ea74da6a787a527a4a2488b260be4d8f89cbab1aaf975de69025d8b2b734a791`. Private policy `conversation/policy/dps.v1.json` перепривязывает 83 ответа, 51 определение и 43 вопроса; 73 прежние реплики сохранены с условиями. Вопрос показывается только при полезном достижимом изменении помощи. Всегда доступны лишь уместные действия; отправка, согласие и открытие документов этим профилем не подключены.

Публичный v2 validator не ослаблен. Выбранный источник ДПС является private assembly с дополнительным envelope; в шести document_check masks отсутствует held key required_document_missing. Reader допускает только этот exact pinned snapshot и эти шесть известных отсутствий. Отсутствие не становится false или наблюдением пользователя. Это не сертификация общего public JSON и не разрешение изменять исходник.

Семь producers/scope остаются HOLD: exit_basis_explained, result_disputed, required_document_missing, right_to_drive_valid, оба stage-specific seizure_record_created и deadline_restoration_reason_present. Их 30 зависимых строк и v71 с неподтверждённой фазой not_started не выбираются. Все существующие IDs и тексты сохранены; совместимая общая помощь остаётся доступной.

`dps-interpret.mjs` поддерживает ограниченную грамматику явных наблюдений и ответы на текущий вопрос. Это не общий распознаватель произвольной речи: нераспознанное сообщение не заполняет context. Explicit unknown и отсутствие факта различаются. Протокол, постановление, автомобиль и процедура имеют отдельные subject bindings; их смена не обнуляет лимит. Два вопроса на весь случай, одна pending-квитанция, третья карта пуста. История, повторная доставка, atomic save и outbox используют общий механизм. После перезапуска вопрос не считается ответом и не расходует ещё одну пару.

Локальные tests: `dps-package.test.mjs`, `dps-conversation.test.mjs`; для второго задать `DPS_DM_TEST_ROOT` внутри отдельной папки результата, а `DPS_DM_TRACE_FILE` — для фактических traces. Отчёт N59 находится в `_work/dps/dialogue-manager-implementation/20261025-v1`. Изменения не доказывают UI/production readiness, актуальность законов или независимую проверку; шаг 4 назначается отдельно. DOCUMENT остаётся без правок.

### Контроль с исправлениями N60

Отрицание принадлежности участника к ДПС проверяется до положительного совпадения. Сообщение о другом участнике не записывает факты действий инспектора; утративший область вопрос закрывается без подстановки значения поля. Неоднозначная ссылка на два документа или участников также не создаёт факт. Для документов используется существующий вопрос «Какой документ вы имеете в виду?», для участников — «Кого вы имеете в виду?», только в пределах оставшегося общего бюджета.

В текущей ограниченной грамматике текст в кавычках и явно обозначенные цитаты/гипотезы не служат источником наблюдений. Это консервативная граница распознавания: произвольные смешанные рассказы требуют отдельного расширения и проверки. Для распознанных отдельных утверждений сохраняются собственные дословные цитаты и полуинтервалы Unicode code points исходной реплики, включая сообщения о новом происшествии. Лимит вопросов при смене предмета или уточнении участника не сбрасывается.

Шесть контрпримеров, исправления, исходные неуспешные и окончательные локальные прогоны сохранены в `_work/dps/dialogue-manager-final-control/20261025-v1`. Семь HOLD, ограничение v71, private-schema исключение, недоступность DOCUMENT/backend и отсутствие UI/production подтверждения сохраняются. Проверка выполнена в том же чате с прежним участием в реализации; она не является независимым аудитом.


## Ограниченный локальный профиль detention_guide — DT21, 25 октября 2026

Локальный профиль создаётся через createDetentionGuideProfile() из services/category-runtime/service/conversation/detention-guide-profile.mjs и явно передаётся в createConversationService({dataDir, getActive, getBundle, categoryProfile}). Параметр categoryProfile принимает только detention_guide; одновременный dpsProfile отклоняется. Без явной опции прежние PPS/DPS маршруты сохраняются. Это локальная реализация до отдельного STEP4; production/UI подключение не выполнялось.

Reader допускает только source SHA-256 91818a46d822acf0325ef8e1b2dc786034cb0a328e9897746c9978ee6531f149 и внешний NEXT 16f7cc30629833ab88522ed0b792140d4f0ea1ce569cde73677282ee89f70d22. Приватный envelope и порядок ключей сохранены; public validator не ослаблен. Политика policy/detention_guide.v1.json привязывает48существующих полей,472ответа и17вопросов. Старые тела в NEXT не отображаются: помощь берётся из текущего source по ID.

Используется общий ledger, identity/revision/nonce, atomic commit/outbox и case receipts. Два вопроса на весь случай включая routing/conflict, одна pending-квитанция, карта третьего вопроса пустая. История неизвестности и предметов сохраняется; смена stage/документа/эпизода/версии не пополняет бюджет. Лишь явно сообщённый отдельный случай начинает новый allowance. Неизвестная прежняя policy отклоняется до записи: автоматический rebase неподтверждённых версий не реализован.

Выбор существующего ответа требует точного равенства всех установленных material conditions с закреплённой строкой; никакого первого/самого подробного mask.136строк зависят от шести qualified predicates и остаются закрытыми: оба protocol_missing, search_protocol_created, extended_admin_basis_named, three_hours_elapsed, forty_eight_hours_elapsed. G01–G08 из принятого DT20 сохраняют safe_deferred: спорные права/citizenship/отношения/понятые-видео/применимость судебного решения остаются raw, без придуманного юридического вывода. Ограниченная грамматика не покрывает произвольную речь и не является подключённым form/LK producer. Точные ограничения перечисляются в criteria-and-traces и remaining поставки DT21.

Health означает injury OR illness OR medicine need и не задаёт срочность. Фактически нужная помощь выводится сразу, до уточнений. Изъятие вещи помимо телефона не требует способности её назвать. Поздний возврат сохраняет событие изъятия и закрывает выдачу устаревшего специального совета для этого досмотра. Запрос копии и наблюдаемый результат связаны с конкретным документом. Where_to и законы неизменны; documentActionsUnavailable остаётся true.

Локальные tests: detention-guide-package.test.mjs и detention-guide-conversation.test.mjs. DT_DM_TEST_ROOT должен указывать на отдельную папку тестовых сессий; DT_DM_TRACE_FILE задаёт файл фактических traces. Поставка и результаты: _work/detention_guide/dialogue-manager-implementation/20261025-v1. DOCUMENT долги OPEN, актуальность законов NOT_ASSESSED; rollout, API/UI, Qdrant и native forms не проверялись.


### DT22 — scoped final control, 25 October 2026

The exact DT21 source/NEXT/policy pins remain unchanged. DT-only corrections now reject finite modal, quoted (including multi-clause), question and reported-negation inputs; raw observations remain available. A current coercion statement may establish pressure without establishing the demanded signature. Independently asserted clauses can retain different topic facts and render their current source actions together. This is a bounded grammar, not a universal language model or a new producer for the twelve raw-only fields.

Later item-return signals accumulate across clauses and urgent-help output precedes return notices. A conflicted lawyer request cannot donate a trusted same-request mirror; explicit correction/withdrawal retires old conflict projections while retaining their evidence. Generic withdrawal targets only a uniquely identifiable previous observation, never an unanswered question; ambiguous withdrawal preserves facts. A copy for an unspecified other document cannot satisfy the current document request.

All six qualified HOLDs and their 136 dependent rows, six ambiguous subcases, two-question whole-case budget, empty third-question reasons, one pending question and unchanged public validator remain. Unknown predecessor policy is rejected without rewriting saved bytes; no migration certification is implied. Sources, IDs, laws, where_to and DOCUMENT remain immutable. Exact commands, limits, before/after SHA and actual STEP4 results are recorded under _work/detention_guide/dialogue-manager-final-control/20261025-v1. This local control does not activate any service, production, UI, API, import, or DOCUMENT action.

## Ограниченный локальный профиль «Телефон и полиция» — PH22, 25 октября 2026

`createPhoneProfile()` из `services/category-runtime/service/conversation/phone-profile.mjs` передаётся в существующий `createConversationService({ categoryProfile: profile, ... })`. Это отдельный opt-in для локального подключения, без изменения стандартной загрузки PPS/DPS/DT и без server activation. Публичный validator не изменяется. Private reader принимает только exact source SHA `2cd98f3e95b61c44d176088f0e9b29d9bc26bbc6f9ac69bd8470e9c1e78990ef`, внешний NEXT SHA `1ca6c6e31247d2c8c714a211481eb6227f678cc5e82647c4d1a3d5289ffefd85` и все семь pinned компонентов из phone policy. Ответы берутся из текущего source с проверкой accepted current-answer-lookup. Исторические pending headers не заменяют PH18/PH19 приоритет.

Профиль использует общие identity/atomic state/ledger/pending/served receipts/nonce/outbox/replay. Его scope adapter разделяет case/person/action/handset и relevant account/cloud-operation/data/recording/protocol/request; журнал старого предмета сохраняется. Два directional cross-stage links допускаются только через `profile.link` с independently bound source/destination и проверенными event/object identity. Автоматическое распознавание таких связей из произвольной речи не заявлено. Технические `selectScope/admit/link` не являются клиентским API: клиентские context, source masks, article/ID и старый DOCUMENT не поставляют факты.

53 existing field keys сохранены. Пятнадцать occurrences пяти qualified типов остаются producer HOLD; 109 dependent IDs недоступны. Шестой qualified тип — существование протокола — поддерживает только принятые attributed user reports с basis (видел конкретный протокол / сотрудник сообщил о несоставлении). Отсутствие копии ничего не доказывает о существовании. Три наблюдаемых поля остаются raw-only для распознавания: seizure_protocol_created, phone_listed_in_protocol, copying_recorded_in_protocol. Остальное распознавание ограничено буквальными правилами/текущими вопросами; полного NLU и полной extraction matrix для всех35 nominal bounded occurrences нет.

13 original NEXT, 25 serialized source occurrences/75 branches и58 исходных cold paths переиспользуются; исходник не редактируется. Каждое решение повторно проверяет216 admissions, content_applicability и sent-request/protocol guards; source null остаётся wildcard. Общий бюджет —2 на весь case, включая service questions; третья карта пустая. После known TFU/answered null повторов нет. Новый предмет, stage, resume и версия не создают бюджет. Неизвестная predecessor policy/source закрывается, автоматическая миграция не заявлена.

Локальные tests требуют `PH_DM_TEST_ROOT` в отдельной assigned output и по желанию `PH_DM_TRACE_FILE`. Синтетика — dev/regression, не независимый holdout. Source32 и прежние приёмки сохранены. Owner point1 разрешает полный factual draft при неизвестных данных, но формы/экспорт/каталог/DOCUMENT backend здесь не реализованы; document actions недоступны. DOCUMENT debts, юридическая актуальность и отдельная STEP4 приёмка остаются отдельными gate. Развёртывание, UI/API/live services/import не выполняются.

## PH23 — ограниченный контроль с исправлениями, 26 октября 2026

`phone-police.20261026.v2` сохраняет source/NEXT и все семь frozen компонентов. Изменены только private PH interpreter/profile/policy/test и этот раздел. Общие service/state и профили PPS/DPS/DT остаются точными байтами принятой PH22 базы. Старые PH22 policy sessions отклоняются без переписывания истории и сброса бюджета; автоматической миграции нет. Локальный opt-in не активирует сервер.

Наблюдение поля текущего установленного действия само по себе не переключает stage. Явная смена темы/новое действие по-прежнему маршрутизируется отдельно и требует области предмета. Вложенное упоминание внутри проверенных форм неизвестности, планов, чужой речи, кавычек, условных и вопросительных реплик не становится фактом. Противоречащие самостоятельные утверждения, в том числе о силе и протоколе, проходят через общий conflict ledger. Цитаты и spans сохраняют исходные пробелы и Unicode code points. Границы слов отделены от совпадения подстроки; слово «был» не является меткой протокола «Б».

Неопределённость нового предмета сохраняется после общей просьбы помочь и исправления без указания предмета. Явная идентификация предмета может восстановить соответствующую сохранённую область. Пароль аккаунта не считается раскрытым паролем телефона; письменный отказ принять заявление не означает отказ вернуть телефон. Распознавание местоимений, произвольной речи и отношений между несколькими действиями остаётся ограниченным: неподдержанная форма сохраняется raw/HOLD. Полная модель русского языка не заявлена.

В PH23 проверены все35 nominal bounded field occurrences: конечный синтетический корпус 17 семейств на поле, включая две минимальные пары, literal provenance, коррекцию/конфликт/позднее завершение, unknown без вопроса и специфичную смысловую границу. Это scoped service fixtures с независимо установленными темой/участником/предметом, а не35 cold-start распознавателей. Unknown на существующий вопрос проверен отдельно для всех13 original NEXT; для22 полей без такого вопроса он не выдумывается. Формы с местоимениями проверены на raw/HOLD, точность на независимом holdout не измерялась. Все15 qualified occurrences/109held IDs и3 raw-only поля сохранены. Точные команды, исходные провалы, исправления и окончательные результаты находятся в `_work/phone_police/dialogue-manager-final-control/20261026-v1`.

Owner point1 разрешает полный фактический черновик при неизвестных данных. Реальная выгрузка/DOCUMENT backend,11 технических долгов документов, current form/LK, UI/API, rollout и legal currentness этим контролем не закрываются. После поставки — STOP до отдельного решения; автоматического следующего этапа нет.

## Flooding C49 — bounded local integration, 26 October 2026

`createFloodingProfile()` from `services/category-runtime/service/conversation/flooding-profile.mjs` is passed to the existing `createConversationService({categoryProfile: profile, ...})`. It is a local opt-in profile. Default PPS/DPS/DT/PH startup, public validators and production activation are unchanged. The only common-code changes add flooding to two category checks in service and two state/subject checks. Original mixed line endings are retained.

The private reader pins the current 53-row, eight-stage source (`70ff5ee1796b8ecd379c47ebb01b003f41e6e477ec1186949f6aa06148e95507`), accepted option2 NEXT (`ee7d03433c483fc08aba2c1fd6d03218e9c6f87c270be69764434f0d5667850f`), current lookup, native requests, all53/all105 bindings and acceptance/source-priority components. Public payload.next remains empty. It registers all35 questions through the common question validator, checks186 native uses and503 possible target compositions. Compatibility lists are not executable final edges or facts. All53 retained masks are checked with true/false/null semantics and unique qualified specificity.

The profile reuses shared identity, ledger, pending/served receipts, revision/nonce, atomic commit and outbox/replay. It scopes observations by incident/episode/role/actor/apartment and relevant component, inspection/act revision, claim/addressee or insurer/payment. Technical selectScope/admit functions are internal trusted-conversation seams, not client input. Client facts, masks, IDs, article text and old DOCUMENT never supply facts. No cross-stage homonym projection is enabled. Current self references retain an already identified own apartment. Generic unknown/new objects stay raw/HOLD until identified.

All35 accepted factual questions support exact native captions and bounded current literal assertions. Access absent=true, present=false; bare yes/no to the neutral access prompt is not interpreted. Insurance amount dispute is the accepted actual-payment AND amount-dispute predicate; it is not a legal underpayment decision. Thirteen qualified omissions remain producer HOLD and34 dependent rows remain unavailable;19 rows without those dependencies are not universal cold-start coverage. The partial cause/source predicate is unresolved and never assigned AND/OR semantics. Full NLU, independent holdout accuracy and arbitrary multi-actor conversation understanding are not claimed.

One pending and whole-case2 apply across topics, objects, resume/restart and all question origins. Third reasons are empty; the proposed insurance exception is not activated. Known true/false and answered null are skipped; source-mask null cannot erase history. Corrections, withdrawal, conflict, prerequisites, later access/leak state and historical receipt/capture are separated. New urgent accepted help precedes questions while earlier compatible help remains referenced.

Local tests require FLOOD_DM_TEST_ROOT under an assigned isolated output; FLOOD_DM_TRACE_FILE captures synthetic dev/regression traces. Exact commands, prior failures/corrections, before/after hashes and final results are in `_work/flooding/dialogue-manager-implementation/20261026-v1`. The five existing DOCUMENT debts, forms/export/catalog, UI/API/deployment, source legal currentness and separate STEP4 review remain open boundaries. This implementation does not close or publish the category.


### Flooding C50 bounded final control — 2026-10-26

The opt-in flooding profile now uses private policy version flooding.20261026.c50.v1. Public category, NEXT, laws, IDs and document links remain byte-identical. Earlier C49 saved sessions fail with FLOOD_POLICY_VERSION_UNAVAILABLE before writes; there is no automatic migration or question-budget reset. Reuse of old observations requires a separate reviewed migration because earlier parsing could admit quoted, planned or foreign reports.

Within the finite supported grammar, nonasserted headers suppress fact extraction, multiple object IDs hold scope, and correction/later intent belongs to its own clause. A newly identified act cannot inherit old act-text availability; an unidentified replacement/revision retires the act binding. Ambiguous/foreign scope selects compatible general help while retaining history. Unsupported pronouns and typos remain raw; this is not universal Russian NLU.

The existing 13 qualified predicates and 34 dependent variants remain unavailable. The partial cause/source predicate is unresolved, third-question reasons remain empty, and the whole-case limit is two. Forms, document generation, production UI/API and rollout are not activated by this control.
## Ограниченный локальный профиль Госуслуг — GA19, 26 октября 2026

`createGosuslugiAccessProfile()` из `services/category-runtime/service/conversation/gosuslugi-access-profile.mjs` явно передаётся в существующий `createConversationService({dataDir, getActive, getBundle, categoryProfile})`. По умолчанию профиль не включён. Общие identity/revision/nonce, журнал, квитанции вопросов, атомарное сохранение, replay и outbox используются из существующего сервиса. Подключение к серверу, UI/API, Qdrant и DOCUMENT этой реализацией не выполняется.

Reader принимает только source SHA256 `3cb77472a69cfd86636405b6f468a044028058a4703351434195e1d0abd24021` и отдельный NEXT `fcf021e6abf069f98b2a0eefa939065106eeb24e445952acb47c18bee53b5ac2`, точную private policy и её два компонента. Исходный private envelope и пустые payload.next сохраняются. Public validator не изменён. Пустой status.next в копии категории не означает отсутствия принятого NEXT: отдельно сохранены 17 вопросов, 33 узла, 99 ветвей и 74 конечных пути. Тексты всех 376 ответов берутся только из текущего source; 37 общих фрагментов сверяются по значениям/хешам. Исторические GA11/GA13 тексты не используются как запасной показ.

Все 47 полей описаны. Ограниченная грамматика распознаёт точные текущие наблюдения для 44 полей и ответы на все 17 принятых вопросов. Два stage-specific foreign_sessions_active и online_cancellation_available сохраняются raw/HOLD без квалифицированного producer. Фразы находятся в private policy; это конечная грамматика для локального прототипа, а не универсальное понимание русского языка. Нераспознанная реплика не становится false. Цитаты, гипотезы, чужие случаи, неопределённое местоимение, частичное составное наблюдение и опечатка вне грамматики остаются raw. Точные исходные цитаты, Unicode code-point spans и turnId сохраняются.

Привязка предметов в этом прототипе также ограничена: `parseGosuslugiScope` принимает явно названные логические метки аккаунта/попытки/записи/канала/источника/момента, например «моя учетная запись №пример; попытка входа №текущая». Это частные ссылки на сообщённые наблюдения, не серверные удостоверения личности и не реальные реквизиты. Отсутствующая область не заполняется из variant_id, маски, статьи или старого DOCUMENT. Существование полезной общей помощи не зависит от полного заполнения этих меток. Более свободное связывание предметов требует отдельного расширения и проверки; это ограничение текущего распознавания, не требование новой анкеты к пользователю.

12 видов implicit full-body prerequisites и 244 зависящие строки проверяются отдельно от масок. Четыре конечных producer наблюдений поддерживают отдельную видимую кредитную запись, наличие записи в конкретном отчёте, выполненную сверку официального контакта и явно показанный статус заявки без одобрения/выдачи. Это сообщения о конкретном источнике, не гарантия юридической истины. Остальные квалифицированные needs остаются HOLD: доступ в банк не доказывает возможность восстановления, незнакомое устройство не доказывает чужую сессию, изменение контакта не доказывает автора, а текст UI и применимость инструкции не угадываются. Сохраняются 349 ограничений холодной достижимости, два конкретных attribution HOLD и 12 межэтапных editorial offers без автоматической активации. Полные ответы допускаются по текущим scoped facts и всем условиям; при недостатке данных показываются точные применимые общие фрагменты.

Одна pending-квитанция и общий бюджет 2 распространяются на весь случай. Переход этапа/предмета, повтор, исправление и перезапуск бюджет не сбрасывают. Пустая default third map сохраняется. Единственное принятое исключение динамически проверяется для q_gosuslugi_access_restore_mfc_bank_identity_data_mismatch: реальные отдельные bank/MFC failure=true того же восстановления/аккаунта. Тогда максимум 3, никогда 4; T/F/U ведут к существующим v81/v79/v79 только после full-body guards. История T/F/explicit null подавляет повтор; missing value не является неизвестностью. Противоречие, явное исправление, отзыв и позднее изменение состояния сохраняют исходную историю и инвалидируют зависимости. Нераспознанное явное исправление удерживает полный ответ, сохраняя факты и общую помощь. Неизвестная прежняя policy отклоняется до перезаписи состояния.

Локальные проверки: `gosuslugi-access-package.test.mjs` и `gosuslugi-access-conversation.test.mjs`. Для второго обязательна `GA_DM_TEST_ROOT` внутри отдельной папки результата, `GA_DM_TRACE_FILE` сохраняет полные фактические traces. Результат реализации и ограничения: `_work/gosuslugi_access/dialogue-manager-implementation/20261026-v1`. Это STEP3 до отдельно назначенного контроля STEP4. Долги DOCUMENT OPEN, актуальность законов NOT_ASSESSED; независимого holdout и общей production readiness не заявлено.


### Контроль Госуслуг GA20 — 26 октября 2026

Локальная private policy получила версию `gosuslugi-access/20261026-v2`. Сессии GA19 с прежней версией отклоняются до записи; автоматического переноса старых наблюдений и сброса бюджета нет. Подключение по умолчанию остаётся выключенным.

Конечная грамматика теперь требует понятной рамки всего сообщения: неизвестная вводная, чужой рассказ, план, цитата или блок кода не позволяют извлечь соседнюю утвердительную фразу. Две разные ссылки на одну роль и несколько разных stage в одной реплике остаются неоднозначными. Это консервативная граница распознавания, не универсальное понимание речи. У понятых отдельных предикатов сохраняются собственные T/F/unknown и исходные цитаты. Область дополнительно проверяет исходную цитату, точные Unicode code-point границы, turnId, case/episode и версии источников для каждой роли.

Четыре вспомогательных наблюдения получили ограниченные отрицания/unknown, конфликт, явное исправление и отзыв. Противоречие закрывает зависимый полный ответ; обычное unknown не стирает прежний факт, явное исправление в unknown снимает подтверждение. Позднее сообщение о показанном статусе заявки обновляет только этот статус; совершённая проверка контакта не исчезает из истории. Нераспознанное явное исправление, в том числе с цитатой замены, удерживает полный ответ. Эти четыре наблюдения остаются сообщениями пользователя об увиденном или сделанном и не удостоверяют официальность, автора, законность, одобрение либо выдачу денег.

Три qualified-поля и восемь implicit prerequisites по-прежнему HOLD с доступной общей помощью; AC05/AC07 остаются частичными, AC06/AC12 — ограниченными. Исходные 376 ответов, NEXT, 37 фрагментов, документы и юридические даты не менялись. Реальные проверки, контрпримеры до правок, ограничения и точные файлы находятся в `_work/gosuslugi_access/dialogue-manager-final-control/20261026-v1`. Приёмка CENTRAL и готовность production — отдельные состояния.


## Ограниченный локальный профиль digital_access — DA17, 26 октября 2026

Профиль создаётся асинхронно через await createDigitalAccessProfile() из
services/category-runtime/service/conversation/digital-access-profile.mjs и явно
передаётся в существующий createConversationService({categoryProfile,...}).
defaultActivation=false. Общий service/state расширен только четырьмя строками
допуска digital_access; identity, ledger, served receipts, atomic commit и outbox
переиспользуются. Служба или публичный маршрут этим не включаются.

Private reader проверяет восемь exact stage-файлов, 291 исходный ответ,
56 полей, внешний NEXT и 43 принятых определения вопросов. Diagnostic
editorial-final-bundle не является входным answer bundle. Version hash составной:
восемь raw pins, текущие NEXT/catalog, decision contract, accepted fact/composition
helpers, lookups и отдельное evidence. Исходные файлы и public validator сохранены.
После pin-проверки импортируются только принятые чистые helpers independent-facts
и answer-presentation; authoring-next QA engine/session не импортируется.

Внешний NEXT содержит 1038 узлов/3114 ветвей. Ещё 146 узлов/438 ветвей поддержанного
DM закреплены в DA14 acceptance. Их 3552 использования сохраняются как разные
контейнеры evidence. 2529 динамических отображений не создают новые variant_id.
Два security composites вычисляются только из независимых листьев; старые
aggregate события не раскрываются в листья. Настройка экрана относится к способу
разблокировки до утраты. Отсутствующие резервные коды сервиса имеют N/A.
Имя remote_lock_completed сохраняется, но принятый вопрос означает запуск команды,
а не подтверждённое завершение стирания/блокировки. Реальные команды не исполняются.

Распознавание ограничено перечисленными буквальными наблюдениями, текущими
кнопками и явными ссылками читателя на свой аккаунт/устройство/номер/сервис/обращение.
Неизвестный ввод, неполная часть составного утверждения, цитата, гипотеза,
неоднозначный субъект, чужая история и опечатка остаются raw. Это не полный NLU.
Новых context, supplemental вопросов и отдельной анкеты идентификаторов нет.
Из одиннадцати полей без принятого вопроса девять допускают только ограниченные
независимые сообщения с нужной областью; два financial qualified producers остаются
HOLD. Дополнительный вывод о согласии, преступлении, consumer contract, заражении,
банке/crypto или другом провайдере не производится.

История разделяет case/episode/owner и предметы полей. Результаты конкретного
обращения/операции требуют соответствующей independently reported ссылки.
Переноса по совпадению короткого имени между stage нет. Изменение контакта
переопределяет область checked/owned, а исправление checked инвалидирует зависимое
ownership. Исторические события сохраняются. Неизвестная предыдущая policy
закрывается до записи, автоматическая migration/rebase отсутствует.

Один pending и два фактически выданных вопроса на весь случай через общий ledger.
DA thirdQuestionReasons пуст. Stage/аккаунт/номер/устройство/новая версия/перезапуск
лимит не пополняют. Известные true/false/null и фактические answered receipts
подавляют повтор; только явно отдельное происшествие начинает новый case.
Доступная совместимая помощь выводится до уточнения, qualified HOLD не закрывает
её целиком. Документы, native forms/export/catalog/render и production остаются
отдельными открытыми gate; source-laws currentness NOT_ASSESSED.

Локальные проверки: digital-access-package.test.mjs и
digital-access-conversation.test.mjs. Для native набора обязательны
DA_DM_TEST_ROOT и DA_DM_TRACE_FILE внутри папки результата.
Фактические команды, native traces, ограничения и результаты DA17 находятся в
_work/digital_access/dialogue-manager-implementation/20261026-v1.
Синтетические fixtures являются development/regression, а не независимым holdout
или доказательством понимания произвольных сообщений. STEP4 назначается отдельно.


### Digital access DA18 bounded final control (2026-10-26)

DA18 revalidates stored fact values, literal meaning, original user turn, source kind,
Unicode quote offsets and observation time before projection. A stored question answer
must still match its actually served question, offered value and original user reply.
Scope evidence is independently checked against the original scoped observation.
Ownership recovered from a receipt still requires its current checked prerequisite.
Corrections and withdrawals cannot rehabilitate a record whose original observation is
invalid. A changed subject or provider introduced after an observation in the same frame
is ambiguous; the whole frame remains raw and available compatible help continues.

These checks remain within the finite DA grammar. They do not authenticate arbitrary
filesystem replacement of the entire session or certify arbitrary natural language.
The original 52 bounded / 2 derived / 2 qualified financial HOLD distinctions, source
content, human criteria and whole-case two-question budget remain unchanged.
The implementation is private opt-in with default activation false. No public import,
UI/API or deployment readiness is implied. The DA18 evidence and complete final commands
are stored in _work/digital_access/dialogue-manager-final-control/20261026-v1.

## labor_disputes — bounded private profile, LAB27 STEP3, 26 October 2026

`createLaborProfile()` from `conversation/labor-profile.mjs` connects only through
the explicit `createConversationService({ categoryProfile: profile, ... })` option.
Default activation remains false. The exact accepted diagnostic source SHA is
`2efc29be2fe859ffd763ceeba0b3d2f06153be07658585ee6631f5f7091395e5` and external NEXT SHA is
`6659dd9c2a6bd64cb45db3e4f23003c72313fcd603b91c41a73cfeb9191ba71f`.
The private policy also pins current lookup, all1664 current row bindings, catalog,
authority, semantic migration and private10. The diagnostic remains NOT_FOR_IMPORT.
The public validator is unchanged; embedded historical NEXT does not override the
accepted external catalog. Exact full answer/law/document-link values are preserved.

The profile uses common identity, atomic sessions, fact ledger, pending question,
served receipts, nonce, replay and outbox. It owns no parallel session map or question
counter. All57 existing fields have explicit dispositions:28 observation guidance
fields support the finite literal grammar and current TFU replies;29 nonbridge
fields have no connected native producer and remain HOLD.1550 dependent existing IDs
are inadmissible.114 is a static upper bound of observation-only masks, not a native
coverage count. No legal/medical evaluator or client-supplied verified context is added.

Scope is bound to original user turns, employer, topic, literal period and any stated
job/contract/request/order/object. Unhandled narratives and ambiguous subjects remain
raw; ambiguous scope persists until explicit confirmation. The finite grammar is not
general NLU. Dates and amounts are recorded as allegations, without guessed years,
deadline arithmetic, pay calculation or legal qualification. Persisted sources are
rechecked for proposition/value/kind/quote/span/time/current scope. Receipt fallback
also checks the original served question and actual offered reply. Old policy versions
fail closed without automatic migration or budget reset.

The whole case has two questions, one pending and an empty LAB third-question map.
Known true/false and answered null are not reasked. An explicitly different incident
alone creates a new budget. Available accepted help precedes clarification. No accepted
labor urgent medical handler is connected: urgent coverage remains a declared HOLD.
Private10 voluntary raw reports do not become identity, canonical prompts or evaluator
facts. DOCUMENT/forms/catalog/export, serialization, currentness and production gates
remain separate. The completed343 finite LAB tests, affected regressions and limitations
are recorded under `_work/labor_disputes/dialogue-manager-implementation/20261026-v1`.
STEP4 requires a separate assignment; this local opt-in does not activate UI/API/import.

### Labor STEP4 control, 26 October 2026 (LAB28)

The preceding LAB27 section records the STEP3 delivery. LAB28's bounded control and
in-pass corrections use private policy `labor-bounded-DM/20261026-r28-v2`. The public
category, current NEXT, laws, destinations and document sources remain unchanged.

The finite interpreter now rejects a literal embedded in unsupported surrounding
clauses and detects conflicting period/job/contract/object declarations in one turn.
Child observations require an already established parent at admission; their proof
binds the exact parent record and source turn. Later establishment of a missing parent
does not retroactively activate an earlier unbound child.

Original user turns retain observation time and admission snapshots. Revalidation
compares value, operation, record identity, dependencies and source against that
snapshot as well as reparsing the original proposition. Served receipts bind exact
question text, controls, source/NEXT/policy and scope. A corrupted outstanding question
is rejected before a reply writes state. These are checks of server-owned history,
not cryptographic authentication against an attacker rewriting the whole filesystem.

The old LAB27 policy is rejected before write; there is no automatic migration. The
common service, identity, question counter and atomic persistence code are unchanged
in LAB28. Final native inputs, responses, state traces, code pins, correction groups
and finite criterion results are in
`_work/labor_disputes/dialogue-manager-final-control/20261026-v1`.

This remains explicit opt-in, with two questions per case and no third-question reason.
The 29 nonbridge producers and 1550 dependent rows remain disabled. Urgent medical
coverage remains HOLD; available accepted guidance is retained. No arbitrary-language,
all-1664 native coverage, currentness, DOCUMENT, UI/API, import or production readiness
is certified. CENTRAL's exact STEP4 acceptance and writer release are separate.

## Ограниченный локальный профиль «Приставы» — BA26, 26 октября 2026

createBailiffsProfile() из services/category-runtime/service/conversation/bailiffs-profile.mjs передаётся явно в createConversationService({categoryProfile, ...}). По умолчанию он не включён; сервер, HTTP/API и UI не подключались. Единственная общая правка — регистрация bailiffs в существующих allowlist service/state. Сессии, факты, pending, вопросные квитанции, revision/nonce, atomic commit, replay, outbox и бюджет использует общий runtime.

Reader закрепляет выбранную BA24 категорию SHA ba0c0a5b34480fadb23c3b87d1ec31c91500e252354f376eab8d67923c1c7123 и пять компонентов принятого анализа BA25. Все30 полных ответов, контексты, retrieval, законы, where_to и встроенный NEXT сверяются до показа. Исторический BA21 lookup не восстанавливает прежние вопросы двух изменённых вариантов. status.next=null не означает отсутствие NEXT. Текущий неизменённый schema-reader принимает этот пакет; это наблюдение не открывает production gate. Для совместимости используется его существующий createExplicitEngine, без отдельного счётчика и запуска второй цепочки.

59 полей сохранены. Только16 существующих NEXT-предикатов поддерживают ограниченные буквальные наблюдения и ответы на актуальный вопрос; остальные43 — raw/HOLD. Это сообщения пользователя, не проверенная юридическая истина: verified, canonicalContextWrite и evaluatorInput остаются false. Полные исходные условия и исключения сохраняются. Произвольная речь, новые вычисления сроков/сумм, законность, защищённость дохода, собственность и право на приостановление не определяются.

Область связывает явно сообщённое лицо/роль и производство, а также нужные постановление/акт, банк/счёт, плательщика/выплату, вещь и заявление. Числовые технические идентификаторы не обязательны. Смена текущего производства закрывает старые проекции в других stage; история сохраняется. Одноимённые поля между stage не копируются. Единственный исходный переход account_arrest→money_writeoff_general завершает уточнение и не устанавливает новые факты целевого stage.

31 исходный узел/93 ветви/70 путей и16 формулировок переиспользуются. Все источники вопросов используют общий лимит двух пар, одну pending-квитанцию и пустую карту третьих вопросов. «Не знаю» не становится «Нет»; отвеченное поле не спрашивается под другим alias. Исправление, отзыв, конфликт, поздний ответ или отмена события сохраняют provenance и меняют применимость. Продажа, которая уже состоялась или отменена, не получает специальный совет действовать до продажи. Неизвестные source/policy и устаревшие кнопки отклоняются.

Локальные tests: bailiffs-package.test.mjs и bailiffs-conversation.test.mjs. BA_DM_TEST_ROOT должен находиться в назначенной папке _work/bailiffs/dialogue-manager-implementation/20261026-v1/. Полные входы, ответы и состояния сохраняются как синтетические service traces; независимый holdout и универсальное понимание речи не заявляются. Реальные результаты и прежние неуспешные прогоны находятся в этой поставке. STEP4 назначается отдельно.

44 условных DOCUMENT/138 потребностей и семь технических долгов остаются OPEN. Законы и where_to сохранены, documentActionsUnavailable=true. Native-формы, экспорт, production ID, актуальность права, публикация, Qdrant и внешняя интеграция не сертифицированы. Исходники категории, документы и ARTICLE не изменялись.


### Bailiffs BA27: bounded STEP4 corrections, 2026-10-26

The private opt-in policy is now bailiffs.ba27.20261026.v2. BA26 sessions fail closed; there is no automatic migration, rebase or new question allowance.

A fact admission binds its stored value, supersedes list and exact parent record revision. Projection and further correction revalidate the full original chain, including historical user turns and original button offers. A corrupted predecessor is not repaired by a later correction. This is a server-owned cross-check, not whole-filesystem cryptographic authentication.

Each served BA question additionally binds the original persisted response, question text, ordered captions and native controls. Short text TFU uses that same receipt validation; an edited original offer fails before saving.

Compound scope descriptions joined by Russian and/or, and the bounded inflected references to a different proceeding, debit, payment or other object, remain raw/HOLD until an explicit unambiguous binding. This conservatively includes some genuine multiword object names; it is not full Russian NLU. Existing accepted question texts, source answers and laws are unchanged.

The added adversarial tests are in bailiffs-conversation.test.mjs and write only to the BA27 test root. All sixteen existing observations remain unverified user guidance; forty-three fields retain raw/HOLD. The common service/state, explicit engine, counter and other categories are unchanged from accepted BA26. Default activation, production readiness and category closure remain false. DOCUMENT and law-currentness gates remain open.
