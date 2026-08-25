# FINDING — страница «Заявки клиентов» (`page-requests`)

> Диагностика, режим только чтение. Ничего в коде/БД не менялось. Проверка
> выполнена на изолированном локальном static-сервере (Node.js, порт 8934,
> отдаёт только статические файлы репозитория — PHP не выполняется, боевая
> MySQL не задействована и недостижима: `api/config.php` в рабочей копии
> отсутствует, любой реальный `fetch('api/...')` уходит на тот же
> `127.0.0.1:8934` и получает 404). Данные в тестах — синтетические
> (`TEST-001`, «ТЕСТ Синтетика Ltd»), не боевые.

## Вывод коротко

**Страница технически достижима в обход меню — подтверждено живым тестом.**
Отдельного API за ней нет — данные уже приходят в браузер любой роли в
составе общего `GET /api/state`, и уже рендерятся в скрытый DOM на каждом
цикле `render()`, независимо от того, вызывался ли обход меню вообще.

**Уровень находки: ВАЖНО.**
(Обоснование уровня — в конце документа.)

---

## 1. Код, относящийся к странице

- HTML-блок: `<div class="page" id="page-requests">` —
  [index.html:1728-1740](index.html#L1728). Фильтры статуса
  (`filterRequests('all'|'new'|'in_production'|'ready'|'shipped', this)`),
  контейнер `<div id="requests-list">`.
- Рендер: `renderRequests()` — [index.html:6000-6042](index.html#L6000). Читает
  `state.requests`, без сети.
- Обработчик фильтра: `filterRequests(status, btn)` —
  [index.html:6044-6050](index.html#L6044) (единственное место, откуда
  `renderRequests()` вызывается по имени напрямую, кроме общего `render()`).
- `data-page="requests"` — **нигде не встречается**: ни один `.nav-tab`
  с таким атрибутом не генерируется, так как `ALL_TABS` (9 пунктов) его не
  содержит — [index.html:2529-2539](index.html#L2529). Подтверждено и в
  браузере: `document.querySelector('.nav-tab[data-page="requests"]')` → `null`.
- Собственных data-атрибутов доступа/роли у блока `page-requests` нет —
  никакой `data-roles`, `data-tab-required` и т.п. в разметке отсутствует.

## 2. Механизм показа страниц

**Роутера по hash нет.** Поиск `location.hash` / `hashchange` по всему
`index.html` — 0 совпадений. Показ страниц — только через вызов JS-функции.

**`showPage(id, btn)`** — [index.html:3745-3773](index.html#L3745) — единственная
точка показа. Разбор тела функции:
```js
function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`page-${id}`).classList.add('active');   // ← без проверки id
  ...
  render();
}
```
Функция **не сверяет `id` ни с `ALL_TABS`, ни с `getEffectiveTabs()`, ни с
`currentUser`/ролью** — она берёт `id`, ищет `#page-${id}` в DOM и включает
класс `active`. Проверка списком разрешённых применяется **только один раз** —
при генерации кнопок сайдбара, `getEffectiveTabs().map(...)` —
[index.html:3693](index.html#L3693). То есть: список вкладок фильтрует
**кнопки**, а не сам показ страницы. `showPage()` как функция открыта для
любого `id`, для которого в DOM существует `#page-<id>`.

### 2.1 Живой тест — обход меню

Открыт локальный офлайн-экземпляр (`?shop=1`, чтобы не улетать редиректом на
портал — по коду `leaveToEntryPoint()`, [index.html:3477](index.html#L3477)).
В консоли браузера (реальный JS-движок, не чтение исходников):

```js
currentUser = { roleId: 'warshchik', loginAt: Date.now() }; // роль tabs=['warshchik'] — ТОЛЬКО этот раздел
state.requests = [{ id:'TEST-001', client:'ТЕСТ Синтетика Ltd', status:'new', batchIds:[],
  date:'2026-08-25', brewDate:'2026-08-26', shipDate:'2026-08-27', brewHours:3, reactor:'Р-1',
  items:[{name:'Тестовый продукт', qty:10}] }];
showPage('requests', null);
```

Результат (зафиксирован фактическим состоянием DOM после выполнения):
- `document.getElementById('page-requests').className` → **`"page active"`**
  (было `"page"` до вызова).
- `getComputedStyle(...).display` → **`"block"`**, `visibility` → **`"visible"`**
  — не просто класс, а реально видимая страница.
- `#requests-list` заполнен полной карточкой заявки (клиент, товар, даты,
  реактор, прогресс).
- Роль, под которой выполнен вызов — `warshchik`, чьи `tabs` в `state.roles`
  фактически равны `["warshchik"]` (проверено: `state.roles.find(r=>r.id==='warshchik').tabs`
  → `["warshchik"]"`) — то есть самая ограниченная цеховая роль, у которой
  в норме нет доступа ни к одному другому разделу, кроме своего.
- Ошибок, редиректов, проверок прав — не возникло.

**Вывод: обход подтверждён фактическим выполнением, не выведен из чтения кода.**

### 2.2 Данные уже отрисованы ДО обхода — без вызова showPage вообще

Второй тест: после включения `page-requests` вернулись на легитимную страницу
роли — `showPage('warshchik', null)`. Результат:
- `document.querySelector('.page.active').id` → `"page-warshchik"` (страница
  переключилась как положено).
- `document.getElementById('page-requests').className` → снова `"page"`
  (визуально скрыта).
- `document.getElementById('requests-list').innerHTML.includes('ТЕСТ Синтетика Ltd')`
  → **`true`**.

То есть данные заявки остаются отрисованными в скрытом DOM-узле независимо от
того, какая страница активна. Причина — `render()`,
[index.html:4186-4212](index.html#L4186): единый список шагов рендера
выполняется **безусловно на каждый цикл** (`renderRequests` — один из шагов,
[index.html:4197](index.html#L4197)), без проверки текущей активной страницы
или роли. `showPage()` вызывает `render()` в конце всегда —
[index.html:3770](index.html#L3770). Значит для просмотра данных заявок не
обязателен даже вызов `showPage('requests')` — достаточно открыть DevTools →
Elements и найти `#requests-list`, либо выполнить `console.log(state.requests)`,
у любого залогиненного пользователя.

Комментарий в коде подтверждает, что скрытие из меню было осознанным шагом
(не забытым куском): [index.html:4221](index.html#L4221) — «раздел "Заявки"
убран из навигации — счётчик новых заявок больше не нужен» (внутри
`updateBadge()`). То есть удаление именно из **меню** документировано в самом
коде; про закрытие самих данных/страницы комментарий не говорит.

## 3. Отдельный API-эндпоинт — есть ли, и его защита

**Отдельного эндпоинта нет.** Полный список защищённых вызовов `apiFetch()`
и прямых `fetch(API_BASE + ...)` в `index.html`:

| Путь | Строка |
|---|---|
| `/ping` | [index.html:3248](index.html#L3248) |
| `/auth` | [index.html:3494](index.html#L3494) |
| `/state` (используется страницей заявок опосредованно) | [index.html:2781](index.html#L2781), [index.html:3175](index.html#L3175), [index.html:3318](index.html#L3318) |
| `/activity` | [index.html:3355](index.html#L3355), [index.html:3367](index.html#L3367) |
| `/logout` | [index.html:3547](index.html#L3547) |
| `/sso-users` | [index.html:7511](index.html#L7511), [index.html:7590](index.html#L7590) |
| `/branding`, `/whoami` | [index.html:3604](index.html#L3604), [index.html:3628](index.html#L3628) |

Список файлов в `api/`: `activity.php, auth.php, branding.php, import.php,
logout.php, ping.php, report.php, roles.php, sso_users.php, state.php,
whoami.php` — нет `requests.php`/`zayavki.php` или аналога.

`state.requests[]` приходит целиком внутри ответа `GET api/state.php` —
[api/state.php:11-24](api/state.php#L11): `SELECT data, rev FROM app_state
WHERE id = 1`, без какой-либо фильтрации по роли/вкладкам сессии. Проверка на
этом эндпоинте — `requireAuth()` (валидная сессия обязательна,
[api/state.php:8](api/state.php#L8)), но это проверка **«залогинен ли вообще»**,
а не «имеет ли право видеть раздел заявок». Ролевая/полевая фильтрация здесь
отсутствует: любая валидная сессия — включая `warshchik` и `intake`, чьи
клиентские вкладки ограничены одним разделом — получает **весь** `app_state`,
включая `requests`, `clients`, полные `batches`, `recipes` и т.д. Это и
объясняет результат теста в §2.2: данные не «утекают через отдельную дыру», а
уже присутствуют в памяти браузера любой роли как часть обычной загрузки
состояния.

## 4. Итог

- **Достижима технически: ДА.** Доказано вызовом `showPage('requests', null)`
  из консоли под ролью с `tabs:['warshchik']` — страница стала `active`,
  видимой (`display:block`), с данными. `showPage()` не проверяет `id` ни по
  какому списку разрешений — [index.html:3745-3773](index.html#L3745).
- **Отдельный API за страницей:** отсутствует. Данные приходят в составе
  общего `GET api/state.php`, который не фильтрует `data` по роли/уровню —
  единственная проверка на нём — `requireAuth()` (факт валидной сессии)
  [api/state.php:8](api/state.php#L8), [api/storage.php:463-476](api/storage.php#L463).
- **Более широкий факт (не ограничен страницей заявок):** данные раздела уже
  отрисованы в скрытом DOM на каждом `render()` для любой активной сессии,
  независимо от вызова `showPage('requests')` — сама функция обхода не
  обязательна, чтобы получить доступ к содержимому через DevTools.

### Уровень находки

**ВАЖНО.**

Не «КРИТИЧНО» — потому что: (а) для просмотра всё равно требуется валидная
аутентифицированная сессия (не анонимный доступ — `requireAuth()` в
`api/state.php` реален и подтверждён по коду); (б) раздел содержит только
данные заявок клиентов (имя клиента, товар/количество, даты, реактор) — не
пароли, не платёжные данные, не персональные данные вне контекста B2B-заказа.

Не «РЕКОМЕНДАЦИЯ» — потому что это не гипотетический недостаток, а
подтверждённый живым тестом обход UI-ограничения с полным раскрытием данных
раздела любой аутентифицированной роли, включая роли, для которых этот раздел
явно не предназначен (`warshchik`, `intake` — цеховые терминалы на общем
планшете, к которому потенциально имеет физический доступ более широкий круг
людей, чем к учётке `admin`). Отсутствие проверки в `showPage()` — не
единичный баг именно этой страницы, а системное свойство функции показа
страниц: то же самое верно для любого другого `id`, для которого в DOM
существует `page-<id>`, но нет пункта в `ALL_TABS` (если такие появятся в
будущем). Ролевая модель `tabs` в этом приложении, как показывает тест,
работает как **фильтр интерфейса**, а не как контроль доступа к данным —
контроль данных существует только на уровне «залогинен/не залогинен» и
отдельно на уровне `viewer` (запрет записи, [api/state.php:35-39](api/state.php#L35)),
но не на уровне «какие разделы state.* эта роль имеет право видеть».

Оценка серьёзности и решение (закрывать ли на уровне API-фильтрации по
роли/полю, ограничивать ли `showPage()` списком разрешённых `id`, или
считать риск приемлемым для однопользовательской производственной системы
одной компании) — вне рамок этой диагностики, решение владельца.

---

## 5. Масштаб

> Дополнение от 2026-08-25. Только чтение, решение об уровне находки —
> ниже, изменений в коде/БД нет.

### 5.1 Фильтр по company_id / org_id в `api/state.php`

**Фильтра нет — эндпоинт отдаёт единый глобальный state всем ролям
одинаково.** Полный текст GET-обработчика:

```php
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $row = $db->query('SELECT data, rev FROM app_state WHERE id = 1')->fetch();
    ...
    echo '{"rev":' . (int)$row['rev'] . ',"data":' . $row['data'] . '}';
```
[api/state.php:11-24](api/state.php#L11) — ни `WHERE`, ни любой другой SQL-предикат
не содержит признака организации; ни до, ни после `SELECT` в PHP нет фильтрации
или обрезки JSON по ролям/полям. Единственное встроенное имя таблицы/строки —
жёстко заданный `id = 1`. То же в `POST`-ветке (запись) —
[api/state.php:55,83,86](api/state.php#L55): `WHERE id = 1` /
`INSERT ... VALUES (1, ...)`. Фильтра по company_id/org_id в PHP-коде эндпоинта
нет ни в одной ветке.

### 5.2 Поле company_id / org_id в схеме

**Физически не существует.** Поиск `company_id|companyId|org_id|orgId|
organization_id` по всему репозиторию (код + `_методология` не входит в
область; репозиторий проекта) — **0 совпадений**. Полная схема из
`bootstrapSchema()` и отложенных миграций
([api/storage.php:110-308](api/storage.php#L110)) — 7 таблиц (`app_state,
roles, sessions, activity_log, login_log, rate_limit, sso_role_map,
portal_verify_cache`) — ни у одной нет колонки, отвечающей за
принадлежность компании/организации. Таблица `app_state` устроена как
**одна обязательная строка**: `id TINYINT NOT NULL PRIMARY KEY`, и везде в
коде адресуется буквальной константой `id = 1` — встречается в 5 разных
местах: [api/import.php:28](api/import.php#L28),
[api/report.php:47](api/report.php#L47), [api/state.php:12](api/state.php#L12),
[api/state.php:55](api/state.php#L55), [api/state.php:83](api/state.php#L83).
Разграничение по компании в схеме не существует — и не может быть
добавлено без изменения структуры таблицы (`id` не свободен для второго
значения, весь код жёстко ожидает единственную строку `id=1`).

### 5.3 Фактическое использование более чем одной компанией

**Прямой проверкой (SQL к боевой БД) не подтверждено и не может быть
подтверждено в рамках этой диагностики** — рабочая копия не имеет
`api/config.php` (креды в `.gitignore`, живут только на сервере — см.
[CLAUDE.md](CLAUDE.md)), доступа к боевой MySQL у этой сессии нет, и
подключаться к ней впрямую запрещено правилами проекта («никогда не
запускать/проверять приложение способом, который может вызвать запись/
обращение к боевой БД»).

Однако вопрос закрывается на уровне архитектуры, а не данных: поскольку
`app_state` физически ограничена одной строкой (`id` — `PRIMARY KEY`,
везде используется только значение `1`), система **структурно не может**
хранить раздельные данные более чем одной компании одновременно — в ней
буквально нет места для второй компании, есть она сегодня фактически или
нет. Это не наблюдение по данным, а следствие DDL: `SELECT DISTINCT` по
полю принадлежности невозможен, потому что такого поля не существует, а
самих строк, из которых можно было бы выбирать `DISTINCT`, в таблице
никогда не бывает больше одной.

### 5.4 Другие чувствительные разделы `state`, уходящие всем ролям безусловно

Просмотрен полный список корневых полей `state` (§4.2 в `ТЗ_Manufacture_v2.0.md`,
не редактировался, использован только как опись) на предмет: финансовых
показателей, персональных данных сотрудников, зарплат, контактов.

**Зарплат, окладов, финансовых показателей (выручка/маржа/себестоимость),
персональных контактов сотрудников (телефон/адрес) в модели `state` не
найдено.** Проверено:
- `state.clients[]` — массив простых строк-названий, не объектов: «Создавайте
  клиентов простым названием» — [index.html:2062](index.html#L2062),
  дефолтные значения `SAMPLE_CLIENTS` тоже просто строки —
  [index.html:2633](index.html#L2633). Полей телефона/адреса/контакта нет.
- `state.roles[]` — объекты собираются на клиенте только с полями `{id, name,
  login, password, tabs, fields, fullAccess}` — [index.html:7924](index.html#L7924),
  [index.html:7930](index.html#L7930); поле `password` сервер вырезает перед
  сохранением ([api/storage.php:517-519](api/storage.php#L517)). Колонки
  `roles.email` и `roles.telegram_chat_id` в БД существуют
  ([api/storage.php:134-135](api/storage.php#L134)), но ни разу не
  используются при сборке `state.roles` — ни клиентской формой роли, ни
  `rolesForState()` ([api/storage.php:487-501](api/storage.php#L487),
  отдаёт только `id, name, login, tabs, fields, fullAccess`) — поэтому
  email/Telegram сотрудников в общий `state` не попадают.
- Поиск `зарплат|salary|оклад|ставка|себестоим|revenue|salary|wage|маржа|
  выручка|доход` по `index.html` — 0 релевантных совпадений (единственное
  совпадение — «не доходит» в комментарии о прогресс-баре,
  [index.html:3995](index.html#L3995), к теме не относится).

**Но по тому же паттерну — весь раздел уходит всем ролям безусловно,
независимо от вкладок — размещены ещё два раздела, не относящиеся к
финансам/личным данным, но чувствительные для производственной компании:**

1. **`state.recipes[]` — полные рецептуры (состав сырья и пропорции по
   каждому SKU).** Раздел «Рецептуры» в UI помечен как доступный только из
   админ-панели («Состав сырья и время варки по продуктам» —
   [index.html:1942](index.html#L1942)), но сами данные — часть общего
   `state`, отдаваемого целиком любой сессии тем же `GET api/state.php`
   ([api/state.php:11-24](api/state.php#L11)). Формула продукта — прямой
   аналог коммерческой тайны/ноу-хау для производителя бытовой химии; она
   так же доступна `warshchik`/`intake` через `console.log(state.recipes)`
   без вызова `showPage`, как заявки клиентов в §2.2.
2. **`state.roles[]` — полный список внутренних логинов и структуры
   доступа компании** (без паролей, но с `login`, `name`, `tabs` каждой
   учётки) — тот же путь доставки, тот же обход. Само по себе не
   критично, но раскрывает организационную структуру системы (кто есть
   кто, какие роли существуют) любому, кто откроет DevTools под любой
   ролью.

### 5.5 Проверка ещё двух ролей — паттерн системный

Тем же методом (`showPage('requests', null)` из консоли на изолированном
офлайн-стенде, синтетические данные), дополнительно к `warshchik` (§2.1):

**Роль `intake`** (`tabs: ["intake"]`, [index.html:2584-2586](index.html#L2584)) —
`currentUser = {roleId:'intake'}` →
`page-requests` class `"page"` → `"page active"`, `display:block`,
`#requests-list` содержит тестовые данные (`ТЕСТ Розлив Ltd`). Идентично
`warshchik`.

**Роль `operator`** (`tabs: ["dashboard","production","weekplan","calendar",
"reports","journal"]`, `requests` в списке нет — проверено программно:
`tabs.includes('requests') === false`) —
`currentUser = {roleId:'operator'}` → `showPage('requests', null)` →
`page-requests` `display:block`, `#requests-list` содержит тестовые данные
(`ТЕСТ Оператор Ltd`).

Все три протестированные роли (`warshchik`, `intake`, `operator`) —
с разным набором `tabs`, от 1 до 6 вкладок из 9 — одинаково не встретили
никакой проверки в `showPage()`. Паттерн подтверждён как системное свойство
функции показа страниц, а не особенность одной роли.

### 5.6 Вывод по масштабу — есть ли основания поднять уровень до КРИТИЧНО

**Оснований поднять уровень до КРИТИЧНО не найдено. Уровень ВАЖНО
остаётся в силе**, со следующими уточнениями по итогам расширенной проверки:

- **Межкомпанийской утечки нет и структурно не может быть** — схема не
  просто «не фильтрует по компании», она физически не способна хранить
  более одной компании одновременно (`app_state` — ровно одна строка,
  `id=1` захардкожен в 5 местах). Это закрывает самый тяжёлый сценарий
  («данные компании А видит компания Б»), который оправдывал бы КРИТИЧНО.
- **Периметр находки шире, чем одна страница заявок**, — это не
  отдельный дефект `page-requests`, а системное свойство: любая
  аутентифицированная роль получает целиком весь `app_state` (§5.1) и
  видит в нём ВСЁ, включая разделы, скрытые в её интерфейсе (рецептуры,
  список внутренних учёток, заявки) — подтверждено на 3 ролях (§5.5).
  Это довод за то, чтобы фиксировать находку не как баг одной страницы, а
  как архитектурное свойство модели прав («tabs — фильтр интерфейса, не
  ACL данных»), что и было изложено в §4 выше.
- **Новых категорий данных, поднимающих чувствительность до уровня
  критично** (учётные данные для входа, платёжные реквизиты, персональные
  данные сотрудников, зарплаты), не обнаружено — только бизнес-данные
  одной компании о самой себе (заявки, рецептуры, структура ролей).
  Рецептуры — по существу коммерческая тайна, что удерживает общую оценку
  на уровне ВАЖНО (а не «рекомендация»), но не переводит её в КРИТИЧНО в
  отсутствие межкомпанийского или credential-риска.

Решение — расширять ли scope фикса с «страницы заявок» на «модель прав в
целом» (rec/roles/requests как один класс проблемы) — вне рамок диагностики,
решение владельца.

---

## 6. Матрица доступа (по факту конфигурации)

> Дополнение от 2026-08-25. Только чтение, подготовка данных для будущего
> фикса — роли/права/`tabs` НЕ переосмысливаются и не оцениваются, только
> сводятся факты по существующему коду. Методологическое ограничение: для
> каждой вкладки собраны **прямые** обращения `state.*` внутри тела её
> `render*()`-функции (сплошной grep по всему файлу, забакечено по
> границам функций) плюс **точечно проверенные** косвенные обращения через
> общие хелперы (`getRoleById()`, `pmGetDateFilteredBatches()` и т.п.) —
> точечно, не по каждому хелперу файла. Там, где косвенный путь не
> прослежен построчно, это явно помечено «не подтверждено», а не молча
> опущено.

### 6.1 Роли — дословно из кода

| id | Источник | `tabs` (дословно) |
|---|---|---|
| `admin` | [index.html:2575-2577](index.html#L2575), `defaultRoles()` | `ALL_TABS.map(t=>t[0])` → `['dashboard','production','weekplan','calendar','warshchik','intake','reports','journal','admin']` |
| `operator` | [index.html:2578-2580](index.html#L2578) | `['dashboard','production','weekplan','calendar','reports','journal']` |
| `warshchik` | [index.html:2581-2583](index.html#L2581) | `['warshchik']` |
| `intake` | [index.html:2584-2586](index.html#L2584) | `['intake']` |
| `viewer` | [api/storage.php:97-103](api/storage.php#L97), `ensureViewerRole()` — серверный сид, вне `defaultRoles()` | `json_encode(['dashboard','reports','journal'])` → `['dashboard','reports','journal']` |

Дополнительно в [index.html:2657](index.html#L2657) (`applyStateMigrations()`) сохранён
**устаревший** вариант `operator: tabs:['dashboard','weekplan','calendar','journal']`
— срабатывает только как одноразовая миграция очень старых сохранений
(схема `state.passwords`), не текущий дефолт, живым источником не считается.

`sso_role_map.role_id` (только для SSO-входа) — не отдельный набор `tabs`, а
указатель на строку **той же** таблицы `roles`; `sso_role_map.level`
(`viewer`/`manager`/`admin`) — независимая ось «что можно делать», не
«что видно», уже задокументирована в §3 предыдущей находки.

**Граница метода:** это роли, заданные КОДОМ (сиды/дефолты). Полный список
строк реальной таблицы `roles` на проде (включая роли, вручную созданные
админом через UI) этой диагностикой не проверялся — доступа к боевой БД нет
и подключаться к ней запрещено правилами проекта.

### 6.2 Ключи верхнего уровня объекта `state`, отдаваемого `api/state.php`

`GET api/state.php` ничего не формирует и не фильтрует — он **дословно**
передаёт колонку `data` из `app_state` в обёртке `{"rev":N,"data":{...}}`
([api/state.php:11-24](api/state.php#L11)); форму самого `data` задаёт
исключительно клиент в момент `saveState()`. Поэтому «код сборки ответа» —
это код, который наполняет клиентский объект `state`: начальный литерал
[index.html:2463-2511](index.html#L2463) + `applyStateMigrations()`
([index.html:2638-2725](index.html#L2638), довносит ключи, которых нет в
начальном литерале, с дефолтами) + отдельные точки создания новых ключей
по всему файлу. Полный список (собран grep'ом `state\.\w+\s*=` по всему
`index.html`, 148 мест присвоения, сведено к уникальным именам) — **58
ключей**, плюс `_rev`/`_updatedAt` дублируются как «служебные» (см. ниже).

| Категория | Ключи |
|---|---|
| Бизнес-данные (массивы/объекты) | `clients, recipes, reactors, pouringLines, requests, batches, roles, stockLevels, wpClients, wpDemand, wpBrewPlan, wpGenerated, journalEntries, systemEvents, loggedAlarmKeys, integrations` |
| Брендинг | `companyName, companyLogoUrl` |
| Настройки/счётчики | `batchCounter, requestCounter, workdayHours, sheetsUrl (legacy), recipeSkuCounter` |
| Навигация (кастомизация сайдбара) | `navTabsOrder, navTabsLabels` |
| View-state конкретных страниц (UI-выбор, не бизнес-данные) | `filterStatus, filterReactor, filterPouringLine, filterRequestStatus, currentBatchId, currentPouringId, calMonth, calYear, calSelectedDate, wpWeekStart, wpHistoryCollapsed, pmDate, pmShowAll, journalActiveTab, journalShowAll, journalStatusFilter, journalDate, journalSeverityFilter, dashDate, dashHorizon, dashPreset, dashWeekOffset, dashStart, reportsDate, intakeDate, intakeShowAll, warshchikViewDate, warshchikViewingHistory, recipesSelectedCategory, alarmsCollapsed, theme, themeUserSet` |
| Служебные/sync | `_rev, _updatedAt` (первое также дублируется сервером — [api/state.php:75](api/state.php#L75), `$state['_rev'] = $newRev`) |

Все 58+2 ключа — часть ЕДИНОГО объекта `data`, отдаваемого целиком любой
валидной сессии (см. §3 предыдущей находки) — деления по ключам на сервере
нет вообще.

### 6.3 Вкладка → рендер-функция → что ей реально нужно (по коду рендера)

| Вкладка (`id` в `tabs`) | Рендер-функция(и) | Ключи `state`, законно нужные (прямо/подтверждённо-косвенно) |
|---|---|---|
| `dashboard` | `renderDashboard()`+`renderBiAnalytics()`+суб-блоки, [index.html:4729-5081](index.html#L4729); диапазон дат — `dashRange()`, [index.html:4279-4362](index.html#L4279) | `batches, requests, reactors, recipes, pouringLines, workdayHours` + view-state `dashDate, dashPreset, dashHorizon, dashWeekOffset, dashStart` |
| `production` | `renderProductionManagement()`+`renderPmContent()`, [index.html:5082-5553](index.html#L5082) | `reactors, pouringLines, workdayHours` + view-state `pmDate, pmShowAll`; `batches` — **косвенно**, через `pmGetDateFilteredBatches()` (не в теле рендера напрямую, но вызывается из него — [index.html:5096](index.html#L5096)); `roles` — косвенно через `getRoleById()` (назначенный оператор варки/розлива, [index.html:5198,5294,5332,5356,5418,5445](index.html#L5198)). `recipes` — **прямого или подтверждённого косвенного обращения не найдено** (единственное найденное `state.recipes.find` рядом по коду — внутри `mkRequest()`, [index.html:3925](index.html#L3925), который создаёт `state.requests`, т.е. относится к отдельному, орфанному потоку, не к production). |
| `weekplan` | `renderWeekPlan()`+`renderWpHistory()`, [index.html:5554-5999](index.html#L5554) | `clients, wpClients, recipes, stockLevels, wpDemand, wpBrewPlan, wpGenerated, batches, workdayHours` + view-state `wpWeekStart, wpHistoryCollapsed` |
| `calendar` | `renderCalendar()`+`renderCalDayDetail()`, [index.html:8886-9235](index.html#L8886) (по факту диапазона до конца найденных `state.*`-обращений) | `batches, reactors, workdayHours` + view-state `calMonth, calYear, calSelectedDate` |
| `warshchik` | `renderWarshchikBatches()`+панели, [index.html:6083-6394](index.html#L6083); детальная карточка партии — `renderZakladkaDetail()`, [index.html:8598-8636](index.html#L8598) | `batches, reactors` + view-state `warshchikViewDate, warshchikViewingHistory, filterReactor`; `roles` — косвенно через `getRoleById()` ([index.html:6093,6141,6245](index.html#L6093), видимость полей своей же роли). **`recipes` подтверждённо НЕ нужен**: состав сырья на партии берётся из `b.ingredients`, посчитанного и записанного в саму партию при её создании (`mkBatch()`, `calcIngredients()`, [index.html:3838](index.html#L3838)) — денормализовано, не требует `state.recipes`. |
| `intake` | `renderIntake()`+панели+`renderPouringDetail()`, [index.html:6395-6846](index.html#L6395) | `batches, pouringLines` + view-state `intakeDate, intakeShowAll, filterPouringLine, currentPouringId`; `roles` — косвенно через `getRoleById()` ([index.html:6404,6710](index.html#L6404)). `recipes` — не обнаружено ни прямо, ни косвенно. |
| `reports` | `renderReports()`, [index.html:6847-7116](index.html#L6847) | `batches` + view-state `reportsDate`. `recipes` — прямого обращения в теле рендера не найдено (не исключает косвенного через непроверенный этой диагностикой хелпер — граница метода, см. врезку в начале раздела). |
| `journal` | `renderSystemEvents()`+`renderJournalActions()`+`renderJournal()`, [index.html:7117-7331](index.html#L7117) | `journalEntries, systemEvents, batches` + view-state `journalActiveTab, journalDate, journalShowAll, journalStatusFilter, journalSeverityFilter`; `roles` — косвенно через `getRoleById()` ([index.html:7283](index.html#L7283)). |
| `admin` | `renderAdmin()`+все `admin-section-*`-обработчики, [index.html:7430](index.html#L7430) далее (роли/доступы/клиенты/реакторы/линии/рецептуры/настройки/меню/подключения/брендинг/журнал/бэкап — см. §2.2 п. MFG-022…031 в `ТЗ_Manufacture_v2.0.md`, не редактировался, использован только как опись) | `roles, clients, reactors, pouringLines, recipes, workdayHours, navTabsOrder, navTabsLabels, integrations, sheetsUrl, companyName, companyLogoUrl` напрямую по разделам; `requests` — **только** как часть целикового экспорта «Резервная копия» (`downloadStateBackup()`, [index.html:1965-1969](index.html#L1965)) — отдельного просмотра заявок нет и у `admin` тоже (в `ALL_TABS` раздела `requests` нет ни для одной роли, см. §1 выше). |

### 6.4 Свод по ролям

| Роль | Объединённые законные ключи (union по её `tabs` из §6.3) | Что реально приходит в `data` сверх этого списка (по факту — весь §6.2) |
|---|---|---|
| `admin` | Почти всё бизнес-ядро напрямую + `requests` только как экспорт-бэкап | Ничего сверх «прямого просмотра» практически не остаётся, кроме нюанса с `requests` (см. §6.3) |
| `operator` | dashboard+production+weekplan+calendar+reports+journal → `batches, requests(только dashboard-агрегаты), recipes, reactors, pouringLines, workdayHours, clients, wpClients, stockLevels, wpDemand, wpBrewPlan, wpGenerated, journalEntries, systemEvents, roles(косвенно)` | `navTabsOrder/Labels, integrations, sheetsUrl, companyName, companyLogoUrl` — admin-only ключи брендинга/меню/интеграций технически тоже в `data`, хотя `operator` не имеет `admin` в `tabs` |
| `warshchik` | `batches, reactors` (+`roles` косвенно, своя видимость полей) | **`requests, recipes, clients, wpClients, wpDemand, wpBrewPlan, wpGenerated, stockLevels, journalEntries, systemEvents, navTabsOrder/Labels, integrations, sheetsUrl, companyName, companyLogoUrl`** — весь этот список приходит целиком, ни один пункт не виден ни в одной странице роли `warshchik` |
| `intake` | `batches, pouringLines` (+`roles` косвенно) | Аналогично `warshchik`, плюс `reactors` (нет ни одной страницы `intake`, где `state.reactors` был бы прочитан — только `pouringLines`) |
| `viewer` | dashboard+reports+journal → `batches, requests(dashboard-агрегаты), recipes, reactors, pouringLines, workdayHours, journalEntries, systemEvents` | `clients, wpClients, wpDemand, wpBrewPlan, wpGenerated, stockLevels, roles(полный список, не только своя запись), navTabsOrder/Labels, integrations, sheetsUrl, companyName, companyLogoUrl` |

### 6.5 Ключи, не показанные ВООБЩЕ ни в одном известном page-блоке

- **`requests`** — уже установлено в §1-4: нет `tabs: 'requests'` ни у одной
  роли, включая `admin`; единственный путь — целиковый экспорт бэкапа
  (§6.3). Это отдельная, уже задокументированная находка (страница
  `page-requests` физически существует в DOM, но не в навигации).
- **`sheetsUrl`** — поле-предшественник `integrations.googleSheets`.
  Единственное действующее место с полем ввода — `#int-googleSheets`,
  пишет в `state.integrations.googleSheets`
  ([index.html:8080](index.html#L8080)); `state.sheetsUrl` сегодня
  участвует только в одноразовой миграции
  ([index.html:2722-2723](index.html#L2722)) — прямого UI-владельца
  (поля ввода/отображения именно этого ключа) не найдено.
- **`_rev`, `_updatedAt`** — служебные поля синхронизации (легаси-версия
  документа и метка последнего сохранения), не бизнес-раздел и не
  предполагают отдельного page-блока по своей природе — отмечены отдельно
  от «находок», а не как аномалия.

Остальные ключи из §6.2 — у каждого нашёлся хотя бы один прямой или
подтверждённый косвенный обращающийся `render*()`/хелпер (см. §6.3),
за отдельно оговорённым исключением `recipes` для `production`/`reports`
(не найдено, но и не доказано отсутствие — граница метода).

### 6.6 Неоднозначные случаи

1. **`state.roles` — нет единственного «владельца».** Основной пишущий/
   управляющий раздел — `admin` («Роли»), но ЧИТАЮТ его косвенно через
   `getRoleById()` ещё 4 вкладки: `production` (имя назначенного
   оператора), `warshchik`/`intake` (видимость полей собственной роли),
   `journal` (не проверено, для чего именно — см. [index.html:7283](index.html#L7283)).
   То есть у самой ограниченной роли (`warshchik`, `tabs:['warshchik']`)
   есть законная, кодом подтверждённая причина видеть **часть** `state.roles`
   (свою запись) — но не весь массив логинов/`tabs` всех ролей компании,
   который она получает по факту. Разделения «нужна своя запись» / «нужен
   весь список» на уровне кода нет — это структурная неоднозначность, а не
   баг одной страницы.
2. **`state.recipes` — три разных владельца с разной степенью необходимости.**
   `admin` («Рецептуры», полное управление), `weekplan` (пропорции
   `tara`/`baseBatch` для расчёта плана), `dashboard` (названия SKU в
   агрегатах). Ни один из трёх не относится к `warshchik`/`intake`, но само
   наличие трёх непересекающихся легитимных потребителей у одного ключа —
   типичный случай «нельзя просто закрыть ключ одной проверке роли», если
   решение когда-либо будет приниматься.
3. **`state.clients` — два владельца.** `admin` («Клиенты», список) и
   `weekplan` (выбор клиента в таблице плана). Не связано ни с одной ролью
   цеха.
4. **`state.batches` — фактически общий для всех операционных вкладок.**
   Единственная роль, не имеющая ни одной вкладки, читающей `batches` —
   такой не нашлось: `dashboard, production, weekplan, calendar, warshchik,
   intake, reports, journal` — все восемь неадминских вкладок так или иначе
   его используют. Это не «неоднозначность владения», а иной класс
   ситуации: ключ структурно общий для всей модели партии, сузить его по
   ролям без изменения модели данных, по-видимому, нельзя — фиксируется
   как факт, не как находка.
5. **`workdayHours`, `reactors`, `pouringLines` — один писатель
   (`admin`, разделы «Реакторы»/«Линии розлива»/«Параметры производства»),
   много читателей** (`dashboard, production, weekplan, calendar,
   warshchik`/`intake` — каждый только свой список: `reactors` у
   `warshchik`, `pouringLines` у `intake`). Однозначного конфликта нет
   (структура «настройка админом → используется цехом» ожидаема), но
   технически это тоже «один раздел `state`, несколько ролей», раз вопрос
   был именно про это.

---

## Итог по разделу 6 — для чата (сколько ролей/ключей/сопоставлений)

- Ролей (по коду): **5** (`admin, operator, warshchik, intake, viewer`) —
  плюс явно оговорённая граница: реальные кастомные роли на проде не
  проверялись (нет доступа).
- Ключей верхнего уровня `state`: **58** бизнес/настроечных/view-state +
  **2** служебных (`_rev`, `_updatedAt`) = **60**.
- Однозначных сопоставлений «ключ → единственная законная вкладка/роль»:
  **view-state ключи (32 шт.)** — каждый привязан ровно к одной странице
  (`pmDate`↔production, `warshchikViewDate`↔warshchik и т.д.) — однозначны
  по построению (название = префикс страницы). Из бизнес-ключей однозначны:
  `journalEntries, systemEvents, loggedAlarmKeys` (→ только journal),
  `navTabsOrder, navTabsLabels, integrations, companyName, companyLogoUrl`
  (→ только admin), `stockLevels, wpDemand, wpBrewPlan, wpGenerated`
  (→ только weekplan) — итого около **43** ключей с одним чётким
  владельцем.
- Неоднозначных/многовладельческих случаев, требующих решения владельца
  при проектировании фикса: **5** (перечислены в §6.6) — `roles`,
  `recipes`, `clients`, `batches` (структурно-общий), связка
  `workdayHours/reactors/pouringLines` (один писатель/много читателей).
  Плюс отдельно — уже известный `requests` (0 законных владельцев вообще)
  и `sheetsUrl` (legacy, без активного владельца).

---

## 7. Исправлено (Часть 1 из 2, 2026-08-25)

> Решение владельца, объём строго ограничен: только 3 ключа в
> `api/state.php`. `state.roles, state.clients, state.batches,
> state.workdayHours/reactors/pouringLines` — НЕ трогались, отложены
> отдельным пунктом (см. `tasks/todo.md`).

### Что изменено

Файл: [api/state.php](api/state.php).

1. Добавлены константы и функция-фильтр
   [api/state.php:11-34](api/state.php#L11):
   - `STATE_KEYS_DROP_ALWAYS = ['requests', 'sheetsUrl']` — вырезаются из
     `data` для ЛЮБОЙ сессии.
   - `STATE_KEYS_DROP_SHOPFLOOR = ['recipes']`, `SHOPFLOOR_ROLE_IDS =
     ['warshchik', 'intake']` — `recipes` дополнительно вырезается только
     для этих двух ролей (по `session['role_id']`, т.е. по эффективной
     роли, а не по способу входа — локальный логин или SSO-сессия с
     `role_id`, сопоставленным на `warshchik`/`intake`, обрабатываются
     одинаково).
   - `filterStateJsonForSession(string $json, array $session): string` —
     `json_decode` → `unset()` нужных ключей → `json_encode(...,
     JSON_UNESCAPED_UNICODE)`; при нераспознанном JSON возвращает вход как
     есть (не падает, не глотает ошибку молча — просто не режет то, что не
     смогла разобрать).
2. Применена в **двух** местах, где `api/state.php` отдаёт содержимое
   `data` целиком — оба входили в «ответ» эндпоинта, оба нужно было
   закрыть одним фильтром, иначе фикс обходился конфликтным POST:
   - GET-успех — [api/state.php:48](api/state.php#L48).
   - POST → 409 conflict — [api/state.php:86](api/state.php#L86)
     (расширение относительно исходной постановки задачи: в ней были
     упомянуты «ВСЕ роли получают ответ GET», но `data` целиком отдаётся
     и здесь, под тем же `requireAuth()`, без всякой фильтрации — до
     фикса это был прямой обход GET-ограничения одним POST'ом с заведомо
     неверным `baseRev`. Явно выделено, чтобы можно было откатить именно
     эту часть при необходимости).
3. **Не менялось**: запись в БД (`$state`, `syncRolesFromState()`,
   `rolesForState()`, транзакция, `_rev`) — фильтр применяется только к
   тому, что уходит в HTTP-ответ, не к тому, что хранится или пишется.
   POST-успех (`{"rev":N}`) `data` не возвращает вообще — там нечего
   было фильтровать, не тронут.

### Легитимные сценарии по ролям — что каждая должна получать после фикса

По карте из §6.3/6.4 (не по догадке):

| Роль | Легитимные разделы `data` (по картe §6.3) | `requests`/`sheetsUrl` | `recipes` |
|---|---|---|---|
| `admin` | практически всё бизнес-ядро напрямую | убраны (0 законных потребителей были и у admin — см. §6.3, единственный путь был через целиковый бэкап, не точечный просмотр) | остаётся |
| `operator` | dashboard/production/weekplan/calendar/reports/journal — `batches, recipes, reactors, pouringLines, workdayHours, clients, wpClients, stockLevels, wpDemand, wpBrewPlan, wpGenerated, journalEntries, systemEvents, roles(косвенно)` | убраны | остаётся (нужен dashboard и weekplan) |
| `warshchik` | `batches, reactors, roles(косвенно)` | убраны | убран (подтверждено: ingredients денормализованы в `batch.ingredients`, §6.3) |
| `intake` | `batches, pouringLines, roles(косвенно)` | убраны | убран (аналогично) |
| `viewer` | dashboard/reports/journal — `batches, recipes, reactors, pouringLines, workdayHours, journalEntries, systemEvents` | убраны | остаётся (нужен dashboard) |

Ни один пункт из колонки «легитимные разделы» не входит в списки
`STATE_KEYS_DROP_ALWAYS`/`STATE_KEYS_DROP_SHOPFLOOR` — фильтр вырезает
только то, для чего в §6.3/6.5 не нашлось ни одного потребителя
(`requests`, `sheetsUrl`) либо потребитель прямо исключён по роли
(`recipes` у `warshchik`/`intake`).

### Как проверено

Доступа к боевой/локальной MySQL нет (креды от локального MariaDB на этой
машине неизвестны, подбирать их не стал — это было бы попыткой
несанкционированного доступа, пусть и к локальной службе; правило проекта
и так требует тестировать только на изолированной копии, а не считает
угадывание паролей приемлемым способом её получить). Живой HTTP-запрос к
реальному `api/state.php` в рамках этой сессии не выполнялся.

Вместо этого — тот же принцип изоляции, что уже применялся в истории
проекта для JS (`tasks/todo.md`: «извлечь `<script>` без src и прогнать
через `new vm.Script`»): **дословно извлечён** (программно, по маркерам в
самом файле — не перепечатан вручную) блок [api/state.php:11-34](api/state.php#L11)
и выполнен в изолированном PHP 8.3 CLI без БД и без HTTP-контекста, на
синтетических данных (не боевых), для каждой из 5 ролей + негативный
тест на невалидный JSON:

```
admin      requests=absent sheetsUrl=absent recipes=present (expected present) untouched_keys_intact=yes => PASS
operator   requests=absent sheetsUrl=absent recipes=present (expected present) untouched_keys_intact=yes => PASS
warshchik  requests=absent sheetsUrl=absent recipes=absent (expected absent) untouched_keys_intact=yes => PASS
intake     requests=absent sheetsUrl=absent recipes=absent (expected absent) untouched_keys_intact=yes => PASS
viewer     requests=absent sheetsUrl=absent recipes=present (expected present) untouched_keys_intact=yes => PASS
malformed-json passthrough => PASS

ALL TESTS PASS
```

Для каждой роли дополнительно проверено байт-в-байт равенство «нетронутых»
ключей (`batches, roles, clients, workdayHours, reactors, pouringLines`)
входу — то есть прямое подтверждение, что список «НЕ ТРОГАТЬ» из
постановки задачи действительно не тронут этим кодом, а не просто не
упомянут в диффе.

Синтаксис всего файла проверен `php -l` (PHP 8.3, локально) — без ошибок.

**Граница проверки:** это тест ЛОГИКИ фильтра в изоляции, не
end-to-end тест реального HTTP-запроса через `requireAuth()`/`pdo()`/
живую сессию — тот уровень проверки either требует доступа к MySQL
(которого нет и не добывался) либо развёртывания на сервере (что не
входило в объём этой части). Риск, который это оставляет непроверенным:
корректность самого `$session['role_id']`, которую формирует
`currentSession()`/`verifyPortalToken()` — но эта часть кода фиксом не
менялась, только читается (`$session['role_id'] ?? null`), и это
единственная точка контакта нового кода с остальной системой.
